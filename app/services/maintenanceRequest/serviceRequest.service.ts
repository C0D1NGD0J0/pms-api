import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { VendorDAO } from '@dao/vendorDAO';
import { createLogger } from '@utils/index';
import { PaymentDAO } from '@dao/paymentDAO';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { SMSMessageType } from '@interfaces/index';
import { CurrentUser } from '@utils/currentUserRole';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { convertUserRoleToEnum } from '@utils/helpers';
import { LeaseStatus } from '@interfaces/lease.interface';
import { UploadResult } from '@interfaces/utils.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { SMSService } from '@services/smsService/sms.service';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { assertRecordOwnership } from '@utils/authorization.utils';
import { TenantPaymentStatus } from '@interfaces/invoice.interface';
import ROLES, { ROLE_GROUPS } from '@shared/constants/roles.constants';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';
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
  IAssignVendorPayload,
  IUpdateStatusPayload,
  IMaintenanceFilters,
  WorkOrderStatus,
} from '@interfaces/maintenanceRequest.interface';

import { VendorSuggestionService } from './vendorSuggestion.service';
import { MaintenanceInvoiceService } from './maintenanceInvoice.service';
import {
  assertVendorAuthorized,
  resolvePrimaryVendorId,
  getRequestOrThrow,
  assertTransition,
} from './serviceRequest.helpers';

