import dayjs from 'dayjs';
import mongoose, { Types } from 'mongoose';
import { MoneyUtils } from '@utils/money.utils';
import { MailType } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';
import {
  MaintenanceWorkOrderSubmittedPayload,
  MaintenanceAITriageCompletedPayload,
  MaintenanceWorkOrderApprovedPayload,
  MaintenanceWorkOrderRejectedPayload,
  MaintenanceInvoiceSubmittedPayload,
  MaintenanceRequestCancelledPayload,
  MaintenanceRequestCompletedPayload,
  MaintenanceInvoiceApprovedPayload,
  MaintenanceInvoiceRejectedPayload,
  MaintenanceRequestAcceptedPayload,
  MaintenanceRequestAssignedPayload,
  MaintenanceRequestDeclinedPayload,
  MaintenanceRequestWorkDonePayload,
  MaintenanceFundsAvailablePayload,
  MaintenanceRequestCreatedPayload,
  MaintenanceRequestUpdatedPayload,
  MaintenanceChargeCreatedPayload,
  MaintenanceChargePaidPayload,
  MaintenanceVendorPaidPayload,
} from '@interfaces/events.interface';

import { INotificationContext } from './notification.types';
import { getFormattedNotification } from './notificationMessages';
import {
  fetchRequestAndEnqueueEmail,
  notifyAnnouncement,
  notifyIndividuals,
  ALL_STAFF_ROLES,
  MGMT_ROLES,
} from './notification.helpers';

const normalizeWorkOrderForEmail = (workOrder: any) => {
  if (!workOrder) return workOrder;
  const scope = typeof workOrder.scope === 'object' ? workOrder.scope.text : workOrder.scope;
  return { ...workOrder, scope };
};

const PROFILE_POPULATE = {
  path: 'profile',
  select: 'personalInfo.firstName personalInfo.lastName',
};

/** Shape a raw user document into the flat object email templates expect. */
const shapeUserForEmail = (user: any) => ({
  firstName: user?.profile?.personalInfo?.firstName || user?.email,
  lastName: user?.profile?.personalInfo?.lastName || '',
  email: user?.email,
});

// ── Maintenance request handlers ────────────────────────────────────────────

export async function handleInvoiceApproved(
  ctx: INotificationContext,
  payload: MaintenanceInvoiceApprovedPayload
): Promise<void> {
  const {
    cuid,
    mruid,
    vendorId,
    technicianId,
    tenantId,
    isBillable,
    amount,
    currency,
    approvedBy,
  } = payload;
  const fmt = MoneyUtils.formatCurrency(amount || 0, currency || 'USD');

  if (vendorId) {
    try {
      await notifyIndividuals(
        ctx,
        cuid,
        NotificationTypeEnum.MAINTENANCE,
        'maintenance.invoiceApproved',
        { mruid, amount: fmt },
        [vendorId, technicianId],
        { mruid },
        NotificationPriorityEnum.MEDIUM
      );
    } catch (error) {
      ctx.log.error('Error sending invoice approved notification', { error, payload });
    }

    try {
      const [vendorUser, approvedByUser] = await Promise.all([
        ctx.userDAO.findFirst({ _id: new Types.ObjectId(vendorId), deletedAt: null }),
        ctx.userDAO.findFirst(
          { _id: new Types.ObjectId(approvedBy), deletedAt: null },
          { populate: PROFILE_POPULATE }
        ),
      ]);
      if (vendorUser?.email) {
        ctx.emailQueue.addToEmailQueue('maintenanceInvoiceApproved', {
          to: vendorUser.email,
          emailType: MailType.MAINTENANCE_INVOICE_APPROVED,
          subject: '',
          data: {
            request: { mruid, invoice: { amount, currency } },
            approvedBy: shapeUserForEmail(approvedByUser),
          },
        });
      }
    } catch (err) {
      ctx.log.error({ err, mruid }, 'Failed to enqueue maintenanceInvoiceApproved email to vendor');
    }
  }

  // ── Resource-event SSE → tenant page invalidates cache immediately ──────────
  if (tenantId) {
    try {
      await ctx.sseService.sendToUser(
        tenantId,
        cuid,
        { resource: 'maintenance', action: 'invoice-approved', resourceUId: mruid },
        'resource-event'
      );
    } catch (error) {
      ctx.log.error('Error sending invoice approved resource-event SSE to tenant', {
        error,
        payload,
      });
    }
  }

  if (tenantId) {
    try {
      const { title, message } = getFormattedNotification('maintenance.invoiceApprovedTenant', {
        mruid,
      });
      await ctx.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipient: tenantId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { mruid },
      });
    } catch (error) {
      ctx.log.error('Error sending invoice approved notification to tenant', { error, payload });
    }

    if (isBillable) {
      try {
        const { title, message } = getFormattedNotification('maintenance.invoiceBillableNotice', {
          mruid,
          amount: fmt,
        });
        await ctx.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
          cuid,
          type: NotificationTypeEnum.PAYMENT,
          recipient: tenantId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.HIGH,
          title,
          message,
          metadata: { mruid, amount, currency },
        });
      } catch (error) {
        ctx.log.error('Error sending billable invoice notice to tenant', { error, payload });
      }
    }
  }
}

