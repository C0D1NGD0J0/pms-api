import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { VendorDAO } from '@dao/vendorDAO';
import { createLogger } from '@utils/index';
import { PropertyDAO } from '@dao/propertyDAO';
import { EmailQueue } from '@queues/email.queue';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { EventTypes } from '@interfaces/events.interface';
import { LeaseStatus } from '@interfaces/lease.interface';
import { ICurrentUser } from '@interfaces/user.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import ROLES, { ROLE_GROUPS } from '@shared/constants/roles.constants';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  ISuccessReturnData,
  IPaginationQuery,
  IRequestContext,
  MailType,
} from '@interfaces/utils.interface';
import {
  ICompleteMaintenancePayload,
  IMaintenanceRequestDocument,
  IRespondToAssignmentPayload,
  ICreateMaintenanceRequest,
  IDeclineAssignmentPayload,
  ICancelMaintenancePayload,
  MaintenanceRequestStatus,
  ISubmitWorkOrderPayload,
  IReviewWorkOrderPayload,
  IInvoiceWebhookPayload,
  ISubmitInvoicePayload,
  IRejectInvoicePayload,
  IAssignVendorPayload,
  IUpdateStatusPayload,
  IMaintenanceFilters,
  WorkOrderStatus,
  InvoiceStatus,
  InvoiceSource,
} from '@interfaces/maintenanceRequest.interface';

const ALLOWED_TRANSITIONS: Record<MaintenanceRequestStatus, MaintenanceRequestStatus[]> = {
  [MaintenanceRequestStatus.PENDING]: [MaintenanceRequestStatus.OPEN],
  [MaintenanceRequestStatus.OPEN]: [
    MaintenanceRequestStatus.ASSIGNED,
    MaintenanceRequestStatus.CANCELLED,
  ],
  [MaintenanceRequestStatus.ASSIGNED]: [
    MaintenanceRequestStatus.IN_PROGRESS,
    MaintenanceRequestStatus.OPEN,
    MaintenanceRequestStatus.CANCELLED,
  ],
  [MaintenanceRequestStatus.IN_PROGRESS]: [
    MaintenanceRequestStatus.COMPLETED,
    MaintenanceRequestStatus.CANCELLED,
  ],
  [MaintenanceRequestStatus.COMPLETED]: [],
  [MaintenanceRequestStatus.CANCELLED]: [],
};

