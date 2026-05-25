import dayjs from 'dayjs';
import Logger from 'bunyan';
import Decimal from 'decimal.js';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { UserDAO } from '@dao/userDAO';
import sanitizeHtml from 'sanitize-html';
import { LeaseDAO } from '@dao/leaseDAO';
import { VendorDAO } from '@dao/vendorDAO';
import { PaymentDAO } from '@dao/paymentDAO';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { AIService } from '@services/ai/ai.service';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { convertUserRoleToEnum } from '@utils/helpers';
import { LeaseStatus } from '@interfaces/lease.interface';
import { ICurrentUser } from '@interfaces/user.interface';
import { UploadResult } from '@interfaces/utils.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { TenantPaymentStatus } from '@interfaces/invoice.interface';
import ROLES, { ROLE_GROUPS } from '@shared/constants/roles.constants';
import { CATEGORY_TO_VENDOR_SERVICE, createLogger } from '@utils/index';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';
import { ServiceAreaService } from '@services/serviceArea/serviceArea.service';
import { PROPERTY_APPROVAL_ROLES, PROPERTY_STAFF_ROLES } from '@utils/constants';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';
import { ISuccessReturnData, IPaginationQuery, IRequestContext } from '@interfaces/utils.interface';
import {
  MaintenanceVendorPaidPayload,
  MaintenanceChargePaidPayload,
  EventTypes,
} from '@interfaces/events.interface';
import {
  ITenantMaintenanceRequestView,
  ICompleteMaintenancePayload,
  IMaintenanceRequestDocument,
  IRespondToAssignmentPayload,
  ICreateMaintenanceRequest,
  IDeclineAssignmentPayload,
  IUpdateMaintenancePayload,
  ICancelMaintenancePayload,
  MaintenanceRequestStatus,
  MaintenanceRequestMedia,
  ISubmitWorkOrderPayload,
  IReviewWorkOrderPayload,
  IInvoiceWebhookPayload,
  ISubmitInvoicePayload,
  IRejectInvoicePayload,
  IAssignVendorPayload,
  IUpdateStatusPayload,
  IMaintenanceFilters,
  MaintenanceCategory,
  IVendorSuggestion,
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
    MaintenanceRequestStatus.AWAITING_INVOICE,
    MaintenanceRequestStatus.CANCELLED,
  ],
  [MaintenanceRequestStatus.AWAITING_INVOICE]: [
    MaintenanceRequestStatus.COMPLETED,
    MaintenanceRequestStatus.CANCELLED,
  ],
  [MaintenanceRequestStatus.COMPLETED]: [],
  [MaintenanceRequestStatus.CANCELLED]: [],
};

