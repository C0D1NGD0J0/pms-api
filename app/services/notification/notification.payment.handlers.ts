import { Types } from 'mongoose';
import { envVariables } from '@shared/config';
import { MoneyUtils } from '@utils/money.utils';
import { MailType } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';
import {
  PaymentMethodSetupCompletedPayload,
  SubscriptionRenewalUpcomingPayload,
  PadPreDebitNotificationPayload,
  PaymentRetriedWithCardPayload,
  PaymentRequestCreatedPayload,
  DepositRefundFailedPayload,
  PadMandateConfirmedPayload,
  PadDebitInitiatedPayload,
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
import { translateNotificationText, getFormattedNotification } from './notificationMessages';
import {
  resolveTenantRecipient,
  buildTenantPaymentsUrl,
  resolveNoticeCurrency,
  findPaymentForNotice,
  FINANCE_DEPARTMENTS,
  getPaymentTypeLabel,
  isAutoDebitPayment,
  notifyAnnouncement,
  formatNoticeAmount,
  formatNoticeDate,
  ITenantRecipient,
  getPayeeDetails,
  MGMT_ROLES,
} from './notification.helpers';

const DEFAULT_PAD_NOTICE_DAYS = 10;

const getPadNoticeDays = (): number =>
  envVariables.STRIPE?.PAD_PRE_NOTIFICATION_DAYS || DEFAULT_PAD_NOTICE_DAYS;

/** In-app notices only — email templates are English and keep using getPaymentTypeLabel. */
const getLocalizedPaymentTypeLabel = (paymentType: string | null | undefined): string => {
  const englishLabel = getPaymentTypeLabel(paymentType);
  const isKnownType = Boolean(paymentType) && englishLabel !== getPaymentTypeLabel(null);
  return translateNotificationText(
    `fragments.paymentTypes.${isKnownType ? paymentType : 'default'}`,
    englishLabel
  );
};

const getUnknownErrorText = (): string =>
  translateNotificationText('fragments.unknownError', 'unknown error');

/**
 * Refund issued: the account owner gets an in-app notice; the tenant gets an email and an
 * in-app notice with the amount, currency, partial/full and reason.
 */
export async function handlePaymentRefunded(
  ctx: INotificationContext,
  payload: PaymentRefundedPayload
): Promise<void> {
  try {
    const { cuid, pytuid } = payload;
    const refundCents = payload.amount ?? payload.refundAmount ?? 0;
    const payment =
      !payload.currency || !payload.tenantId ? await findPaymentForNotice(ctx, pytuid, cuid) : null;
    const currency = await resolveNoticeCurrency(ctx, {
      currency: payload.currency,
      pytuid,
      cuid,
      payment,
    });
    const fmt = formatNoticeAmount(refundCents, currency);

    const { title, message } = getFormattedNotification('payment.refunded', { amount: fmt });
    await ctx.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
      cuid,
      type: NotificationTypeEnum.PAYMENT,
      recipientType: RecipientTypeEnum.ANNOUNCEMENT,
      targetRoles: [ROLES.SUPER_ADMIN], // account owner only
      priority: NotificationPriorityEnum.MEDIUM,
      title,
      message,
      metadata: { pytuid },
    });

    const tenantId = payload.tenantId ?? payment?.tenant?.toString();
    const tenant = await resolveTenantRecipient(ctx, tenantId);
    if (!tenant) {
      ctx.log.warn(
        { tenantId, pytuid },
        'Payment refunded: tenant not found — tenant not notified'
      );
      return;
    }

    const isPartial = payload.isPartial ?? false;
    await notifyTenantInApp(
      ctx,
      cuid,
      tenant,
      getFormattedNotification('payment.refundedTenant', {
        amount: fmt,
        pytuid,
        refundKind: isPartial
          ? translateNotificationText('fragments.refundKinds.partial', 'partial')
          : translateNotificationText('fragments.refundKinds.full', 'full'),
      }),
      { pytuid },
      NotificationPriorityEnum.MEDIUM
    );

    if (!tenant.email) return;
    ctx.emailQueue.addToEmailQueue('paymentRefunded', {
      to: tenant.email,
      requestId: ctx.requestId,
      emailType: MailType.PAYMENT_REFUNDED,
      subject: '',
      data: {
        tenantName: tenant.firstName,
        amount: fmt,
        currency,
        isPartial,
        totalRefunded:
          isPartial && payload.totalRefunded
            ? formatNoticeAmount(payload.totalRefunded, currency)
            : '',
        reason: payload.reason || '',
        refundedOn: formatNoticeDate(new Date()),
        reference: pytuid,
        paymentsUrl: buildTenantPaymentsUrl(cuid, tenant, pytuid),
      },
    });
  } catch (error) {
    ctx.log.error('Error sending payment refunded notification', { error, payload });
  }
}