interface IConstructor {
  maintenanceRequestDAO: MaintenanceRequestDAO;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  propertyDAO: PropertyDAO;
  emailQueue: EmailQueue;
  vendorDAO: VendorDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class MaintenanceRequestService {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly vendorDAO: VendorDAO;
  private readonly emailQueue: EmailQueue;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;

  constructor({
    userDAO,
    leaseDAO,
    vendorDAO,
    emailQueue,
    propertyDAO,
    emitterService,
    propertyUnitDAO,
    maintenanceRequestDAO,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.vendorDAO = vendorDAO;
    this.emailQueue = emailQueue;
    this.propertyDAO = propertyDAO;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.maintenanceRequestDAO = maintenanceRequestDAO;
    this.log = createLogger('MaintenanceRequestService');
  }

  private async resolvePrimaryVendorId(currentuser: ICurrentUser): Promise<Types.ObjectId | null> {
    const { linkedVendorUid } = currentuser.client;
    if (!linkedVendorUid) return null;
    const primaryVendor = await this.userDAO.findFirst({ uid: linkedVendorUid, deletedAt: null });
    return primaryVendor ? primaryVendor._id : null;
  }

  private async buildRoleFilter(ctx: IRequestContext): Promise<Record<string, any>> {
    const currentuser = ctx.currentuser;
    if (currentuser.client.role === 'tenant') {
      return { tenantId: new Types.ObjectId(currentuser.sub) };
    }
    if (currentuser.client.role === 'vendor') {
      if (currentuser.client.linkedVendorUid) {
        const primaryId = await this.resolvePrimaryVendorId(currentuser);
        if (primaryId) {
          return { vendorId: { $in: [primaryId, new Types.ObjectId(currentuser.sub)] } };
        }
      }
      return { vendorId: new Types.ObjectId(currentuser.sub) };
    }
    return {};
  }

  private async getRequestOrThrow(
    mruid: string,
    cuid: string
  ): Promise<IMaintenanceRequestDocument> {
    const request = await this.maintenanceRequestDAO.getByMruid(mruid, cuid);
    if (!request) throw new NotFoundError({ message: t('maintenance.errors.notFound') });
    return request;
  }

  private assertTransition(
    current: MaintenanceRequestStatus,
    next: MaintenanceRequestStatus
  ): void {
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new BadRequestError({
        message: t('maintenance.errors.invalidTransition', { current, next }),
      });
    }
  }

  async createRequest(
    ctx: IRequestContext,
    data: ICreateMaintenanceRequest
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;

    const property = await this.propertyDAO.findFirst({
      pid: data.pid,
      cuid,
      deletedAt: null,
    });
    if (!property) throw new NotFoundError({ message: t('property.errors.notFound') });
    if (property.approvalStatus !== 'approved') {
      throw new BadRequestError({ message: t('property.errors.notApproved') });
    }
    if (property.operationalStatus === 'inactive') {
      throw new BadRequestError({ message: t('property.errors.inactive') });
    }

    let unit = null;
    if (data.puid) {
      unit = await this.propertyUnitDAO.findFirst({
        puid: data.puid,
        propertyId: property._id,
        isActive: true,
        status: { $ne: PropertyUnitStatusEnum.INACTIVE },
        deletedAt: null,
      });
      if (!unit) throw new NotFoundError({ message: t('unit.errors.notFound') });
    }

    if (currentuser.client.role === ROLES.TENANT) {
      const activeLease = await this.leaseDAO.findFirst({
        cuid,
        'property.id': property._id,
        ...(unit ? { 'property.unitId': unit._id } : {}),
        tenantId: new Types.ObjectId(currentuser.sub),
        status: LeaseStatus.ACTIVE,
        deletedAt: null,
      });

      if (!activeLease) {
        throw new ForbiddenError({ message: t('maintenance.errors.notYourUnit') });
      }
    }

    // Employees (staff/manager/admin) cannot create MRs on properties they personally
    // occupy — prevents gaming the system by filing requests on their own unit via staff access.
    if (ROLE_GROUPS.EMPLOYEE_ROLES.includes(currentuser.client.role as any)) {
      const [asPrimaryTenant, asCoTenant] = await Promise.all([
        this.leaseDAO.findFirst({
          cuid,
          'property.id': property._id,
          tenantId: new Types.ObjectId(currentuser.sub),
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        }),
        this.leaseDAO.findFirst({
          cuid,
          'property.id': property._id,
          'coTenants.email': currentuser.email,
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        }),
      ]);

      if (asPrimaryTenant || asCoTenant) {
        throw new ForbiddenError({ message: t('maintenance.errors.staffCannotCreateForOwnUnit') });
      }
    }

    const session = await this.maintenanceRequestDAO.startSession();
    const request = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.insert(
        {
          cuid,
          tenantId:
            currentuser.client.role === 'tenant' ? new Types.ObjectId(currentuser.sub) : undefined,
          propertyId: property._id,
          propertyUnitId: unit?._id,
          title: data.title,
          description: data.description,
          category: data.category,
          priority: data.priority,
          locationDescription: data.locationDescription,
          permissionToEnter: data.permissionToEnter,
          hasPet: data.hasPet,
          status: MaintenanceRequestStatus.OPEN,
          isBillable: false,
          media: data.media || [],
          availabilityInfo: data.availabilityInfo,
        },
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_CREATED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      tenantId: currentuser.sub,
      propertyId: property._id.toString(),
      unitId: unit?._id?.toString(),
      title: request.title,
      category: request.category,
      priority: request.priority,
    });

    this.emailQueue.addToEmailQueue('maintenanceRequestCreated', {
      to: currentuser.email,
      emailType: MailType.MAINTENANCE_REQUEST_CREATED,
      subject: '',
      data: { request, currentuser },
    });

    return { success: true, data: request, message: t('maintenance.success.created') };
  }

  async listRequests(
    ctx: IRequestContext,
    filters: IMaintenanceFilters,
    pagination: IPaginationQuery
  ): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    const baseFilter: Record<string, any> = {
      cuid,
      deletedAt: null,
      ...(await this.buildRoleFilter(ctx)),
    };