interface IConstructor {
  maintenanceInvoiceService: MaintenanceInvoiceService;
  vendorSuggestionService: VendorSuggestionService;
  maintenanceRequestDAO: MaintenanceRequestDAO;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  propertyDAO: PropertyDAO;
  invoiceDAO: InvoiceDAO;
  paymentDAO: PaymentDAO;
  smsService: SMSService;
  vendorDAO: VendorDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class MaintenanceRequestService {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly vendorDAO: VendorDAO;
  private readonly invoiceDAO: InvoiceDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly smsService: SMSService;
  private readonly emitterService: EventEmitterService;
  private readonly paymentDAO: PaymentDAO;
  private readonly vendorSuggestionService: VendorSuggestionService;
  private readonly maintenanceInvoiceService: MaintenanceInvoiceService;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;

  constructor({
    userDAO,
    leaseDAO,
    vendorDAO,
    invoiceDAO,
    paymentDAO,
    propertyDAO,
    smsService,
    emitterService,
    propertyUnitDAO,
    maintenanceRequestDAO,
    vendorSuggestionService,
    maintenanceInvoiceService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.smsService = smsService;
    this.vendorDAO = vendorDAO;
    this.invoiceDAO = invoiceDAO;
    this.paymentDAO = paymentDAO;
    this.propertyDAO = propertyDAO;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.maintenanceRequestDAO = maintenanceRequestDAO;
    this.vendorSuggestionService = vendorSuggestionService;
    this.maintenanceInvoiceService = maintenanceInvoiceService;
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

  private async buildRoleFilter(ctx: IRequestContext): Promise<Record<string, any>> {
    const currentuser = ctx.currentuser;

    if (CurrentUser.isTenant(currentuser)) {
      return { tenantId: new Types.ObjectId(currentuser.sub) };
    }

    if (ROLE_GROUPS.PROPERTY_STAFF_ROLES.includes(currentuser.client.role as any)) {
      return { assignedBy: new Types.ObjectId(currentuser.sub) };
    }

    if (CurrentUser.isPrimaryVendor(currentuser)) {
      // Primary vendor account — scoped to MRs assigned to their organisation
      const primaryId = await resolvePrimaryVendorId(this.vendorDAO, currentuser);
      if (primaryId) {
        return { vendorId: primaryId };
      }
    }
    return {};
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
    if (!property)
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Property' }) });
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
      if (!unit)
        throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Unit' }) });
    }

    let leasePetDefault = false;

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

      leasePetDefault = activeLease.petPolicy?.allowed ?? false;
    } else if (data.hasPet === undefined && unit) {
      // For employees filing on behalf of a tenant, derive pet default from the unit's active lease
      const unitLease = await this.leaseDAO.findFirst(
        {
          cuid,
          'property.id': property._id,
          'property.unitId': unit._id,
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        },
        { select: 'petPolicy.allowed' }
      );
      leasePetDefault = unitLease?.petPolicy?.allowed ?? false;
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
          hasPet: data.hasPet ?? leasePetDefault,
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
    this.vendorSuggestionService
      .runAITriage(request)
      .catch((err) =>
        this.log.error({ err, mruid: request.mruid }, 'AI triage background task failed')
      );

    return {
      success: true,
      data: request,
      message: t('common.success.created', { resource: 'Maintenance request' }),
    };
  }

  async listRequests(
    ctx: IRequestContext,
    filters: IMaintenanceFilters,
    pagination: IPaginationQuery
  ): Promise<ISuccessReturnData> {
    const { cuid } = ctx.request.params;
    const currentuser = ctx.currentuser;

    const baseFilter: Record<string, any> = {
      cuid,
      deletedAt: null,
      ...(await this.buildRoleFilter(ctx)),
    };
    const isTenant = CurrentUser.isTenant(currentuser);
    const isVendorTeamMember = CurrentUser.isVendorTeamMember(currentuser);

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

    if (filters.assignedTechnicianSub) {
      if (isVendorTeamMember && filters.assignedTechnicianSub !== currentuser.sub) {
        throw new ForbiddenError({ message: t('common.errors.insufficientPermissions') });
      }
      baseFilter['assignedTechnician.userId'] = new Types.ObjectId(filters.assignedTechnicianSub);
    }

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
    if (!request)
      throw new NotFoundError({
        message: t('common.errors.notFound', { resource: 'Maintenance request' }),
      });

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
    // Collapse tenantId back to a plain string after populate (like vendorId)
    plain.tenantId = tenant?._id?.toString() ?? null;

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
      tenantPaymentStatus: inv.tenantPaymentStatus,
      stripeReceiptUrl: inv.stripeReceiptUrl ?? null,
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
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

    // OPEN → ASSIGNED (vendor must accept before work begins)
    assertTransition(request.status, MaintenanceRequestStatus.ASSIGNED);

    const vendorRecord = await this.vendorDAO.findFirst({
      vuid: data.vuid,
      'connectedClients.cuid': cuid,
      'connectedClients.isConnected': true,
      deletedAt: null,
    });
    if (!vendorRecord)
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Vendor' }) });

    const clientConn = vendorRecord.connectedClients.find((c) => c.cuid === cuid);
    const vendorUserId = clientConn!.primaryAccountHolderUserId;
    const vendorUser = await this.userDAO.findFirst({ _id: vendorUserId });
    if (!vendorUser)
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Vendor' }) });

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

    // Send SMS notification (fire-and-forget — failures are logged internally)
    this.smsService
      .sendToUser(
        cuid,
        vendorUserId.toString(),
        `You've been assigned to service request #${mruid}.`,
        SMSMessageType.MAINTENANCE_UPDATE,
        currentuser.sub
      )
      .catch(() => {}); // swallow — SMSService logs internally

    return { success: true, data: updated, message: t('maintenance.success.assigned') };
  }

  async acceptAssignment(
    ctx: IRequestContext,
    mruid: string,
    data: IRespondToAssignmentPayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

    if (request.status !== MaintenanceRequestStatus.ASSIGNED) {
      throw new BadRequestError({ message: t('maintenance.errors.notAssigned') });
    }
    await this.assertIsAssignedVendor(request, currentuser);

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
      if (!data.technician?.userId) {
        data.technician = {
          phone: '',
          email: currentuser.email,
          userId: currentuser.sub.toString(),
          name: currentuser.fullname || currentuser.displayName || 'Assigned Technician',
        };
      }

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
                ...(data.technician.userId &&
                  Types.ObjectId.isValid(data.technician.userId) && {
                    userId: new Types.ObjectId(data.technician.userId),
                  }),
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

    // Send SMS notification (fire-and-forget — failures are logged internally)
    if (request.tenantId) {
      this.smsService
        .sendToUser(
          cuid,
          request.tenantId.toString(),
          `A technician has accepted your service request #${mruid}.`,
          SMSMessageType.MAINTENANCE_UPDATE,
          currentuser.sub
        )
        .catch(() => {}); // swallow — SMSService logs internally
    }

    return { success: true, data: updated, message: t('maintenance.success.accepted') };
  }

  async declineAssignment(
    ctx: IRequestContext,
    mruid: string,
    data: IDeclineAssignmentPayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

    if (request.status !== MaintenanceRequestStatus.ASSIGNED) {
      throw new BadRequestError({ message: t('maintenance.errors.notAssigned') });
    }
    await this.assertIsAssignedVendor(request, currentuser);

    // Unassign vendor and return to OPEN for PM to reassign
    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        this.buildUnassignUpdate(),
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
      technician?: { name: string; phone?: string; email?: string; userId?: string };
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
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

    if (request.status !== MaintenanceRequestStatus.IN_PROGRESS) {
      throw new BadRequestError({ message: 'Assignment can only be released while in progress' });
    }
    if (request.workOrder?.status !== WorkOrderStatus.REJECTED) {
      throw new BadRequestError({
        message: 'Assignment can only be released after a work order has been rejected',
      });
    }

    // Verify the caller is the assigned vendor
    await this.assertIsAssignedVendor(request, currentuser);

    // Unassign vendor, clear WO, return SR to OPEN for PM to reassign
    const session = await this.maintenanceRequestDAO.startSession();
    const updated = await this.maintenanceRequestDAO.withTransaction(session, async (session) => {
      return this.maintenanceRequestDAO.updateById(
        request._id.toString(),
        this.buildUnassignUpdate(),
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
      message: t('maintenance.success.declined'),
    };
  }

  async updateStatus(
    ctx: IRequestContext,
    mruid: string,
    data: IUpdateStatusPayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

    if (CurrentUser.isTenant(currentuser)) {
      throw new ForbiddenError({ message: t('common.errors.insufficientPermissions') });
    }
    if (CurrentUser.isVendor(currentuser)) {
      assertRecordOwnership(currentuser, request.vendorId, {
        errorMessage: t('maintenance.errors.notYourAssignment'),
      });
    }

    assertTransition(request.status, data.status);

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

    return {
      success: true,
      data: updated,
      message: t('common.success.updated', { resource: 'Status' }),
    };
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
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);
    assertTransition(request.status, MaintenanceRequestStatus.AWAITING_INVOICE);

    // Vendor ownership check: primary vendor always allowed; team member only if specifically assigned
    if (CurrentUser.isVendor(currentuser)) {
      const isDirectlyAssigned = request.vendorId?.toString() === currentuser.sub;
      let authorized = isDirectlyAssigned;
      if (!authorized && CurrentUser.isVendorTeamMember(currentuser)) {
        const primaryId = await resolvePrimaryVendorId(this.vendorDAO, currentuser);
        const resolvedToAssignedVendor =
          !!primaryId && request.vendorId?.toString() === primaryId.toString();
        if (resolvedToAssignedVendor) {
          const assignedTechId = request.assignedTechnician?.userId?.toString();
          authorized = assignedTechId ? assignedTechId === currentuser.sub : true;
        }
      }
      if (!authorized) {
        throw new ForbiddenError({ message: t('maintenance.errors.notYourAssignment') });
      }
    }

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

    // Send SMS notification (fire-and-forget — failures are logged internally)
    if (request.tenantId) {
      this.smsService
        .sendToUser(
          cuid,
          request.tenantId.toString(),
          `Work has been completed on your service request #${mruid}.`,
          SMSMessageType.MAINTENANCE_UPDATE,
          currentuser.sub
        )
        .catch(() => {}); // swallow — SMSService logs internally
    }

    return { success: true, data: updated, message: t('maintenance.success.workDone') };
  }

  /**
   * PM finalizes the request → transitions AWAITING_INVOICE → COMPLETED.
   * Typically called after invoice is approved (or after 72hr expiry if PM decides to close).
   */
  async finalizeCompletion(ctx: IRequestContext, mruid: string): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);
    assertTransition(request.status, MaintenanceRequestStatus.COMPLETED);

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
      technicianId: request.assignedTechnician?.userId?.toString(),
      completedBy: currentuser.sub,
    });

