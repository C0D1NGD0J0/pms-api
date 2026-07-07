import bunyan from 'bunyan';
import { container } from '@di/index';
import { t } from '@shared/languages';
import { UAParser } from 'ua-parser-js';
import ProfileDAO from '@dao/profileDAO';
import { AuthCache } from '@caching/auth.cache';
import { ClamScannerService } from '@shared/config';
export { preventTenantConflict } from '@utils/helpers';
import { NextFunction, Response, Request } from 'express';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { subscriptionPlanConfig } from '@services/subscription';
import { LanguageService } from '@shared/languages/language.service';
import { ITenantFeatureSettings } from '@interfaces/client.interface';
import { ROLE_GROUPS, ROLES } from '@shared/constants/roles.constants';
import { PermissionService } from '@services/permission/permission.service';
import { extractMulterFiles, generateShortUID, JWT_KEY_NAMES, createLogger } from '@utils/index';
import {
  ServiceUnavailableError,
  InvalidRequestError,
  UnauthorizedError,
  ForbiddenError,
} from '@shared/customErrors';
import {
  RateLimitOptions,
  IPermissionCheck,
  RequestSource,
  AppRequest,
  TokenType,
} from '@interfaces/utils.interface';
import {
  EventEmitterService,
  SubscriptionService,
  FeatureFlagService,
  AuthTokenService,
  DiskStorage,
} from '@services/index';
import {
  ISubscriptionEntitlements,
  ISubscriptionStatus,
  PermissionResource,
  PermissionAction,
  PermissionScope,
  ICurrentUser,
  EventTypes,
} from '@interfaces/index';

import { rateLimiterFactory } from './rateLimiterFactory';

interface DIServices {
  subscriptionService: SubscriptionService;
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
const logger = createLogger('MiddlewareLogger');

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

    const currentUserResp = await authCache.getCurrentUser(
      payload.data?.sub as string,
      payload.data.cuid
    );
    if (!currentUserResp.success) {
      logger.error('User not found in cache, fetching from database...');
      const _currentuser = await profileDAO.generateCurrentUserInfo(
        payload.data?.sub as string,
        payload.data.cuid
      );
      if (_currentuser) {
        if (_currentuser.client?.cuid !== payload.data.cuid) {
          return next(new UnauthorizedError({ message: 'Session context mismatch.' }));
        }
        if (_currentuser.subscription?.plan?.name) {
          const planConfig = subscriptionPlanConfig.getConfig(_currentuser.subscription.plan.name);
          if (planConfig) _currentuser.subscription.entitlements = planConfig.features;
        }
        await authCache.saveCurrentUser(_currentuser);
        req.context.currentuser = _currentuser;
      }
    }

    if (currentUserResp.success && !req.context.currentuser) {
      req.context.currentuser = currentUserResp.data as ICurrentUser;
    }