    if (filters.status) {
      baseFilter.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
    }
    if (filters.priority) baseFilter.priority = filters.priority;
    if (filters.category) baseFilter.category = filters.category;
    if (filters.isBillable !== undefined) baseFilter.isBillable = filters.isBillable;
    if (filters.dateFrom || filters.dateTo) {
      baseFilter.createdAt = {};
      if (filters.dateFrom) baseFilter.createdAt.$gte = new Date(filters.dateFrom);
      if (filters.dateTo) baseFilter.createdAt.$lte = new Date(filters.dateTo);
    }

    // Resolve resource UIDs to ObjectIds for DB queries
    const [property, unit, vendor, tenant] = await Promise.all([
      filters.pid ? this.propertyDAO.findFirst({ pid: filters.pid, cuid, deletedAt: null }) : null,
      filters.puid ? this.propertyUnitDAO.findFirst({ puid: filters.puid, deletedAt: null }) : null,
      filters.vendorUid
        ? this.userDAO.findFirst({ uid: filters.vendorUid, deletedAt: null })
        : null,
      filters.tenantUid
        ? this.userDAO.findFirst({ uid: filters.tenantUid, deletedAt: null })
        : null,
    ]);
    if (property) baseFilter.propertyId = property._id;
    if (unit) baseFilter.propertyUnitId = unit._id;
    if (vendor) baseFilter.vendorId = vendor._id;
    if (tenant) baseFilter.tenantId = tenant._id;

