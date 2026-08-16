import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { ClientDAO } from '@dao/clientDAO';
import { VendorDAO } from '@dao/vendorDAO';
import { LeaseCache } from '@caching/index';
import { PaymentDAO } from '@dao/paymentDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { LeaseService } from '@services/lease';
import { UserCache } from '@caching/user.cache';
import { AuthCache } from '@caching/auth.cache';
import { EmailQueue } from '@queues/email.queue';
import { InspectionDAO } from '@dao/inspectionDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { SSEService } from '@services/sse/sse.service';
import { EventTypes } from '@interfaces/events.interface';
import { LEASE_CONSTANTS, createLogger } from '@utils/index';
import { EventEmitterService } from '@services/eventEmitter';
import { InvoiceStatus } from '@interfaces/invoice.interface';
import { ROLE_GROUPS } from '@shared/constants/roles.constants';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { PaymentRecordStatus } from '@interfaces/payments.interface';
import { LeaseRenewalService } from '@services/lease/leaseRenewal.service';
import { InspectionService } from '@services/inspection/inspection.service';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';
import { buildSystemRequestContext, getSystemBotUserId } from '@utils/systemBot';
import { InspectionStatus, InspectionType } from '@interfaces/inspection.interface';
import { MaintenanceRequestStatus } from '@interfaces/maintenanceRequest.interface';
import { MaintenancePaymentService } from '@services/payments/maintenancePayment.service';
import { IPromiseReturnedData, IRequestContext, MailType } from '@interfaces/utils.interface';
import {
  IVacateRequestDecision,
  IOffboardingStatus,
  ILeaseDocument,
  LeaseStatus,
} from '@interfaces/lease.interface';

export class OffboardingService {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly leaseService: LeaseService;
  private readonly userCache?: UserCache;
  private readonly leaseCache?: LeaseCache;
  private readonly authCache?: AuthCache;
  private readonly inspectionDAO: InspectionDAO;
  private readonly inspectionService: InspectionService;
  private readonly leaseRenewalService: LeaseRenewalService;
  private readonly emitterService: EventEmitterService;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;
  private readonly maintenancePaymentService: MaintenancePaymentService;
  private readonly sseService: SSEService;
  private readonly vendorDAO: VendorDAO;
  private readonly clientDAO: ClientDAO;
  private readonly emailQueue: EmailQueue;

  constructor({
    userDAO,
    leaseDAO,
    propertyDAO,
    propertyUnitDAO,
    paymentDAO,
    userCache,
    leaseCache,
    authCache,
    leaseService,
    inspectionDAO,
    inspectionService,
    leaseRenewalService,
    emitterService,
    maintenanceRequestDAO,
    maintenancePaymentService,
    sseService,
    vendorDAO,
    clientDAO,
    emailQueue,
  }: {
    userDAO: UserDAO;
    leaseDAO: LeaseDAO;
    propertyDAO: PropertyDAO;
    propertyUnitDAO: PropertyUnitDAO;
    paymentDAO: PaymentDAO;
    userCache?: UserCache;
    leaseCache?: LeaseCache;
    authCache?: AuthCache;
    leaseService: LeaseService;
    inspectionDAO: InspectionDAO;
    inspectionService: InspectionService;
    leaseRenewalService: LeaseRenewalService;
    emitterService: EventEmitterService;
    maintenanceRequestDAO: MaintenanceRequestDAO;
    maintenancePaymentService: MaintenancePaymentService;
    sseService: SSEService;
    vendorDAO: VendorDAO;
    clientDAO: ClientDAO;
    emailQueue: EmailQueue;
  }) {
    this.log = createLogger('OffboardingService');
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.propertyDAO = propertyDAO;
    this.propertyUnitDAO = propertyUnitDAO;
    this.paymentDAO = paymentDAO;
    this.userCache = userCache;
    this.leaseCache = leaseCache;
    this.authCache = authCache;
    this.leaseService = leaseService;
    this.inspectionDAO = inspectionDAO;
    this.inspectionService = inspectionService;
    this.leaseRenewalService = leaseRenewalService;
    this.emitterService = emitterService;
    this.maintenanceRequestDAO = maintenanceRequestDAO;
    this.maintenancePaymentService = maintenancePaymentService;
    this.sseService = sseService;
    this.vendorDAO = vendorDAO;
    this.clientDAO = clientDAO;
    this.emailQueue = emailQueue;

    this.setupEventListeners();
  }