    if (req.context.currentuser) {
      const activeConnection = req.context.currentuser.clients.find(
        (c: any) => c.cuid === req.context.currentuser!.client.cuid
      );

      if (!activeConnection || !activeConnection.isConnected) {
        const isVendor = activeConnection?.roles?.includes('vendor');
        const isVendorPayoutRoute = /\/vendor[s]?\/[^/]+\/payout/.test(req.path);
        const isCurrentUserRoute = /\/auth\/[^/]+\/me$/.test(req.path);
        if (isVendor && (isVendorPayoutRoute || isCurrentUserRoute)) {
          // Disconnected vendors retain access to payout routes and their own user context
        } else {
          return next(new UnauthorizedError({ message: 'User connection inactive' }));
        }
      }

      if (permissionService) {
        req.context.currentuser = await permissionService.populateUserPermissions(
          req.context.currentuser
        );
      }

      // When a PM disables the tenant portal, ALL access is blocked — this is a hard suspension,
      // not read-only mode. Disconnected/former tenants (isConnected === false) are handled
      // separately in requireActiveTenant() and retain read-only access to their history.
      // Exception: /me and /logout are always allowed so the frontend can load the user's
      // identity, display the "portal suspended" screen, and let the tenant log out cleanly.
      if (req.context.currentuser?.client?.role === ROLES.TENANT) {
        const tenantFeatures = req.context.currentuser.client?.tenantFeatures;
        const isPortalSuspended = tenantFeatures?.tenantPortalActive === false;
        const isIdentityOrExitRoute =
          req.originalUrl.endsWith('/me') ||
          req.originalUrl.includes('/logout') ||
          req.originalUrl.includes('/notifications');
        if (isPortalSuspended && !isIdentityOrExitRoute) {
          return next(
            new ForbiddenError({
              message: 'Tenant portal access has been disabled by your property manager.',
            })
          );
        }
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
    logger.error(error);
    return next(new UnauthorizedError());
  }
};

export const diskUpload =
  (fieldNames: string[]) => async (req: Request, res: Response, next: NextFunction) => {
    const { diskStorage }: { diskStorage: DiskStorage } = req.container.cradle;

    const uploadMiddleware = diskStorage.uploadMiddleware(fieldNames);
    uploadMiddleware(req, res, (err: any) => {
      if (err) {
        logger.error('❌ [ERROR] diskUpload middleware failed:', err);
        return next(err);
      }
      diskStorage.validateMagicBytes()(req, res, next);
    });
  };

export const scanFile = async (req: Request, _res: Response, next: NextFunction) => {
  const logger = createLogger('ScanFileMiddleware');
  const { emitterService }: { emitterService: EventEmitterService } = req.container.cradle;

  const files = req.files;
  if (!files) {
    return next();
  }

  const _files = extractMulterFiles(files, req.context.currentuser?.sub);
  if (!req.context.currentuser) {
    return next(new UnauthorizedError({ message: 'Unauthorized action.' }));
  }

  try {
    const hasClamScanner = req.container.hasRegistration('clamScanner');

    if (!hasClamScanner) {
      logger.warn(
        { userId: req.context.currentuser.sub, fileCount: _files.length },
        'ClamAV scanner unavailable - skipping virus scan'
      );
      (req as AppRequest).scannedFiles = _files;
      return next();
    }

    const clamScanner: ClamScannerService = req.container.resolve('clamScanner');

    if (!clamScanner.isReady()) {
      logger.warn(
        { userId: req.context.currentuser.sub, fileCount: _files.length },
        'ClamAV scanner not ready - skipping virus scan'
      );
      (req as AppRequest).scannedFiles = _files;
      return next();
    }

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
      logger.error({ viruses: foundViruses }, 'File upload rejected: Viruses detected');
      return next(new InvalidRequestError({ message: 'Error processing uploaded files.' }));
    }

    if (validFiles.length) {
      (req as AppRequest).scannedFiles = validFiles;
    }

    return next();
  } catch (error) {
    logger.error({ error }, 'Error during file virus scanning');

    // Delete files from disk when an error occurs
    if (req.files) {
      const filesToDelete = extractMulterFiles(req.files).map((file) => file.filename);
      emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, filesToDelete);
    }

    next(new InvalidRequestError({ message: 'Error processing uploaded files.' }));
  }
};

/**
 * rate limiter middleware - blocks requests after max limit is reached
 * @param options - rate limiting options
 */
export const createRateLimit = (options: Partial<RateLimitOptions> = {}) => {
  return rateLimiterFactory.getRateLimiter(options);
};

/**
 * speed limiter middleware - adds delays after threshold is reached
 * @param options - speed limiting options
 */
export const createSpeedLimit = (options: Partial<RateLimitOptions> = {}) => {
  return rateLimiterFactory.getSpeedLimiter(options);
};

export const basicLimiter = (options: Partial<RateLimitOptions> = {}) => {
  return rateLimiterFactory.getBasicLimiter(options);
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
        requestId: (req as any).context?.requestId,
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
 * order of choice: user.preferences.lang > client.settings.lang > profile.settings.lang > request.lang > default
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
    logger.error('Error in setUserLanguage middleware:', error);
    next();
  }
};

/**
 * Attach lightweight subscription access control to request context
 * Runs after isAuthenticated, provides feature flags and payment status
 * All users (owner, staff, vendors, tenants) get the client's subscription
 */
export const subscriptionEntitlements = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const currentUser = req.context?.currentuser;
    if (!currentUser || !currentUser.client?.cuid) {
      return next(new UnauthorizedError({ message: 'Unauthorized action.' }));
    }

    const { subscriptionService }: DIServices = req.container.cradle;
    if (!subscriptionService) {
      return next(new UnauthorizedError({ message: 'Unauthorized action.' }));
    }

    const cuid = currentUser.client.cuid;
    const userRole = currentUser.client.role;
    const result = await subscriptionService.getSubscriptionEntitlements(cuid, userRole);
    if (result.success && result.data) {
      req.context.entitlements = result.data;
    }

    next();
  } catch (error) {
    logger.error('Error in subscriptionEntitlements middleware:', error);
    next(
      new ServiceUnavailableError({
        message: 'Subscription service is temporarily unavailable. Please try again.',
      })
    );
  }
};