    const result = await this.maintenanceRequestDAO.listWithDetails(baseFilter, pagination);
    return { success: true, data: result };
  }

  async getRequest(ctx: IRequestContext, mruid: string): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    const request = await this.maintenanceRequestDAO.findFirst({
      mruid,
      cuid,
      deletedAt: null,
      ...(await this.buildRoleFilter(ctx)),
    });
    if (!request) throw new NotFoundError({ message: t('maintenance.errors.notFound') });
    return { success: true, data: request };
  }

  async assignVendor(
    ctx: IRequestContext,
    mruid: string,
    data: IAssignVendorPayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    // OPEN → ASSIGNED (vendor must accept before work begins)
    this.assertTransition(request.status, MaintenanceRequestStatus.ASSIGNED);

    const vendorRecord = await this.vendorDAO.findFirst({
      vuid: data.vuid,
      'connectedClients.cuid': cuid,
      'connectedClients.isConnected': true,
      deletedAt: null,
    });
    if (!vendorRecord) throw new NotFoundError({ message: t('maintenance.errors.vendorNotFound') });

    const clientConn = vendorRecord.connectedClients.find((c) => c.cuid === cuid);
    const vendorUserId = clientConn!.primaryAccountHolder;
    const vendorUser = await this.userDAO.findFirst({ _id: vendorUserId });
    if (!vendorUser) throw new NotFoundError({ message: t('maintenance.errors.vendorNotFound') });

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        {
          $set: {
            vendorId: vendorUserId,
            assignedAt: new Date(),
            assignedBy: new Types.ObjectId(currentuser.sub),
            status: MaintenanceRequestStatus.ASSIGNED,
            ...(data.scheduledDate && { scheduledDate: new Date(data.scheduledDate) }),
            ...(data.estimatedCost !== undefined && { estimatedCost: data.estimatedCost }),
          },
        },
        undefined,
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_ASSIGNED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      vendorId: vendorUserId.toString(),
      assignedBy: currentuser.sub,
      scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : undefined,
    });

    // Notify vendor — they need to accept or decline
    this.emailQueue.addToEmailQueue('maintenanceRequestAssigned', {
      to: vendorUser.email,
      emailType: MailType.MAINTENANCE_REQUEST_ASSIGNED,
      subject: '',
      data: { request: updated, vendor: vendorUser, assignedBy: currentuser },
    });

    return { success: true, data: updated, message: t('maintenance.success.assigned') };
  }

  async acceptAssignment(
    ctx: IRequestContext,
    mruid: string,
    data: IRespondToAssignmentPayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    if (request.status !== MaintenanceRequestStatus.ASSIGNED) {
      throw new BadRequestError({ message: t('maintenance.errors.notAssigned') });
    }
    const isAssignedVendor = request.vendorId?.toString() === currentuser.sub;
    let authorized = isAssignedVendor;
    if (!authorized && currentuser.client.linkedVendorUid) {
      const primaryId = await this.resolvePrimaryVendorId(currentuser);
      authorized = !!primaryId && request.vendorId?.toString() === primaryId.toString();
    }
    if (!authorized) {
      throw new ForbiddenError({ message: t('maintenance.errors.notYourAssignment') });
    }

    // Work-order guard: block acceptance if a work order is pending or rejected
    if (request.workOrder) {
      if (request.workOrder.status === WorkOrderStatus.PENDING_REVIEW) {
        throw new BadRequestError({ message: t('maintenance.errors.workOrderPendingReview') });
      }
      if (request.workOrder.status === WorkOrderStatus.REJECTED) {
        throw new BadRequestError({ message: t('maintenance.errors.workOrderRejected') });
      }
    }

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        {
          $set: {
            status: MaintenanceRequestStatus.IN_PROGRESS,
            ...(data.technician && {
              assignedTechnician: {
                name: data.technician.name,
                phone: data.technician.phone,
                email: data.technician.email,
              },
            }),
          },
        },
        undefined,
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_ACCEPTED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      vendorId: currentuser.sub,
    });

    return { success: true, data: updated, message: t('maintenance.success.accepted') };
  }

  async declineAssignment(
    ctx: IRequestContext,
    mruid: string,
    data: IDeclineAssignmentPayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    if (request.status !== MaintenanceRequestStatus.ASSIGNED) {
      throw new BadRequestError({ message: t('maintenance.errors.notAssigned') });
    }
    const isAssignedDecline = request.vendorId?.toString() === currentuser.sub;
    let authorizedDecline = isAssignedDecline;
    if (!authorizedDecline && currentuser.client.linkedVendorUid) {
      const primaryId = await this.resolvePrimaryVendorId(currentuser);
      authorizedDecline = !!primaryId && request.vendorId?.toString() === primaryId.toString();
    }
    if (!authorizedDecline) {
      throw new ForbiddenError({ message: t('maintenance.errors.notYourAssignment') });
    }

    // Unassign vendor and return to OPEN for PM to reassign
    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        {
          $set: { status: MaintenanceRequestStatus.OPEN },
          $unset: {
            vendorId: 1,
            assignedAt: 1,
            assignedBy: 1,
            scheduledDate: 1,
            assignedTechnician: 1,
            workOrder: 1,
          },
        },
        undefined,
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_DECLINED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      vendorId: currentuser.sub,
      reason: data.reason,
    });

    // Notify PM so they can reassign
    this.emailQueue.addToEmailQueue('maintenanceRequestDeclined', {
      to: '', // resolved by worker from cuid's admin users
      emailType: MailType.MAINTENANCE_REQUEST_DECLINED,
      subject: '',
      data: { request: updated, vendorId: currentuser.sub, reason: data.reason },
    });

    return { success: true, data: updated, message: t('maintenance.success.declined') };
  }

  async updateStatus(
    ctx: IRequestContext,
    mruid: string,
    data: IUpdateStatusPayload
  ): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);
    this.assertTransition(request.status, data.status);

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        { $set: { status: data.status } },
        undefined,
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_UPDATED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      previousStatus: request.status,
      newStatus: data.status,
    });

    return { success: true, data: updated, message: t('maintenance.success.statusUpdated') };
  }

  async completeRequest(
    ctx: IRequestContext,
    mruid: string,
    data: ICompleteMaintenancePayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);
    this.assertTransition(request.status, MaintenanceRequestStatus.COMPLETED);

    const updateQuery: Record<string, any> = {
      $set: {
        status: MaintenanceRequestStatus.COMPLETED,
        completedAt: new Date(),
        ...(data.actualCost !== undefined && { actualCost: data.actualCost }),
      },
    };

    if (data.completionNotes) {
      updateQuery.$push = {
        completionNotes: {
          author: new Types.ObjectId(currentuser.sub),
          note: data.completionNotes,
          createdAt: new Date(),
        },
      };
    }

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        updateQuery,
        undefined,
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_COMPLETED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      completedBy: currentuser.sub,
      actualCost: data.actualCost,
    });

    return { success: true, data: updated, message: t('maintenance.success.completed') };
  }

  async cancelRequest(
    ctx: IRequestContext,
    mruid: string,
    data: ICancelMaintenancePayload
  ): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);
    this.assertTransition(request.status, MaintenanceRequestStatus.CANCELLED);

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        { $set: { status: MaintenanceRequestStatus.CANCELLED } },
        undefined,
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_CANCELLED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      reason: data.reason,
    });

    return { success: true, data: updated, message: t('maintenance.success.cancelled') };
  }

  async getStats(ctx: IRequestContext, pid?: string): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    let propertyObjectId: string | undefined;
    if (pid) {
      const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
      propertyObjectId = property?._id?.toString();
    }
    const stats = await this.maintenanceRequestDAO.getStats(cuid, propertyObjectId);
    return { success: true, data: stats };
  }

  async submitInvoice(
    ctx: IRequestContext,
    mruid: string,
    data: ISubmitInvoicePayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    if (
      ![MaintenanceRequestStatus.IN_PROGRESS, MaintenanceRequestStatus.COMPLETED].includes(
        request.status
      )
    ) {
      throw new BadRequestError({ message: t('maintenance.errors.invoiceInvalidStatus') });
    }
    if (currentuser.client.role === 'vendor') {
      const isAssignedInvoice = request.vendorId?.toString() === currentuser.sub;
      let authorizedInvoice = isAssignedInvoice;
      if (!authorizedInvoice && currentuser.client.linkedVendorUid) {
        const primaryId = await this.resolvePrimaryVendorId(currentuser);
        authorizedInvoice = !!primaryId && request.vendorId?.toString() === primaryId.toString();
      }
      if (!authorizedInvoice) {
        throw new ForbiddenError({ message: t('maintenance.errors.invoiceForbidden') });
      }
    }

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        {
          $set: {
            invoice: {
              submittedBy: new Types.ObjectId(currentuser.sub),
              submittedAt: new Date(),
              amountInCents: data.amount,
              currency: (data.currency || 'usd').toLowerCase(),
              description: data.description,
              lineItems: data.lineItems,
              status: InvoiceStatus.PENDING,
              source: data.source || 'manual',
              externalInvoiceId: data.externalInvoiceId,
              externalInvoiceUrl: data.externalInvoiceUrl,
            },
          },
        },
        undefined,
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_INVOICE_SUBMITTED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      vendorId: currentuser.sub,
      amount: data.amount,
      currency: data.currency || 'usd',
    });

    this.emailQueue.addToEmailQueue('maintenanceInvoiceSubmitted', {
      to: '', // resolved by worker from cuid's admin users
      emailType: MailType.MAINTENANCE_INVOICE_SUBMITTED,
      subject: '',
      data: { request: updated, vendorId: currentuser.sub, amount: data.amount },
    });

    return { success: true, data: updated, message: t('maintenance.success.invoiceSubmitted') };
  }

  async approveInvoice(ctx: IRequestContext, mruid: string): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    if (!request.invoice) throw new BadRequestError({ message: t('maintenance.errors.noInvoice') });
    if (request.invoice.status !== InvoiceStatus.PENDING) {
      throw new BadRequestError({ message: t('maintenance.errors.invoiceNotPending') });
    }

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        {
          $set: {
            'invoice.status': InvoiceStatus.APPROVED,
            'invoice.reviewedBy': new Types.ObjectId(currentuser.sub),
            'invoice.reviewedAt': new Date(),
          },
        },
        undefined,
        session
      );
    });

    // Expense integration seam — expense service listens for this event
    this.emitterService.emit(EventTypes.MAINTENANCE_INVOICE_APPROVED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      vendorId: request.vendorId?.toString(),
      amount: request.invoice.amountInCents,
      currency: request.invoice.currency,
      approvedBy: currentuser.sub,
    });

    this.emailQueue.addToEmailQueue('maintenanceInvoiceApproved', {
      to: '', // resolved by worker from vendorId
      emailType: MailType.MAINTENANCE_INVOICE_APPROVED,
      subject: '',
      data: { request: updated, approvedBy: currentuser },
    });

    return { success: true, data: updated, message: t('maintenance.success.invoiceApproved') };
  }

  async rejectInvoice(
    ctx: IRequestContext,
    mruid: string,
    data: IRejectInvoicePayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    if (!request.invoice) throw new BadRequestError({ message: t('maintenance.errors.noInvoice') });
    if (request.invoice.status !== InvoiceStatus.PENDING) {
      throw new BadRequestError({ message: t('maintenance.errors.invoiceNotPending') });
    }

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        {
          $set: {
            'invoice.status': InvoiceStatus.REJECTED,
            'invoice.reviewedBy': new Types.ObjectId(currentuser.sub),
            'invoice.reviewedAt': new Date(),
            'invoice.rejectionReason': data.rejectionReason,
          },
        },
        undefined,
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_INVOICE_REJECTED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      vendorId: request.vendorId?.toString(),
      rejectionReason: data.rejectionReason,
    });

    this.emailQueue.addToEmailQueue('maintenanceInvoiceRejected', {
      to: '', // resolved by worker from vendorId
      emailType: MailType.MAINTENANCE_INVOICE_REJECTED,
      subject: '',
      data: { request: updated, rejectionReason: data.rejectionReason, rejectedBy: currentuser },
    });

    return { success: true, data: updated, message: t('maintenance.success.invoiceRejected') };
  }

  async submitWorkOrder(
    ctx: IRequestContext,
    mruid: string,
    data: ISubmitWorkOrderPayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    if (request.status !== MaintenanceRequestStatus.ASSIGNED) {
      throw new BadRequestError({ message: t('maintenance.errors.notAssigned') });
    }
    if (currentuser.client.role !== 'vendor') {
      throw new ForbiddenError({ message: t('maintenance.errors.workOrderForbidden') });
    }
    const isAssignedWorkOrder = request.vendorId?.toString() === currentuser.sub;
    let authorizedWorkOrder = isAssignedWorkOrder;
    if (!authorizedWorkOrder && currentuser.client.linkedVendorUid) {
      const primaryId = await this.resolvePrimaryVendorId(currentuser);
      authorizedWorkOrder = !!primaryId && request.vendorId?.toString() === primaryId.toString();
    }
    if (!authorizedWorkOrder) {
      throw new ForbiddenError({ message: t('maintenance.errors.notYourAssignment') });
    }

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        {
          $set: {
            workOrder: {
              status: WorkOrderStatus.PENDING_REVIEW,
              submittedBy: new Types.ObjectId(currentuser.sub),
              submittedAt: new Date(),
              scope: data.scope,
              estimatedCostInCents: data.estimatedCostInCents,
              lineItems: data.lineItems,
              notes: data.notes,
            },
          },
        },
        undefined,
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_WORK_ORDER_SUBMITTED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      vendorId: currentuser.sub,
      estimatedCostInCents: data.estimatedCostInCents,
    });

    this.emailQueue.addToEmailQueue('maintenanceWorkOrderSubmitted', {
      to: '',
      emailType: MailType.MAINTENANCE_WORK_ORDER_SUBMITTED,
      subject: '',
      data: { request: updated, workOrder: updated?.workOrder, vendorId: currentuser.sub },
    } as any);

    if (request.tenantId) {
      const tenant = await this.userDAO.findFirst({ _id: request.tenantId });
      if (tenant) {
        this.emailQueue.addToEmailQueue('maintenanceWorkOrderSubmittedTenant', {
          to: tenant.email,
          emailType: MailType.MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT,
          subject: '',
          data: { request: updated, workOrder: updated?.workOrder },
        } as any);
      }
    }

    return { success: true, data: updated, message: t('maintenance.success.workOrderSubmitted') };
  }

  async reviewWorkOrder(
    ctx: IRequestContext,
    mruid: string,
    data: IReviewWorkOrderPayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    if (!request.workOrder) {
      throw new BadRequestError({ message: t('maintenance.errors.workOrderNotFound') });
    }
    if (request.workOrder.status !== WorkOrderStatus.PENDING_REVIEW) {
      throw new BadRequestError({ message: t('maintenance.errors.workOrderNotPending') });
    }
    if (currentuser.client.role === 'vendor') {
      throw new ForbiddenError({ message: t('maintenance.errors.workOrderForbidden') });
    }

    const approved = data.action === 'approve';
    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        {
          $set: {
            'workOrder.status': approved ? WorkOrderStatus.APPROVED : WorkOrderStatus.REJECTED,
            'workOrder.reviewedBy': new Types.ObjectId(currentuser.sub),
            'workOrder.reviewedAt': new Date(),
            ...(!approved &&
              data.rejectionReason && {
                'workOrder.rejectionReason': data.rejectionReason,
              }),
          },
        },
        undefined,
        session
      );
    });

    if (approved) {
      this.emitterService.emit(EventTypes.MAINTENANCE_WORK_ORDER_APPROVED, {
        requestId: request._id.toString(),
        mruid: request.mruid,
        cuid,
        approvedBy: currentuser.sub,
      });

      if (request.vendorId) {
        const vendor = await this.userDAO.findFirst({ _id: request.vendorId });
        if (vendor) {
          this.emailQueue.addToEmailQueue('maintenanceWorkOrderApproved', {
            to: vendor.email,
            emailType: MailType.MAINTENANCE_WORK_ORDER_APPROVED,
            subject: '',
            data: { request: updated, workOrder: updated?.workOrder, approvedBy: currentuser },
          } as any);
        }
      }
    } else {
      this.emitterService.emit(EventTypes.MAINTENANCE_WORK_ORDER_REJECTED, {
        requestId: request._id.toString(),
        mruid: request.mruid,
        cuid,
        rejectedBy: currentuser.sub,
        rejectionReason: data.rejectionReason!,
      });

      if (request.vendorId) {
        const vendor = await this.userDAO.findFirst({ _id: request.vendorId });
        if (vendor) {
          this.emailQueue.addToEmailQueue('maintenanceWorkOrderRejected', {
            to: vendor.email,
            emailType: MailType.MAINTENANCE_WORK_ORDER_REJECTED,
            subject: '',
            data: {
              request: updated,
              workOrder: updated?.workOrder,
              rejectionReason: data.rejectionReason,
              rejectedBy: currentuser,
            },
          } as any);
        }
      }
    }

    const msg = approved
      ? t('maintenance.success.workOrderApproved')
      : t('maintenance.success.workOrderRejected');
    return { success: true, data: updated, message: msg };
  }

  async handleInvoiceWebhook(
    source: InvoiceSource,
    rawBody: Buffer,
    headers: Record<string, string>,
    payload: IInvoiceWebhookPayload
  ): Promise<ISuccessReturnData> {
    if (!this.validateWebhookSignature(source, headers, rawBody)) {
      throw new ForbiddenError({ message: t('maintenance.errors.webhookSignatureInvalid') });
    }

    const request = await this.maintenanceRequestDAO.findFirst({
      mruid: payload.mruid,
      deletedAt: null,
    });
    if (!request) throw new NotFoundError({ message: t('maintenance.errors.notFound') });

    const submittedBy = request.vendorId;
    if (!submittedBy) {
      throw new BadRequestError({ message: t('maintenance.errors.noVendorAssigned') });
    }

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        {
          $set: {
            invoice: {
              submittedBy,
              submittedAt: new Date(),
              amountInCents: payload.amount,
              currency: payload.currency,
              description: payload.description,
              lineItems: payload.lineItems,
              status: InvoiceStatus.PENDING,
              source: payload.source,
              externalInvoiceId: payload.externalInvoiceId,
              externalInvoiceUrl: payload.externalInvoiceUrl,
            },
          },
        },
        undefined,
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_INVOICE_SUBMITTED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid: request.cuid,
      vendorId: submittedBy.toString(),
      amount: payload.amount,
      currency: payload.currency,
    });

    return { success: true, data: updated };
  }

  private validateWebhookSignature(
    source: InvoiceSource,
    _headers: Record<string, string>,
    _rawBody: Buffer
  ): boolean {
    // TODO (Phase 2): Verify HMAC signature before processing
    // Until implemented, this endpoint should NOT be exposed in production without network-level protection
    switch (source) {
      case 'quickbooks':
        // TODO (Phase 2): verify headers['intuit-signature'] with HMAC-SHA256
        return true;
      case 'freshbooks':
        // TODO (Phase 2): verify headers['x-freshbooks-hmac-sha256']
        return true;
      case 'jobber':
        // TODO (Phase 2): verify headers['x-jobber-hmac-sha256']
        return true;
      case 'manual':
      default:
        return true;
    }
  }
}