    // Send SMS notification (fire-and-forget — failures are logged internally)
    if (request.tenantId) {
      this.smsService
        .sendToUser(
          cuid,
          request.tenantId.toString(),
          `Your service request #${mruid} has been resolved.`,
          SMSMessageType.MAINTENANCE_UPDATE,
          currentuser.sub
        )
        .catch(() => {}); // swallow — SMSService logs internally
    }

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
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

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

  private async assertIsAssignedVendor(
    request: { vendorId?: any },
    currentuser: any
  ): Promise<void> {
    await assertVendorAuthorized(this.vendorDAO, currentuser, request);
  }

  private buildUnassignUpdate() {
    return {
      $set: { status: MaintenanceRequestStatus.OPEN },
      $unset: {
        vendorId: 1,
        assignedAt: 1,
        assignedBy: 1,
        scheduledDate: 1,
        assignedTechnician: 1,
        workOrder: 1,
      },
    };
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
      await this.vendorDAO.updateMany(
        { 'connectedClients.primaryAccountHolderUserId': new Types.ObjectId(vendorUserId) },
        { $set: { 'stats.rating': avgRating, 'stats.reviewCount': items.length } }
      );
    } catch (error) {
      this.log.error('Failed to update vendor rating:', error);
    }
  }

  async cancelRequest(
    ctx: IRequestContext,
    mruid: string,
    data: ICancelMaintenancePayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

    if (CurrentUser.isTenant(currentuser)) {
      assertRecordOwnership(currentuser, request.tenantId, {
        errorMessage: t('maintenance.errors.notYourRequest'),
      });
    }
    if (CurrentUser.isVendor(currentuser)) {
      assertRecordOwnership(currentuser, request.vendorId, {
        errorMessage: t('maintenance.errors.notYourAssignment'),
      });
    }

    assertTransition(request.status, MaintenanceRequestStatus.CANCELLED);

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
      technicianId: request.assignedTechnician?.userId?.toString(),
      reason: data.reason,
    });

    // Send SMS notifications (fire-and-forget — failures are logged internally)
    const cancelMsg = `Service request #${mruid} has been cancelled.`;
    if (request.tenantId) {
      this.smsService
        .sendToUser(
          cuid,
          request.tenantId.toString(),
          cancelMsg,
          SMSMessageType.MAINTENANCE_UPDATE,
          currentuser.sub
        )
        .catch(() => {}); // swallow — SMSService logs internally
    }
    if (request.vendorId) {
      this.smsService
        .sendToUser(
          cuid,
          request.vendorId.toString(),
          cancelMsg,
          SMSMessageType.MAINTENANCE_UPDATE,
          currentuser.sub
        )
        .catch(() => {}); // swallow — SMSService logs internally
    }

    return { success: true, data: updated, message: t('maintenance.success.cancelled') };
  }

  async updateRequest(
    ctx: IRequestContext,
    mruid: string,
    data: IUpdateMaintenancePayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

    if (CurrentUser.isTenant(currentuser)) {
      assertRecordOwnership(currentuser, request.tenantId, {
        errorMessage: t('maintenance.errors.notYourRequest'),
      });
    }
    if (CurrentUser.isVendor(currentuser)) {
      const isAssigned = request.vendorId?.toString() === currentuser.sub;
      let authorized = isAssigned;
      if (!authorized && CurrentUser.isVendorTeamMember(currentuser)) {
        const primaryId = await resolvePrimaryVendorId(this.vendorDAO, currentuser);
        authorized = !!primaryId && request.vendorId?.toString() === primaryId.toString();
      }
      if (!authorized) {
        throw new ForbiddenError({ message: t('maintenance.errors.notYourAssignment') });
      }
    }

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

      return {
        success: true,
        data: updated,
        message: t('common.success.updated', { resource: 'Maintenance request' }),
      };
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
      this.vendorSuggestionService
        .runAITriage(updated)
        .catch((err) =>
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

    return {
      success: true,
      data: updated,
      message: t('common.success.updated', { resource: 'Maintenance request' }),
    };
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
    const assignedTechnicianUserId = CurrentUser.isVendorTeamMember(currentuser)
      ? currentuser.sub
      : undefined;

    const stats = await this.maintenanceRequestDAO.getStats(cuid, {
      propertyId: propertyObjectId,
      tenantUserId,
      assignedTechnicianUserId,
    });
    return { success: true, data: stats };
  }

  // submitInvoice, approveInvoice, rejectInvoice, reviewInvoice, submitWorkOrder,
  // reviewWorkOrder, handleInvoiceWebhook → MaintenanceInvoiceService

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
    if (!req)
      throw new NotFoundError({
        message: t('common.errors.notFound', { resource: 'Maintenance request' }),
      });
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

  // acceptAISuggestion, dismissAISuggestion, runAITriage, suggestVendor → VendorSuggestionService
}