export const contextBuilder = (req: Request, res: Response, next: NextFunction) => {
  try {
    const sourceHeader = req.header('X-Request-Source') || RequestSource.UNKNOWN;
    const source = Object.values(RequestSource).includes(sourceHeader as RequestSource)
      ? (sourceHeader as RequestSource)
      : RequestSource.UNKNOWN;

    const rawRequestId = req.headers['x-request-id'];
    const requestId =
      (Array.isArray(rawRequestId) ? rawRequestId[0] : rawRequestId) || generateShortUID(12);
    res.setHeader('X-Request-ID', requestId);

    const uaParser = new UAParser(req.headers['user-agent'] as string);
    const uaResult = uaParser.getResult();
    req.context = {
      timestamp: new Date(),
      requestId,
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
        get params() {
          return req.params;
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        set params(_value: Record<string, any>) {
          // no-op: getter always returns the live req.params
        },
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
    logger.error('Error in context middleware:', error);
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
    next(new UnauthorizedError({ message: t('common.errors.unauthorized') }));
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
        logger.error('Client ID mismatch: ', { clientId, userClientId: currentuser.client.cuid });
        return next(new ForbiddenError({ message: t('auth.errors.clientAccessDenied') }));
      }

      // For CLIENT resource actions, ensure user has appropriate role
      if (resource === PermissionResource.CLIENT) {
        const restrictedRoles = ROLE_GROUPS.EXTERNAL_ROLES;
        if (restrictedRoles.includes(currentuser.client.role as any)) {
          logger.error('Insufficient role for CLIENT resource:', {
            role: currentuser.client.role,
            resource,
            action,
          });
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
        logger.warn('Permission denied:', {
          userId: currentuser.sub,
          resource,
          action,
          reason: hasPermission.reason,
        });
        return next(
          new ForbiddenError({
            message: t('common.errors.insufficientPermissions', {
              resource,
              action,
              reason: hasPermission.reason || '',
            }),
          })
        );
      }

      next();
    } catch (error) {
      logger.error('Error in requirePermission middleware:', error);
      return next(new ForbiddenError({ message: t('auth.errors.permissionCheckFailed') }));
    }
  };
};

/**
 * Restrict access to primary vendor users only.
 * Must be placed after isAuthenticated.
 */
export const requirePrimaryVendor = (req: Request, _res: Response, next: NextFunction) => {
  const currentUser = req.context?.currentuser;
  if (!currentUser?.vendorInfo?.isPrimaryVendor) {
    return next(
      new ForbiddenError({
        message: t('common.errors.insufficientPermissions', {
          resource: 'payout',
          action: 'manage',
          reason: 'Only primary vendor account holders can manage payout settings',
        }),
      })
    );
  }
  next();
};

/**
 * Check if the current user's subscription entitles them to a specific feature.
 * Requires `subscriptionEntitlements` middleware to have run first.
 */
export const requireFeature = (featureName: keyof ISubscriptionEntitlements['entitlements']) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const entitlements = req.context?.entitlements?.entitlements;
    if (!entitlements) {
      return next(new ForbiddenError({ message: t('auth.errors.entitlementsUnavailable') }));
    }
    if (!entitlements[featureName]) {
      return next(new ForbiddenError({ message: t('auth.errors.featureNotEntitled') }));
    }
    next();
  };
};

/**
 * Blocks requests when the client's subscription is not in an active state.
 * Requires `subscriptionEntitlements` middleware to have run first.
 * Fails open (allows request) when entitlements could not be loaded, so a
 * subscription service outage does not break the application.
 */
export const requireActiveSubscription = (req: Request, _res: Response, next: NextFunction) => {
  const entitlements = req.context?.entitlements;
  if (!entitlements) {
    return next(
      new ServiceUnavailableError({
        message: 'Unable to verify subscription status. Please try again.',
      })
    );
  }
  const { status } = entitlements.plan;
  if (status === ISubscriptionStatus.INACTIVE || status === ISubscriptionStatus.PENDING_PAYMENT) {
    return next(new ForbiddenError({ message: t('auth.errors.subscriptionInactive') }));
  }
  // PAST_DUE is allowed through — grace period is active, banner shown on frontend
  next();
};