export async function handleWorkOrderApproved(
  ctx: INotificationContext,
  payload: MaintenanceWorkOrderApprovedPayload
): Promise<void> {
  const { cuid, mruid, vendorId, technicianId, tenantId } = payload;

  // ── Resource-event SSE → vendor page invalidates cache immediately ──────────
  // Sending this independently of the notification so the cache refresh is
  // reliable even if the user has disabled in-app notifications.
  try {
    if (vendorId) {
      await ctx.sseService.sendToUser(
        vendorId,
        cuid,
        { resource: 'maintenance', action: 'work-order-approved', resourceUId: mruid },
        'resource-event'
      );
    }
    if (technicianId && technicianId !== vendorId) {
      await ctx.sseService.sendToUser(
        technicianId,
        cuid,
        { resource: 'maintenance', action: 'work-order-approved', resourceUId: mruid },
        'resource-event'
      );
    }
  } catch (error) {
    ctx.log.error('Error sending work order approved resource-event SSE', { error, payload });
  }

  // ── In-app notification → vendor ────────────────────────────────────────────
  try {
    if (!vendorId) return;
    await notifyIndividuals(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.workOrderApproved',
      { mruid },
      [vendorId, technicianId],
      { mruid },
      NotificationPriorityEnum.MEDIUM
    );
  } catch (error) {
    ctx.log.error('Error sending work order approved notification to vendor', { error, payload });
  }

  // ── In-app notification → tenant ────────────────────────────────────────────
  try {
    if (tenantId) {
      const { title, message } = getFormattedNotification('maintenance.workOrderApprovedTenant', {
        mruid,
      });
      await ctx.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipient: tenantId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.LOW,
        title,
        message,
        metadata: { mruid },
      });
    }
  } catch (error) {
    ctx.log.error('Error sending work order approved notification to tenant', { error, payload });
  }

  // ── Email → vendor ──────────────────────────────────────────────────────────
  try {
    if (!vendorId) return;
    const { approvedBy } = payload;
    const [request, vendorUser, approvedByUser] = await Promise.all([
      ctx.maintenanceRequestDAO.getByMruid(mruid, cuid),
      ctx.userDAO.findFirst({ _id: new Types.ObjectId(vendorId), deletedAt: null }),
      ctx.userDAO.findFirst(
        { _id: new Types.ObjectId(approvedBy), deletedAt: null },
        { populate: PROFILE_POPULATE }
      ),
    ]);
    if (request && vendorUser?.email) {
      ctx.emailQueue.addToEmailQueue('maintenanceWorkOrderApproved', {
        to: vendorUser.email,
        emailType: MailType.MAINTENANCE_WORK_ORDER_APPROVED,
        subject: '',
        data: {
          request,
          workOrder: normalizeWorkOrderForEmail((request as any).workOrder),
          approvedBy: shapeUserForEmail(approvedByUser),
        },
      } as any);
    }
  } catch (err) {
    ctx.log.error(
      { err, mruid: payload.mruid },
      'Failed to enqueue maintenanceWorkOrderApproved email'
    );
  }
}