/**
 * A failed bank debit was charged to the tenant's card instead. The tenant must be told
 * (email + in-app); managers get an informational in-app notice.
 */
export async function handlePaymentRetriedWithCard(
  ctx: INotificationContext,
  payload: PaymentRetriedWithCardPayload
): Promise<void> {
  try {
    const { cuid, pytuid, tenantId, amount, cardLast4, failureReason } = payload;
    const currency = await resolveNoticeCurrency(ctx, { currency: payload.currency, pytuid, cuid });
    const fmt = formatNoticeAmount(amount, currency);

    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.retriedWithCard',
      { amount: fmt, pytuid },
      MGMT_ROLES,
      { pytuid, tenantId },
      NotificationPriorityEnum.MEDIUM,
      FINANCE_DEPARTMENTS
    );

    const tenant = await resolveTenantRecipient(ctx, tenantId);
    if (!tenant) {
      ctx.log.warn({ tenantId, pytuid }, 'Card retry: tenant not found — tenant not notified');
      return;
    }

    const cardDescription = cardLast4
      ? translateNotificationText(
          'fragments.cardDescriptions.endingIn',
          'your card ending in {{cardLast4}}',
          { cardLast4 }
        )
      : translateNotificationText('fragments.cardDescriptions.onFile', 'your card on file');
    await notifyTenantInApp(
      ctx,
      cuid,
      tenant,
      getFormattedNotification('payment.retriedWithCardTenant', { amount: fmt, cardDescription }),
      { pytuid }
    );

    if (!tenant.email) return;
    const payee = await getPayeeDetails(ctx, cuid);
    ctx.emailQueue.addToEmailQueue('paymentRetriedWithCard', {
      to: tenant.email,
      requestId: ctx.requestId,
      emailType: MailType.PAYMENT_RETRIED_WITH_CARD,
      subject: '',
      data: {
        tenantName: tenant.firstName,
        payeeName: payee.name,
        amount: fmt,
        cardLast4: cardLast4 || '',
        failureReason: failureReason || '',
        reference: pytuid,
        paymentsUrl: buildTenantPaymentsUrl(cuid, tenant, pytuid),
      },
    });
  } catch (error) {
    ctx.log.error('Error sending payment retried-with-card notification', { error, payload });
  }
}

export async function handlePaymentFailed(
  ctx: INotificationContext,
  payload: PaymentFailedPayload
): Promise<void> {
  try {
    const { cuid, amount, tenantId, pytuid, hostedInvoiceUrl, failureReason } = payload;
    const currency = await resolveNoticeCurrency(ctx, { currency: payload.currency, pytuid, cuid });
    const fmt = amount ? formatNoticeAmount(amount, currency) : '—';

    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.failed',
      { amount: fmt },
      MGMT_ROLES,
      { pytuid, tenantId, ...(failureReason && { failureReason }) },
      NotificationPriorityEnum.HIGH,
      FINANCE_DEPARTMENTS
    );

    if (!tenantId) return;
    const tenant = await resolveTenantRecipient(ctx, tenantId);
    if (!tenant) {
      ctx.log.warn({ tenantId, pytuid }, 'Payment failed: tenant not found — tenant not notified');
      return;
    }

    const notice = failureReason
      ? getFormattedNotification('payment.failedTenantWithReason', {
          amount: fmt,
          reason: failureReason,
        })
      : getFormattedNotification('payment.failedTenant', { amount: fmt });
    await notifyTenantInApp(ctx, cuid, tenant, notice, {
      pytuid,
      ...(hostedInvoiceUrl && { hostedInvoiceUrl }),
    });

    if (!tenant.email) return;
    try {
      ctx.emailQueue.addToEmailQueue('paymentFailed', {
        to: tenant.email,
        requestId: ctx.requestId,
        emailType: MailType.PAYMENT_FAILED,
        subject: '',
        data: {
          tenantName: tenant.firstName,
          amount: fmt,
          failureReason: failureReason || '',
          hostedInvoiceUrl: hostedInvoiceUrl || '',
          reference: pytuid,
        },
      });
    } catch (emailErr) {
      ctx.log.error({ err: emailErr }, 'Failed to enqueue payment-failed email');
    }
  } catch (error) {
    ctx.log.error('Error sending payment failed notification', { error, payload });
  }
}