  /**
   * Set up event listeners that auto-trigger offboarding steps.
   * LEASE_TERMINATED → auto-schedule move-out inspection
   * LEASE_EXPIRED (natural) → auto-schedule move-out inspection
   */
  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.LEASE_TERMINATED, async (payload) => {
      this.log.info('Lease terminated — offboarding chain started', {
        leaseId: payload.leaseId,
        luid: payload.luid,
        cuid: payload.cuid,
        moveOutDate: payload.moveOutDate,
      });

      await this.autoScheduleMoveOutInspection(
        payload.cuid,
        payload.luid,
        payload.terminatedBy,
        payload.moveOutDate || payload.terminationDate
      );

      // Also close open service requests
      const terminatedLease = await this.leaseDAO.findFirst({
        luid: payload.luid,
        cuid: payload.cuid,
      });
      if (terminatedLease) {
        await this.closeOpenServiceRequests(
          payload.cuid,
          terminatedLease.tenantId.toString(),
          terminatedLease.property.id.toString(),
          terminatedLease.property.unitId?.toString()
        );
      }
    });

    this.emitterService.on(EventTypes.LEASE_EXPIRED, async (payload) => {
      if (payload.reason === 'expired') {
        // Guard: if the lease was already completed (PM did inspection early), skip
        const existingLease = await this.leaseDAO.findFirst({
          luid: payload.luid,
          cuid: payload.cuid,
        });
        if (existingLease?.status === LeaseStatus.COMPLETED) {
          this.log.info('Lease already completed — skipping offboarding', {
            luid: payload.luid,
            cuid: payload.cuid,
          });
          return;
        }

        this.log.info('Lease expired naturally — offboarding chain started', {
          leaseId: payload.leaseId,
          luid: payload.luid,
          cuid: payload.cuid,
        });

        // Check if a move-out inspection was already approved (PM completed it before expiry)
        const approvedInspection = existingLease
          ? await this.inspectionDAO.findFirst({
              leaseId: existingLease._id,
              type: InspectionType.MOVE_OUT,
              status: InspectionStatus.APPROVED,
              deletedAt: null,
            })
          : null;

        if (approvedInspection) {
          this.log.info('Move-out inspection already approved — triggering completion directly', {
            luid: payload.luid,
            iuid: approvedInspection.iuid,
          });
          // Re-emit INSPECTION_APPROVED to trigger the completion flow
          this.emitterService.emit(EventTypes.INSPECTION_APPROVED, {
            iuid: approvedInspection.iuid,
            cuid: payload.cuid,
            leaseId: existingLease!._id.toString(),
            tenantId: existingLease!.tenantId.toString(),
          });
        } else {
          await this.autoScheduleMoveOutInspection(
            payload.cuid,
            payload.luid,
            'system',
            new Date()
          );
        }

        // Also close open service requests
        const expiredLease = existingLease;
        if (expiredLease) {
          await this.closeOpenServiceRequests(
            payload.cuid,
            expiredLease.tenantId.toString(),
            expiredLease.property.id.toString(),
            expiredLease.property.unitId?.toString()
          );
        }
      }
    });

    this.emitterService.on(EventTypes.INSPECTION_APPROVED, async (payload) => {
      try {
        // Check if this is a move-out inspection tied to an expired/terminated lease
        const inspection = await this.inspectionDAO.findFirst({
          iuid: payload.iuid,
          type: InspectionType.MOVE_OUT,
          deletedAt: null,
        });

        if (!inspection) return;

        const lease = await this.leaseDAO.findFirst({
          _id: inspection.leaseId,
          status: { $in: [LeaseStatus.ACTIVE, LeaseStatus.EXPIRED, LeaseStatus.TERMINATED] },
          deletedAt: null,
        });

        if (!lease) return;

        // For active leases, only proceed if within the grace period window.
        // This allows the PM to finalize offboarding up to GRACE_PERIOD_DAYS (3)
        // before the end date — e.g., PM approves move-out inspection at T-2 and
        // the lease completes immediately instead of waiting for the expiry cron.
        // The scheduling guard already limits move-out inspections to within 30 days
        // of expiry, so approval at this stage is an explicit signal to complete.
        if (lease.status === LeaseStatus.ACTIVE) {
          const endDate = dayjs(lease.duration.endDate);
          const graceCutoff = endDate.subtract(LEASE_CONSTANTS.GRACE_PERIOD_DAYS, 'days');
          const isWithinGraceWindow = dayjs().isAfter(graceCutoff);
          if (!isWithinGraceWindow) return;
        }

        const tenantId = lease.tenantId.toString();
        const cuid = lease.cuid;

        this.log.info('Move-out inspection approved — finalizing offboarding', {
          tenantId,
          cuid,
          luid: lease.luid,
          iuid: payload.iuid,
        });

        // 1. Mark lease as completed
        const systemBotId = await getSystemBotUserId();
        await this.leaseDAO.updateById(lease._id.toString(), {
          status: 'completed',
          completedAt: new Date(),
          ...(systemBotId && {
            $push: {
              lastModifiedBy: {
                action: 'completed',
                userId: systemBotId,
                name: 'System - Inspection Approved',
                date: new Date(),
              },
            },
          }),
        });

        // Invalidate lease + auth caches so tenant sees updated status immediately
        await this.leaseCache?.invalidateLease(cuid, lease.luid);
        await this.leaseCache?.invalidateLeaseLists(cuid);
        await this.authCache?.invalidateCurrentUser(tenantId, cuid);

        // 2. Release property unit / mark property vacant
        if (lease.property?.unitId) {
          await this.propertyUnitDAO.updateById(lease.property.unitId.toString(), {
            status: PropertyUnitStatusEnum.AVAILABLE,
            currentTenant: null,
            currentLease: null,
          });
        } else if (lease.property?.id) {
          await this.propertyDAO.updateById(lease.property.id.toString(), {
            occupancyStatus: 'vacant',
          });
        }

        // 3. Deactivate tenant — set read-only + isFormerTenant
        const user = await this.userDAO.findFirst({
          _id: new Types.ObjectId(tenantId),
          'cuids.cuid': cuid,
        });

        if (user) {
          await this.userDAO.update(
            { _id: new Types.ObjectId(tenantId), 'cuids.cuid': cuid },
            {
              $set: {
                'cuids.$.isConnected': false,
                'cuids.$.pendingDeactivation': false,
                'cuids.$.isFormerTenant': true,
              },
            }
          );

          // Invalidate cache so tenant immediately enters read-only mode
          if (user.uid) {
            await this.userCache?.invalidateUserDetail(cuid, user.uid);
          }
        }

        // Notify tenant via SSE so the dashboard refreshes immediately
        try {
          await this.sseService.sendToUser(
            tenantId,
            cuid,
            { resource: 'lease', action: 'lease-expired', resourceUId: lease.luid },
            'resource-event'
          );
        } catch (sseErr) {
          this.log.warn({ sseErr }, '[OffboardingService] SSE notify failed (non-fatal)');
        }

        this.log.info(
          'Offboarding finalized — lease completed, unit released, tenant deactivated',
          {
            tenantId,
            cuid,
            luid: lease.luid,
          }
        );
      } catch (error) {
        this.log.error('Error finalizing offboarding on inspection approval', {
          error,
          payload,
        });
      }
    });
  }

  private async autoScheduleMoveOutInspection(
    cuid: string,
    luid: string,
    userId: string,
    scheduledDate: Date
  ): Promise<void> {
    try {
      const lease = await this.leaseDAO.findFirst({ luid, cuid, deletedAt: null });
      if (!lease) {
        this.log.warn({ luid, cuid }, 'Lease not found for auto-schedule move-out inspection');
        return;
      }

      const existing = await this.inspectionDAO.findFirst({
        leaseId: lease._id,
        type: InspectionType.MOVE_OUT,
        cuid,
        deletedAt: null,
      });
      if (existing) {
        this.log.info({ luid }, 'Move-out inspection already exists, skipping auto-schedule');
        return;
      }

      await this.inspectionService.scheduleInspection(cuid, userId, {
        leaseId: luid,
        type: InspectionType.MOVE_OUT,
        scheduledDate,
        refundDeposit: true,
      });

      this.log.info({ luid, cuid }, 'Auto-scheduled move-out inspection via offboarding chain');
    } catch (error) {
      this.log.error({ error, luid, cuid }, 'Failed to auto-schedule move-out inspection');
    }
  }

  /**
   * Close all open (non-completed, non-cancelled) service requests tied to a
   * tenant + property when their lease expires or is terminated.
   *
   * For billable SRs with an approved invoice, an auto-charge is attempted first
   * so the PM doesn't lose revenue. All remaining open SRs are then bulk-cancelled.
   */
  private async closeOpenServiceRequests(
    cuid: string,
    tenantId: string,
    propertyId: string,
    unitId?: string
  ): Promise<void> {
    try {
      // Build filter for open SRs tied to this tenant + property
      const filter: Record<string, any> = {
        cuid,
        tenantId: new Types.ObjectId(tenantId),
        propertyId: new Types.ObjectId(propertyId),
        status: {
          $nin: [MaintenanceRequestStatus.COMPLETED, MaintenanceRequestStatus.CANCELLED],
        },
        deletedAt: null,
      };

      if (unitId) {
        filter.propertyUnitId = new Types.ObjectId(unitId);
      }

      const openRequests = await this.maintenanceRequestDAO.list(filter, {
        populate: [{ path: 'invoiceId', select: 'status amountInCents' }],
      });
      const items = openRequests.items || [];

      if (items.length === 0) {
        this.log.info('No open service requests to close', { cuid, tenantId });
        return;
      }

      this.log.info(`Closing ${items.length} open service request(s) on lease expiry`, {
        cuid,
        tenantId,
        mrCount: items.length,
      });

      // For billable SRs with approved invoices, ensure charges exist
      for (const sr of items) {
        const invoice = sr.invoice ?? (sr as any).invoiceId;
        if (
          sr.isBillable &&
          invoice?.status === InvoiceStatus.APPROVED &&
          invoice.amountInCents > 0
        ) {
          try {
            await this.maintenancePaymentService.chargeForMaintenance(cuid, 'system', {
              mruid: sr.mruid,
              tenantId,
              amount: invoice.amountInCents,
              description: `Auto-charge for service request ${sr.mruid} on lease expiry`,
            });
            this.log.info('Auto-charged billable SR on lease expiry', {
              mruid: sr.mruid,
              amount: invoice.amountInCents,
            });
          } catch (chargeError: any) {
            // Charge may already exist (idempotency) — log and continue
            this.log.warn('Could not auto-charge SR (may already be charged)', {
              mruid: sr.mruid,
              error: chargeError.message,
            });
          }
        }
      }

      // Bulk cancel all open SRs
      const srIds = items.map((sr: any) => sr._id);
      await this.maintenanceRequestDAO.updateMany(
        { _id: { $in: srIds } },
        {
          $set: {
            status: MaintenanceRequestStatus.CANCELLED,
            completedAt: new Date(),
          },
        }
      );

      this.log.info('Open service requests auto-cancelled on lease expiry', {
        cuid,
        tenantId,
        count: items.length,
        mruids: items.map((sr) => sr.mruid),
      });
    } catch (error) {
      this.log.error('Error closing open service requests on lease expiry', {
        error,
        cuid,
        tenantId,
      });
    }
  }

  /**
   * Tenant submits a vacate request on their active lease.
   */
  async submitVacateRequest(
    cuid: string,
    luid: string,
    data: { requestedMoveOutDate: Date; reason: string },
    ctx: IRequestContext
  ): IPromiseReturnedData<ILeaseDocument> {
    const currentUser = ctx.currentuser!;

    const lease = await this.leaseDAO.findFirst({ luid, cuid, deletedAt: null });
    if (!lease) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }

    // Only the tenant on the lease can submit a vacate request
    const tenantRef = (lease.tenantId as any)?._id ?? lease.tenantId;
    if (tenantRef.toString() !== currentUser.sub) {
      throw new ValidationRequestError({
        message: t('common.errors.insufficientPermissions'),
        errorInfo: { authorization: [t('common.errors.insufficientPermissions')] },
      });
    }

    if (lease.vacateRequest?.status === 'pending') {
      throw new ValidationRequestError({
        message: t('common.errors.alreadyInState', {
          resource: 'Vacate request',
          state: 'pending',
        }),
        errorInfo: {
          vacateRequest: [
            t('common.errors.alreadyInState', { resource: 'Vacate request', state: 'pending' }),
          ],
        },
      });
    }

    if (lease.renewalRequest?.status === 'pending') {
      throw new ValidationRequestError({
        message: 'Cannot submit a vacate request while a renewal request is pending',
        errorInfo: {
          renewalRequest: ['Cannot submit a vacate request while a renewal request is pending'],
        },
      });
    }

    const requestedDate = new Date(data.requestedMoveOutDate);
    const noticeDays = lease.renewalOptions?.noticePeriodDays ?? 30;
    const minDate = new Date();
    minDate.setDate(minDate.getDate() + noticeDays);

    if (requestedDate < minDate) {
      throw new ValidationRequestError({
        message: t('common.errors.validationFailed'),
        errorInfo: {
          requestedMoveOutDate: [`Move-out date must be at least ${noticeDays} days from today`],
        },
      });
    }

    const updatedLease = await this.leaseDAO.submitVacateRequest(cuid, lease._id.toString(), {
      requestedMoveOutDate: requestedDate,
      reason: data.reason,
    });

    if (!updatedLease) {
      // findOneAndUpdate returned null — lease state changed between read and write (race condition)
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'submit vacate request' }),
      });
    }

    this.emitterService.emit(EventTypes.VACATE_REQUEST_SUBMITTED, {
      leaseId: lease._id.toString(),
      luid: lease.luid,
      cuid,
      tenantId: currentUser.sub,
      requestedMoveOutDate: requestedDate,
      reason: data.reason,
    });

    this.log.info('Vacate request submitted', { luid, cuid, tenantId: currentUser.sub });

    return {
      success: true,
      data: updatedLease,
      message: t('common.success.created', { resource: 'Vacate request' }),
    };
  }

  /**
   * PM approves or rejects a vacate request.
   * If approved, triggers lease termination (which cascades the offboarding chain).
   * Uses a MongoDB transaction to ensure the decision + termination are atomic.
   */
  async decideVacateRequest(
    cuid: string,
    luid: string,
    decision: IVacateRequestDecision,
    ctx: IRequestContext
  ): IPromiseReturnedData<ILeaseDocument> {
    const currentUser = ctx.currentuser!;

    const lease = await this.leaseDAO.findFirst({ luid, cuid, deletedAt: null });
    if (!lease) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }

    if (lease.vacateRequest?.status !== 'pending') {
      throw new ValidationRequestError({
        message: t('common.errors.notFound', { resource: 'Pending vacate request' }),
        errorInfo: {
          vacateRequest: [t('common.errors.notFound', { resource: 'Pending vacate request' })],
        },
      });
    }

    const session = await this.leaseDAO.startSession();
    const updatedLease = await this.leaseDAO.withTransaction(session, async () => {
      const decidedLease = await this.leaseDAO.decideVacateRequest(cuid, lease._id.toString(), {
        approved: decision.approved,
        decidedBy: currentUser.sub,
        adjustedMoveOutDate: decision.adjustedMoveOutDate
          ? new Date(decision.adjustedMoveOutDate)
          : undefined,
        rejectionReason: decision.rejectionReason,
      });

      if (!decidedLease) {
        // findOneAndUpdate returned null — another PM already decided this request (race condition)
        throw new BadRequestError({
          message: t('common.errors.operationFailed', { action: 'decide vacate request' }),
        });
      }

      return decidedLease;
    });

    // Lease termination runs AFTER the transaction commits — terminateLease does its own
    // DAO writes, payment cancellation, cache invalidation, and event emission which
    // should not be rolled back if the vacate decision was already committed.
    if (decision.approved) {
      const moveOutDate = decision.adjustedMoveOutDate
        ? new Date(decision.adjustedMoveOutDate)
        : lease.vacateRequest!.requestedMoveOutDate;

      await this.leaseService.terminateLease(
        cuid,
        luid,
        {
          terminationDate: new Date(),
          terminationReason: `Tenant vacate request: ${lease.vacateRequest!.reason}`,
          moveOutDate,
        },
        ctx
      );
    }

    // Emit events after transaction commits successfully
    if (decision.approved) {
      this.emitterService.emit(EventTypes.VACATE_REQUEST_APPROVED, {
        leaseId: lease._id.toString(),
        luid: lease.luid,
        cuid,
        tenantId: lease.tenantId.toString(),
        decidedBy: currentUser.sub,
        approved: true,
        adjustedMoveOutDate: decision.adjustedMoveOutDate
          ? new Date(decision.adjustedMoveOutDate)
          : undefined,
      });

      this.log.info('Vacate request approved — lease termination triggered', {
        luid,
        cuid,
      });
    } else {
      this.emitterService.emit(EventTypes.VACATE_REQUEST_REJECTED, {
        leaseId: lease._id.toString(),
        luid: lease.luid,
        cuid,
        tenantId: lease.tenantId.toString(),
        decidedBy: currentUser.sub,
        approved: false,
        rejectionReason: decision.rejectionReason,
      });

      this.log.info('Vacate request rejected', {
        luid,
        cuid,
        reason: decision.rejectionReason,
      });
    }

    return {
      success: true,
      data: updatedLease,
      message: decision.approved
        ? t('common.success.updated', { resource: 'Vacate request' })
        : t('common.success.updated', { resource: 'Vacate request' }),
    };
  }

  /**
   * Get pending vacate requests for a PM's dashboard.
   */
  async getPendingVacateRequests(cuid: string): IPromiseReturnedData<ILeaseDocument[]> {
    const leases = await this.leaseDAO.getPendingVacateRequests(cuid);

    return {
      success: true,
      data: leases,
      message: t('common.success.retrieved', { resource: 'Vacate requests' }),
    };
  }

  /**
   * Get active offboardings (terminated leases with incomplete offboarding steps).
   */
  async getActiveOffboardings(
    cuid: string,
    page = 1,
    limit = 20
  ): IPromiseReturnedData<{ items: ILeaseDocument[]; total: number }> {
    const result = await this.leaseDAO.getActiveOffboardings(cuid, page, limit);

    return {
      success: true,
      data: result,
      message: t('common.success.retrieved', { resource: 'Offboardings' }),
    };
  }

  /**
   * Derive offboarding status from existing data — no separate collection.
   * Assembles the current state of the offboarding chain by querying lease + inspection data.
   */
  async getOffboardingStatus(cuid: string, luid: string): IPromiseReturnedData<IOffboardingStatus> {
    const lease = await this.leaseDAO.findFirst({ luid, cuid, deletedAt: null });
    if (!lease) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }

    const inspection = await this.inspectionDAO.findFirst({
      cuid,
      leaseId: lease._id,
      type: InspectionType.MOVE_OUT,
      deletedAt: null,
    });

    let depositRefundStatus: IOffboardingStatus['depositRefundStatus'] = 'not_applicable';
    if (lease.fees.securityDeposit > 0) {
      depositRefundStatus = inspection?.refundInfo?.isRefunded ? 'refunded' : 'pending';
    }

    // Check if any open payments remain — paymentsCancelled is only true when no pending/overdue/processing charges exist
    const openPaymentCount = await this.paymentDAO.countDocuments({
      lease: lease._id,
      status: {
        $in: [
          PaymentRecordStatus.PENDING,
          PaymentRecordStatus.OVERDUE,
          PaymentRecordStatus.PROCESSING,
        ],
      },
      deletedAt: null,
    });

    const status: IOffboardingStatus = {
      leaseTerminated: lease.status === 'terminated',
      terminationDate: lease.duration.terminationDate,
      paymentsCancelled: lease.status === 'terminated' && openPaymentCount === 0,
      inspectionStatus: inspection?.status || null,
      inspectionScheduledDate: inspection?.scheduledDate,
      depositRefundStatus,
      depositAmount: lease.fees.securityDeposit,
    };

    return {
      success: true,
      data: status,
      message: t('common.success.retrieved', { resource: 'Offboarding status' }),
    };
  }

  /**
   * Tenant submits a renewal request on their active lease.
   * Mirrors submitVacateRequest but for lease renewal.
   */
  async submitRenewalRequest(
    cuid: string,
    luid: string,
    data: { requestedTermMonths: number; message?: string },
    ctx: IRequestContext
  ): IPromiseReturnedData<ILeaseDocument> {
    const currentUser = ctx.currentuser!;

    const lease = await this.leaseDAO.findFirst({ luid, cuid, deletedAt: null });
    if (!lease) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }

    // Only the tenant on the lease can submit a renewal request
    const tenantRef = (lease.tenantId as any)?._id ?? lease.tenantId;
    if (tenantRef.toString() !== currentUser.sub) {
      throw new ValidationRequestError({
        message: t('common.errors.insufficientPermissions'),
        errorInfo: { authorization: [t('common.errors.insufficientPermissions')] },
      });
    }

    if (lease.status !== LeaseStatus.ACTIVE) {
      throw new ValidationRequestError({
        message: t('common.errors.alreadyInState', {
          resource: 'Lease',
          state: lease.status,
        }),
        errorInfo: {
          status: ['Only active leases are eligible for renewal requests'],
        },
      });
    }

    // Verify no pending vacate request exists
    if (lease.vacateRequest?.status === 'pending') {
      throw new ValidationRequestError({
        message: 'Cannot request renewal while a vacate request is pending',
        errorInfo: {
          vacateRequest: ['Cannot request renewal while a vacate request is pending'],
        },
      });
    }

    // Verify no pending renewal request already exists
    if (lease.renewalRequest?.status === 'pending') {
      throw new ValidationRequestError({
        message: t('common.errors.alreadyInState', {
          resource: 'Renewal request',
          state: 'pending',
        }),
        errorInfo: {
          renewalRequest: [
            t('common.errors.alreadyInState', { resource: 'Renewal request', state: 'pending' }),
          ],
        },
      });
    }

    // Verify lease is within 30-day expiry window or in grace period
    const now = dayjs();
    const endDate = dayjs(lease.duration.endDate);
    const daysUntilExpiry = endDate.diff(now, 'day');

    if (daysUntilExpiry > 30) {
      throw new ValidationRequestError({
        message: t('common.errors.validationFailed'),
        errorInfo: {
          renewalRequest: ['Renewal requests can only be submitted within 30 days of lease expiry'],
        },
      });
    }

    // Overlap guard: check proposed renewal dates against existing leases
    const renewalTermMonths = data.requestedTermMonths || 12;
    const proposedStartDate = endDate.add(1, 'day').toDate();
    const proposedEndDate = dayjs(proposedStartDate).add(renewalTermMonths, 'month').toDate();

    const propertyId = lease.property.id.toString();
    const unitId = lease.property.unitId?.toString();

    const overlaps = await this.leaseDAO.checkOverlappingLeases(
      cuid,
      propertyId,
      unitId,
      proposedStartDate,
      proposedEndDate,
      lease._id.toString()
    );

    if (overlaps.length > 0) {
      throw new BadRequestError({
        message: 'A new lease is already scheduled for this property.',
      });
    }

    const updatedLease = await this.leaseDAO.submitRenewalRequest(cuid, lease._id.toString(), {
      requestedTermMonths: data.requestedTermMonths,
      message: data.message,
    });

    if (!updatedLease) {
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'submit renewal request' }),
      });
    }

    this.emitterService.emit(EventTypes.LEASE_RENEWAL_REQUESTED, {
      leaseId: lease._id.toString(),
      luid: lease.luid,
      cuid,
      tenantId: currentUser.sub,
      requestedBy: currentUser.sub,
      propertyId,
      propertyUnitId: unitId,
      renewalTermMonths: data.requestedTermMonths,
    });

    this.log.info('Renewal request submitted', { luid, cuid, tenantId: currentUser.sub });

    return {
      success: true,
      data: updatedLease,
      message: t('common.success.created', { resource: 'Renewal request' }),
    };
  }

  /**
   * PM approves or rejects a renewal request.
   * If approved, creates a draft renewal lease via LeaseRenewalService.
   */
  async decideRenewalRequest(
    cuid: string,
    luid: string,
    decision: { approved: boolean; rejectionReason?: string },
    ctx: IRequestContext
  ): IPromiseReturnedData<ILeaseDocument> {
    const currentUser = ctx.currentuser!;

    const lease = await this.leaseDAO.findFirst({ luid, cuid, deletedAt: null });
    if (!lease) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }

    if (lease.renewalRequest?.status !== 'pending') {
      throw new ValidationRequestError({
        message: t('common.errors.notFound', { resource: 'Pending renewal request' }),
        errorInfo: {
          renewalRequest: [t('common.errors.notFound', { resource: 'Pending renewal request' })],
        },
      });
    }

    // Compute renewal dates upfront (needed for overlap check and draft creation)
    const endDate = dayjs(lease.duration.endDate);
    const renewalTermMonths = lease.renewalRequest.requestedTermMonths || 12;
    const proposedStartDate = endDate.add(1, 'day').toDate();
    const proposedEndDate = dayjs(proposedStartDate).add(renewalTermMonths, 'month').toDate();

    if (decision.approved) {
      // Re-check overlap guard before approval (a new lease may have been created since submission)
      const propertyId = lease.property.id.toString();
      const unitId = lease.property.unitId?.toString();

      const overlaps = await this.leaseDAO.checkOverlappingLeases(
        cuid,
        propertyId,
        unitId,
        proposedStartDate,
        proposedEndDate,
        lease._id.toString()
      );

      if (overlaps.length > 0) {
        throw new BadRequestError({
          message: 'A new lease is already scheduled for this property.',
        });
      }
    }

    // Record the decision first (safe to retry if draft creation fails later)
    const updatedLease = await this.leaseDAO.decideRenewalRequest(cuid, lease._id.toString(), {
      approved: decision.approved,
      decidedBy: currentUser.sub,
      rejectionReason: decision.rejectionReason,
    });

    if (!updatedLease) {
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'decide renewal request' }),
      });
    }

    if (decision.approved) {
      // Create draft renewal lease after decision is recorded
      await this.leaseRenewalService.createDraftLeaseRenewal(
        cuid,
        luid,
        {
          duration: {
            startDate: proposedStartDate,
            endDate: proposedEndDate,
            moveInDate: proposedStartDate,
          },
        } as any,
        ctx
      );
      this.log.info('Renewal request approved — draft renewal lease created', { luid, cuid });
    } else {
      this.log.info('Renewal request rejected', {
        luid,
        cuid,
        reason: decision.rejectionReason,
      });
    }

    return {
      success: true,
      data: updatedLease,
      message: t('common.success.updated', { resource: 'Renewal request' }),
    };
  }

  /**
   * PM-initiated account closure. Terminates all active leases (triggering the existing
   * offboarding chain per lease), disconnects staff and vendors, suspends the client,
   * and sends closure notification emails.
   */
  async initiateAccountClosure(
    cuid: string,
    ctx: IRequestContext,
    reason?: string
  ): IPromiseReturnedData<{ message: string }> {
    const currentUser = ctx.currentuser!;

    if (currentUser.client.role !== 'super-admin') {
      throw new BadRequestError({ message: 'Only the account owner can close the account' });
    }

    // Idempotency: skip if already closed
    const client = await this.clientDAO.findFirst(
      { cuid },
      { select: '+suspension.isActive +suspension.reason +suspension.at +suspension.by' }
    );
    if (!client) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Client' }) });
    }
    if (client.suspension?.isActive && client.suspension.reason?.includes('Account closed')) {
      return {
        success: true,
        data: { message: 'Account is already closed' },
        message: 'Account is already closed',
      };
    }

    const companyName =
      client.companyProfile?.tradingName ||
      client.companyProfile?.legalEntityName ||
      client.displayName ||
      'Your Company';

    this.log.info({ cuid, initiatedBy: currentUser.sub }, 'Account closure initiated');

    const systemCtx = await buildSystemRequestContext(cuid);
    if (!systemCtx) {
      throw new BadRequestError({
        message: 'System bot not found — cannot process account closure',
      });
    }

    // --- 1. Bulk terminate all active leases ---
    const activeLeases = await this.leaseDAO.list({
      cuid,
      status: LeaseStatus.ACTIVE,
      deletedAt: null,
    });

    const leaseResults = { succeeded: 0, failed: 0 };
    for (const lease of activeLeases.items || []) {
      try {
        await this.leaseService.terminateLease(
          cuid,
          lease.luid,
          {
            terminationDate: new Date(),
            terminationReason: reason || 'Account closure',
            moveOutDate: new Date(),
          },
          systemCtx
        );
        leaseResults.succeeded++;
      } catch (err: any) {
        this.log.warn(
          { luid: lease.luid, error: err.message },
          'Lease termination failed during account closure'
        );
        leaseResults.failed++;
      }
    }
    this.log.info({ cuid, ...leaseResults }, 'Account closure — lease termination batch complete');

    // --- 2. Disconnect all staff/admin users ---
    const staffUsers = await this.userDAO.list({
      'cuids.cuid': cuid,
      'cuids.roles': { $in: ROLE_GROUPS.EMPLOYEE_ROLES },
      'cuids.isConnected': true,
      deletedAt: null,
    });

    for (const user of staffUsers.items || []) {
      try {
        if (user._id.toString() === currentUser.sub) continue;

        await this.userDAO.update(
          { _id: user._id, 'cuids.cuid': cuid },
          { $set: { 'cuids.$.isConnected': false } }
        );

        if (user.uid) {
          await this.userCache?.invalidateUserDetail(cuid, user.uid);
        }
        await this.authCache?.invalidateCurrentUser(user._id.toString(), cuid);
      } catch (err: any) {
        this.log.warn(
          { userId: user._id, error: err.message },
          'Staff disconnection failed during closure'
        );
      }
    }

    // --- 3. Disconnect all vendors ---
    const vendors = await this.vendorDAO.getClientVendors(cuid);
    for (const vendor of vendors.items || []) {
      try {
        await this.vendorDAO.disconnectClient(vendor._id.toString(), cuid);
      } catch (err: any) {
        this.log.warn(
          { vendorId: vendor._id, error: err.message },
          'Vendor disconnection failed during closure'
        );
      }
    }

    // --- 4. Suspend the client ---
    await this.clientDAO.update(
      { cuid },
      {
        $set: {
          'suspension.isActive': true,
          'suspension.reason': reason ? `Account closed: ${reason}` : 'Account closed',
          'suspension.at': new Date(),
          'suspension.by': new Types.ObjectId(currentUser.sub),
        },
      }
    );

    // --- 5. Send closure emails ---
    for (const user of staffUsers.items || []) {
      if (user.email && user._id.toString() !== currentUser.sub) {
        this.emailQueue.addToEmailQueue('companyClosure-staff', {
          to: user.email,
          emailType: MailType.COMPANY_CLOSURE_STAFF,
          subject: `${companyName} — Account Closure Notice`,
          data: { companyName, effectiveDate: new Date().toLocaleDateString() },
        });
      }
    }

    for (const vendor of vendors.items || []) {
      const connectedClient = (vendor as any).connectedClients?.find((c: any) => c.cuid === cuid);
      const vendorEmail = connectedClient?.primaryAccountHolderEmail || (vendor as any).email;
      if (vendorEmail) {
        this.emailQueue.addToEmailQueue('companyClosure-vendor', {
          to: vendorEmail,
          emailType: MailType.COMPANY_CLOSURE_VENDOR,
          subject: `${companyName} — Service Disconnection Notice`,
          data: { companyName, effectiveDate: new Date().toLocaleDateString() },
        });
      }
    }

    // --- 6. Emit closure event for audit ---
    this.emitterService.emit(EventTypes.ACCOUNT_CLOSURE_INITIATED, {
      cuid,
      initiatedBy: currentUser.sub,
      reason,
    });

    this.log.info({ cuid }, 'Account closure completed');

    return {
      success: true,
      data: {
        message: `Account closed. ${leaseResults.succeeded} leases terminated, ${(staffUsers.items || []).length} staff disconnected, ${(vendors.items || []).length} vendors disconnected.`,
      },
      message: 'Account has been closed successfully',
    };
  }

  /**
   * Returns the current state of an account closure for display on the frontend.
   */
  async getAccountClosureStatus(cuid: string): IPromiseReturnedData<{
    isClosed: boolean;
    closedAt: Date | null;
    closureReason: string | null;
    leases: { total: number; terminated: number; completed: number; active: number };
    staff: { total: number; disconnected: number };
    vendors: { total: number; disconnected: number };
  }> {
    const client = await this.clientDAO.findFirst(
      { cuid },
      { select: '+suspension.isActive +suspension.reason +suspension.at' }
    );
    if (!client) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Client' }) });
    }

    const isClosed = !!(
      client.suspension?.isActive && client.suspension.reason?.includes('Account closed')
    );

    const [activeLeases, terminatedLeases, completedLeases] = await Promise.all([
      this.leaseDAO.countDocuments({ cuid, status: LeaseStatus.ACTIVE, deletedAt: null }),
      this.leaseDAO.countDocuments({ cuid, status: LeaseStatus.TERMINATED, deletedAt: null }),
      this.leaseDAO.countDocuments({ cuid, status: LeaseStatus.COMPLETED, deletedAt: null }),
    ]);
    const totalLeases = activeLeases + terminatedLeases + completedLeases;

    const totalStaff = await this.userDAO.countDocuments({
      'cuids.cuid': cuid,
      'cuids.roles': { $in: ROLE_GROUPS.EMPLOYEE_ROLES },
      deletedAt: null,
    });
    const connectedStaff = await this.userDAO.countDocuments({
      'cuids.cuid': cuid,
      'cuids.roles': { $in: ROLE_GROUPS.EMPLOYEE_ROLES },
      'cuids.isConnected': true,
      deletedAt: null,
    });

    const totalVendors = await this.vendorDAO.countDocuments({
      'connectedClients.cuid': cuid,
      deletedAt: null,
    });
    const connectedVendors = await this.vendorDAO.countDocuments({
      'connectedClients.cuid': cuid,
      'connectedClients.isConnected': true,
      deletedAt: null,
    });

    return {
      success: true,
      data: {
        isClosed,
        closedAt: isClosed ? client.suspension!.at || null : null,
        closureReason: isClosed ? client.suspension!.reason || null : null,
        leases: {
          total: totalLeases,
          terminated: terminatedLeases,
          completed: completedLeases,
          active: activeLeases,
        },
        staff: {
          total: totalStaff,
          disconnected: totalStaff - connectedStaff,
        },
        vendors: {
          total: totalVendors,
          disconnected: totalVendors - connectedVendors,
        },
      },
      message: t('common.success.retrieved', { resource: 'Account closure status' }),
    };
  }
}
