import Logger from 'bunyan';
import { t } from '@shared/languages';
import { LeaseDAO } from '@dao/leaseDAO';
import { createLogger } from '@utils/index';
import { LeaseService } from '@services/lease';
import { InspectionDAO } from '@dao/inspectionDAO';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { InspectionType } from '@interfaces/inspection.interface';
import { InspectionService } from '@services/inspection/inspection.service';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';
import { IPromiseReturnedData, IRequestContext } from '@interfaces/utils.interface';
import {
  IVacateRequestDecision,
  IOffboardingStatus,
  ILeaseDocument,
} from '@interfaces/lease.interface';

export class OffboardingService {
  private readonly log: Logger;
  private readonly leaseDAO: LeaseDAO;
  private readonly leaseService: LeaseService;
  private readonly inspectionDAO: InspectionDAO;
  private readonly inspectionService: InspectionService;
  private readonly emitterService: EventEmitterService;

  constructor({
    leaseDAO,
    leaseService,
    inspectionDAO,
    inspectionService,
    emitterService,
  }: {
    leaseDAO: LeaseDAO;
    leaseService: LeaseService;
    inspectionDAO: InspectionDAO;
    inspectionService: InspectionService;
    emitterService: EventEmitterService;
  }) {
    this.log = createLogger('OffboardingService');
    this.leaseDAO = leaseDAO;
    this.leaseService = leaseService;
    this.inspectionDAO = inspectionDAO;
    this.inspectionService = inspectionService;
    this.emitterService = emitterService;

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
    });

    this.emitterService.on(EventTypes.LEASE_EXPIRED, async (payload) => {
      if (payload.reason === 'expired') {
        this.log.info('Lease expired naturally — offboarding chain started', {
          leaseId: payload.leaseId,
          luid: payload.luid,
          cuid: payload.cuid,
        });

        await this.autoScheduleMoveOutInspection(payload.cuid, payload.luid, 'system', new Date());
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
  async getActiveOffboardings(cuid: string): IPromiseReturnedData<ILeaseDocument[]> {
    const leases = await this.leaseDAO.getActiveOffboardings(cuid);

    return {
      success: true,
      data: leases,
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

    const status: IOffboardingStatus = {
      leaseTerminated: lease.status === 'terminated',
      terminationDate: lease.duration.terminationDate,
      paymentsCancelled: lease.status === 'terminated',
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
}