export async function handleVendorPaid(
  ctx: INotificationContext,
  payload: MaintenanceVendorPaidPayload
): Promise<void> {
  const { cuid, mruid, vendorId, amountInCents, transferId } = payload;
  const currency = 'USD'; // transfer currency not on payload — default for display
  const fmt = MoneyUtils.formatCurrency(amountInCents || 0, currency);

  // ── Resource-event SSE → vendor portal invalidates cache immediately ──────
  try {
    await ctx.sseService.sendToUser(
      vendorId,
      cuid,
      { resource: 'maintenance', action: 'vendor-paid', resourceUId: mruid },
      'resource-event'
    );

    // Also notify the primary account holder if different from the assigned vendor user
    const vendorUser = await ctx.userDAO.findFirst({ _id: new Types.ObjectId(vendorId) });
    const clientEntry = vendorUser?.cuids?.find((c: any) => c.cuid === cuid);
    const vendorVuid = clientEntry?.linkedVendorUid;

    const vendorQuery = vendorVuid
      ? { vuid: vendorVuid, deletedAt: null }
      : {
          'connectedClients.primaryAccountHolderUserId': new Types.ObjectId(vendorId),
          deletedAt: null,
        };
    const vendorOrg = await mongoose.connection.db
      ?.collection('vendors')
      .findOne(vendorQuery, { projection: { connectedClients: 1 } });
    const clientConn = vendorOrg?.connectedClients?.find((c: any) => c.cuid === cuid);
    const primaryHolderId = clientConn?.primaryAccountHolderUserId?.toString();

    if (primaryHolderId && primaryHolderId !== vendorId) {
      await ctx.sseService.sendToUser(
        primaryHolderId,
        cuid,
        { resource: 'maintenance', action: 'vendor-paid', resourceUId: mruid },
        'resource-event'
      );
    }
  } catch (error) {
    ctx.log.error('Error sending vendor-paid resource-event SSE', { error, payload });
  }

  // ── In-app notification → vendor ──────────────────────────────────────────
  try {
    await notifyIndividuals(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'maintenance.vendorPaid',
      { mruid, amount: fmt },
      [vendorId],
      { mruid, transferId },
      NotificationPriorityEnum.HIGH
    );
  } catch (error) {
    ctx.log.error('Error sending vendor paid notification', { error, payload });
  }

  // ── Email → vendor ────────────────────────────────────────────────────────
  try {
    const vendorUser = await ctx.userDAO.findFirst({ _id: new Types.ObjectId(vendorId) });
    if (vendorUser?.email) {
      const invoice = await ctx.maintenanceRequestDAO.getByMruid(mruid, cuid);
      ctx.emailQueue.addToEmailQueue('maintenanceVendorPaid', {
        to: vendorUser.email,
        emailType: MailType.MAINTENANCE_VENDOR_PAID,
        subject: '',
        data: {
          mruid,
          jobTitle: invoice?.title || '',
          amountInCents,
          currency: 'USD',
          transferId,
        },
      });
    }
  } catch (err) {
    ctx.log.error({ err, mruid }, 'Failed to enqueue maintenanceVendorPaid email');
  }
}

