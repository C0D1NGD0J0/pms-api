import { Types } from 'mongoose';
import { MoneyUtils } from '@utils/money.utils';
import { MailType } from '@interfaces/utils.interface';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';
import {
  PaymentMethodSetupCompletedPayload,
  SubscriptionRenewalUpcomingPayload,
  PaymentRequestCreatedPayload,
  PaymentCancelledPayload,
  PaymentSucceededPayload,
  PaymentRefundedPayload,
  InvoiceOverduePayload,
  PaymentOverduePayload,
  PaymentFailedPayload,
  PayoutFailedPayload,
  PayoutPaidPayload,
} from '@interfaces/events.interface';

import { INotificationContext } from './notification.types';
import { getFormattedNotification } from './notificationMessages';
import { FINANCE_DEPARTMENTS, notifyAnnouncement, MGMT_ROLES } from './notification.helpers';

export async function handlePaymentFailed(
  ctx: INotificationContext,
  payload: PaymentFailedPayload
): Promise<void> {
  try {
    const { cuid, amount, tenantId, pytuid, hostedInvoiceUrl } = payload;
    const fmt = amount ? MoneyUtils.formatCurrency(amount) : '—';

    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.failed',
      { amount: fmt },
      MGMT_ROLES,
      { pytuid, tenantId },
      NotificationPriorityEnum.HIGH,
      FINANCE_DEPARTMENTS
    );

    if (tenantId) {
      const { title, message } = getFormattedNotification('payment.failedTenant', { amount: fmt });
      await ctx.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipient: tenantId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.HIGH,
        title,
        message,
        metadata: { pytuid, ...(hostedInvoiceUrl && { hostedInvoiceUrl }) },
      });

      // Queue payment-failed email to tenant
      try {
        const tenantUser = await ctx.userDAO.findFirst({
          _id: new Types.ObjectId(tenantId),
          deletedAt: null,
        });

        if (tenantUser?.email) {
          const tenantName =
            tenantUser.profile?.personalInfo?.firstName || tenantUser.fullname || tenantUser.email;

          ctx.emailQueue.addToEmailQueue('paymentFailed', {
            to: tenantUser.email,
            emailType: MailType.PAYMENT_FAILED,
            subject: '',
            data: {
              tenantName,
              amount: fmt,
              failureReason: payload.failureReason || '',
              hostedInvoiceUrl: hostedInvoiceUrl || '',
            },
          });
        }
      } catch (emailErr) {
        ctx.log.error({ err: emailErr }, 'Failed to enqueue payment-failed email');
      }
    }
  } catch (error) {
    ctx.log.error('Error sending payment failed notification', { error, payload });
  }
}

export async function handlePaymentSucceeded(
  ctx: INotificationContext,
  payload: PaymentSucceededPayload
): Promise<void> {
  try {
    const { cuid, amount } = payload;
    const fmt = MoneyUtils.formatCurrency(amount || 0);
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.succeeded',
      { amount: fmt },
      MGMT_ROLES,
      { pytuid: payload.pytuid },
      NotificationPriorityEnum.MEDIUM,
      FINANCE_DEPARTMENTS
    );

    // Queue payment receipt email to tenant
    if (payload.tenantId) {
      try {
        const tenantUser = await ctx.userDAO.findFirst(
          { _id: new Types.ObjectId(payload.tenantId), deletedAt: null },
          { populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' } }
        );
        if (tenantUser?.email) {
          const tenantName =
            tenantUser.profile?.personalInfo?.firstName || tenantUser.fullname || tenantUser.email;

          const paymentTypeLabel =
            payload.paymentType === 'rent'
              ? 'Rent'
              : payload.paymentType === 'maintenance'
                ? 'Maintenance'
                : 'Payment';

          ctx.emailQueue.addToEmailQueue('paymentReceipt', {
            to: tenantUser.email,
            emailType: MailType.PAYMENT_RECEIPT,
            subject: '',
            data: {
              tenantName,
              amount: fmt,
              paidAt: new Date().toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              }),
              receiptUrl: payload.receiptUrl || '',
              paymentType: paymentTypeLabel,
            },
          });
        }
      } catch (err) {
        ctx.log.error({ err }, 'Failed to queue payment receipt email');
      }
    }
  } catch (error) {
    ctx.log.error('Error sending payment succeeded notification', { error, payload });
  }
}