/**
 * PAD mandate confirmed — Rule H1 confirmation email (sent within 5 days of the mandate):
 * terms, payee contact, recourse rights, advance-notice period and how to cancel.
 */
export async function handlePadMandateConfirmed(
  ctx: INotificationContext,
  payload: PadMandateConfirmedPayload
): Promise<void> {
  try {
    const { tenantId, cuid, mandateId } = payload;

    const tenant = await resolveTenantRecipient(ctx, tenantId);
    if (!tenant?.email) {
      ctx.log.warn({ tenantId, cuid }, 'PAD mandate confirmation: tenant email not found');
      return;
    }

    const payee = await getPayeeDetails(ctx, cuid);
    const noticeDays = getPadNoticeDays();

    ctx.emailQueue.addToEmailQueue('padMandateConfirmation', {
      to: tenant.email,
      requestId: ctx.requestId,
      emailType: MailType.PAD_MANDATE_CONFIRMATION,
      subject: '',
      data: {
        tenantName: tenant.firstName,
        payeeName: payee.name,
        payeeAddress: payee.address,
        payeePhone: payee.phone,
        payeeEmail: payee.email,
        amount: 'Your rent as set out in your lease',
        variableAmounts:
          'Maintenance charges and late fees are variable amounts. Each one is debited only after we send you notice of its amount and debit date.',
        frequency: 'Monthly (rent); as they arise (maintenance charges and late fees)',
        debitDay: null,
        startDate: formatNoticeDate(new Date()),
        noticeDays,
        mandateReference: mandateId,
        accountLast4: payload.accountLast4 || '',
        institutionName: payload.institutionName || '',
        paymentsUrl: buildTenantPaymentsUrl(cuid, tenant),
        cancellationRights: `You may cancel this authorization at any time by contacting ${payee.name} or by removing the bank account from your payment settings. Cancelling the authorization does not cancel amounts you owe under your lease.`,
      },
    });

    ctx.log.info({ tenantId, cuid, mandateId }, 'PAD mandate confirmation email queued');
  } catch (error) {
    ctx.log.error('Error handling PAD mandate confirmed', { error, payload });
  }
}