export async function handleInvoiceSubmitted(
  ctx: INotificationContext,
  payload: MaintenanceInvoiceSubmittedPayload
): Promise<void> {
  try {
    const { cuid, mruid, amount, currency } = payload;
    const fmt = MoneyUtils.formatCurrency(amount || 0, currency || 'USD');
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.invoiceSubmitted',
      { mruid, amount: fmt },
      ALL_STAFF_ROLES,
      { mruid },
      NotificationPriorityEnum.HIGH
    );
  } catch (error) {
    ctx.log.error('Error sending invoice submitted notification', { error, payload });
  }

  // Notify the vendor org's primary account holder if the submitter is a team member
  try {
    const { cuid, mruid, vendorId, amount, currency } = payload;
    const submitter = await ctx.userDAO.findFirst({ _id: new Types.ObjectId(vendorId) });
    const clientEntry = submitter?.cuids?.find((c: any) => c.cuid === cuid);
    const vendorVuid = clientEntry?.linkedVendorUid;

    // Resolve the vendor org — either via linkedVendorUid or as primary holder
    const vendorQuery = vendorVuid
      ? { vuid: vendorVuid, deletedAt: null }
      : {
          'connectedClients.primaryAccountHolderUserId': new Types.ObjectId(vendorId),
          deletedAt: null,
        };
    const vendorOrg = await mongoose.connection.db
      ?.collection('vendors')
      .findOne(vendorQuery, { projection: { connectedClients: 1 } });

    const clientConn = vendorOrg?.connectedClients?.find((c: any) => c.cuid === cuid);
    const primaryHolderId = clientConn?.primaryAccountHolderUserId?.toString();

    // Only notify if the primary holder is different from the submitter
    if (primaryHolderId && primaryHolderId !== vendorId) {
      const fmt = MoneyUtils.formatCurrency(amount || 0, currency || 'USD');
      await notifyIndividuals(
        ctx,
        cuid,
        NotificationTypeEnum.MAINTENANCE,
        'maintenance.invoiceSubmitted',
        { mruid, amount: fmt },
        [primaryHolderId],
        { mruid },
        NotificationPriorityEnum.HIGH
      );
    }
  } catch (err) {
    ctx.log.error(
      { err, mruid: payload.mruid },
      'Failed to notify vendor primary account holder about invoice submission'
    );
  }

  try {
    const { mruid, cuid, amount, vendorId } = payload;
    const request = await ctx.maintenanceRequestDAO.getByMruid(mruid, cuid);
    if (request) {
      ctx.emailQueue.addToEmailQueue('maintenanceInvoiceSubmitted', {
        to: '',
        emailType: MailType.MAINTENANCE_INVOICE_SUBMITTED,
        subject: '',
        data: { request, invoice: request.invoice, vendorId, amount },
      });
    }
  } catch (err) {
    ctx.log.error(
      { err, mruid: payload.mruid },
      'Failed to enqueue maintenanceInvoiceSubmitted email'
    );
  }
}

export async function handleWorkOrderRejected(
  ctx: INotificationContext,
  payload: MaintenanceWorkOrderRejectedPayload
): Promise<void> {
  const { cuid, mruid, vendorId, technicianId } = payload;

  // ── Resource-event SSE → vendor page invalidates cache immediately ──────────
  try {
    if (vendorId) {
      await ctx.sseService.sendToUser(
        vendorId,
        cuid,
        { resource: 'maintenance', action: 'work-order-rejected', resourceUId: mruid },
        'resource-event'
      );
    }
    if (technicianId && technicianId !== vendorId) {
      await ctx.sseService.sendToUser(
        technicianId,
        cuid,
        { resource: 'maintenance', action: 'work-order-rejected', resourceUId: mruid },
        'resource-event'
      );
    }
  } catch (error) {
    ctx.log.error('Error sending work order rejected resource-event SSE', { error, payload });
  }

  // ── In-app notification → vendor ────────────────────────────────────────────
  try {
    if (!vendorId) return;
    await notifyIndividuals(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.workOrderRejected',
      { mruid },
      [vendorId, technicianId],
      { mruid },
      NotificationPriorityEnum.MEDIUM
    );
  } catch (error) {
    ctx.log.error('Error sending work order rejected notification', { error, payload });
  }

  // ── Email → vendor ──────────────────────────────────────────────────────────
  try {
    const { rejectedBy, rejectionReason } = payload;
    if (!vendorId) return;
    const [request, vendorUser, rejectedByUser] = await Promise.all([
      ctx.maintenanceRequestDAO.getByMruid(mruid, cuid),
      ctx.userDAO.findFirst({ _id: new Types.ObjectId(vendorId), deletedAt: null }),
      ctx.userDAO.findFirst(
        { _id: new Types.ObjectId(rejectedBy), deletedAt: null },
        { populate: PROFILE_POPULATE }
      ),
    ]);
    if (request && vendorUser?.email) {
      ctx.emailQueue.addToEmailQueue('maintenanceWorkOrderRejected', {
        to: vendorUser.email,
        emailType: MailType.MAINTENANCE_WORK_ORDER_REJECTED,
        subject: '',
        data: {
          request,
          workOrder: normalizeWorkOrderForEmail((request as any).workOrder),
          rejectionReason,
          rejectedBy: shapeUserForEmail(rejectedByUser),
        },
      } as any);
    }
  } catch (err) {
    ctx.log.error(
      { err, mruid: payload.mruid },
      'Failed to enqueue maintenanceWorkOrderRejected email'
    );
  }
}

