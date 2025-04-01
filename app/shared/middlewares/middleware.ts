import { container } from '@di/index';
import ProfileDAO from '@dao/profileDAO';
import { extractMulterFiles, JWT_KEY_NAMES } from '@utils/index';
import { AuthCache } from '@caching/auth.cache';
import { AuthTokenService } from '@services/auth';
import { TokenType } from '@interfaces/utils.interface';
import { InvalidRequestError, UnauthorizedError } from '@shared/customErrors';
import { NextFunction, Response, Request } from 'express';
import { DiskStorage } from '@services/fileUpload';
import { clamScanner, ClamScannerService } from '@shared/config';
import { ICurrentUser } from '@interfaces/index';

interface DIServices {
  tokenService: AuthTokenService;
  profileDAO: ProfileDAO;
  authCache: AuthCache;
}
export const scopedMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Create a scoped contaner
  const scope = container.createScope();
  // Attach the scoped container to the request
  req.container = scope;
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
      console.error(`User not found in cache, fetching from database...`);
      const _currentuser = await profileDAO.generateCurrentUserInfo(payload.data?.sub as string);
      if (_currentuser) {
        await authCache.saveCurrentUser(_currentuser);
        req.currentuser = _currentuser;
      }
    }

    if (currentUserResp.success && !req.currentuser) {
      req.currentuser = currentUserResp.data as ICurrentUser;
    }
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      next(
        new UnauthorizedError({ message: 'Authentication token has expired.', statusCode: 419 })
      );
    }
    next(new UnauthorizedError({ message: 'Authentication failed.' }));
  }
};

export const diskUpload = async (req: Request, res: Response, next: NextFunction) => {
  const { diskStorage }: { diskStorage: DiskStorage } = req.container.cradle;
  diskStorage.uploadMiddleware(req, res, next);
};

export const scanFile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      clamScanner,
      diskStorage,
    }: { diskStorage: DiskStorage; clamScanner: ClamScannerService } = req.container.cradle;
    const files = req.files;
    if (!files) {
      return next();
    }

    const foundViruses: { file: string; viruses: string[]; createdAt: string }[] = [];
    const _files = extractMulterFiles(files);
    const filenames = [];

    for (const file of _files) {
      const { isInfected, viruses } = await clamScanner.scanFile(file.path);

      if (isInfected) {
        foundViruses.push({
          viruses,
          file: file.filename,
          createdAt: new Date().toISOString(),
        });
        filenames.push(file.filename);
      }
    }

    await diskStorage.deleteFiles(filenames);
    if (foundViruses.length > 0) {
      console.error('Virus found in uploaded files:', foundViruses);
      return next(new InvalidRequestError({ message: 'Error processing uploaded files.' }));
    }

    return next();
  } catch (error) {
    console.error('Error during virus scan:', error);
    next(new InvalidRequestError({ message: 'Error processing uploaded files.' }));
  }
};
