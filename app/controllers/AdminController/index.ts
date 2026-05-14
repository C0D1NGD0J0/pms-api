import Logger from 'bunyan';
import { Types } from 'mongoose';
import { Response } from 'express';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { IUserRole } from '@shared/constants/roles.constants';
import { MaintenanceRequestDAO, PaymentDAO, ClientDAO } from '@dao/index';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors/index';
import { PropertyCache, VendorCache, LeaseCache, UserCache, AuthCache } from '@caching/index';
import { MaintenanceRequestStatus, InvoiceStatus } from '@interfaces/maintenanceRequest.interface';

const CACHE_TYPES = ['user', 'property', 'lease', 'vendor', 'auth'] as const;
type CacheType = (typeof CACHE_TYPES)[number];

export class AdminController {
  private readonly log: Logger;
  private readonly userCache: UserCache;
  private readonly propertyCache: PropertyCache;
  private readonly leaseCache: LeaseCache;
  private readonly vendorCache: VendorCache;
  private readonly authCache: AuthCache;
  private readonly clientDAO: ClientDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly invoiceDAO: InvoiceDAO;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;
  private readonly emitterService: EventEmitterService;

  constructor({
    userCache,
    propertyCache,
    leaseCache,
    vendorCache,
    authCache,
    clientDAO,
    paymentDAO,
    invoiceDAO,
    maintenanceRequestDAO,
    emitterService,
  }: {
    userCache: UserCache;
    propertyCache: PropertyCache;
    leaseCache: LeaseCache;
    vendorCache: VendorCache;
    authCache: AuthCache;
    clientDAO: ClientDAO;
    paymentDAO: PaymentDAO;
    invoiceDAO: InvoiceDAO;
    maintenanceRequestDAO: MaintenanceRequestDAO;
    emitterService: EventEmitterService;
  }) {
    this.log = createLogger('AdminController');
    this.userCache = userCache;
    this.propertyCache = propertyCache;
    this.leaseCache = leaseCache;
    this.vendorCache = vendorCache;
    this.authCache = authCache;
    this.clientDAO = clientDAO;
    this.paymentDAO = paymentDAO;
    this.invoiceDAO = invoiceDAO;
    this.maintenanceRequestDAO = maintenanceRequestDAO;
    this.emitterService = emitterService;
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

  suspendClient = async (req: AppRequest, res: Response) => {
    const currentuser = req.context?.currentuser;
    if (!currentuser || currentuser.client.role !== IUserRole.SUPER_ADMIN) {
      throw new ForbiddenError({ message: t('auth.errors.insufficientRole') });
    }

    const { cuid } = req.params;
    const { reason } = req.body as { reason?: string };

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      throw new NotFoundError({ message: 'Client not found' });
    }

    await this.clientDAO.update(
      { cuid },
      {
        $set: {
          'suspension.isActive': true,
          'suspension.reason': reason ?? 'Suspended by admin',
          'suspension.at': new Date(),
          'suspension.by': new Types.ObjectId(currentuser.sub),
        },
      }
    );

    this.log.info({ cuid, by: currentuser.sub, reason }, 'Client account suspended');

    return res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Client account suspended successfully',
    });
  };

  unsuspendClient = async (req: AppRequest, res: Response) => {
    const currentuser = req.context?.currentuser;
    if (!currentuser || currentuser.client.role !== IUserRole.SUPER_ADMIN) {
      throw new ForbiddenError({ message: t('auth.errors.insufficientRole') });
    }

    const { cuid } = req.params;

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      throw new NotFoundError({ message: 'Client not found' });
    }

    await this.clientDAO.update(
      { cuid },
      {
        $set: {
          'suspension.isActive': false,
          'suspension.reason': null,
          'suspension.at': null,
          'suspension.by': null,
        },
      }
    );

    this.log.info({ cuid, by: currentuser.sub }, 'Client account unsuspended');

    return res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Client account unsuspended successfully',
    });
  };

  /**
   * One-time migration: find all SRs stuck in `awaiting_invoice` that have an
   * approved invoice AND a paid tenant maintenance charge, then auto-complete them.
   *
   * POST /api/v1/admin/maintenance/finalize-paid
   * Body: { dryRun?: boolean }  — pass dryRun:true to preview without writing.
   */
  finalizePaidMaintenanceRequests = async (req: AppRequest, res: Response) => {
    const currentuser = req.context?.currentuser;
    if (!currentuser || currentuser.client.role !== IUserRole.SUPER_ADMIN) {
      throw new ForbiddenError({ message: t('auth.errors.insufficientRole') });
    }

    const dryRun = (req.body as { dryRun?: boolean }).dryRun === true;
    this.log.info(
      { by: currentuser.sub, dryRun },
      '[Admin] finalize-paid maintenance migration started'
    );

    const stuck = await this.maintenanceRequestDAO.list(
      { status: MaintenanceRequestStatus.AWAITING_INVOICE, deletedAt: null },
      { limit: 1000 }
    );

    const candidates = stuck.items || [];
    const completed: string[] = [];
    const skipped: string[] = [];

    for (const sr of candidates) {
      const mruid = sr.mruid;
      const cuid = sr.cuid;

      const invoice = await this.invoiceDAO.findFirst({
        maintenanceRequestId: sr._id,
        status: InvoiceStatus.APPROVED,
        isDeleted: false,
      });

      if (!invoice) {
        skipped.push(mruid);
        continue;
      }

      const paidCharge = await this.paymentDAO.findFirst({
        cuid,
        maintenanceRequestUid: mruid,
        paymentType: PaymentRecordType.MAINTENANCE,
        vendorId: { $exists: false },
        status: PaymentRecordStatus.PAID,
        deletedAt: null,
      });

      if (!paidCharge) {
        skipped.push(mruid);
        continue;
      }

      if (!dryRun) {
        await this.maintenanceRequestDAO.updateById(sr._id.toString(), {
          $set: {
            status: MaintenanceRequestStatus.COMPLETED,
            completedAt: new Date(),
            'tenantFeedback.status': 'pending',
          },
        });

        this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_COMPLETED, {
          requestId: sr._id.toString(),
          mruid,
          cuid,
          tenantId: sr.tenantId?.toString() ?? '',
          vendorId: sr.vendorId?.toString(),
          completedBy: 'system:migration',
        });
      }

      completed.push(mruid);
    }

    this.log.info(
      { completed: completed.length, skipped: skipped.length, dryRun },
      '[Admin] finalize-paid migration done'
    );

    return res.status(httpStatusCodes.OK).json({
      success: true,
      message: dryRun
        ? 'Dry run complete — no writes performed'
        : `${completed.length} SR(s) finalized`,
      data: { completed, skipped, dryRun },
    });
  };
}