export async function handleWorkOrderSubmitted(
  ctx: INotificationContext,
  payload: MaintenanceWorkOrderSubmittedPayload
): Promise<void> {
  try {
    const { cuid, mruid } = payload;
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.workOrderSubmitted',
      { mruid },
      ALL_STAFF_ROLES,
      { mruid },
      NotificationPriorityEnum.MEDIUM
    );
  } catch (error) {
    ctx.log.error('Error sending work order submitted notification', { error, payload });
  }

  try {
    const { mruid, cuid, vendorId } = payload;
    const request = await ctx.maintenanceRequestDAO.getByMruid(mruid, cuid);
    if (request) {
      const workOrder = normalizeWorkOrderForEmail((request as any).workOrder);
      ctx.emailQueue.addToEmailQueue('maintenanceWorkOrderSubmitted', {
        to: '',
        emailType: MailType.MAINTENANCE_WORK_ORDER_SUBMITTED,
        subject: '',
        data: { request, workOrder, vendorId },
      } as any);

      if (request.tenantId) {
        const tenantUser = await ctx.userDAO.findFirst({
          _id: request.tenantId,
          deletedAt: null,
        });
        if (tenantUser?.email) {
          ctx.emailQueue.addToEmailQueue('maintenanceWorkOrderSubmittedTenant', {
            to: tenantUser.email,
            emailType: MailType.MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT,
            subject: '',
            data: { request, workOrder },
          } as any);
        }

        if (payload.scheduledDate) {
          const formattedDate = dayjs(payload.scheduledDate).format('ddd, MMM D, YYYY h:mm A');
          const { title, message } = getFormattedNotification('maintenance.vendorScheduledVisit', {
            mruid,
            scheduledDate: formattedDate,
          });
          await ctx.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
            cuid,
            type: NotificationTypeEnum.MAINTENANCE,
            recipientType: RecipientTypeEnum.INDIVIDUAL,
            recipient: request.tenantId.toString(),
            priority: NotificationPriorityEnum.MEDIUM,
            title,
            message,
            metadata: { mruid, scheduledDate: payload.scheduledDate },
          });
        }
      }
    }
  } catch (err) {
    ctx.log.error(
      { err, mruid: payload.mruid },
      'Failed to enqueue maintenanceWorkOrderSubmitted email'
    );
  }
}

export async function handleMRAssigned(
  ctx: INotificationContext,
  payload: MaintenanceRequestAssignedPayload
): Promise<void> {
  try {
    const { cuid, mruid, tenantId, vendorId } = payload;
    if (tenantId) {
      const { title, message } = getFormattedNotification('maintenance.requestAssigned', { mruid });
      await ctx.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipient: tenantId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { mruid },
      });
    }
    const { title, message } = getFormattedNotification('maintenance.requestAssignedVendor', {
      mruid,
    });
    await ctx.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
      cuid,
      type: NotificationTypeEnum.MAINTENANCE,
      recipient: vendorId,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      priority: NotificationPriorityEnum.MEDIUM,
      title,
      message,
      metadata: { mruid },
    });
  } catch (error) {
    ctx.log.error('Error sending MR assigned notification', { error, payload });
  }

  try {
    const { mruid, cuid, vendorId, assignedBy } = payload;
    const [request, vendorUser, assignedByUser] = await Promise.all([
      ctx.maintenanceRequestDAO.getByMruid(mruid, cuid),
      ctx.userDAO.findFirst(
        { _id: new Types.ObjectId(vendorId), deletedAt: null },
        { populate: PROFILE_POPULATE }
      ),
      ctx.userDAO.findFirst(
        { _id: new Types.ObjectId(assignedBy), deletedAt: null },
        { populate: PROFILE_POPULATE }
      ),
    ]);
    if (request && vendorUser?.email) {
      ctx.emailQueue.addToEmailQueue('maintenanceRequestAssigned', {
        to: vendorUser.email,
        emailType: MailType.MAINTENANCE_REQUEST_ASSIGNED,
        subject: '',
        data: {
          request: {
            ...(request.toObject ? request.toObject() : request),
            description: typeof request.description === 'object' ? '' : request.description,
          },
          vendor: shapeUserForEmail(vendorUser),
          assignedBy: shapeUserForEmail(assignedByUser),
        },
      });
    }
  } catch (err) {
    ctx.log.error(
      { err, mruid: payload.mruid },
      'Failed to enqueue maintenanceRequestAssigned email'
    );
  }
}

