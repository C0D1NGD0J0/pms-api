import bunyan from 'bunyan';
import { container } from '@di/index';
import { t } from '@shared/languages';
import { UAParser } from 'ua-parser-js';
import ProfileDAO from '@dao/profileDAO';
import slowDown from 'express-slow-down';
import rateLimit from 'express-rate-limit';
import { AuthCache } from '@caching/auth.cache';
import { ClamScannerService } from '@shared/config';
import { NextFunction, Response, Request } from 'express';
import { LanguageService } from '@shared/languages/language.service';
import { PermissionService } from '@services/permission/permission.service';
import { EventEmitterService, AuthTokenService, DiskStorage } from '@services/index';
import { RateLimitOptions, RequestSource, TokenType } from '@interfaces/utils.interface';
import { InvalidRequestError, UnauthorizedError, ForbiddenError } from '@shared/customErrors';
import { PermissionResource, PermissionAction, ICurrentUser, EventTypes } from '@interfaces/index';
import { extractMulterFiles, generateShortUID, httpStatusCodes, JWT_KEY_NAMES } from '@utils/index';

interface DIServices {
  permissionService: PermissionService;
  emitterService: EventEmitterService;
  tokenService: AuthTokenService;
  profileDAO: ProfileDAO;
  authCache: AuthCache;
}

interface PermissionCheck {
  resource: PermissionResource | string;
  action: PermissionAction | string;
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
    const { tokenService, profileDAO, authCache, permissionService }: DIServices =
      req.container.cradle;
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

    // Validate connection status
    if (req.context.currentuser) {
      const activeConnection = req.context.currentuser.clients.find(
        (c: any) => c.cuid === req.context.currentuser!.client.cuid
      );

      if (!activeConnection || !activeConnection.isConnected) {
        return next(new UnauthorizedError({ message: 'User connection inactive' }));
      }

      // Populate user permissions using PermissionService
      if (permissionService) {
        req.context.currentuser = await permissionService.populateUserPermissions(
          req.context.currentuser
        );
      }
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

    const uploadMiddleware = diskStorage.uploadMiddleware(fieldNames);
    uploadMiddleware(req, res, (err: any) => {
      if (err) {
        console.error('❌ [ERROR] diskUpload middleware failed:', err);
      }
      next(err);
    });
  };

export const scanFile = async (req: Request, res: Response, next: NextFunction) => {
  const {
    emitterService,
    clamScanner,
  }: { emitterService: EventEmitterService; clamScanner: ClamScannerService } =
    req.container.cradle;

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
      emitterService.emit(
        EventTypes.DELETE_LOCAL_ASSET,
        foundViruses.map((file) => file.fileName)
      );
      return next(new InvalidRequestError({ message: 'Error processing uploaded files.' }));
    }

    if (validFiles.length) {
      req.body.scannedFiles = validFiles;
    }