export async function handleSubscriptionRenewalUpcoming(
  ctx: INotificationContext,
  payload: SubscriptionRenewalUpcomingPayload
): Promise<void> {
  try {
    const { cuid, planName, amountInCents, currency, renewalDate } = payload;
    const fmt = MoneyUtils.formatCurrency(amountInCents || 0, (currency || 'usd').toUpperCase());
    const renewalDateStr = formatNoticeDate(renewalDate);

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
            requestId: ctx.requestId,
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

/**
 * PAD pre-debit notice — sent N days (PAD_PRE_NOTIFICATION_DAYS) BEFORE each ACSS debit
 * (Rule H1). Always sent: it is a regulatory notice.
 */
export async function handlePadPreDebitNotification(
  ctx: INotificationContext,
  payload: PadPreDebitNotificationPayload
): Promise<void> {
  try {
    const { tenantId, cuid, amount, pytuid } = payload;

    const tenant = await resolveTenantRecipient(ctx, tenantId);
    if (!tenant?.email) {
      ctx.log.warn({ tenantId, cuid, pytuid }, 'PAD pre-debit notice: tenant email not found');
      return;
    }

    const currency = await resolveNoticeCurrency(ctx, { currency: payload.currency, pytuid, cuid });
    const payee = await getPayeeDetails(ctx, cuid);
    const noticeDays = getPadNoticeDays();
    const debitDate = payload.debitDate || new Date(Date.now() + noticeDays * 24 * 60 * 60 * 1000);

    ctx.emailQueue.addToEmailQueue('padPreDebitNotification', {
      to: tenant.email,
      requestId: ctx.requestId,
      emailType: MailType.PAD_PRE_DEBIT_NOTIFICATION,
      subject: '',
      data: {
        tenantName: tenant.firstName,
        payeeName: payee.name,
        payeeAddress: payee.address,
        payeePhone: payee.phone,
        payeeEmail: payee.email,
        amount: formatNoticeAmount(amount, currency),
        currency,
        debitDate: formatNoticeDate(debitDate),
        paymentType: getPaymentTypeLabel(payload.paymentType),
        reference: pytuid,
        pytuid,
        accountLast4: payload.accountLast4 || '',
        mandateReference: payload.mandateReference || '',
        noticeDays,
        paymentsUrl: buildTenantPaymentsUrl(cuid, tenant, pytuid),
      },
    });

    ctx.log.info({ tenantId, cuid, pytuid }, 'PAD pre-debit notification email queued');
  } catch (error) {
    ctx.log.error('Error handling PAD pre-debit notification', { error, payload });
  }
}

/**
 * In-app notice for a new charge. Only auto-debit leases are told their account will be
 * charged; cash / cheque / e-transfer tenants are asked to pay by the due date.
 */
export async function handlePaymentRequestCreated(
  ctx: INotificationContext,
  payload: PaymentRequestCreatedPayload
): Promise<void> {
  try {
    const { tenantUserId, amountInCents, dueDate, pytuid, cuid } = payload;
    const needsPaymentRecord =
      !payload.currency || !payload.paymentType || !payload.acceptedPaymentMethod;
    const payment = needsPaymentRecord ? await findPaymentForNotice(ctx, pytuid, cuid) : null;

    const currency = await resolveNoticeCurrency(ctx, {
      currency: payload.currency,
      pytuid,
      cuid,
      payment,
    });
    const isAutoDebit = await isAutoDebitPayment(ctx, {
      acceptedPaymentMethod: payload.acceptedPaymentMethod,
      payment,
    });
    const paymentLabel = getLocalizedPaymentTypeLabel(
      payload.paymentType || payment?.paymentType
    ).toLowerCase();

    const tenant = await resolveTenantRecipient(ctx, tenantUserId);
    const { title, message } = getFormattedNotification(
      isAutoDebit ? 'payment.requested' : 'payment.requestedManual',
      {
        amount: formatNoticeAmount(amountInCents || 0, currency),
        dueDate: formatNoticeDate(dueDate),
        paymentLabel,
      }
    );
    await ctx.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
      cuid,
      type: NotificationTypeEnum.PAYMENT,
      recipient: tenant?.userId ?? tenantUserId,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      required: true,
      priority: NotificationPriorityEnum.HIGH,
      title,
      message,
      metadata: { pytuid },
    });
  } catch (error) {
    ctx.log.error('Error sending payment request notification', { error, payload });
  }
}

/** A deposit refund could not be processed — managers must act (in-app + email). */
export async function handleDepositRefundFailed(
  ctx: INotificationContext,
  payload: DepositRefundFailedPayload
): Promise<void> {
  try {
    const { cuid, pytuid, leaseId, amount, reason } = payload;
    const currency = await resolveNoticeCurrency(ctx, { currency: payload.currency, pytuid, cuid });
    const fmt = formatNoticeAmount(amount, currency);

    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.depositRefundFailed',
      { amount: fmt, pytuid, reason: reason || getUnknownErrorText() },
      MGMT_ROLES,
      { pytuid, leaseId },
      NotificationPriorityEnum.HIGH,
      FINANCE_DEPARTMENTS,
      true
    );

    try {
      const managerEmail = await getDepositManagerEmail(ctx, leaseId, cuid);
      if (!managerEmail) return;
      const frontendUrl = envVariables.FRONTEND?.URL;
      ctx.emailQueue.addToEmailQueue('depositRefundFailed', {
        to: managerEmail,
        requestId: ctx.requestId,
        emailType: MailType.DEPOSIT_REFUND_FAILED,
        subject: '',
        data: {
          amount: fmt,
          currency,
          reason: reason || '',
          reference: pytuid,
          paymentUrl: frontendUrl ? `${frontendUrl}/payments/${cuid}/${pytuid}` : '',
        },
      });
    } catch (err) {
      ctx.log.error({ err, pytuid }, 'Failed to enqueue deposit-refund-failed email');
    }
  } catch (error) {
    ctx.log.error('Error sending deposit refund failed notification', { error, payload });
  }
}