export async function handleMaintenanceChargeCreated(
  ctx: INotificationContext,
  payload: MaintenanceChargeCreatedPayload
): Promise<void> {
  try {
    const { cuid, mruid, tenantId, amountInCents, currency, pytuid, dueDate } = payload;
    const fmt = MoneyUtils.formatCurrency(amountInCents || 0, currency || 'USD');
    const dueDateStr = new Date(dueDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const { title, message } = getFormattedNotification('maintenance.chargeCreated', {
      mruid,
      amount: fmt,
      dueDate: dueDateStr,
    });
    await ctx.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
      cuid,
      type: NotificationTypeEnum.PAYMENT,
      recipient: tenantId,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      priority: NotificationPriorityEnum.HIGH,
      title,
      message,
      metadata: { mruid, pytuid },
    });
  } catch (error) {
    ctx.log.error('Error sending maintenance charge notification to tenant', { error, payload });
  }

  try {
    const {
      cuid,
      mruid,
      tenantId,
      amountInCents,
      currency,
      pytuid,
      title: jobTitle,
      dueDate,
    } = payload;
    const tenantUser = await ctx.userDAO.findFirst({
      _id: new Types.ObjectId(tenantId),
      deletedAt: null,
    });
    if (tenantUser?.email) {
      ctx.emailQueue.addToEmailQueue('maintenanceChargeCreated', {
        to: tenantUser.email,
        emailType: MailType.MAINTENANCE_CHARGE_CREATED,
        subject: '',
        data: { mruid, cuid, pytuid, jobTitle, amountInCents, currency, dueDate },
      });
    }
  } catch (err) {
    ctx.log.error(
      { err, mruid: payload.mruid },
      'Failed to enqueue maintenanceChargeCreated email to tenant'
    );
  }
}

// ── Invoice & charge handlers ───────────────────────────────────────────────

export async function handleInvoiceRejected(
  ctx: INotificationContext,
  payload: MaintenanceInvoiceRejectedPayload
): Promise<void> {
  try {
    const { cuid, mruid, vendorId, technicianId } = payload;
    if (!vendorId) return;
    await notifyIndividuals(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.invoiceRejected',
      { mruid },
      [vendorId, technicianId],
      { mruid },
      NotificationPriorityEnum.MEDIUM
    );
  } catch (error) {
    ctx.log.error('Error sending invoice rejected notification', { error, payload });
  }

  try {
    const { mruid, cuid, vendorId, rejectionReason, rejectedBy } = payload;
    if (!vendorId) return;
    const [request, vendorUser, rejectedByUser] = await Promise.all([
      ctx.maintenanceRequestDAO.getByMruid(mruid, cuid),
      ctx.userDAO.findFirst({ _id: new Types.ObjectId(vendorId), deletedAt: null }),
      ctx.userDAO.findFirst(
        { _id: new Types.ObjectId(rejectedBy), deletedAt: null },
        { populate: PROFILE_POPULATE }
      ),
    ]);
    if (request && vendorUser?.email) {
      ctx.emailQueue.addToEmailQueue('maintenanceInvoiceRejected', {
        to: vendorUser.email,
        emailType: MailType.MAINTENANCE_INVOICE_REJECTED,
        subject: '',
        data: { request, rejectionReason, rejectedBy: shapeUserForEmail(rejectedByUser) },
      });
    }
  } catch (err) {
    ctx.log.error(
      { err, mruid: payload.mruid },
      'Failed to enqueue maintenanceInvoiceRejected email'
    );
  }
}

