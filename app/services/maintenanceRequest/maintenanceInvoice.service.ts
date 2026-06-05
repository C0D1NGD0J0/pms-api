import Logger from 'bunyan';
import Decimal from 'decimal.js';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import sanitizeHtml from 'sanitize-html';
import { VendorDAO } from '@dao/vendorDAO';
import { createLogger } from '@utils/index';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { CurrentUser } from '@utils/currentUserRole';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { ROLE_GROUPS } from '@shared/constants/roles.constants';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { ISuccessReturnData, IRequestContext } from '@interfaces/utils.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  MaintenanceRequestStatus,
  ISubmitWorkOrderPayload,
  IReviewWorkOrderPayload,
  IInvoiceWebhookPayload,
  ISubmitInvoicePayload,
  IRejectInvoicePayload,
  WorkOrderStatus,
  InvoiceStatus,
  InvoiceSource,
} from '@interfaces/maintenanceRequest.interface';

import { resolvePrimaryVendorId, getRequestOrThrow } from './serviceRequest.helpers';

interface IConstructor {
  maintenanceRequestDAO: MaintenanceRequestDAO;
  emitterService: EventEmitterService;
  invoiceDAO: InvoiceDAO;
  vendorDAO: VendorDAO;
}

export class MaintenanceInvoiceService {
  private readonly log: Logger;
  private readonly vendorDAO: VendorDAO;
  private readonly invoiceDAO: InvoiceDAO;
  private readonly emitterService: EventEmitterService;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;

  constructor({ maintenanceRequestDAO, emitterService, invoiceDAO, vendorDAO }: IConstructor) {
    this.vendorDAO = vendorDAO;
    this.invoiceDAO = invoiceDAO;
    this.emitterService = emitterService;
    this.maintenanceRequestDAO = maintenanceRequestDAO;
    this.log = createLogger('MaintenanceInvoiceService');
  }

  async submitInvoice(
    ctx: IRequestContext,
    mruid: string,
    data: ISubmitInvoicePayload
  ): Promise<ISuccessReturnData> {
    const currentuser = ctx.currentuser;
    const { cuid } = ctx.request.params;
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

    const invoiceAllowedStatuses = [
      MaintenanceRequestStatus.IN_PROGRESS,
      MaintenanceRequestStatus.AWAITING_INVOICE,
    ];
    if (!invoiceAllowedStatuses.includes(request.status)) {
      throw new BadRequestError({ message: t('maintenance.errors.invoiceInvalidStatus') });
    }

    // Work order must be approved before invoicing (same gate as mark_work_done)
    if (!request.workOrder || request.workOrder.status !== WorkOrderStatus.APPROVED) {
      throw new BadRequestError({ message: t('maintenance.errors.workOrderNotApproved') });
    }

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

    // Track whether we need to emit WORK_DONE after the transaction succeeds
    const needsAutoTransition = request.status === MaintenanceRequestStatus.IN_PROGRESS;
    const invoiceDeadline = needsAutoTransition
      ? new Date(Date.now() + 72 * 60 * 60 * 1000)
      : undefined;

    // Create standalone Invoice document, link to MR, and (if needed) auto-transition
    // from IN_PROGRESS → AWAITING_INVOICE — all within a single transaction so a
    // partial failure cannot leave inconsistent state.
    // Uses baseDAO.withTransaction which gracefully skips transactions in dev mode
    // (standalone MongoDB doesn't support multi-doc transactions).
    const session = await this.invoiceDAO.startSession();
    let invoice: any;
    try {
      await this.invoiceDAO.withTransaction(session, async (txnSession) => {
        // Auto-transition status inside the transaction to avoid write conflicts
        if (needsAutoTransition) {
          await this.maintenanceRequestDAO.updateById(
            request._id.toString(),
            { $set: { status: MaintenanceRequestStatus.AWAITING_INVOICE, invoiceDeadline } },
            {},
            txnSession
          );
        }

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
          txnSession
        );

        await this.maintenanceRequestDAO.updateById(
          request._id.toString(),
          { $set: { invoiceId: invoice._id } },
          {},
          txnSession
        );
      });
    } finally {
      await session.endSession();
    }

    // Emit WORK_DONE event after successful transaction so tenant/staff get notified
    if (needsAutoTransition) {
      this.emitterService.emit(EventTypes.MAINTENANCE_REQUEST_WORK_DONE, {
        requestId: request._id.toString(),
        mruid,
        cuid,
        tenantId: request.tenantId?.toString(),
        vendorId: request.vendorId?.toString(),
        completedBy: currentuser.sub,
        invoiceDeadline: invoiceDeadline!.toISOString(),
      });
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

    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

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
      technicianId: request.assignedTechnician?.userId?.toString(),
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

    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

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
      technicianId: request.assignedTechnician?.userId?.toString(),
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
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

    const workOrderAllowedStatuses = [
      MaintenanceRequestStatus.ASSIGNED,
      MaintenanceRequestStatus.IN_PROGRESS,
      MaintenanceRequestStatus.AWAITING_INVOICE,
    ];
    if (!workOrderAllowedStatuses.includes(request.status as MaintenanceRequestStatus)) {
      throw new BadRequestError({ message: t('maintenance.errors.notAssigned') });
    }
    if (!CurrentUser.isVendor(currentuser)) {
      throw new ForbiddenError({ message: t('maintenance.errors.workOrderForbidden') });
    }
    const isDirectlyAssignedWO = request.vendorId?.toString() === currentuser.sub;
    let authorizedWorkOrder = isDirectlyAssignedWO;
    if (!authorizedWorkOrder && CurrentUser.isVendorTeamMember(currentuser)) {
      const primaryId = await resolvePrimaryVendorId(this.vendorDAO, currentuser);
      const resolvedToAssignedVendor =
        !!primaryId && request.vendorId?.toString() === primaryId.toString();
      if (resolvedToAssignedVendor) {
        const assignedTechId = request.assignedTechnician?.userId?.toString();
        authorizedWorkOrder = assignedTechId ? assignedTechId === currentuser.sub : true;
      }
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
    const request = await getRequestOrThrow(this.maintenanceRequestDAO, mruid, cuid);

    if (!request.workOrder) {
      throw new BadRequestError({ message: t('maintenance.errors.workOrderNotFound') });
    }
    if (request.workOrder.status !== WorkOrderStatus.PENDING_REVIEW) {
      throw new BadRequestError({ message: t('maintenance.errors.workOrderNotPending') });
    }
    if (CurrentUser.isVendor(currentuser)) {
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
        technicianId: request.assignedTechnician?.userId?.toString(),
        tenantId: request.tenantId?.toString(),
        approvedBy: currentuser.sub,
      });
    } else {
      this.emitterService.emit(EventTypes.MAINTENANCE_WORK_ORDER_REJECTED, {
        requestId: request._id.toString(),
        mruid: request.mruid,
        cuid,
        vendorId: request.vendorId?.toString(),
        technicianId: request.assignedTechnician?.userId?.toString(),
        tenantId: request.tenantId?.toString(),
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
    // Uses baseDAO.withTransaction which gracefully skips sessions in dev mode.
    const session = await this.invoiceDAO.startSession();
    let invoice: any;
    try {
      await this.invoiceDAO.withTransaction(session, async (txnSession) => {
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
          txnSession
        );

        await this.maintenanceRequestDAO.updateById(
          request._id.toString(),
          { $set: { invoiceId: (invoice as any)._id } },
          {},
          txnSession
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
}