/**
 * Blocks access when the client account is suspended.
 * Must run after isAuthenticated. Do NOT apply to auth routes.
 */
export const requireNotSuspended = (req: Request, _res: Response, next: NextFunction) => {
  const currentuser = validateUserAndConnection(req, next);
  if (!currentuser) return;

  if (currentuser.client.suspension?.isActive) {
    return next(
      new ForbiddenError({ message: 'This account has been suspended. Please contact support.' })
    );
  }

  next();
};

/**
 * Ensures the client account is verified before allowing business-critical actions.
 * Must run after isAuthenticated.
 */
export const requireVerifiedClient = (req: Request, _res: Response, next: NextFunction) => {
  const currentuser = validateUserAndConnection(req, next);
  if (!currentuser) return;

  if (!currentuser.client.isVerified) {
    return next(new ForbiddenError({ message: t('auth.errors.clientNotVerified') }));
  }

  next();
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
      return next(new ForbiddenError({ message: t('common.errors.insufficientPermissions') }));
    } catch (error) {
      logger.error('Error in requireAnyPermission middleware:', error);
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
              message: t('common.errors.insufficientPermissions', {
                resource: permission.resource,
                action: permission.action,
              }),
            })
          );
        }
      }

      next();
    } catch (error) {
      logger.error('Error in requireAllPermissions middleware:', error);
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

/**
 * Enhanced permission middleware with resource context validation
 */
export const requirePermissionWithContext = (
  resource: PermissionResource | string,
  action: PermissionAction | string,
  contextExtractor?: (req: Request) => {
    resourceId?: string;
    ownerId?: string;
    assignedUsers?: string[];
  }
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

      // Extract resource context if provided
      let context: Record<string, any> = {};
      let scope: PermissionScope | undefined;
      if (contextExtractor) {
        try {
          const extractedContext = contextExtractor(req);
          // Auto-determine scope: if ownerId matches the current user, use MINE scope
          const ownerId = extractedContext?.ownerId;
          const isOwner = ownerId
            ? ownerId === currentuser.uid || ownerId === currentuser.sub
            : false;
          if (ownerId) {
            scope = isOwner ? PermissionScope.MINE : PermissionScope.ANY;
          }
          context = {
            clientId: currentuser.client.cuid,
            userId: currentuser.sub,
            // When ownership is confirmed via uid or sub, normalize resourceOwnerId to sub
            // so validateMineScope's resourceOwnerId === userId comparison always works
            // regardless of which identifier type (uid hash vs ObjectId) was in the URL param.
            resourceOwnerId: isOwner ? currentuser.sub : extractedContext?.ownerId,
            ...extractedContext,
          };
        } catch (error) {
          logger.warn('Error extracting resource context:', error);
        }
      }

      const { permissionService }: { permissionService: PermissionService } = req.container.cradle;

      // Use enhanced permission check with context
      const permissionCheck: IPermissionCheck = {
        role: currentuser.client.role,
        resource: resource as PermissionResource,
        action: action as string,
        scope: scope ?? PermissionScope.ANY,
        context: {
          clientId: currentuser.client.cuid,
          userId: currentuser.sub,
          ...context,
        } as any,
      };

      const hasPermission = await permissionService.checkPermission(permissionCheck);

      if (!hasPermission.granted) {
        return next(
          new ForbiddenError({
            message: t('common.errors.insufficientPermissions', {
              resource,
              action,
              reason: hasPermission.reason || '',
            }),
          })
        );
      }

      next();
    } catch (error) {
      logger.error('Error in requirePermissionWithContext middleware:', error);
      return next(new ForbiddenError({ message: t('auth.errors.permissionCheckFailed') }));
    }
  };
};

/**
 * Property-specific middleware - validates property ownership/assignment
 */
export const requirePropertyPermission = (action: PermissionAction | string) => {
  return requirePermissionWithContext(PermissionResource.PROPERTY, action, (req: Request) => ({
    resourceId: req.params.propertyId || req.params.pid,
    // These would typically come from database lookups in real implementation
    ownerId: req.body?.ownerId,
    assignedUsers: req.body?.assignedUsers || [],
  }));
};

/**
 * Maintenance-specific middleware - validates maintenance request access
 */