export async function handleMRAccepted(
  ctx: INotificationContext,
  payload: MaintenanceRequestAcceptedPayload
): Promise<void> {
  try {
    const { cuid, mruid, tenantId } = payload;
    if (tenantId) {
      const { title, message } = getFormattedNotification('maintenance.requestAcceptedTenant', {
        mruid,
      });
      await ctx.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipient: tenantId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { mruid },
      });
    }
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.requestAccepted',
      { mruid },
      ALL_STAFF_ROLES,
      { mruid },
      NotificationPriorityEnum.LOW
    );
  } catch (error) {
    ctx.log.error('Error sending MR accepted notification', { error, payload });
  }

  if (payload.tenantId) {
    await fetchRequestAndEnqueueEmail(ctx, {
      mruid: payload.mruid,
      cuid: payload.cuid,
      userId: payload.tenantId,
      emailTemplate: 'maintenanceRequestAccepted',
      emailType: MailType.MAINTENANCE_REQUEST_ACCEPTED,
      buildData: (request, tenant) => ({ request, tenant, vendor: {} }),
      errorLabel: 'maintenanceRequestAccepted',
    });
  }
}

export async function handleMRCreated(
  ctx: INotificationContext,
  payload: MaintenanceRequestCreatedPayload
): Promise<void> {
  try {
    const { cuid, mruid, title, priority } = payload;
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.requestCreated',
      { priority, title, mruid },
      ALL_STAFF_ROLES,
      { mruid },
      NotificationPriorityEnum.MEDIUM
    );
  } catch (error) {
    ctx.log.error('Error sending MR created notification', { error, payload });
  }

  try {
    const { mruid, title, category, priority, tenantId } = payload;
    if (tenantId) {
      const creator = await ctx.userDAO.findFirst(
        {
          _id: new Types.ObjectId(tenantId),
          deletedAt: null,
        },
        { populate: PROFILE_POPULATE }
      );
      if (creator?.email) {
        ctx.emailQueue.addToEmailQueue('maintenanceRequestCreated', {
          to: creator.email,
          emailType: MailType.MAINTENANCE_REQUEST_CREATED,
          subject: '',
          data: {
            request: { mruid, title, category, priority },
            currentuser: shapeUserForEmail(creator),
          },
        });
      }
    }
  } catch (err) {
    ctx.log.error(
      { err, mruid: payload.mruid },
      'Failed to enqueue maintenanceRequestCreated email'
    );
  }
}

export async function handleMRCompleted(
  ctx: INotificationContext,
  payload: MaintenanceRequestCompletedPayload
): Promise<void> {
  try {
    const { cuid, mruid, tenantId, vendorId, technicianId } = payload;
    await notifyIndividuals(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.requestCompleted',
      { mruid },
      [tenantId, vendorId, technicianId],
      { mruid },
      NotificationPriorityEnum.MEDIUM
    );
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.requestCompleted',
      { mruid },
      ALL_STAFF_ROLES,
      { mruid },
      NotificationPriorityEnum.LOW
    );
  } catch (error) {
    ctx.log.error('Error sending MR completed notification', { error, payload });
  }

  if (payload.tenantId) {
    await fetchRequestAndEnqueueEmail(ctx, {
      mruid: payload.mruid,
      cuid: payload.cuid,
      userId: payload.tenantId,
      emailTemplate: 'maintenanceRequestCompleted',
      emailType: MailType.MAINTENANCE_REQUEST_COMPLETED,
      buildData: (request, tenant) => ({ request, tenant }),
      errorLabel: 'maintenanceRequestCompleted',
    });
  }
}

export async function handleMRUpdatedByTenant(
  ctx: INotificationContext,
  payload: MaintenanceRequestUpdatedPayload
): Promise<void> {
  try {
    const { cuid, mruid, managedBy, propertyId } = payload;

    let recipientId = managedBy;

    if (!recipientId && propertyId) {
      const property = await ctx.propertyDAO.findFirst({
        _id: new Types.ObjectId(propertyId),
        deletedAt: null,
      });
      recipientId = property?.managedBy?.toString();
    }

    if (!recipientId) {
      ctx.log.warn('No manager found for MR update notification, skipping', { mruid, cuid });
      return;
    }

    const { title, message } = getFormattedNotification('maintenance.requestUpdatedByTenant', {
      mruid,
    });
    await ctx.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
      cuid,
      type: NotificationTypeEnum.MAINTENANCE,
      recipient: recipientId,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      priority: NotificationPriorityEnum.LOW,
      title,
      message,
      metadata: { mruid },
    });
  } catch (error) {
    ctx.log.error('Error sending MR updated by tenant notification', { error, payload });
  }
}