export async function handlePaymentSucceeded(
  ctx: INotificationContext,
  payload: PaymentSucceededPayload
): Promise<void> {
  try {
    const { cuid, amount, pytuid } = payload;
    const currency = await resolveNoticeCurrency(ctx, { currency: payload.currency, pytuid, cuid });
    const fmt = formatNoticeAmount(amount || 0, currency);
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.succeeded',
      { amount: fmt },
      MGMT_ROLES,
      { pytuid },
      NotificationPriorityEnum.MEDIUM,
      FINANCE_DEPARTMENTS
    );

    if (!payload.tenantId) return;
    try {
      const tenant = await resolveTenantRecipient(ctx, payload.tenantId);
      if (!tenant?.email) return;

      ctx.emailQueue.addToEmailQueue('paymentReceipt', {
        to: tenant.email,
        requestId: ctx.requestId,
        emailType: MailType.PAYMENT_RECEIPT,
        subject: '',
        data: {
          tenantName: tenant.firstName,
          amount: fmt,
          paidAt: formatNoticeDate(payload.paidAt || new Date()),
          receiptUrl: payload.receiptUrl || '',
          paymentType: getPaymentTypeLabel(payload.paymentType),
          reference: pytuid,
        },
      });
    } catch (err) {
      ctx.log.error({ err }, 'Failed to queue payment receipt email');
    }
  } catch (error) {
    ctx.log.error('Error sending payment succeeded notification', { error, payload });
  }
}

export async function handlePaymentOverdue(
  ctx: INotificationContext,
  payload: PaymentOverduePayload
): Promise<void> {
  try {
    const { cuid, tenantId, pytuid } = payload;
    const currency = await resolveNoticeCurrency(ctx, { currency: payload.currency, pytuid, cuid });
    const fmt = formatNoticeAmount(payload.amount || 0, currency);
    const dueDateStr = formatNoticeDate(payload.dueDate);
    const paymentTitle = getLocalizedPaymentTypeLabel(payload.paymentType);
    const typeVars = { paymentTitle, paymentLabel: paymentTitle.toLowerCase() };

    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.overdue',
      { amount: fmt, dueDate: dueDateStr, ...typeVars },
      MGMT_ROLES,
      { pytuid, tenantId },
      NotificationPriorityEnum.HIGH,
      FINANCE_DEPARTMENTS
    );

    if (!tenantId) return;
    const tenant = await resolveTenantRecipient(ctx, tenantId);
    if (!tenant) {
      ctx.log.warn({ tenantId, pytuid }, 'Payment overdue: tenant not found — tenant not notified');
      return;
    }

    await notifyTenantInApp(
      ctx,
      cuid,
      tenant,
      getFormattedNotification('payment.overdueTenant', {
        amount: fmt,
        dueDate: dueDateStr,
        ...typeVars,
      }),
      { pytuid }
    );
  } catch (error) {
    ctx.log.error('Error sending payment overdue notification', { error, payload });
  }
}

/** A pre-authorized (ACSS) debit has been submitted to the bank and is processing. */
export async function handlePadDebitInitiated(
  ctx: INotificationContext,
  payload: PadDebitInitiatedPayload
): Promise<void> {
  try {
    const { tenantId, cuid, amount, pytuid } = payload;

    const tenant = await resolveTenantRecipient(ctx, tenantId);
    if (!tenant?.email) {
      ctx.log.warn({ tenantId, cuid, pytuid }, 'PAD debit initiated: tenant email not found');
      return;
    }

    const currency = await resolveNoticeCurrency(ctx, { currency: payload.currency, pytuid, cuid });
    const payee = await getPayeeDetails(ctx, cuid);

    ctx.emailQueue.addToEmailQueue('padDebitInitiated', {
      to: tenant.email,
      requestId: ctx.requestId,
      emailType: MailType.PAD_DEBIT_INITIATED,
      subject: '',
      data: {
        tenantName: tenant.firstName,
        payeeName: payee.name,
        payeePhone: payee.phone,
        payeeEmail: payee.email,
        amount: formatNoticeAmount(amount, currency),
        currency,
        initiatedOn: formatNoticeDate(new Date()),
        reference: pytuid,
        paymentsUrl: buildTenantPaymentsUrl(cuid, tenant, pytuid),
      },
    });
  } catch (error) {
    ctx.log.error('Error handling PAD debit initiated', { error, payload });
  }
}

