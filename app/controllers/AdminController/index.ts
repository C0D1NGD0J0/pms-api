import Logger from 'bunyan';
import { Response } from 'express';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { IUserRole } from '@shared/constants/roles.constants';
import { BadRequestError, ForbiddenError } from '@shared/customErrors/index';
import { PropertyCache, VendorCache, LeaseCache, UserCache, AuthCache } from '@caching/index';

const CACHE_TYPES = ['user', 'property', 'lease', 'vendor', 'auth'] as const;
type CacheType = (typeof CACHE_TYPES)[number];

export class AdminController {
  private readonly log: Logger;
  private readonly userCache: UserCache;
  private readonly propertyCache: PropertyCache;
  private readonly leaseCache: LeaseCache;
  private readonly vendorCache: VendorCache;
  private readonly authCache: AuthCache;

  constructor({
    userCache,
    propertyCache,
    leaseCache,
    vendorCache,
    authCache,
  }: {
    userCache: UserCache;
    propertyCache: PropertyCache;
    leaseCache: LeaseCache;
    vendorCache: VendorCache;
    authCache: AuthCache;
  }) {
    this.log = createLogger('AdminController');
    this.userCache = userCache;
    this.propertyCache = propertyCache;
    this.leaseCache = leaseCache;
    this.vendorCache = vendorCache;
    this.authCache = authCache;
  }

  /**
   * Developer tool: invalidate Redis cache entries by type, client, and optional item ID.
   *
   * POST /api/v1/admin/cache/invalidate
   * Body: { type: 'user' | 'property' | 'lease' | 'vendor' | 'auth', cuid: string, id?: string }
   *
   * - type=user,   no id  → flush all user details + lists for the client
   * - type=user,   id     → flush single user detail for the client
   * - type=property, ...  → same pattern
   * - type=lease,   ...   → same pattern
   * - type=vendor,  ...   → same pattern
   * - type=auth,    id    → flush auth session for a specific userId (id required)
   */
  invalidateCache = async (req: AppRequest, res: Response) => {
    const currentuser = req.context?.currentuser;
    if (!currentuser || currentuser.client.role !== IUserRole.SUPER_ADMIN) {
      throw new ForbiddenError({ message: t('auth.errors.insufficientRole') });
    }

    const { type, cuid, id } = req.body as { type: CacheType; cuid: string; id?: string };

    if (!type || !CACHE_TYPES.includes(type)) {
      throw new BadRequestError({
        message: `Invalid cache type. Must be one of: ${CACHE_TYPES.join(', ')}`,
      });
    }
    if (!cuid) {
      throw new BadRequestError({ message: 'cuid is required' });
    }

    this.log.info('Cache invalidation requested', { type, cuid, id, by: currentuser.sub });

    let deletedCount: number | undefined;

    switch (type) {
      case 'property':
        if (id) {
          await this.propertyCache.invalidateProperty(cuid, id);
          deletedCount = 1;
        } else {
          const p = await this.propertyCache.invalidateClientProperties(cuid);
          await this.propertyCache.invalidatePropertyLists(cuid);
          deletedCount = p.data?.deletedCount;
        }
        break;

      case 'vendor':
        if (id) {
          await this.vendorCache.invalidateVendorDetail(cuid, id);
          deletedCount = 1;
        } else {
          await this.vendorCache.invalidateAllVendorCaches(cuid);
        }
        break;

      case 'lease':
        if (id) {
          await this.leaseCache.invalidateLease(cuid, id);
          deletedCount = 1;
        } else {
          const l = await this.leaseCache.invalidateClientLeases(cuid);
          await this.leaseCache.invalidateLeaseLists(cuid);
          deletedCount = l.data?.deletedCount;
        }
        break;

      case 'user':
        if (id) {
          await this.userCache.invalidateUserDetail(cuid, id);
          deletedCount = 1;
        } else {
          const u = await this.userCache.invalidateClientUserDetails(cuid);
          await this.userCache.invalidateUserLists(cuid);
          deletedCount = u.data?.deletedCount;
        }
        break;

      case 'auth':
        if (!id) {
          throw new BadRequestError({
            message: 'id (userId) is required for auth cache invalidation',
          });
        }
        await this.authCache.invalidateUserSession(id, cuid);
        deletedCount = 1;
        break;
    }

    this.log.info('Cache invalidated', { type, cuid, id, deletedCount });

    res.status(httpStatusCodes.OK).json({
      success: true,
      message: `${type} cache invalidated successfully`,
      data: { type, cuid, id: id ?? null, deletedCount: deletedCount ?? null },
    });
  };
}