export async function handleMRDeclined(
  ctx: INotificationContext,
  payload: MaintenanceRequestDeclinedPayload
): Promise<void> {
  try {
    const { cuid, mruid } = payload;
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.requestDeclined',
      { mruid },
      ALL_STAFF_ROLES,
      { mruid },
      NotificationPriorityEnum.HIGH
    );
  } catch (error) {
    ctx.log.error('Error sending MR declined notification', { error, payload });
  }

  try {
    const { mruid, cuid, vendorId, reason } = payload;
    const request = await ctx.maintenanceRequestDAO.getByMruid(mruid, cuid);
    if (request) {
      ctx.emailQueue.addToEmailQueue('maintenanceRequestDeclined', {
        to: '',
        emailType: MailType.MAINTENANCE_REQUEST_DECLINED,
        subject: '',
        data: { request, vendorId, reason },
      });
    }
  } catch (err) {
    ctx.log.error(
      { err, mruid: payload.mruid },
      'Failed to enqueue maintenanceRequestDeclined email'
    );
  }
}

// ── Work order handlers ─────────────────────────────────────────────────────

export async function handleMRWorkDone(
  ctx: INotificationContext,
  payload: MaintenanceRequestWorkDonePayload
): Promise<void> {
  try {
    const { cuid, mruid, tenantId } = payload;

    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.workDone',
      { mruid },
      ALL_STAFF_ROLES,
      { mruid },
      NotificationPriorityEnum.MEDIUM
    );

    if (tenantId) {
      const { title, message } = getFormattedNotification('maintenance.workDoneTenant', { mruid });
      await ctx.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipient: tenantId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { mruid },
      });
    }
  } catch (error) {
    ctx.log.error('Error sending MR work done notification', { error, payload });
  }
}

export async function handleMRCancelled(
  ctx: INotificationContext,
  payload: MaintenanceRequestCancelledPayload
): Promise<void> {
  try {
    const { cuid, mruid, tenantId, vendorId, technicianId } = payload;
    await notifyIndividuals(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.requestCancelled',
      { mruid },
      [tenantId, vendorId, technicianId],
      { mruid },
      NotificationPriorityEnum.MEDIUM
    );
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.MAINTENANCE,
      'maintenance.requestCancelled',
      { mruid },
      ALL_STAFF_ROLES,
      { mruid },
      NotificationPriorityEnum.LOW
    );
  } catch (error) {
    ctx.log.error('Error sending MR cancelled notification', { error, payload });
  }
}

export async function handleMaintenanceChargePaid(
  ctx: INotificationContext,
  payload: MaintenanceChargePaidPayload
): Promise<void> {
  try {
    const { cuid, mruid, amountInCents } = payload;
    const fmt = MoneyUtils.formatCurrency(amountInCents, 'usd');
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'maintenance.chargePaid',
      { amount: fmt, mruid },
      MGMT_ROLES,
      { mruid },
      NotificationPriorityEnum.HIGH
    );
  } catch (error) {
    ctx.log.error('Error sending maintenance charge paid notification', { error, payload });
  }
}

// ── AI triage handler ───────────────────────────────────────────────────────

export async function handleMaintenanceFundsAvailable(
  ctx: INotificationContext,
  payload: MaintenanceFundsAvailablePayload
): Promise<void> {
  try {
    const { cuid, mruid } = payload;
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'maintenance.fundsAvailable',
      { mruid },
      ALL_STAFF_ROLES,
      { mruid },
      NotificationPriorityEnum.MEDIUM
    );
  } catch (error) {
    ctx.log.error('Error sending funds available notification', { error, payload });
  }
}

export async function handleAITriageCompleted(
  ctx: INotificationContext,
  payload: MaintenanceAITriageCompletedPayload
): Promise<void> {
  try {
    const { cuid, mruid } = payload;
    await ctx.sseService.broadcastToClient(
      cuid,
      { resource: 'maintenance', action: 'ai-analysis-ready', resourceUId: mruid },
      'resource-event',
      undefined,
      [ROLES.ADMIN, ROLES.SUPER_ADMIN]
    );
  } catch (error) {
    ctx.log.error('Error sending ai-analysis-ready SSE', { error, payload });
  }
}
