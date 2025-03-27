import { container } from '@di/index';
import ProfileDAO from '@dao/profileDAO';
import { JWT_KEY_NAMES } from '@utils/index';
import { AuthCache } from '@caching/auth.cache';
import { AuthTokenService } from '@services/auth';
import { TokenType } from '@interfaces/utils.interface';
import { UnauthorizedError } from '@shared/customErrors';
import { NextFunction, Response, Request } from 'express';

interface DIServices {
  authTokenService: AuthTokenService;
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
    const { authTokenService, profileDAO, authCache }: DIServices = req.container.cradle;

    const token = authTokenService.extractTokenFromRequest(req);

    if (!token) {
      next(new UnauthorizedError({ message: 'Invalid authentication token' }));
    }

    const payload = await authTokenService.verifyJwtToken(
      JWT_KEY_NAMES.ACCESS_TOKEN as TokenType,
      token as string
    );
    if (!payload.success || !payload.data?.sub) {
      next(new UnauthorizedError({ message: 'Invalid authentication token' }));
    }

    const currentUserResp = await authCache.getCurrentUser(payload.data?.sub as string);
    if (!currentUserResp.success) {
      console.error(`User not found in cache, fetching from database: ${payload.data?.sub}`);
      const _currentuser = await profileDAO.generateCurrentUserInfo(payload.data?.sub as string);
      if (_currentuser) {
        await authCache.saveCurrentUser(_currentuser);
      }
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