interface IConstructor {
  maintenanceRequestDAO: MaintenanceRequestDAO;
  serviceAreaService: ServiceAreaService;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  propertyDAO: PropertyDAO;
  invoiceDAO: InvoiceDAO;
  paymentDAO: PaymentDAO;
  vendorDAO: VendorDAO;
  aiService: AIService;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class MaintenanceRequestService {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly vendorDAO: VendorDAO;
  private readonly invoiceDAO: InvoiceDAO;
  private readonly aiService: AIService;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;
  private readonly paymentDAO: PaymentDAO;
  private readonly serviceAreaService: ServiceAreaService;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;

  constructor({
    userDAO,
    leaseDAO,
    vendorDAO,
    invoiceDAO,
    paymentDAO,
    propertyDAO,
    aiService,
    emitterService,
    propertyUnitDAO,
    serviceAreaService,
    maintenanceRequestDAO,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.vendorDAO = vendorDAO;
    this.invoiceDAO = invoiceDAO;
    this.paymentDAO = paymentDAO;
    this.aiService = aiService;
    this.propertyDAO = propertyDAO;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.serviceAreaService = serviceAreaService;
    this.maintenanceRequestDAO = maintenanceRequestDAO;
    this.log = createLogger('MaintenanceRequestService');

    this.emitterService.on(EventTypes.MAINTENANCE_VENDOR_PAID, this.handleVendorPaid.bind(this));
    this.emitterService.on(EventTypes.MAINTENANCE_CHARGE_PAID, this.handleChargePaid.bind(this));
  }

  async persistUploadedMedia(
    mruid: string,
    results: UploadResult[],
    actorId: string
  ): Promise<string | null> {
    if (!results?.length) return null;

    const mediaItems: MaintenanceRequestMedia[] = results.map((r) => ({
      url: r.url,
      key: r.key,
      filename: r.filename,
      uploadedBy: new Types.ObjectId(actorId),
      uploadedAt: new Date(),
      status: 'active',
    }));

    const updated = await this.maintenanceRequestDAO.update(
      { mruid },
      { $push: { media: { $each: mediaItems } } }
    );

    this.log.info(
      { mruid, count: mediaItems.length },
      '[MaintenanceRequestService] media persisted after S3 upload'
    );

    return updated?.cuid ?? null;
  }

  /**
   * When the Stripe webhook confirms a tenant maintenance charge is paid,
   * auto-complete the SR so it moves from awaiting_invoice → completed.
   */
  private handleChargePaid = async (payload: MaintenanceChargePaidPayload): Promise<void> => {
    try {
      this.log.info(
        { mruid: payload.mruid },
        '[ServiceRequestService] Maintenance charge paid — persisting tenant payment status'
      );

      // Always persist tenantPaymentStatus on the invoice so the PM portal
      // reflects payment without relying on a computed field at read time.
      const invoice = await this.invoiceDAO.findByMaintenanceRequest(payload.mruid, payload.cuid);
      if (invoice) {
        await this.invoiceDAO.updateById((invoice as any)._id.toString(), {
          $set: { tenantPaymentStatus: TenantPaymentStatus.PAID },
        });
        this.log.info(
          { mruid: payload.mruid },
          '[ServiceRequestService] Invoice tenantPaymentStatus set to paid'
        );
      }

      const request = await this.maintenanceRequestDAO.getByMruid(payload.mruid, payload.cuid);
      if (!request) {
        this.log.warn(
          { mruid: payload.mruid },
          '[ServiceRequestService] SR not found for charge-paid event'
        );
        return;
      }
      if (request.status !== MaintenanceRequestStatus.AWAITING_INVOICE) {
        this.log.info(
          { mruid: payload.mruid, status: request.status },
          '[ServiceRequestService] SR not in awaiting_invoice — skipping auto-finalize'
        );
        return;
      }

      await this.maintenanceRequestDAO.updateById(request._id.toString(), {
        $set: {
          status: MaintenanceRequestStatus.COMPLETED,
          completedAt: new Date(),
          'tenantFeedback.status': 'pending',
        },
      });

      this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_COMPLETED, {
        requestId: request._id.toString(),
        mruid: request.mruid,
        cuid: payload.cuid,
        tenantId: request.tenantId?.toString() ?? '',
        vendorId: request.vendorId?.toString(),
        completedBy: 'system',
      });

      this.log.info(
        { mruid: payload.mruid },
        '[ServiceRequestService] SR auto-completed after tenant charge paid'
      );
    } catch (err: unknown) {
      this.log.error(
        { err, mruid: payload.mruid },
        '[ServiceRequestService] Failed to auto-complete SR after charge paid'
      );
    }
  };

  /**
   * When PaymentService emits MAINTENANCE_VENDOR_PAID after a successful Stripe transfer,
   * mark the linked Invoice as paid so the frontend payout badge reflects it.
   */
  private handleVendorPaid = async (payload: MaintenanceVendorPaidPayload): Promise<void> => {
    try {
      this.log.info({ mruid: payload.mruid }, '[ServiceRequestService] Vendor paid event received');
      const invoice = await this.invoiceDAO.findByMaintenanceRequest(payload.mruid, payload.cuid);
      if (invoice) {
        await this.invoiceDAO.updateById((invoice as any)._id.toString(), {
          $set: {
            vendorPayoutStatus: 'paid',
            vendorPaidAt: new Date(),
            vendorPayoutTransferId: payload.transferId,
          },
        });
      }
    } catch (err: unknown) {
      this.log.error(
        { err, mruid: payload.mruid },
        '[ServiceRequestService] Failed to update invoice vendor payout status'
      );
    }
  };

  private async resolvePrimaryVendorId(currentuser: ICurrentUser): Promise<Types.ObjectId | null> {
    const { linkedVendorUid } = currentuser.client;
    if (!linkedVendorUid) return null;
    const primaryVendor = await this.userDAO.findFirst({
      uid: linkedVendorUid,
      'cuids.cuid': currentuser.client.cuid,
      deletedAt: null,
    });
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

    if (currentuser.client.role === ROLES.TENANT) {
      const anyActiveLease = await this.leaseDAO.findFirst({
        cuid,
        tenantId: new Types.ObjectId(currentuser.sub),
        status: LeaseStatus.ACTIVE,
        deletedAt: null,
      });
      if (!anyActiveLease) {
        throw new ForbiddenError({ message: t('maintenance.errors.noActiveLease') });
      }
    }

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

    // ── Maintenance status toggle ──────────────────────────────────────────────
    if (data.setMaintenanceStatus && currentuser.client.role !== ROLES.TENANT) {
      const userRoleEnum = convertUserRoleToEnum(currentuser.client.role);

      if (PROPERTY_APPROVAL_ROLES.includes(userRoleEnum)) {
        // Manager/Admin → apply directly
        await this.propertyDAO.updateById(property._id.toString(), {
          $set: { operationalStatus: 'maintenance' },
        });
        if (unit) {
          await (unit as any).prepareForMaintenance(
            `SR ${request.mruid}: ${data.title}`,
            currentuser.sub
          );
        }
      } else if (PROPERTY_STAFF_ROLES.includes(userRoleEnum)) {
        // Staff → submit for approval
        await this.maintenanceRequestDAO.updateById(request._id.toString(), {
          $set: {
            pendingMaintenanceStatus: {
              propertyId: property._id,
              unitId: unit?._id,
              requestedBy: new Types.ObjectId(currentuser.sub),
              requestedAt: new Date(),
              displayName: currentuser.fullname || currentuser.displayName,
            },
          },
        });
      }
    }

    // ── Optional vendor assignment on creation ──────────────────────────────────
    if (data.vendorVuid && currentuser.client.role !== ROLES.TENANT) {
      const vendorRecord = await this.vendorDAO.findFirst({
        vuid: data.vendorVuid,
        'connectedClients.cuid': cuid,
        'connectedClients.isConnected': true,
        deletedAt: null,
      });
      if (vendorRecord) {
        const clientConn = vendorRecord.connectedClients.find((c) => c.cuid === cuid);
        if (clientConn?.primaryAccountHolderUserId) {
          const vendorUserId = clientConn.primaryAccountHolderUserId;
          await this.maintenanceRequestDAO.updateById(request._id.toString(), {
            $set: {
              vendorId: vendorUserId,
              assignedAt: new Date(),
              assignedBy: new Types.ObjectId(currentuser.sub),
              status: MaintenanceRequestStatus.ASSIGNED,
              ...(data.scheduledDate && { scheduledDate: new Date(data.scheduledDate) }),
              ...(data.estimatedCost !== undefined && { estimatedCost: data.estimatedCost }),
            },
          });

          this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_ASSIGNED, {
            requestId: request._id.toString(),
            mruid: request.mruid,
            cuid,
            vendorId: vendorUserId.toString(),
            assignedBy: currentuser.sub,
          });
        }
      }
    }

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

    // Fire-and-forget: AI triage runs async, never blocks the response
    this.runAITriage(request).catch((err) =>
      this.log.error({ err, mruid: request.mruid }, 'AI triage background task failed')
    );

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

    const isTenant = ctx.currentuser.client.role === ROLES.TENANT;
    if (filters.status) {
      baseFilter.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
    } else if (!isTenant) {
      // PMs, staff, and vendors don't see cancelled requests unless they explicitly filter for them
      baseFilter.status = { $ne: 'cancelled' };
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
    const [property, unit, vendor, tenant, managedBy] = await Promise.all([
      filters.pid ? this.propertyDAO.findFirst({ pid: filters.pid, cuid, deletedAt: null }) : null,
      filters.puid ? this.propertyUnitDAO.findFirst({ puid: filters.puid, deletedAt: null }) : null,
      filters.vendorUid
        ? this.userDAO.findFirst({ uid: filters.vendorUid, deletedAt: null })
        : null,
      filters.tenantUid
        ? this.userDAO.findFirst({ uid: filters.tenantUid, deletedAt: null })
        : null,
      filters.managedByUid
        ? this.userDAO.findFirst({ uid: filters.managedByUid, deletedAt: null })
        : null,
    ]);
    if (property) baseFilter.propertyId = property._id;
    if (unit) baseFilter.propertyUnitId = unit._id;
    if (vendor) baseFilter.vendorId = vendor._id;
    if (tenant) baseFilter.tenantId = tenant._id;
    if (managedBy) baseFilter.managedBy = managedBy._id;

    const result = await this.maintenanceRequestDAO.listWithDetails(baseFilter, pagination);

    const rawItems: any[] = ((result as any).items || []).map((item: any) =>
      item.toObject ? item.toObject() : { ...item }
    );

    // Batch-resolve vendor company names — one query for the whole page
    const vendorUserIds = [
      ...new Set(
        rawItems
          .map((item: any) => item.vendorId?._id?.toString() ?? item.vendorId?.toString())
          .filter(Boolean)
      ),
    ];
    const vendorCompanyMap: Record<string, string> = {};
    if (vendorUserIds.length > 0) {
      const vendorDocs = await this.vendorDAO.list(
        {
          'connectedClients.primaryAccountHolderUserId': {
            $in: vendorUserIds.map((id) => new Types.ObjectId(id)),
          },
        },
        { projection: 'companyName connectedClients' }
      );
      for (const vDoc of (vendorDocs as any).items || []) {
        for (const conn of vDoc.connectedClients || []) {
          vendorCompanyMap[conn.primaryAccountHolderUserId.toString()] = vDoc.companyName;
        }
      }
    }

    // Project invoiceId (populated) → invoice object for list items
    const items = rawItems.map((plain: any) => {
      const invoiceDoc = plain.invoiceId;
      if (typeof invoiceDoc === 'object' && invoiceDoc !== null) {
        // An approved invoice on a completed SR means the tenant has paid
        const rawStatus: string = invoiceDoc.status ?? 'pending';
        const effectiveStatus =
          rawStatus === 'approved' && plain.status === MaintenanceRequestStatus.COMPLETED
            ? 'paid'
            : rawStatus;
        plain.invoice = {
          invuid: invoiceDoc.invuid ?? null,
          status: effectiveStatus,
          amountInCents: invoiceDoc.amountInCents ?? null,
          vendorPayoutStatus: invoiceDoc.vendorPayoutStatus ?? null,
          submittedAt: invoiceDoc.submittedAt ?? null,
        };
      } else {
        plain.invoice = null;
      }
      delete plain.invoiceId;

      // Map populated vendorId (User doc) → vendorName + plain vendorId string
      const vendorUser = plain.vendorId;
      if (vendorUser && typeof vendorUser === 'object') {
        const userId = vendorUser._id?.toString();
        plain.vendorName =
          (userId && vendorCompanyMap[userId]) ||
          `${vendorUser?.profile?.personalInfo?.firstName || ''} ${vendorUser?.profile?.personalInfo?.lastName || ''}`.trim() ||
          vendorUser.email ||
          null;
        plain.vendorId = userId ?? null;
      }

      return plain;
    });

    return { success: true, data: { ...(result as any), items } };
  }

  async getRequest(ctx: IRequestContext, mruid: string): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    const request = await this.maintenanceRequestDAO.findFirst(
      {
        mruid,
        cuid,
        deletedAt: null,
        ...(await this.buildRoleFilter(ctx)),
      },
      {
        populate: [
          { path: 'propertyId', select: 'address pid name' },
          { path: 'propertyUnitId', select: 'unitNumber puid' },
          {
            path: 'vendorId',
            select: 'email uid',
            populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' },
          },
          {
            path: 'tenantId',
            select: 'email uid',
            populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' },
          },
          { path: 'invoiceId' },
        ],
      }
    );
    if (!request) throw new NotFoundError({ message: t('maintenance.errors.notFound') });

    const property = (request as any).propertyId as any;
    const unit = (request as any).propertyUnitId as any;
    const tenant = (request as any).tenantId as any;
    const vendor = (request as any).vendorId as any;

    const plain = request.toObject ? request.toObject() : { ...request };

    // Map populated refs to flat display fields the frontend expects
    plain.propertyAddress =
      typeof property?.address === 'string'
        ? property.address
        : property?.address?.fullAddress || property?.name || '';

    // Collapse propertyId back to a plain pid string (interface declares string)
    plain.propertyId = property?.pid ?? '';

    // Expose unit as a typed object so the frontend gets both unitNumber and puid
    plain.propertyUnit =
      unit && typeof unit === 'object'
        ? { unitNumber: unit.unitNumber ?? null, puid: unit.puid ?? null }
        : null;
    delete plain.propertyUnitId;

    const tenantProfile = tenant?.profile?.personalInfo;
    if (tenantProfile) {
      plain.tenantName =
        `${tenantProfile.firstName || ''} ${tenantProfile.lastName || ''}`.trim() || tenant.email;
    }
    // tenantId populated object is not consumed by any portal — drop it
    delete plain.tenantId;

    // Resolve active lease end date for the property/unit so the frontend can cap scheduling
    const leaseFilter: Record<string, any> = {
      cuid,
      'property.id': property?._id,
      status: LeaseStatus.ACTIVE,
      deletedAt: null,
    };
    if (unit?._id) leaseFilter['property.unitId'] = unit._id;
    const activeLease = await this.leaseDAO.findFirst(leaseFilter, { select: 'duration.endDate' });
    plain.leaseEndDate = activeLease?.duration?.endDate
      ? dayjs(activeLease.duration.endDate).format('YYYY-MM-DD')
      : undefined;

    if (vendor) {
      // vendorId refs User, not Vendor — look up the Vendor doc for companyName
      const vendorDoc = await this.vendorDAO.findFirst({
        'connectedClients.primaryAccountHolderUserId': vendor._id,
        'connectedClients.cuid': cuid,
      });
      plain.vendorName =
        vendorDoc?.companyName ||
        `${vendor?.profile?.personalInfo?.firstName || ''} ${vendor?.profile?.personalInfo?.lastName || ''}`.trim() ||
        vendor.email;
    }
    // Collapse vendorId back to a plain string after populate (interface declares string)
    plain.vendorId = vendor?._id?.toString() ?? null;

    const mapInvoiceDoc = (inv: any) => ({
      invuid: inv.invuid,
      submittedAt: inv.submittedAt,
      amountInCents: inv.amountInCents,
      currency: inv.currency,
      description: inv.description,
      status: inv.status,
      source: inv.source?.type ?? 'manual',
      lineItems: inv.lineItems ?? [],
      attachmentUrl: inv.attachment?.url,
      attachmentKey: inv.attachment?.key,
      reviewedAt: inv.review?.reviewedAt,
      rejectionReason: inv.review?.rejectionReason,
      externalInvoiceId: inv.source?.externalId,
      externalInvoiceUrl: inv.source?.externalUrl,
      vendorPayoutStatus: inv.vendorPayoutStatus,
      vendorPaidAt: inv.vendorPaidAt,
    });

    // Map populated invoiceId to `invoice` for frontend compatibility.
    // Flatten the standalone Invoice document shape to match the MRInvoice interface.
    if (plain.invoiceId && typeof plain.invoiceId === 'object') {
      plain.invoice = mapInvoiceDoc(plain.invoiceId);
      delete plain.invoiceId;
    }

    // Filter out soft-deleted media items before sending to client
    if (Array.isArray(plain.media)) {
      plain.media = plain.media.filter((m: any) => m.status !== 'deleted');
    }

    // Strip internal-only fields not consumed by any frontend view
    delete plain.__v;
    delete plain.assignedBy;
    if (plain.workOrder) {
      delete plain.workOrder.submittedBy;
      delete plain.workOrder.reviewedBy;
    }

    // Augment invoice with tenant payment status so the frontend can gate "Pay Vendor".
    // Prefer the persisted field (set by webhook handler); fall back to a live payment
    // lookup for records created before the field was added.
    if (plain.invoice?.status === 'approved') {
      if (plain.invoice.tenantPaymentStatus) {
        // Already persisted by the webhook handler — no extra query needed.
      } else {
        const tenantCharge = await this.paymentDAO.findFirst({
          cuid,
          maintenanceRequestUid: mruid,
          paymentType: PaymentRecordType.MAINTENANCE,
          vendorId: { $exists: false },
          deletedAt: null,
        });
        plain.invoice.tenantPaymentStatus =
          tenantCharge?.status === PaymentRecordStatus.PAID
            ? TenantPaymentStatus.PAID
            : TenantPaymentStatus.UNPAID;
      }
    }

    return { success: true, data: plain };
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
    const vendorUserId = clientConn!.primaryAccountHolderUserId;
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
      tenantId: request.tenantId?.toString(),
      vendorId: vendorUserId.toString(),
      assignedBy: currentuser.sub,
      scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : undefined,
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
      tenantId: request.tenantId?.toString(),
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
      tenantId: request.tenantId?.toString(),
      vendorId: currentuser.sub,
      reason: data.reason,
    });

    return { success: true, data: updated, message: t('maintenance.success.declined') };
  }

  async respondToAssignment(
    ctx: IRequestContext,
    mruid: string,
    body: {
      action: string;
      reason?: string;
      technician?: { name: string; phone?: string; email?: string };
    }
  ): Promise<ISuccessReturnData> {
    if (body.action === 'accept') {
      return this.acceptAssignment(ctx, mruid, { action: 'accept', technician: body.technician });
    }
    if (body.action === 'abandon') {
      return this.abandonAssignment(ctx, mruid);
    }
    return this.declineAssignment(ctx, mruid, { reason: body.reason });
  }

  async abandonAssignment(ctx: IRequestContext, mruid: string): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    if (request.status !== MaintenanceRequestStatus.IN_PROGRESS) {
      throw new BadRequestError({ message: 'Assignment can only be released while in progress' });
    }
    if (request.workOrder?.status !== WorkOrderStatus.REJECTED) {
      throw new BadRequestError({
        message: 'Assignment can only be released after a work order has been rejected',
      });
    }

    // Verify the caller is the assigned vendor
    const isAssigned = request.vendorId?.toString() === currentuser.sub;
    let authorized = isAssigned;
    if (!authorized && currentuser.client.linkedVendorUid) {
      const primaryId = await this.resolvePrimaryVendorId(currentuser);
      authorized = !!primaryId && request.vendorId?.toString() === primaryId.toString();
    }
    if (!authorized) {
      throw new ForbiddenError({ message: t('maintenance.errors.notYourAssignment') });
    }

    // Unassign vendor, clear WO, return SR to OPEN for PM to reassign
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

    // Reuse the declined event so PM receives a notification
    this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_DECLINED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      tenantId: request.tenantId?.toString(),
      vendorId: currentuser.sub,
      reason: 'Vendor released assignment after work order was rejected',
    });

    return {
      success: true,
      data: updated,
      message: 'Assignment released. The request has been returned for reassignment.',
    };
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

  /**
   * Vendor marks work as done → transitions to AWAITING_INVOICE with 72hr deadline.
   * Requires an approved work order (even for $0 jobs).
   */
  async markWorkDone(
    ctx: IRequestContext,
    mruid: string,
    data: ICompleteMaintenancePayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);
    this.assertTransition(request.status, MaintenanceRequestStatus.AWAITING_INVOICE);

    // Mandatory work order guard
    if (!request.workOrder) {
      throw new BadRequestError({ message: t('maintenance.errors.workOrderRequired') });
    }
    if (request.workOrder.status !== WorkOrderStatus.APPROVED) {
      throw new BadRequestError({ message: t('maintenance.errors.workOrderNotApproved') });
    }

    const INVOICE_DEADLINE_HOURS = 72;
    const invoiceDeadline = new Date(Date.now() + INVOICE_DEADLINE_HOURS * 60 * 60 * 1000);

    const updateQuery: Record<string, any> = {
      $set: {
        status: MaintenanceRequestStatus.AWAITING_INVOICE,
        invoiceDeadline,
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

    this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_WORK_DONE, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      tenantId: request.tenantId?.toString(),
      vendorId: request.vendorId?.toString(),
      completedBy: currentuser.sub,
      invoiceDeadline: invoiceDeadline.toISOString(),
    });

    return { success: true, data: updated, message: t('maintenance.success.workDone') };
  }

  /**
   * PM finalizes the request → transitions AWAITING_INVOICE → COMPLETED.
   * Typically called after invoice is approved (or after 72hr expiry if PM decides to close).
   */
  async finalizeCompletion(ctx: IRequestContext, mruid: string): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);
    this.assertTransition(request.status, MaintenanceRequestStatus.COMPLETED);

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        {
          $set: {
            status: MaintenanceRequestStatus.COMPLETED,
            completedAt: new Date(),
            'tenantFeedback.status': 'pending',
          },
        },
        undefined,
        session
      );
    });

    this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_COMPLETED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      tenantId: request.tenantId?.toString() ?? '',
      vendorId: request.vendorId?.toString(),
      completedBy: currentuser.sub,
    });

    // Auto-revert property/unit status if in maintenance and no other active SRs
    if (request.propertyId) {
      const property = await this.propertyDAO.findById(request.propertyId.toString());
      if (property?.operationalStatus === 'maintenance') {
        const otherActiveSRs = await this.maintenanceRequestDAO.list({
          propertyId: request.propertyId,
          status: {
            $nin: [MaintenanceRequestStatus.COMPLETED, MaintenanceRequestStatus.CANCELLED],
          },
          _id: { $ne: request._id },
          deletedAt: null,
        });

        if ((otherActiveSRs.items || []).length === 0) {
          await this.propertyDAO.updateById(property._id.toString(), {
            $set: { operationalStatus: 'available' },
          });
          if (request.propertyUnitId) {
            const unit = await this.propertyUnitDAO.findById(request.propertyUnitId.toString());
            if (unit) await (unit as any).makeUnitAvailable(currentuser.sub);
          }
        }
      }
    }

    return { success: true, data: updated, message: t('maintenance.success.completed') };
  }

  /**
   * Tenant submits satisfaction feedback after completion.
   */
  async submitTenantFeedback(
    ctx: IRequestContext,
    mruid: string,
    data: { status: 'confirmed' | 'disputed'; rating?: number; comment?: string }
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    if (request.status !== MaintenanceRequestStatus.COMPLETED) {
      throw new BadRequestError({ message: t('maintenance.errors.notCompleted') });
    }

    if (request.tenantId?.toString() !== currentuser.sub) {
      throw new ForbiddenError({ message: t('maintenance.errors.notYourRequest') });
    }

    if ((request as any).tenantFeedback?.submittedAt) {
      throw new BadRequestError({ message: t('maintenance.errors.feedbackAlreadySubmitted') });
    }

    const updated = await this.maintenanceRequestDAO.updateById(request._id.toString(), {
      $set: {
        'tenantFeedback.status': data.status,
        'tenantFeedback.rating': data.rating,
        'tenantFeedback.comment': data.comment,
        'tenantFeedback.submittedAt': new Date(),
      },
    });

    // @ts-expect-error — event payload type pending update from invoice decoupling
    this.emitterService.emit(EventTypes.MAINTENANCE_FEEDBACK_SUBMITTED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      tenantId: currentuser.sub,
      vendorId: request.vendorId?.toString(),
      feedbackStatus: data.status,
      rating: data.rating,
    });

    // If confirmed with rating, update vendor's average rating
    if (data.status === 'confirmed' && data.rating && request.vendorId) {
      await this.updateVendorRating(request.vendorId.toString());
    }

    return { success: true, data: updated, message: t('maintenance.success.feedbackSubmitted') };
  }

  private async updateVendorRating(vendorUserId: string): Promise<void> {
    try {
      const requests = await this.maintenanceRequestDAO.list({
        vendorId: new Types.ObjectId(vendorUserId),
        'tenantFeedback.status': 'confirmed',
        'tenantFeedback.rating': { $exists: true },
        deletedAt: null,
      });

      const items = requests.items || [];
      if (items.length === 0) return;

      const totalRating = items.reduce(
        (sum: number, r: any) => sum + (r.tenantFeedback?.rating || 0),
        0
      );
      const avgRating = (totalRating / items.length).toFixed(1);

      // Update vendor profile stats
      const vendorDAO = (this as any).vendorDAO;
      if (vendorDAO) {
        await vendorDAO.updateMany(
          { 'connectedClients.primaryAccountHolderUserId': new Types.ObjectId(vendorUserId) },
          { $set: { 'stats.rating': avgRating, 'stats.reviewCount': items.length } }
        );
      }
    } catch (error) {
      this.log.error('Failed to update vendor rating:', error);
    }
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
      tenantId: request.tenantId?.toString() ?? '',
      vendorId: request.vendorId?.toString(),
      reason: data.reason,
    });

    return { success: true, data: updated, message: t('maintenance.success.cancelled') };
  }

  async updateRequest(
    ctx: IRequestContext,
    mruid: string,
    data: IUpdateMaintenancePayload
  ): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    const isFullyEditable = [
      MaintenanceRequestStatus.PENDING,
      MaintenanceRequestStatus.OPEN,
    ].includes(request.status);
    const isLimitedEditable = [
      MaintenanceRequestStatus.IN_PROGRESS,
      MaintenanceRequestStatus.ASSIGNED,
    ].includes(request.status);

    if (!isFullyEditable && !isLimitedEditable) {
      throw new ForbiddenError({ message: t('maintenance.errors.editNotAllowed') });
    }

    // Limited-edit path: only hasPet, preferredDate, availabilityInfo are accepted.
    // All other fields are ignored and AI re-triage is skipped.
    if (isLimitedEditable) {
      const limitedFields: Record<string, unknown> = {};
      if (data.hasPet !== undefined) limitedFields.hasPet = data.hasPet;
      if (data.availabilityInfo !== undefined)
        limitedFields.availabilityInfo = data.availabilityInfo;

      const updated = await this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        { $set: limitedFields },
        undefined,
        undefined
      );

      this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_UPDATED, {
        requestId: request._id.toString(),
        mruid: request.mruid,
        cuid,
        previousStatus: request.status,
        newStatus: request.status,
        managedBy: request.managedBy?.toString(),
        propertyId: request.propertyId?.toString(),
      });

      return { success: true, data: updated, message: t('maintenance.success.updated') };
    }

    const titleChanged = data.title !== undefined && data.title !== request.title;
    const descriptionChanged =
      data.description !== undefined &&
      (data.description as any)?.text !==
        (typeof request.description === 'string'
          ? request.description
          : (request.description as any)?.text);

    const updateFields: Record<string, unknown> = {};
    if (data.title !== undefined) updateFields.title = data.title;
    if (data.description !== undefined) updateFields.description = data.description;
    if (data.category !== undefined) updateFields.category = data.category;
    if (data.priority !== undefined) updateFields.priority = data.priority;
    if (data.locationDescription !== undefined)
      updateFields.locationDescription = data.locationDescription;
    if (data.permissionToEnter !== undefined)
      updateFields.permissionToEnter = data.permissionToEnter;
    if (data.hasPet !== undefined) updateFields.hasPet = data.hasPet;
    if (data.availabilityInfo !== undefined) updateFields.availabilityInfo = data.availabilityInfo;

    // Clear stale AI results when re-triageable content changes so the panel
    // doesn't show a suggestion based on the old title/description.
    const shouldRetriage =
      (titleChanged || descriptionChanged) && request.aiAnalysis?.accepted !== true;
    if (shouldRetriage) {
      updateFields['aiAnalysis'] = {};
    }

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      const ops: Record<string, unknown> = { $set: updateFields };

      if (data.mediaToRemove?.length) {
        // Soft-delete: mark matching media items as 'deleted' so they are
        // excluded from future queries without immediately purging from S3.
        ops['$set'] = {
          ...updateFields,
          'media.$[elem].status': 'deleted',
        };
        return this.maintenanceRequestDAO.updateById(
          request._id.toString(),
          ops,
          {
            arrayFilters: [{ 'elem.key': { $in: data.mediaToRemove } }],
          } as any,
          session
        );
      }

      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        { $set: updateFields },
        undefined,
        session
      );
    });

    // Re-run AI triage when title or description changed and no suggestion was
    // previously accepted. Fire-and-forget — never blocks the response.
    if (shouldRetriage && updated) {
      this.runAITriage(updated).catch((err) =>
        this.log.error({ err, mruid: request.mruid }, 'AI re-triage on edit failed')
      );
    }

    this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_UPDATED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid,
      previousStatus: request.status,
      newStatus: request.status,
      managedBy: request.managedBy?.toString(),
      propertyId: request.propertyId?.toString(),
    });

    return { success: true, data: updated, message: t('maintenance.success.updated') };
  }

  async getStats(ctx: IRequestContext, pid?: string): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    const currentuser = ctx.currentuser;

    let propertyObjectId: string | undefined;
    if (pid) {
      const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
      propertyObjectId = property?._id?.toString();
    }

    const tenantUserId = currentuser.client.role === 'tenant' ? currentuser.sub : undefined;

    const stats = await this.maintenanceRequestDAO.getStats(cuid, {
      propertyId: propertyObjectId,
      tenantUserId,
    });
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

    if (request.status !== MaintenanceRequestStatus.AWAITING_INVOICE) {
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

    // Guard: only allow resubmission after rejection
    const existingInvoice = await this.invoiceDAO.findByMaintenanceRequest(mruid, cuid);
    if (existingInvoice) {
      if ([InvoiceStatus.APPROVED, InvoiceStatus.PENDING].includes(existingInvoice.status)) {
        const statusLabel =
          existingInvoice.status === InvoiceStatus.PENDING ? 'pending review' : 'already approved';
        throw new BadRequestError({
          message: `An invoice is ${statusLabel}. You can only submit a new invoice after a rejection.`,
        });
      }
    }

    // Create standalone Invoice document and link to MR atomically.
    // Both writes are wrapped in a session transaction so a partial failure
    // cannot leave an orphaned invoice with no MR reference.
    const session = await this.invoiceDAO.startSession();
    let invoice: any;
    try {
      await session.withTransaction(async () => {
        invoice = await this.invoiceDAO.insert(
          {
            cuid,
            maintenanceRequestId: request._id,
            mruid: request.mruid,
            submittedBy: new Types.ObjectId(currentuser.sub),
            submittedAt: new Date(),
            amountInCents: data.amount,
            currency: (data.currency || 'USD').toUpperCase(),
            description: data.description,
            lineItems: data.lineItems,
            status: InvoiceStatus.PENDING,
            source: {
              type: data.source || 'manual',
              externalId: data.externalInvoiceId,
              externalUrl: data.externalInvoiceUrl,
            },
          } as any,
          session
        );

        await this.maintenanceRequestDAO.updateById(
          request._id.toString(),
          { $set: { invoiceId: invoice._id } },
          {},
          session
        );
      });
    } finally {
      await session.endSession();
    }

    (this.emitterService as any).emit(EventTypes.MAINTENANCE_INVOICE_SUBMITTED, {
      requestId: request._id.toString(),
      invoiceId: (invoice as any)._id.toString(),
      invuid: (invoice as any).invuid,
      mruid: request.mruid,
      cuid,
      vendorId: currentuser.sub,
      amount: data.amount,
      currency: data.currency || 'USD',
    });

    return { success: true, data: invoice, message: t('maintenance.success.invoiceSubmitted') };
  }

  async approveInvoice(
    ctx: IRequestContext,
    mruid: string,
    options?: { isBillable?: boolean; billToTenantId?: string }
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;

    // Only management roles can approve invoices — tenants, vendors, and staff are excluded
    if (!ROLE_GROUPS.MANAGEMENT_ROLES.includes(currentuser.client.role as any)) {
      throw new ForbiddenError({ message: t('auth.errors.insufficientRole') });
    }

    const request = await this.getRequestOrThrow(mruid, cuid);

    // Find the standalone invoice for this MR
    const invoice = await this.invoiceDAO.findByMaintenanceRequest(mruid, cuid);
    if (!invoice) throw new BadRequestError({ message: t('maintenance.errors.noInvoice') });
    if (invoice.status !== InvoiceStatus.PENDING) {
      throw new BadRequestError({ message: t('maintenance.errors.invoiceNotPending') });
    }

    // Update invoice doc — use { new: true } return value to get the updated state
    const updatedInvoice = await this.invoiceDAO.updateById((invoice as any)._id.toString(), {
      $set: {
        status: InvoiceStatus.APPROVED,
        'review.reviewedBy': new Types.ObjectId(currentuser.sub),
        'review.reviewedAt': new Date(),
      },
    });

    // Update MR billable flag if provided
    if (options?.isBillable !== undefined) {
      await this.maintenanceRequestDAO.updateById(request._id.toString(), {
        $set: { isBillable: options.isBillable },
      });
    }

    const isBillable = options?.isBillable ?? request.isBillable;

    (this.emitterService as any).emit(EventTypes.MAINTENANCE_INVOICE_APPROVED, {
      requestId: request._id.toString(),
      invoiceId: (invoice as any)._id.toString(),
      mruid: request.mruid,
      title: request.title,
      cuid,
      vendorId: request.vendorId?.toString(),
      tenantId: options?.billToTenantId || request.tenantId?.toString(),
      isBillable,
      amount: invoice.amountInCents,
      currency: invoice.currency,
      approvedBy: currentuser.sub,
      invoiceLineItems: (invoice.lineItems ?? []).map((item: any) => ({
        description: item.description,
        amountInCents: item.amountInCents,
      })),
    });

    return {
      success: true,
      data: updatedInvoice,
      message: t('maintenance.success.invoiceApproved'),
    };
  }

  async rejectInvoice(
    ctx: IRequestContext,
    mruid: string,
    data: IRejectInvoicePayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;

    // Only management roles can reject invoices — tenants, vendors, and staff are excluded
    if (!ROLE_GROUPS.MANAGEMENT_ROLES.includes(currentuser.client.role as any)) {
      throw new ForbiddenError({ message: t('auth.errors.insufficientRole') });
    }

    const request = await this.getRequestOrThrow(mruid, cuid);

    const invoice = await this.invoiceDAO.findByMaintenanceRequest(mruid, cuid);
    if (!invoice) throw new BadRequestError({ message: t('maintenance.errors.noInvoice') });
    if (invoice.status !== InvoiceStatus.PENDING) {
      throw new BadRequestError({ message: t('maintenance.errors.invoiceNotPending') });
    }

    const updatedInvoice = await this.invoiceDAO.updateById((invoice as any)._id.toString(), {
      $set: {
        status: InvoiceStatus.REJECTED,
        'review.reviewedBy': new Types.ObjectId(currentuser.sub),
        'review.reviewedAt': new Date(),
        'review.rejectionReason': data.rejectionReason,
      },
    });

    (this.emitterService as any).emit(EventTypes.MAINTENANCE_INVOICE_REJECTED, {
      requestId: request._id.toString(),
      invoiceId: (invoice as any)._id.toString(),
      mruid: request.mruid,
      cuid,
      vendorId: request.vendorId?.toString(),
      rejectionReason: data.rejectionReason,
      rejectedBy: currentuser.sub,
    });

    return {
      success: true,
      data: updatedInvoice,
      message: t('maintenance.success.invoiceRejected'),
    };
  }

  async reviewInvoice(
    ctx: IRequestContext,
    mruid: string,
    body: { action: string; rejectionReason?: string; isBillable?: boolean }
  ): Promise<ISuccessReturnData> {
    if (body.action === 'approve') {
      return this.approveInvoice(ctx, mruid, { isBillable: body.isBillable });
    }
    return this.rejectInvoice(ctx, mruid, { rejectionReason: body.rejectionReason ?? '' });
  }

  async submitWorkOrder(
    ctx: IRequestContext,
    mruid: string,
    data: ISubmitWorkOrderPayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await this.getRequestOrThrow(mruid, cuid);

    const workOrderAllowedStatuses = [
      MaintenanceRequestStatus.ASSIGNED,
      MaintenanceRequestStatus.IN_PROGRESS,
      MaintenanceRequestStatus.AWAITING_INVOICE,
    ];
    if (!workOrderAllowedStatuses.includes(request.status as MaintenanceRequestStatus)) {
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

    // Block resubmission while a WO is still pending review or already approved.
    // Only a rejected WO may be replaced.
    if (request.workOrder && request.workOrder.status !== WorkOrderStatus.REJECTED) {
      throw new BadRequestError({
        message:
          request.workOrder.status === WorkOrderStatus.PENDING_REVIEW
            ? 'A work order is already under review. Wait for the property manager to approve or reject it before submitting a new one.'
            : 'The work order has already been approved. You cannot replace an approved work order.',
      });
    }

    const previousRejected =
      request.workOrder?.status === WorkOrderStatus.REJECTED ? request.workOrder : undefined;

    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        {
          ...(previousRejected && { $push: { workOrderHistory: previousRejected } }),
          $set: {
            workOrder: {
              status: WorkOrderStatus.PENDING_REVIEW,
              submittedBy: new Types.ObjectId(currentuser.sub),
              submittedAt: new Date(),
              scope: {
                text: sanitizeHtml(data.scope, { allowedTags: [], allowedAttributes: {} }).trim(),
                html: sanitizeHtml(data.scope),
              },
              estimatedCostInCents: data.estimatedCostInCents,
              lineItems: data.lineItems?.map((item) => {
                const amount = new Decimal(item.quantity).times(item.unitPriceInCents).toNumber();
                return { ...item, amountInCents: amount };
              }),
              notes: data.notes,
            },
            ...(data.scheduledDate && { scheduledDate: new Date(data.scheduledDate) }),
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
      scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : undefined,
    });

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
        vendorId: request.vendorId?.toString(),
        approvedBy: currentuser.sub,
      });
    } else {
      this.emitterService.emit(EventTypes.MAINTENANCE_WORK_ORDER_REJECTED, {
        requestId: request._id.toString(),
        mruid: request.mruid,
        cuid,
        vendorId: request.vendorId?.toString(),
        rejectedBy: currentuser.sub,
        rejectionReason: data.rejectionReason!,
      });
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

    // Validate tenant isolation: the resolved request must belong to the declared client
    if (request.cuid !== payload.cuid) {
      throw new ForbiddenError({ message: t('maintenance.errors.webhookSignatureInvalid') });
    }

    const submittedBy = request.vendorId;
    if (!submittedBy) {
      throw new BadRequestError({ message: t('maintenance.errors.noVendorAssigned') });
    }

    // Create invoice and link to MR atomically — mirrors submitInvoice transaction pattern.
    const session = await this.invoiceDAO.startSession();
    let invoice: any;
    try {
      await session.withTransaction(async () => {
        invoice = await this.invoiceDAO.insert(
          {
            cuid: request.cuid,
            maintenanceRequestId: request._id,
            mruid: request.mruid,
            submittedBy,
            submittedAt: new Date(),
            amountInCents: payload.amount,
            currency: (payload.currency || 'USD').toUpperCase(),
            description: payload.description,
            lineItems: payload.lineItems,
            status: InvoiceStatus.PENDING,
            source: {
              type: payload.source,
              externalId: payload.externalInvoiceId,
              externalUrl: payload.externalInvoiceUrl,
            },
          } as any,
          session
        );

        await this.maintenanceRequestDAO.updateById(
          request._id.toString(),
          { $set: { invoiceId: (invoice as any)._id } },
          {},
          session
        );
      });
    } finally {
      await session.endSession();
    }

    this.emitterService.emit(EventTypes.MAINTENANCE_INVOICE_SUBMITTED, {
      requestId: request._id.toString(),
      mruid: request.mruid,
      cuid: request.cuid,
      vendorId: submittedBy.toString(),
      amount: payload.amount,
      currency: payload.currency,
    });

    return { success: true, data: invoice };
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

  async getTenantRequests(
    cuid: string,
    tenantUserId: string,
    filters: { page?: number; limit?: number; status?: MaintenanceRequestStatus }
  ): Promise<ISuccessReturnData> {
    const query: Record<string, any> = {
      cuid,
      tenantId: new Types.ObjectId(tenantUserId),
      deletedAt: null,
    };
    if (filters.status) query.status = filters.status;

    const result = await this.maintenanceRequestDAO.listWithDetails(query, {
      page: filters.page || 1,
      limit: filters.limit || 10,
    });

    const items = ((result as any).items || []).map((req: IMaintenanceRequestDocument) =>
      this.buildTenantView(req)
    );
    return { success: true, data: { ...(result as any), items } };
  }

  async getTenantRequestById(
    mruid: string,
    cuid: string,
    tenantUserId: string
  ): Promise<ISuccessReturnData> {
    const req = await this.maintenanceRequestDAO.findFirst({
      mruid,
      cuid,
      tenantId: new Types.ObjectId(tenantUserId),
      deletedAt: null,
    });
    if (!req) throw new NotFoundError({ message: t('maintenance.errors.notFound') });
    return { success: true, data: this.buildTenantView(req) };
  }

  private buildTenantView(req: IMaintenanceRequestDocument): ITenantMaintenanceRequestView {
    const ORDERED_STEPS = [
      { status: MaintenanceRequestStatus.PENDING, label: 'Request Submitted' },
      { status: MaintenanceRequestStatus.OPEN, label: 'Under Review' },
      { status: MaintenanceRequestStatus.ASSIGNED, label: 'Technician Assigned' },
      { status: MaintenanceRequestStatus.IN_PROGRESS, label: 'Work in Progress' },
      { status: MaintenanceRequestStatus.COMPLETED, label: 'Completed' },
    ];

    const currentIndex = ORDERED_STEPS.findIndex((s) => s.status === req.status);

    const timeline = ORDERED_STEPS.map((step, index) => {
      const reached = index <= currentIndex;
      const note =
        step.status === MaintenanceRequestStatus.ASSIGNED && req.vendorId
          ? 'A technician has been assigned'
          : step.status === MaintenanceRequestStatus.COMPLETED && req.completionNotes?.length
            ? (req.completionNotes[req.completionNotes.length - 1] as any).note
            : undefined;

      return {
        status: step.status,
        label: step.label,
        reached,
        timestamp: reached
          ? step.status === MaintenanceRequestStatus.COMPLETED
            ? req.completedAt
            : req.createdAt
          : undefined,
        note,
      };
    });

    const property = (req as any).propertyId as any;
    const unit = (req as any).propertyUnitId as any;
    const propertyAddress =
      typeof property?.address === 'string'
        ? property.address
        : property?.address?.fullAddress || property?.name || 'Property';

    const lastNote = req.completionNotes?.length
      ? (req.completionNotes[req.completionNotes.length - 1] as any).note
      : undefined;

    return {
      mruid: req.mruid,
      title: req.title,
      description: (req.description as any)?.text || '',
      category: req.category,
      priority: req.priority,
      status: req.status,
      propertyAddress,
      unitNumber: typeof unit === 'object' ? unit?.unitNumber : undefined,
      submittedAt: req.createdAt,
      timeline,
      scheduledDate: req.scheduledDate,
      completedAt: req.completedAt,
      completionNote: lastNote,
      media: (req.media || []).map((m: any) => ({ url: m.url, filename: m.filename })),
    };
  }

  /**
   * PM accepts the AI-suggested category + priority — copies aiAnalysis values to the
   * main category/priority fields.
   */
  async acceptAISuggestion(ctx: IRequestContext, mruid: string): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    const role = ctx.currentuser?.client?.role;
    if (!role || !['super-admin', 'manager', 'admin'].includes(role)) {
      throw new ForbiddenError({ message: 'Only managers can accept AI suggestions' });
    }

    const request = await this.maintenanceRequestDAO.getByMruid(mruid, cuid);
    if (!request) throw new NotFoundError({ message: t('maintenance.errors.notFound') });

    if (!request.aiAnalysis?.suggestedCategory && !request.aiAnalysis?.suggestedPriority) {
      throw new BadRequestError({ message: 'No AI suggestion available to accept' });
    }

    const updateFields: Record<string, unknown> = {};
    if (request.aiAnalysis.suggestedCategory)
      updateFields.category = request.aiAnalysis.suggestedCategory;
    if (request.aiAnalysis.suggestedPriority)
      updateFields.priority = request.aiAnalysis.suggestedPriority;
    updateFields['aiAnalysis.accepted'] = true;

    // Auto-assign the scored vendor when the request is still open.
    // This triggers the same notification/event pipeline as a manual assignment.
    let vendorAutoAssigned = false;
    if (request.aiAnalysis.suggestedVendorId && request.status === MaintenanceRequestStatus.OPEN) {
      const vendorDoc = await this.vendorDAO.findFirst({
        _id: new Types.ObjectId(request.aiAnalysis.suggestedVendorId.toString()),
        'connectedClients.cuid': cuid,
        'connectedClients.isConnected': true,
        deletedAt: null,
      });

      const clientConn = vendorDoc?.connectedClients?.find((c: any) => c.cuid === cuid);
      if (clientConn?.primaryAccountHolderUserId) {
        updateFields.vendorId = clientConn.primaryAccountHolderUserId;
        updateFields.assignedAt = new Date();
        updateFields.assignedBy = new Types.ObjectId(ctx.currentuser.sub);
        updateFields.status = MaintenanceRequestStatus.ASSIGNED;
        vendorAutoAssigned = true;
      }
    }

    const updated = await this.maintenanceRequestDAO.update(
      { _id: request._id },
      { $set: updateFields }
    );

    if (vendorAutoAssigned) {
      this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_ASSIGNED, {
        requestId: request._id.toString(),
        mruid: request.mruid,
        cuid,
        tenantId: request.tenantId?.toString(),
        vendorId: (updateFields.vendorId as Types.ObjectId).toString(),
        assignedBy: ctx.currentuser.sub,
      });
    }

    const message = vendorAutoAssigned
      ? t('maintenance.success.assigned')
      : 'AI suggestion applied';

    return { success: true, data: updated, message };
  }

  /**
   * PM dismisses the AI suggestion — keeps tenant's original values and marks the
   * suggestion as dismissed so the panel doesn't show again.
   */
  async dismissAISuggestion(ctx: IRequestContext, mruid: string): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    // Only managers and above may dismiss AI suggestions.
    const role = ctx.currentuser?.client?.role;
    if (!role || !['super-admin', 'manager', 'admin'].includes(role)) {
      throw new ForbiddenError({ message: 'Only managers can dismiss AI suggestions' });
    }
    const request = await this.maintenanceRequestDAO.getByMruid(mruid, cuid);
    if (!request) throw new NotFoundError({ message: t('maintenance.errors.notFound') });

    const updated = await this.maintenanceRequestDAO.update(
      { _id: request._id },
      { $set: { 'aiAnalysis.accepted': false } }
    );

    return { success: true, data: updated, message: 'AI suggestion dismissed' };
  }

  /**
   * Fire-and-forget AI triage: suggests category + priority and persists to aiAnalysis.
   * Tenant-provided values remain authoritative — AI results are advisory only.
   * After AI categorisation, runs vendor scoring to suggest the best-fit vendor.
   */
  private async runAITriage(request: IMaintenanceRequestDocument): Promise<void> {
    const descriptionText =
      typeof request.description === 'string'
        ? request.description
        : ((request.description as any)?.text ?? '');

    const result = await this.aiService.categorizeMaintenanceRequest(
      request.title,
      descriptionText
    );

    if (!result) return; // feature flag disabled or null result

    const updateFields: Record<string, unknown> = {
      'aiAnalysis.suggestedCategory': result.suggestedCategory,
      'aiAnalysis.suggestedPriority': result.suggestedPriority,
      'aiAnalysis.confidence': result.confidence,
      'aiAnalysis.reasoning': result.reasoning,
      'aiAnalysis.processedAt': new Date(),
      'aiAnalysis.modelUsed': 'claude-haiku-4-5',
    };

    // Vendor suggestion: deterministic scoring, no LLM call
    const vendorSuggestion = await this.suggestVendor(
      request.cuid,
      result.suggestedCategory,
      request.propertyId
    );
    if (vendorSuggestion) {
      updateFields['aiAnalysis.suggestedVendorId'] = vendorSuggestion.vendorId;
      updateFields['aiAnalysis.suggestedVendorName'] = vendorSuggestion.companyName;
    }

    await this.maintenanceRequestDAO.update({ _id: request._id }, { $set: updateFields });

    if (request.tenantId) {
      this.emitterService.emit(EventTypes.MAINTENANCE_AI_TRIAGE_COMPLETED, {
        tenantId: request.tenantId.toString(),
        mruid: request.mruid,
        cuid: request.cuid,
      });
    }

    this.log.info(
      {
        mruid: request.mruid,
        confidence: result.confidence,
        suggestedVendor: vendorSuggestion?.companyName ?? null,
      },
      'AI triage persisted'
    );
  }

  // ── Vendor Suggestion Scoring ──────────────────────────────────────────────
  //
  // Proprietary scoring algorithm: ranks qualified vendors for a maintenance
  // category using four weighted signals. This is deterministic (no LLM) and
  // designed to improve over time as vendor performance data accumulates.

  private static readonly SCORE_WEIGHTS = {
    COMPLETION_RATE: 25,
    RATING: 25,
    SPEED: 15,
    WORKLOAD: 15,
    PROXIMITY: 20,
  } as const;

  private static readonly NEW_VENDOR_BASELINE = 50;
  private static readonly MAX_COMPLETION_DAYS = 30; // cap for speed scoring
  private static readonly MAX_ACTIVE_JOBS = 10; // cap for workload scoring

  async suggestVendor(
    cuid: string,
    category: MaintenanceCategory,
    propertyId?: Types.ObjectId | string
  ): Promise<IVendorSuggestion | null> {
    const serviceKey = CATEGORY_TO_VENDOR_SERVICE[category];
    if (!serviceKey) return null;

    const { items: allVendors } = await this.vendorDAO.getClientVendors(cuid);
    if (!allVendors || allVendors.length === 0) return null;

    const qualified = allVendors.filter((v: any) => v.servicesOffered?.[serviceKey] === true);
    if (qualified.length === 0) return null;

    // Resolve property coordinates for proximity filtering + scoring
    let propertyCoords: [number, number] | null = null;
    if (propertyId) {
      const property = await this.propertyDAO.findFirst({ _id: propertyId });
      const coords = property?.computedLocation?.coordinates;
      if (coords?.length === 2) {
        propertyCoords = coords as [number, number];
      }
    }

    // Filter by service area using ServiceAreaService ($geoNear).
    // Vendors with no computedLocation or maxDistance are always included.
    let locationFiltered: typeof qualified = [];
    const distanceMap = new Map<string, number>();

    if (propertyCoords) {
      const geoChecks = await Promise.all(
        qualified.map(async (v: any) => {
          const hasLocation =
            v.address?.computedLocation?.coordinates?.length === 2 && v.serviceAreas?.maxDistance;
          if (!hasLocation) {
            return { vendor: v, include: true, distance: null };
          }
          const check = await this.serviceAreaService.isLocationInVendorServiceArea(
            v._id.toString(),
            propertyCoords!
          );
          return { vendor: v, include: check.isInRange, distance: check.distance ?? null };
        })
      );
      geoChecks.forEach(({ vendor, include, distance }) => {
        if (include) {
          locationFiltered.push(vendor);
          if (distance !== null) distanceMap.set(vendor._id.toString(), distance);
        }
      });
    } else {
      locationFiltered = qualified;
    }

    if (locationFiltered.length === 0) return null;

    const W = MaintenanceRequestService.SCORE_WEIGHTS;
    const scored = await Promise.all(
      locationFiltered.map(async (vendor: any) => {
        const vendorIdStr = vendor._id?.toString();
        const reasons: string[] = [];

        const [stats, avgRating] = await Promise.all([
          this.maintenanceRequestDAO.getVendorStats(vendorIdStr),
          this.maintenanceRequestDAO.getVendorAvgRating(vendorIdStr),
        ]);

        const isNewVendor = stats.total === 0;

        if (isNewVendor) {
          reasons.push('New vendor — no job history yet');
          return {
            vendorId: vendorIdStr,
            vuid: vendor.vuid,
            companyName: vendor.companyName || 'Unknown',
            score: MaintenanceRequestService.NEW_VENDOR_BASELINE,
            reasons,
          };
        }

        // Completion rate: completed / total (0-1) → scaled to weight
        const completionRate = stats.total > 0 ? stats.completed / stats.total : 0;
        const completionScore = completionRate * W.COMPLETION_RATE;
        reasons.push(`${Math.round(completionRate * 100)}% completion rate`);

        // Rating: 0-5 scale → normalized to weight
        const ratingScore = avgRating > 0 ? (avgRating / 5) * W.RATING : 0;
        if (avgRating > 0) {
          reasons.push(`${avgRating.toFixed(1)} avg rating`);
        }

        // Speed: inverse of avgCompletionDays, capped
        const maxDays = MaintenanceRequestService.MAX_COMPLETION_DAYS;
        const days = Math.min(stats.avgCompletionDays ?? maxDays, maxDays);
        const speedScore = ((maxDays - days) / maxDays) * W.SPEED;
        if (stats.avgCompletionDays !== undefined) {
          reasons.push(`${Math.round(stats.avgCompletionDays)}d avg completion`);
        }

        // Workload: fewer active jobs = higher score
        const activeJobs = stats.inProgress + stats.assigned;
        const maxJobs = MaintenanceRequestService.MAX_ACTIVE_JOBS;
        const workloadScore = (Math.max(maxJobs - activeJobs, 0) / maxJobs) * W.WORKLOAD;
        reasons.push(`${activeJobs} active job${activeJobs !== 1 ? 's' : ''}`);

        // Proximity: full score at vendor location, 0 at boundary edge
        const distance = distanceMap.get(vendor._id?.toString());
        let proximityScore = 0;
        if (distance !== undefined) {
          const maxDist = (vendor as any).serviceAreas?.maxDistance ?? 25;
          proximityScore = Math.max(0, 1 - distance / maxDist) * W.PROXIMITY;
          reasons.push(`${Math.round(distance)} km from property`);
        }

        const score = Math.round(
          completionScore + ratingScore + speedScore + workloadScore + proximityScore
        );

        return {
          vendorId: vendorIdStr,
          vuid: vendor.vuid,
          companyName: vendor.companyName || 'Unknown',
          score,
          reasons,
        };
      })
    );

    scored.sort((a: IVendorSuggestion, b: IVendorSuggestion) => b.score - a.score);
    return scored[0] ?? null;
  }
}