    return next();
  } catch (error) {
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
          // responseObject,
          `${req.method} --> ${req.originalUrl} --> ${res.statusCode} --> ${duration}ms`
        );
      } else if (res.statusCode >= 200) {
        logger.trace(
          // responseObject,
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

/**
 * Middleware to detect and set language based on request headers or query params
 */
export const detectLanguage = async (req: Request, _res: Response, next: NextFunction) => {
  const { languageService }: { languageService: LanguageService } = req.container.cradle;

  const language =
    (req.query.lang as string) ||
    req.headers['accept-language']?.split(',')[0]?.split('-')[0] ||
    'en';

  const supportedLanguages = languageService.getAvailableLanguages();
  const selectedLanguage = supportedLanguages.includes(language) ? language : 'en';

  await languageService.setLanguage(selectedLanguage);

  req.context.langSetting = {
    lang: selectedLanguage,
    t: (key: string, params?: Record<string, string | number>) => {
      return languageService.t(key, params);
    },
  };

  next();
};

/**
 * set language from user preferences (after authentication)
 * order of choice: user.preferences.lang > client.settings.lang > profile.lang > request.lang > default
 * Automatically skips if no authenticated user (for public routes)
 */
export const setUserLanguage = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const { languageService }: { languageService: LanguageService } = req.container.cradle;
    const currentUser = req.context?.currentuser;

    if (!currentUser) {
      return next();
    }

    let userLanguage = req.context?.langSetting?.lang || 'en';

    if (currentUser.preferences?.lang) {
      userLanguage = currentUser.preferences.lang;
    } else if ((currentUser as any).clientSettings?.lang) {
      userLanguage = (currentUser as any).clientSettings.lang;
    } else if ((currentUser as any).profile?.lang) {
      userLanguage = (currentUser as any).profile.lang;
    }

    const supportedLanguages = languageService.getAvailableLanguages();
    const selectedLanguage = supportedLanguages.includes(userLanguage) ? userLanguage : 'en';

    await languageService.setLanguage(selectedLanguage);

    req.context.langSetting = {
      lang: selectedLanguage,
      t: (key: string, params?: Record<string, string | number>) => {
        return languageService.t(key, params);
      },
    };

    next();
  } catch (error) {
    console.error('Error in setUserLanguage middleware:', error);
    next();
  }
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
        isMobile: /mobile|android|iphone/i.test((req.headers['user-agent'] as string) || ''),
        isBot: /bot|crawler|spider|scraper/i.test((req.headers['user-agent'] as string) || ''),
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
      langSetting: req.context?.langSetting || {
        lang: 'en',
        t: undefined,
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

/**
 * Common validation helper - checks user auth and connection status
 * Returns validated user or throws error
 */
const validateUserAndConnection = (req: Request, next: NextFunction): ICurrentUser | null => {
  const { currentuser } = req.context;

  if (!currentuser) {
    next(new UnauthorizedError({ message: t('auth.errors.unauthorized') }));
    return null;
  }

  // Check if user's connection to active client is still active
  const activeConnection = currentuser.clients.find((c: any) => c.cuid === currentuser.client.cuid);
  if (!activeConnection?.isConnected) {
    next(new UnauthorizedError({ message: t('auth.errors.connectionInactive') }));
    return null;
  }

  return currentuser;
};

/**
 * check if user has specific permission
 * Includes client context validation for client-specific resources
 */
export const requirePermission = (
  resource: PermissionResource | string,
  action: PermissionAction | string
) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const currentuser = validateUserAndConnection(req, next);
      if (!currentuser) return;

      // Check client context for client-specific resources
      const clientId = req.params.clientId || req.params.cuid;
      if (clientId && currentuser.client.cuid !== clientId) {
        return next(new ForbiddenError({ message: t('auth.errors.clientAccessDenied') }));
      }

      // For CLIENT resource actions, ensure user has appropriate role
      if (resource === PermissionResource.CLIENT) {
        const restrictedRoles = ['tenant', 'vendor'];
        if (restrictedRoles.includes(currentuser.client.role)) {
          return next(new ForbiddenError({ message: t('auth.errors.insufficientRole') }));
        }
      }

      const { permissionService }: { permissionService: PermissionService } = req.container.cradle;

      const hasPermission = await permissionService.checkUserPermission(
        currentuser,
        resource as PermissionResource,
        action as string
      );

      if (!hasPermission.granted) {
        return next(
          new ForbiddenError({
            message: t('auth.errors.insufficientPermissions', { resource, action }),
          })
        );
      }

      next();
    } catch (error) {
      console.error('Error in requirePermission middleware:', error);
      return next(new ForbiddenError({ message: t('auth.errors.permissionCheckFailed') }));
    }
  };
};

/**
 * this check if user has any of the specified permissions (OR logic)
 */
export const requireAnyPermission = (permissions: PermissionCheck[]) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const currentuser = validateUserAndConnection(req, next);
      if (!currentuser) return; // Error already handled

      const { permissionService }: { permissionService: PermissionService } = req.container.cradle;

      // Check if user has any of the specified permissions
      for (const permission of permissions) {
        const result = await permissionService.checkUserPermission(
          currentuser,
          permission.resource as PermissionResource,
          permission.action as string
        );
        if (result.granted) {
          return next(); // Found a valid permission, allow access
        }
      }

      // No valid permissions found
      return next(new ForbiddenError({ message: t('auth.errors.insufficientPermissions') }));
    } catch (error) {
      console.error('Error in requireAnyPermission middleware:', error);
      return next(new ForbiddenError({ message: t('auth.errors.permissionCheckFailed') }));
    }
  };
};

/**
 * this check if user has all specified permissions (AND logic)
 */
export const requireAllPermissions = (permissions: PermissionCheck[]) => {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const currentuser = validateUserAndConnection(req, next);
      if (!currentuser) return; // Error already handled

      const { permissionService }: { permissionService: PermissionService } = req.container.cradle;

      // Check that user has ALL specified permissions
      for (const permission of permissions) {
        const result = await permissionService.checkUserPermission(
          currentuser,
          permission.resource as PermissionResource,
          permission.action as string
        );
        if (!result.granted) {
          return next(
            new ForbiddenError({
              message: t('auth.errors.insufficientPermissions', {
                resource: permission.resource,
                action: permission.action,
              }),
            })
          );
        }
      }

      next();
    } catch (error) {
      console.error('Error in requireAllPermissions middleware:', error);
      return next(new ForbiddenError({ message: t('auth.errors.permissionCheckFailed') }));
    }
  };
};

/**
 * this check if user can manage other users (admin or manager with appropriate permissions)
 */
export const requireUserManagement = () => {
  return requireAnyPermission([
    { resource: PermissionResource.USER, action: PermissionAction.ASSIGN_ROLES },
    { resource: PermissionResource.CLIENT, action: PermissionAction.MANAGE_USERS },
  ]);
};
