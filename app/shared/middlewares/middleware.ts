import bunyan from 'bunyan';
import { container } from '@di/index';
import { UAParser } from 'ua-parser-js';
import ProfileDAO from '@dao/profileDAO';
import slowDown from 'express-slow-down';
import rateLimit from 'express-rate-limit';
import { AuthCache } from '@caching/auth.cache';
import { ClamScannerService } from '@shared/config';
import { NextFunction, Response, Request } from 'express';
import { ICurrentUser, EventTypes } from '@interfaces/index';
import { InvalidRequestError, UnauthorizedError } from '@shared/customErrors';
import { EventEmitterService, AuthTokenService, DiskStorage } from '@services/index';
import { RateLimitOptions, RequestSource, TokenType } from '@interfaces/utils.interface';
import { extractMulterFiles, generateShortUID, httpStatusCodes, JWT_KEY_NAMES } from '@utils/index';

interface DIServices {
  emitterService: EventEmitterService;
  tokenService: AuthTokenService;
  profileDAO: ProfileDAO;
  authCache: AuthCache;
}
export const scopedMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const scope = container.createScope();
  req.container = scope;

  // clean up on request finish
  res.on('finish', () => {
    if (req.container && typeof req.container.dispose === 'function') {
      req.container.dispose();
    }
  });
  // cleanup on error
  res.on('error', () => {
    if (req.container && typeof req.container.dispose === 'function') {
      req.container.dispose();
    }
  });

  next();
};

export const isAuthenticated = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tokenService, profileDAO, authCache }: DIServices = req.container.cradle;
    const token = tokenService.extractTokenFromRequest(req);

    if (!token) {
      return next(new UnauthorizedError({ message: 'Invalid authentication token' }));
    }

    const payload = await tokenService.verifyJwtToken(
      JWT_KEY_NAMES.ACCESS_TOKEN as TokenType,
      token as string
    );
    if (!payload.success || !payload.data?.sub) {
      return next(new UnauthorizedError({ message: 'Invalid authentication token' }));
    }

    const currentUserResp = await authCache.getCurrentUser(payload.data?.sub as string);
    if (!currentUserResp.success) {
      console.error('User not found in cache, fetching from database...');
      const _currentuser = await profileDAO.generateCurrentUserInfo(payload.data?.sub as string);
      if (_currentuser) {
        await authCache.saveCurrentUser(_currentuser);
        req.context.currentuser = _currentuser;
      }
    }

    if (currentUserResp.success && !req.context.currentuser) {
      req.context.currentuser = currentUserResp.data as ICurrentUser;
    }
    // contextbuilder is called here so params and query are available in the context
    contextBuilder(req, res, next);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      if (req.originalUrl === '/api/v1/auth/refresh_token') {
        return next();
      }
      return next(new UnauthorizedError({ message: 'Session expired.' }));
    }
    console.log(error);
    return next(new UnauthorizedError());
  }
};

export const diskUpload =
  (fieldNames: string[]) => async (req: Request, res: Response, next: NextFunction) => {
    const { diskStorage }: { diskStorage: DiskStorage } = req.container.cradle;
    diskStorage.uploadMiddleware(fieldNames)(req, res, next);
  };

export const scanFile = async (req: Request, res: Response, next: NextFunction) => {
  const {
    emitterService,
    clamScanner,
  }: { emitterService: EventEmitterService; clamScanner: ClamScannerService } =
    req.container.cradle;
  console.log('Scanning files...', clamScanner.isReady());
  const files = req.files;
  if (!files) {
    return next();
  }
  const _files = extractMulterFiles(files, req.context.currentuser?.sub);
  if (!req.context.currentuser) {
    return next(new UnauthorizedError({ message: 'Unauthorized action.' }));
  }
  try {
    const foundViruses: { fileName: string; viruses: string[]; createdAt: string }[] = [];
    const validFiles = [];

    for (const file of _files) {
      const { isInfected, viruses } = await clamScanner.scanFile(file.path);
      if (isInfected) {
        foundViruses.push({
          viruses,
          fileName: file.filename,
          createdAt: new Date().toISOString(),
        });
      } else {
        validFiles.push(file);
      }
    }
    if (foundViruses.length > 0) {
      console.log('Deleting infected files:', foundViruses);
      emitterService.emit(
        EventTypes.DELETE_LOCAL_ASSET,
        foundViruses.map((file) => file.fileName)
      );
      return next(new InvalidRequestError({ message: 'Error processing uploaded files.' }));
    }

    if (validFiles.length) {
      // this way we work with the files in the upload dir only that as been scanned and not req.files
      req.body.scannedFiles = validFiles;
    }

    return next();
  } catch (error) {
    console.error('Error during virus scan:', error);
    // delete files from disk when an error occurs regardless if its valid or infected file(memory saver)
    if (req.files) {
      const filesToDelete = extractMulterFiles(req.files).map((file) => file.filename);
      emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, filesToDelete);
    }
    next(new InvalidRequestError({ message: 'Error processing uploaded files.' }));
  }
};