export const requireMaintenancePermission = (action: PermissionAction | string) => {
  return requirePermissionWithContext(PermissionResource.MAINTENANCE, action, (req: Request) => ({
    resourceId: req.params.maintenanceId || req.params.mid,
    ownerId: req.body?.requestedBy,
    assignedUsers: req.body?.assignedTo ? [req.body.assignedTo] : [],
  }));
};

/**
 * User-specific middleware - validates user management permissions
 */
export const requireUserPermission = (action: PermissionAction | string) => {
  return requirePermissionWithContext(PermissionResource.USER, action, (req: Request) => ({
    resourceId: req.params.userId || req.params.uid,
    ownerId: req.params.userId || req.params.uid, // For "mine" scope validation
  }));
};

/**
 * Guard for tenant-role users: blocks write actions for former (disconnected) tenants
 * and optionally gates a specific PM-controlled feature toggle.
 * Fails open when tenantFeatures is absent to protect existing sessions.
 */
export const requireActiveTenant = (tenantFeature?: keyof ITenantFeatureSettings) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const currentUser = req.context?.currentuser;
    if (!currentUser) {
      return next(new UnauthorizedError({ message: t('common.errors.unauthorized') }));
    }

    // Only applies to tenant-role users; all other roles pass through
    if (currentUser.client?.role !== ROLES.TENANT) {
      return next();
    }

    // Block former (disconnected) tenants from write-like actions
    const activeConnection = currentUser.clients?.find(
      (c: any) => c.cuid === currentUser.client.cuid
    );
    if (!activeConnection?.isConnected) {
      return next(
        new ForbiddenError({
          message: t('auth.errors.connectionInactive'),
        })
      );
    }

    // Optionally gate a PM-controlled feature toggle
    if (tenantFeature) {
      const tenantFeatures = currentUser.client?.tenantFeatures;
      // Fails open if tenantFeatures is absent (protects existing sessions)
      if (tenantFeatures && tenantFeatures[tenantFeature] === false) {
        return next(
          new ForbiddenError({
            message: 'This feature has been disabled by your property manager.',
          })
        );
      }
    }

    next();
  };
};

/**
 * Sync middleware that blocks requests when a platform-level feature flag is disabled.
 * Reads env-var-based flags via FeatureFlagService; known flags default to enabled
 * (disabled only when the corresponding FEATURE_* env var is explicitly set to 'false').
 * Unknown/unregistered flags throw — add a case to FeatureFlagService before using.
 */
export const requireFeatureFlag = (flag: FeatureFlag) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const { featureFlagService }: { featureFlagService: FeatureFlagService } = req.container.cradle;

    if (!featureFlagService.isEnabled(flag)) {
      return next(
        new ForbiddenError({
          message: 'This feature is currently unavailable.',
        })
      );
    }

    next();
  };
};

/**
 * Restricts a route to users whose active client role is in the allowed list.
 * Non-tenant roles only — this does not apply to tenant-scoped checks (use requireActiveTenant for those).
 */
export const requireRole = (roles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = (req as AppRequest).context?.currentuser?.client?.role;
    if (!role || !roles.includes(role)) {
      return next(new ForbiddenError({ message: t('auth.errors.forbidden') }));
    }
    return next();
  };
};

export const idempotency = async (
  req: AppRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  if (!idempotencyKey) {
    res.status(400).json({ success: false, message: 'Idempotency-Key header is required' });
    return;
  }

  const { idempotencyCache } = req.container.cradle;
  const userId = req.context?.currentuser?.sub ?? 'anonymous';
  const cuid = req.params?.cuid ?? 'global';
  const routePath = req.route?.path ?? req.path;

  try {
    const cached = await idempotencyCache.getCachedRouteResponse(
      req.method,
      routePath,
      userId,
      cuid,
      idempotencyKey
    );
    if (cached) {
      logger.info({ idempotencyKey, cuid }, 'Returning cached idempotent response');
      res.status(cached.statusCode).json(cached.body);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: any): Response => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        idempotencyCache
          .cacheRouteResponse(
            req.method,
            routePath,
            userId,
            cuid,
            idempotencyKey,
            res.statusCode,
            body
          )
          .catch((err: unknown) =>
            logger.error({ err, idempotencyKey, cuid }, 'Failed to cache idempotent response')
          );
      }
      return originalJson(body);
    };

    next();
  } catch (err) {
    logger.error({ err, idempotencyKey }, 'Idempotency middleware error');
    next(); // fail open
  }
};