export async function handleSubscriptionRenewalUpcoming(
  ctx: INotificationContext,
  payload: SubscriptionRenewalUpcomingPayload
): Promise<void> {
  try {
    const { cuid, planName, amountInCents, currency, renewalDate } = payload;
    const fmt = MoneyUtils.formatCurrency(amountInCents || 0, currency || 'usd');
    const renewalDateStr =
      renewalDate instanceof Date
        ? renewalDate.toLocaleDateString()
        : new Date(renewalDate).toLocaleDateString();

    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.subscriptionRenewalUpcoming',
      { planName, amount: fmt, renewalDate: renewalDateStr },
      MGMT_ROLES,
      { stripeSubscriptionId: payload.stripeSubscriptionId, planName, renewalDate: renewalDateStr },
      NotificationPriorityEnum.MEDIUM,
      FINANCE_DEPARTMENTS
    );

    // Also email the account admin
    try {
      const client = await ctx.clientDAO.findFirst({ cuid });
      const accountAdminId = client?.accountAdmin
        ? typeof client.accountAdmin === 'object' && client.accountAdmin._id
          ? client.accountAdmin._id.toString()
          : client.accountAdmin.toString()
        : null;

      if (accountAdminId) {
        const adminUser = await ctx.userDAO.findFirst({
          _id: new Types.ObjectId(accountAdminId),
          deletedAt: null,
        });
        if (adminUser?.email) {
          ctx.emailQueue.addToEmailQueue('subscriptionRenewalUpcoming', {
            to: adminUser.email,
            emailType: MailType.SUBSCRIPTION_RENEWAL_UPCOMING,
            subject: '',
            data: { planName, amount: fmt, renewalDate: renewalDateStr, currentUser: adminUser },
          });
        }
      }
    } catch (err) {
      ctx.log.error({ err }, 'Failed to enqueue subscriptionRenewalUpcoming email');
    }
  } catch (error) {
    ctx.log.error('Error sending subscription renewal upcoming notification', { error, payload });
  }
}

export async function handlePaymentOverdue(
  ctx: INotificationContext,
  payload: PaymentOverduePayload
): Promise<void> {
  try {
    const { cuid, tenantId } = payload;
    const fmt = MoneyUtils.formatCurrency(payload.amount || 0);
    const dueDateStr = new Date(payload.dueDate).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.overdue',
      { amount: fmt, dueDate: dueDateStr },
      MGMT_ROLES,
      { pytuid: payload.pytuid, tenantId },
      NotificationPriorityEnum.HIGH,
      FINANCE_DEPARTMENTS
    );

    if (tenantId) {
      const { title, message } = getFormattedNotification('payment.overdueTenant', {
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
        metadata: { pytuid: payload.pytuid },
      });
    }
  } catch (error) {
    ctx.log.error('Error sending payment overdue notification', { error, payload });
  }
}

export async function handlePaymentRequestCreated(
  ctx: INotificationContext,
  payload: PaymentRequestCreatedPayload
): Promise<void> {
  try {
    const { tenantUserId, amountInCents, dueDate, pytuid, cuid } = payload;
    const fmt = MoneyUtils.formatCurrency(amountInCents || 0);
    const dueDateStr = new Date(dueDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const { title, message } = getFormattedNotification('payment.requested', {
      amount: fmt,
      dueDate: dueDateStr,
    });
    await ctx.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
      cuid,
      type: NotificationTypeEnum.PAYMENT,
      recipient: tenantUserId,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      priority: NotificationPriorityEnum.HIGH,
      title,
      message,
      metadata: { pytuid },
    });
  } catch (error) {
    ctx.log.error('Error sending payment request notification', { error, payload });
  }
}