export const routeLimiter = (options: RateLimitOptions = {}) => {
  const defaultOptions: RateLimitOptions = {
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 30,
    delayAfter: 20,
    delayMs: () => 500,
    message: 'Too many requests, please try again later.',
    enableSpeedLimit: true,
    enableRateLimit: true,
  };

  const middlewares: any[] = [];
  const mergedOptions = { ...defaultOptions, ...options };

  if (mergedOptions.enableRateLimit) {
    middlewares.push(
      rateLimit({
        windowMs: mergedOptions.windowMs,
        max: mergedOptions.max,
        standardHeaders: true,
        handler: (_req, res, _next) => {
          return res.status(httpStatusCodes.RATE_LIMITER).send(mergedOptions.message);
        },
      })
    );
  }

  if (mergedOptions.enableSpeedLimit) {
    middlewares.push(
      slowDown({
        windowMs: mergedOptions.windowMs,
        delayAfter: mergedOptions.delayAfter,
        delayMs: mergedOptions.delayMs,
      })
    );
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const applyMiddleware = (index: number) => {
      if (index >= middlewares.length) {
        return next();
      }

      middlewares[index](req, res, (err?: any) => {
        if (err) return next(err);
        applyMiddleware(index + 1);
      });
    };

    applyMiddleware(0);
  };
};

export const requestLogger =
  (logger: bunyan) => (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime();

    res.on('finish', () => {
      const [s, ns] = process.hrtime(start);
      const timestamp = new Date().toISOString();
      const duration = (s * 1000 + ns / 1e6).toFixed(2);
      const clientInfo = {
        ip: req.ip || req.socket.remoteAddress,
        userAgent: req.get('user-agent'),
        referer: req.get('referer') || '-',
      };
      const responseObject = {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        timestamp,
        ...clientInfo,
      };
      if (res.statusCode >= 400) {
        logger.error(
          responseObject,
          `${req.method} --> ${req.originalUrl} --> ${res.statusCode} --> ${duration}ms`
        );
      } else if (res.statusCode >= 300) {
        logger.warn(
          responseObject,
          `${req.method} --> ${req.originalUrl} --> ${res.statusCode} --> ${duration}ms`
        );
      } else if (res.statusCode >= 200) {
        logger.trace(
          responseObject,
          `${req.method} --> ${req.originalUrl} --> ${res.statusCode} --> ${duration}ms`
        );
      } else {
        logger.debug(
          responseObject,
          `${req.method} --> ${req.originalUrl} --> ${res.statusCode} --> ${duration}ms`
        );
      }
    });

    next();
  };

export const contextBuilder = (req: Request, res: Response, next: NextFunction) => {
  try {
    const sourceHeader = req.header('X-Request-Source') || RequestSource.UNKNOWN;
    const source = Object.values(RequestSource).includes(sourceHeader as RequestSource)
      ? (sourceHeader as RequestSource)
      : RequestSource.UNKNOWN;

    const uaParser = new UAParser(req.headers['user-agent'] as string);
    const uaResult = uaParser.getResult();
    req.context = {
      timestamp: new Date(),
      requestId: generateShortUID(12),
      source,
      ip: req.ip || req.socket.remoteAddress || '',
      userAgent: {
        raw: (req.headers['user-agent'] as string) || '',
        browser: uaResult.browser.name,
        version: uaResult.browser.version,
        os: uaResult.os.name,
        isBot: false,
        isMobile: /mobile|android|iphone/i.test((req.headers['user-agent'] as string) || ''),
      },
      request: {
        path: req.path,
        method: req.method,
        params: req.params,
        url: req.originalUrl,
        query: req.query as Record<string, any>,
      },
      currentuser: req.context?.currentuser || null,
      timing: {
        startTime: Date.now(),
      },
      service: {
        env: process.env.NODE_ENV || 'development',
      },
    };
    next();
  } catch (error) {
    console.error('Error in context middleware:', error);
    next(error);
  }
};
