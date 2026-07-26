import Logger from 'bunyan';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { EmailQueue } from '@queues/index';
import { createLogger } from '@utils/index';
import { PropertyDAO } from '@dao/propertyDAO';
import { InspectionDAO } from '@dao/inspectionDAO';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { IPromiseReturnedData } from '@interfaces/utils.interface';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { DEFAULT_INSPECTION_ROOMS } from '@models/inspection/inspection.model';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  ALLOWED_INSPECTION_TRANSITIONS,
  IListInspectionsQuery,
  IDisputeInspection,
  ICreateInspection,
  IUpdateInspection,
  InspectionStatus,
  InspectionType,
} from '@interfaces/inspection.interface';

interface IConstructor {
  emitterService: EventEmitterService;
  inspectionDAO: InspectionDAO;
  propertyDAO: PropertyDAO;
  emailQueue: EmailQueue;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class InspectionService implements ICronProvider {
  private readonly inspectionDAO: InspectionDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly userDAO: UserDAO;
  private readonly emitterService: EventEmitterService;
  private readonly emailQueue: EmailQueue;
  private readonly log: Logger;

  constructor({
    inspectionDAO,
    leaseDAO,
    propertyDAO,
    userDAO,
    emitterService,
    emailQueue,
  }: IConstructor) {
    this.inspectionDAO = inspectionDAO;
    this.leaseDAO = leaseDAO;
    this.propertyDAO = propertyDAO;
    this.userDAO = userDAO;
    this.emitterService = emitterService;
    this.emailQueue = emailQueue;
    this.log = createLogger('InspectionService');
  }

  getCronJobs(): ICronJob[] {
    return [
      {
        name: 'inspection:daily-reminders',
        schedule: '0 9 * * *',
        handler: this.sendInspectionReminders.bind(this),
        service: 'InspectionService',
        enabled: true,
        description: 'Send reminder notifications for inspections scheduled within 24 hours',
        timeout: 120_000,
      },
    ];
  }

  async scheduleInspection(
    cuid: string,
    userId: string,
    data: ICreateInspection
  ): IPromiseReturnedData {
    const lease = await this.leaseDAO.findFirst({ luid: data.leaseId, cuid });
    if (!lease) {
      throw new NotFoundError({ message: 'Lease not found' });
    }
    if (lease.status !== 'active') {
      throw new BadRequestError({ message: 'Inspections can only be created for active leases' });
    }

    const property = await this.propertyDAO.findFirst({ _id: lease.property.id, cuid });
    if (!property) {
      throw new NotFoundError({ message: 'Property not found' });
    }

    const inspectorId = data.inspectorId ?? userId;
    const rooms = data.rooms && data.rooms.length > 0 ? data.rooms : DEFAULT_INSPECTION_ROOMS;

    const inspection = await this.inspectionDAO.insert({
      cuid,
      type: data.type,
      status: InspectionStatus.SCHEDULED,
      leaseId: lease._id,
      propertyId: property._id,
      inspectorId,
      tenantId: lease.tenantId,
      scheduledDate: new Date(data.scheduledDate),
      overallNotes: data.overallNotes,
      rooms,
      media: [],
      createdBy: userId,
    } as any);

    this.emitterService.emit(EventTypes.INSPECTION_SCHEDULED, {
      iuid: inspection.iuid,
      cuid,
      propertyId: property._id.toString(),
      tenantId: lease.tenantId.toString(),
      type: inspection.type,
      scheduledDate: inspection.scheduledDate,
    });

    return { success: true, message: 'Inspection scheduled', data: inspection };
  }

  async listInspections(
    cuid: string,
    userId: string,
    userRole: string,
    query: IListInspectionsQuery
  ): IPromiseReturnedData<any> {
    const result =
      userRole === 'tenant'
        ? await this.inspectionDAO.listForTenant(userId, cuid, query)
        : await this.inspectionDAO.listByClient(cuid, query);

    return {
      success: true,
      data: {
        inspections: result.items,
        pagination: result.pagination,
      },
    };
  }

  async getInspection(
    cuid: string,
    userId: string,
    userRole: string,
    iuid: string
  ): IPromiseReturnedData {
    const inspection = await this.inspectionDAO.getByIuid(iuid, cuid);
    if (!inspection) {
      throw new NotFoundError({ message: 'Inspection not found' });
    }

    if (userRole === 'tenant' && inspection.tenantId.toString() !== userId) {
      throw new ForbiddenError({ message: 'Access denied' });
    }

    return { success: true, data: inspection };
  }

  async updateInspection(
    cuid: string,
    userId: string,
    userRole: string,
    iuid: string,
    data: IUpdateInspection
  ): IPromiseReturnedData {
    const inspection = await this.inspectionDAO.getByIuid(iuid, cuid);
    if (!inspection) {
      throw new NotFoundError({ message: 'Inspection not found' });
    }

    const editableStatuses = [InspectionStatus.SCHEDULED, InspectionStatus.IN_PROGRESS];

    // Move-in inspections can be revised after rejection
    if (
      inspection.status === InspectionStatus.REJECTED &&
      inspection.type !== InspectionType.MOVE_OUT
    ) {
      editableStatuses.push(InspectionStatus.REJECTED);
    }

    if (!editableStatuses.includes(inspection.status)) {
      throw new BadRequestError({
        message: `Cannot update inspection in status: ${inspection.status}`,
      });
    }

    if (userRole === 'tenant') {
      if (inspection.tenantId.toString() !== userId) {
        throw new ForbiddenError({ message: 'Access denied' });
      }
      if (inspection.type !== InspectionType.MOVE_IN) {
        throw new ForbiddenError({ message: 'Tenants can only update move-in inspections' });
      }
    }

    const updates: Record<string, any> = { ...data };
    // Auto-advance to IN_PROGRESS on first update or when revising after rejection
    if (
      inspection.status === InspectionStatus.SCHEDULED ||
      inspection.status === InspectionStatus.REJECTED
    ) {
      updates.status = InspectionStatus.IN_PROGRESS;
      updates.rejectionReason = null;
    }

    const updated = await this.inspectionDAO.updateById(inspection._id.toString(), {
      $set: updates,
    });
    return { success: true, message: 'Inspection updated', data: updated! };
  }

  async submitInspection(
    cuid: string,
    userId: string,
    userRole: string,
    iuid: string
  ): IPromiseReturnedData {
    const inspection = await this.inspectionDAO.getByIuid(iuid, cuid);
    if (!inspection) {
      throw new NotFoundError({ message: 'Inspection not found' });
    }

    this._validateTransition(inspection.status, InspectionStatus.SUBMITTED);

    if (userRole === 'tenant') {
      if (inspection.tenantId.toString() !== userId) {
        throw new ForbiddenError({ message: 'Access denied' });
      }
      if (inspection.type !== InspectionType.MOVE_IN) {
        throw new ForbiddenError({ message: 'Tenants can only submit move-in inspections' });
      }
    }

    const updated = await this.inspectionDAO.updateById(inspection._id.toString(), {
      $set: {
        status: InspectionStatus.SUBMITTED,
        submittedAt: new Date(),
        completedDate: new Date(),
      },
    });

    this.emitterService.emit(EventTypes.INSPECTION_SUBMITTED, {
      iuid: inspection.iuid,
      cuid,
      inspectorId: inspection.inspectorId.toString(),
      tenantId: inspection.tenantId.toString(),
      type: inspection.type,
    });

    return { success: true, message: 'Inspection submitted', data: updated! };
  }

  async approveInspection(cuid: string, iuid: string): IPromiseReturnedData {
    const inspection = await this.inspectionDAO.getByIuid(iuid, cuid);
    if (!inspection) {
      throw new NotFoundError({ message: 'Inspection not found' });
    }

    if (![InspectionStatus.SUBMITTED, InspectionStatus.DISPUTED].includes(inspection.status)) {
      throw new BadRequestError({
        message: 'Only submitted or disputed inspections can be approved',
      });
    }

    const updated = await this.inspectionDAO.updateById(inspection._id.toString(), {
      $set: {
        status: InspectionStatus.APPROVED,
        approvedAt: new Date(),
      },
    });

    this.emitterService.emit(EventTypes.INSPECTION_APPROVED, {
      iuid: inspection.iuid,
      cuid,
      tenantId: inspection.tenantId.toString(),
    });

    return { success: true, message: 'Inspection approved', data: updated! };
  }

  async acknowledgeInspection(cuid: string, userId: string, iuid: string): IPromiseReturnedData {
    const inspection = await this.inspectionDAO.getByIuid(iuid, cuid);
    if (!inspection) {
      throw new NotFoundError({ message: 'Inspection not found' });
    }

    if (inspection.tenantId.toString() !== userId) {
      throw new ForbiddenError({ message: 'Access denied' });
    }
    if (inspection.status !== InspectionStatus.SUBMITTED) {
      throw new BadRequestError({ message: 'Inspection must be submitted before acknowledging' });
    }

    const updated = await this.inspectionDAO.updateById(inspection._id.toString(), {
      $set: { tenantAcknowledgedAt: new Date() },
    });

    return { success: true, message: 'Inspection acknowledged', data: updated! };
  }

  async disputeInspection(
    cuid: string,
    userId: string,
    iuid: string,
    data: IDisputeInspection
  ): IPromiseReturnedData {
    const inspection = await this.inspectionDAO.getByIuid(iuid, cuid);
    if (!inspection) {
      throw new NotFoundError({ message: 'Inspection not found' });
    }

    if (inspection.tenantId.toString() !== userId) {
      throw new ForbiddenError({ message: 'Access denied' });
    }
    this._validateTransition(inspection.status, InspectionStatus.DISPUTED);

    const updated = await this.inspectionDAO.updateById(inspection._id.toString(), {
      $set: {
        status: InspectionStatus.DISPUTED,
        disputeNotes: data.disputeNotes,
      },
    });

    this.emitterService.emit(EventTypes.INSPECTION_DISPUTED, {
      iuid: inspection.iuid,
      cuid,
      inspectorId: inspection.inspectorId.toString(),
      tenantId: inspection.tenantId.toString(),
      disputeNotes: data.disputeNotes,
    });

    return { success: true, message: 'Inspection disputed', data: updated! };
  }

  async rejectInspection(cuid: string, iuid: string, reason: string): IPromiseReturnedData {
    const inspection = await this.inspectionDAO.getByIuid(iuid, cuid);
    if (!inspection) {
      throw new NotFoundError({ message: 'Inspection not found' });
    }

    this._validateTransition(inspection.status, InspectionStatus.REJECTED);

    // Move-out: final rejection, no resubmission allowed
    // Move-in/routine: tenant can revise and resubmit
    const isFinal = inspection.type === InspectionType.MOVE_OUT;

    const updated = await this.inspectionDAO.updateById(inspection._id.toString(), {
      $set: {
        status: InspectionStatus.REJECTED,
        rejectionReason: reason,
      },
    });

    this.emitterService.emit(EventTypes.INSPECTION_REJECTED, {
      iuid: inspection.iuid,
      cuid,
      tenantId: inspection.tenantId.toString(),
      reason,
      isFinal,
    });

    const message = isFinal
      ? 'Inspection rejected (final)'
      : 'Inspection rejected — tenant can revise and resubmit';

    return { success: true, message, data: updated! };
  }

  async cancelInspection(cuid: string, iuid: string): IPromiseReturnedData {
    const inspection = await this.inspectionDAO.getByIuid(iuid, cuid);
    if (!inspection) {
      throw new NotFoundError({ message: 'Inspection not found' });
    }

    this._validateTransition(inspection.status, InspectionStatus.CANCELLED);

    const updated = await this.inspectionDAO.updateById(inspection._id.toString(), {
      $set: { status: InspectionStatus.CANCELLED },
    });

    return { success: true, message: 'Inspection cancelled', data: updated! };
  }

  async softDeleteInspection(
    cuid: string,
    iuid: string
  ): Promise<{ success: boolean; message: string }> {
    const inspection = await this.inspectionDAO.getByIuid(iuid, cuid);
    if (!inspection) {
      throw new NotFoundError({ message: 'Inspection not found' });
    }

    await this.inspectionDAO.archiveDocument(inspection._id.toString());
    return { success: true, message: 'Inspection deleted' };
  }

  // ─── Cron: Daily Reminders ───────────────────────────────────────────────────

  async sendInspectionReminders(): Promise<void> {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const upcoming = await this.inspectionDAO.list(
      {
        status: InspectionStatus.SCHEDULED,
        scheduledDate: { $gte: now, $lte: tomorrow },
        deletedAt: null,
      },
      { limit: 100 }
    );

    for (const inspection of upcoming.items) {
      this.emitterService.emit(EventTypes.INSPECTION_SCHEDULED, {
        iuid: inspection.iuid,
        cuid: inspection.cuid,
        propertyId: inspection.propertyId.toString(),
        tenantId: inspection.tenantId.toString(),
        type: inspection.type,
        scheduledDate: inspection.scheduledDate,
      });
    }

    this.log.info(`Sent ${upcoming.items.length} inspection reminders`);
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private _validateTransition(current: InspectionStatus, next: InspectionStatus): void {
    if (!ALLOWED_INSPECTION_TRANSITIONS[current].includes(next)) {
      throw new BadRequestError({ message: `Cannot transition from ${current} to ${next}` });
    }
  }
}