export async function handlePaymentRefunded(
  ctx: INotificationContext,
  payload: PaymentRefundedPayload
): Promise<void> {
  try {
    const { cuid, refundAmount } = payload;
    const fmt = MoneyUtils.formatCurrency(refundAmount || 0);
    const { title, message } = getFormattedNotification('payment.refunded', { amount: fmt });
    await ctx.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
      cuid,
      type: NotificationTypeEnum.PAYMENT,
      recipientType: RecipientTypeEnum.ANNOUNCEMENT,
      targetRoles: [MGMT_ROLES[1]], // SUPER_ADMIN only
      priority: NotificationPriorityEnum.MEDIUM,
      title,
      message,
      metadata: { pytuid: payload.pytuid },
    });
  } catch (error) {
    ctx.log.error('Error sending payment refunded notification', { error, payload });
  }
}

export async function handlePaymentCancelled(
  ctx: INotificationContext,
  payload: PaymentCancelledPayload
): Promise<void> {
  try {
    const { tenantUserId, amountInCents, pytuid, cuid } = payload;
    const fmt = MoneyUtils.formatCurrency(amountInCents || 0);
    const { title, message } = getFormattedNotification('payment.cancelled', { amount: fmt });
    await ctx.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
      cuid,
      type: NotificationTypeEnum.PAYMENT,
      recipient: tenantUserId,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      priority: NotificationPriorityEnum.MEDIUM,
      title,
      message,
      metadata: { pytuid },
    });
  } catch (error) {
    ctx.log.error('Error sending payment cancelled notification', { error, payload });
  }
}

export async function handlePayoutFailed(
  ctx: INotificationContext,
  payload: PayoutFailedPayload
): Promise<void> {
  try {
    const { cuid, amountInCents, currency, reason } = payload;
    const fmt = MoneyUtils.formatCurrency(amountInCents || 0, currency || 'usd');
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.payoutFailed',
      { amount: fmt, reason: reason || 'unknown error' },
      MGMT_ROLES,
      { payoutId: payload.payoutId, accountId: payload.accountId },
      NotificationPriorityEnum.HIGH,
      FINANCE_DEPARTMENTS
    );
  } catch (error) {
    ctx.log.error('Error sending payout failed notification', { error, payload });
  }
}

export async function handleInvoiceOverdue(
  ctx: INotificationContext,
  payload: InvoiceOverduePayload
): Promise<void> {
  try {
    const { cuid, amount, currency } = payload;
    const fmt = MoneyUtils.formatCurrency(amount || 0, currency || 'usd');
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.invoiceOverdue',
      { amount: fmt },
      MGMT_ROLES,
      { pytuid: payload.pytuid, invoiceId: payload.invoiceId, tenantId: payload.tenantId },
      NotificationPriorityEnum.HIGH,
      FINANCE_DEPARTMENTS
    );
  } catch (error) {
    ctx.log.error('Error sending invoice overdue notification', { error, payload });
  }
}

export async function handlePayoutPaid(
  ctx: INotificationContext,
  payload: PayoutPaidPayload
): Promise<void> {
  try {
    const { cuid, amountInCents, currency } = payload;
    const fmt = MoneyUtils.formatCurrency(amountInCents || 0, currency || 'usd');
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.payoutPaid',
      { amount: fmt },
      MGMT_ROLES,
      { payoutId: payload.payoutId, accountId: payload.accountId },
      NotificationPriorityEnum.MEDIUM,
      FINANCE_DEPARTMENTS
    );
  } catch (error) {
    ctx.log.error('Error sending payout paid notification', { error, payload });
  }
}

export async function handlePaymentMethodSetupCompleted(
  ctx: INotificationContext,
  payload: PaymentMethodSetupCompletedPayload
): Promise<void> {
  try {
    const { tenantId, cuid, paymentMethodId } = payload;
    await ctx.sseService.sendToUser(
      tenantId,
      cuid,
      { resource: 'payment', action: 'payment-method-updated', resourceId: paymentMethodId },
      'resource-event'
    );
  } catch (error) {
    ctx.log.error('Error sending payment-method-updated SSE', { error, payload });
  }
}