export async function handlePaymentCancelled(
  ctx: INotificationContext,
  payload: PaymentCancelledPayload
): Promise<void> {
  try {
    const { tenantUserId, amountInCents, pytuid, cuid } = payload;
    const currency = await resolveNoticeCurrency(ctx, { currency: payload.currency, pytuid, cuid });
    const fmt = formatNoticeAmount(amountInCents || 0, currency);
    const tenant = await resolveTenantRecipient(ctx, tenantUserId);
    const { title, message } = getFormattedNotification('payment.cancelled', { amount: fmt });
    await ctx.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
      cuid,
      type: NotificationTypeEnum.PAYMENT,
      recipient: tenant?.userId ?? tenantUserId,
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

export async function handleInvoiceOverdue(
  ctx: INotificationContext,
  payload: InvoiceOverduePayload
): Promise<void> {
  try {
    const { cuid, amount, pytuid } = payload;
    const currency = await resolveNoticeCurrency(ctx, { currency: payload.currency, pytuid, cuid });
    const fmt = formatNoticeAmount(amount || 0, currency);
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.invoiceOverdue',
      { amount: fmt },
      MGMT_ROLES,
      { pytuid, invoiceId: payload.invoiceId, tenantId: payload.tenantId },
      NotificationPriorityEnum.HIGH,
      FINANCE_DEPARTMENTS,
      true
    );
  } catch (error) {
    ctx.log.error('Error sending invoice overdue notification', { error, payload });
  }
}

export async function handlePayoutFailed(
  ctx: INotificationContext,
  payload: PayoutFailedPayload
): Promise<void> {
  try {
    const { cuid, amountInCents, currency, reason } = payload;
    const fmt = MoneyUtils.formatCurrency(amountInCents || 0, (currency || 'usd').toUpperCase());
    await notifyAnnouncement(
      ctx,
      cuid,
      NotificationTypeEnum.PAYMENT,
      'payment.payoutFailed',
      { amount: fmt, reason: reason || 'unknown error' },
      MGMT_ROLES,
      { payoutId: payload.payoutId, accountId: payload.accountId },
      NotificationPriorityEnum.HIGH,
      FINANCE_DEPARTMENTS,
      true
    );
  } catch (error) {
    ctx.log.error('Error sending payout failed notification', { error, payload });
  }
}

export async function handlePayoutPaid(
  ctx: INotificationContext,
  payload: PayoutPaidPayload
): Promise<void> {
  try {
    const { cuid, amountInCents, currency } = payload;
    const fmt = MoneyUtils.formatCurrency(amountInCents || 0, (currency || 'usd').toUpperCase());
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
    const tenant = await resolveTenantRecipient(ctx, tenantId);
    await ctx.sseService.sendToUser(
      tenant?.userId ?? tenantId,
      cuid,
      { resource: 'payment', action: 'payment-method-updated', resourceId: paymentMethodId },
      'resource-event'
    );
  } catch (error) {
    ctx.log.error('Error sending payment-method-updated SSE', { error, payload });
  }
}

/** Email for the deposit-refund-failed alert: the property's manager, else the account admin. */
async function getDepositManagerEmail(
  ctx: INotificationContext,
  leaseId: string,
  cuid: string
): Promise<string | null> {
  let managerId: string | undefined;

  if (ctx.leaseDAO && leaseId) {
    const leaseFilter = Types.ObjectId.isValid(leaseId)
      ? { _id: new Types.ObjectId(leaseId), cuid }
      : { luid: leaseId, cuid };
    const lease: any = await ctx.leaseDAO.findFirst(leaseFilter);
    const propertyId = lease?.property?.id;
    if (propertyId && Types.ObjectId.isValid(propertyId.toString())) {
      const property = await ctx.propertyDAO.findFirst({
        _id: new Types.ObjectId(propertyId.toString()),
      });
      managerId = property?.managedBy?.toString();
    }
  }

  if (!managerId) {
    const client = await ctx.clientDAO.getClientByCuid(cuid);
    const admin = client?.accountAdmin as { _id?: Types.ObjectId } | Types.ObjectId | undefined;
    managerId = (admin && '_id' in admin ? admin._id : admin)?.toString();
  }
  if (!managerId) return null;

  const manager = await ctx.userDAO.findFirst({
    _id: new Types.ObjectId(managerId),
    deletedAt: null,
  });
  return manager?.email ?? null;
}

async function notifyTenantInApp(
  ctx: INotificationContext,
  cuid: string,
  tenant: ITenantRecipient,
  notice: { title: string; message: string },
  metadata: Record<string, any>,
  priority: NotificationPriorityEnum = NotificationPriorityEnum.HIGH
): Promise<void> {
  await ctx.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
    cuid,
    type: NotificationTypeEnum.PAYMENT,
    recipient: tenant.userId,
    recipientType: RecipientTypeEnum.INDIVIDUAL,
    required: true,
    priority,
    title: notice.title,
    message: notice.message,
    metadata,
  });
}
