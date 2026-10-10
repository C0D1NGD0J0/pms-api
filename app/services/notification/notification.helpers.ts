import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { envVariables } from '@shared/config';
import { MoneyUtils } from '@utils/money.utils';
import { MailType } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';
import {
  ICreateNotificationRequest,
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';

import { INotificationContext } from './notification.types';
import { getFormattedNotification, NotificationMessageKey } from './notificationMessages';

export const MGMT_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER] as const;
export const ALL_STAFF_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.STAFF,
] as const;

export const MAINTENANCE_DEPARTMENTS = ['maintenance', 'operations', 'management'] as const;
export const FINANCE_DEPARTMENTS = ['accounting', 'operations', 'management'] as const;

/**
 * Fetch a maintenance request + user by ID, then enqueue an email.
 * Each step is isolated in its own try-catch so one failure doesn't block the other.
 */
export async function fetchRequestAndEnqueueEmail(
  ctx: INotificationContext,
  params: {
    mruid: string;
    cuid: string;
    userId: string;
    emailTemplate: string;
    emailType: MailType;
    buildData: (request: any, user: any) => object;
    errorLabel: string;
  }
): Promise<void> {
  const { mruid, cuid, userId, emailTemplate, emailType, buildData, errorLabel } = params;
  try {
    const [request, user] = await Promise.all([
      ctx.maintenanceRequestDAO.getByMruid(mruid, cuid),
      ctx.userDAO.findFirst(
        { _id: new Types.ObjectId(userId), deletedAt: null },
        { populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' } }
      ),
    ]);
    if (request && user?.email) {
      const shapedUser = {
        firstName: user?.profile?.personalInfo?.firstName || user?.email,
        lastName: user?.profile?.personalInfo?.lastName || '',
        email: user?.email,
      };
      ctx.emailQueue.addToEmailQueue(emailTemplate, {
        to: user.email,
        requestId: ctx.requestId,
        emailType,
        subject: '',
        data: buildData(request, shapedUser),
      });
    }
  } catch (err) {
    ctx.log.error({ err, mruid }, `Failed to enqueue ${errorLabel} email`);
  }
}

/**
 * Send the same notification to multiple individual recipients, skipping nullish values
 * and deduplicating ids that appear more than once.
 * Replaces the repeated vendor+technician pattern.
 */
export async function notifyIndividuals(
  ctx: INotificationContext,
  cuid: string,
  type: NotificationTypeEnum,
  messageKey: NotificationMessageKey,
  vars: Record<string, any>,
  recipientIds: (string | undefined | null)[],
  metadata: Record<string, any>,
  priority: NotificationPriorityEnum = NotificationPriorityEnum.MEDIUM,
  required = false
): Promise<void> {
  const { title, message } = getFormattedNotification(messageKey, vars);
  const seen = new Set<string>();

  for (const id of recipientIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const data: ICreateNotificationRequest = {
      cuid,
      type,
      title,
      message,
      priority,
      recipient: id,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      metadata,
      required,
    };
    await ctx.createNotification(cuid, type, data);
  }
}

/**
 * Send an announcement notification to a set of target roles.
 * Replaces the repeated pattern of: getFormattedNotification → createNotification(ANNOUNCEMENT).
 */
export async function notifyAnnouncement(
  ctx: INotificationContext,
  cuid: string,
  type: NotificationTypeEnum,
  messageKey: NotificationMessageKey,
  vars: Record<string, any>,
  targetRoles: readonly string[],
  metadata: Record<string, any>,
  priority: NotificationPriorityEnum = NotificationPriorityEnum.MEDIUM,
  targetDepartments?: readonly string[],
  required = false
): Promise<void> {
  const { title, message } = getFormattedNotification(messageKey, vars);
  const data: ICreateNotificationRequest = {
    cuid,
    type,
    title,
    message,
    priority,
    recipientType: RecipientTypeEnum.ANNOUNCEMENT,
    targetRoles: targetRoles as string[],
    ...(targetDepartments && { targetDepartments: targetDepartments as string[] }),
    metadata,
    required,
  };
  await ctx.createNotification(cuid, type, data);
}

/**
 * Send a resource-event SSE to a specific user, wrapped in try/catch.
 * Replaces the repeated pattern: ctx.sseService.sendToUser(...) + try/catch + log.error.
 */
export async function sendResourceEvent(
  ctx: INotificationContext,
  userId: string | undefined | null,
  cuid: string,
  resource: string,
  action: string,
  resourceUId: string,
  errorLabel?: string
): Promise<void> {
  if (!userId) return;
  try {
    await ctx.sseService.sendToUser(
      userId,
      cuid,
      { resource, action, resourceUId },
      'resource-event'
    );
  } catch (error) {
    ctx.log.error(
      { error, userId, resourceUId },
      `Error sending ${errorLabel || action} resource-event SSE`
    );
  }
}

/**
 * Send resource-event SSE to multiple users, deduplicating and skipping nullish IDs.
 */
export async function sendResourceEventToMany(
  ctx: INotificationContext,
  userIds: (string | undefined | null)[],
  cuid: string,
  resource: string,
  action: string,
  resourceUId: string,
  errorLabel?: string
): Promise<void> {
  const seen = new Set<string>();
  for (const id of userIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    await sendResourceEvent(ctx, id, cuid, resource, action, resourceUId, errorLabel);
  }
}

// ── Payment notice helpers ──────────────────────────────────────────────────

const TENANT_PROFILE_POPULATE = {
  path: 'profile',
  select: 'personalInfo.firstName personalInfo.lastName',
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  security_deposit: 'Security deposit',
  deposit_refund: 'Deposit refund',
  maintenance: 'Maintenance',
  late_fee: 'Late fee',
  rent: 'Rent',
};

export interface ITenantRecipient {
  email: string | null;
  uid: string | null;
  firstName: string;
  userId: string;
}

export interface IPayeeDetails {
  address: string;
  phone: string;
  email: string;
  name: string;
}

const toTenantRecipient = (user: any, profile: any): ITenantRecipient => ({
  userId: user._id.toString(),
  uid: user.uid ?? null,
  email: user.email ?? null,
  firstName:
    profile?.personalInfo?.firstName ||
    user.profile?.personalInfo?.firstName ||
    user.fullname ||
    user.email ||
    '',
});

/**
 * Payment events carry the tenant as either a User _id or a Profile _id (payment.tenant
 * references Profile). Resolves both to the User so notices reach a real account.
 * Returns null when the id matches neither.
 */
export async function resolveTenantRecipient(
  ctx: INotificationContext,
  tenantId: string | null | undefined
): Promise<ITenantRecipient | null> {
  if (!tenantId || !Types.ObjectId.isValid(tenantId)) return null;
  const id = new Types.ObjectId(tenantId);

  try {
    const user = await ctx.userDAO.findFirst(
      { _id: id, deletedAt: null },
      { populate: TENANT_PROFILE_POPULATE }
    );
    if (user) return toTenantRecipient(user, (user as any).profile);

    const profile: any = await ctx.profileDAO?.findFirst({ _id: id });
    const profileUserId = profile?.user?._id ?? profile?.user;
    if (!profileUserId) return null;

    const profileUser = await ctx.userDAO.findFirst({
      _id: new Types.ObjectId(profileUserId.toString()),
      deletedAt: null,
    });
    return profileUser ? toTenantRecipient(profileUser, profile) : null;
  } catch (error) {
    ctx.log.error({ error, tenantId }, 'Failed to resolve tenant recipient');
    return null;
  }
}

/**
 * Currency for a money notice: the payload's, else the payment record's, else the
 * client's default, else USD.
 */
export async function resolveNoticeCurrency(
  ctx: INotificationContext,
  params: { currency?: string | null; pytuid?: string; cuid: string; payment?: any }
): Promise<string> {
  if (params.currency) return params.currency.toUpperCase();

  const payment = params.payment ?? (await findPaymentForNotice(ctx, params.pytuid, params.cuid));
  if (payment?.currency) return String(payment.currency).toUpperCase();

  try {
    const client = await ctx.clientDAO?.getClientByCuid(params.cuid);
    const defaultCurrency = client?.settings?.defaultCurrency;
    if (defaultCurrency) return defaultCurrency.toUpperCase();
  } catch (error) {
    ctx.log.error({ error, cuid: params.cuid }, 'Failed to load client default currency');
  }
  return 'USD';
}

/** The payment record behind a notice, or null when it can't be read. */
export async function findPaymentForNotice(
  ctx: INotificationContext,
  pytuid: string | undefined,
  cuid: string
): Promise<any | null> {
  if (!pytuid || !ctx.paymentDAO) return null;
  try {
    return await ctx.paymentDAO.findFirst({ pytuid, cuid });
  } catch (error) {
    ctx.log.error({ error, pytuid, cuid }, 'Failed to load payment for notice');
    return null;
  }
}

export const formatNoticeAmount = (cents: number | null | undefined, currency: string): string =>
  MoneyUtils.formatCurrency(cents ?? 0, currency.toUpperCase());

/** All payment notices show dates the same way, e.g. "Oct 7, 2026". */
export const formatNoticeDate = (date: Date | string | null | undefined): string =>
  date && dayjs(date).isValid() ? dayjs(date).format('MMM D, YYYY') : '';

export const getPaymentTypeLabel = (paymentType: string | null | undefined): string =>
  (paymentType && PAYMENT_TYPE_LABELS[paymentType]) || 'Payment';

/** Name and contact details of the client collecting the payment (PAD Rule H1). */
export async function getPayeeDetails(
  ctx: INotificationContext,
  cuid: string
): Promise<IPayeeDetails> {
  try {
    const client = await ctx.clientDAO.getClientByCuid(cuid);
    const company = client?.companyProfile;
    return {
      name:
        company?.tradingName ||
        company?.legalEntityName ||
        client?.displayName ||
        'Your Property Manager',
      address: company?.companyAddress || '',
      phone: company?.companyPhone || company?.contactInfo?.phoneNumber || '',
      email: company?.companyEmail || company?.contactInfo?.email || '',
    };
  } catch (error) {
    ctx.log.error({ error, cuid }, 'Failed to load payee details');
    return { name: 'Your Property Manager', address: '', phone: '', email: '' };
  }
}

/**
 * Whether the lease behind a payment pays by automatic bank/card debit. Unknown (no lease,
 * lookup failure) counts as not auto-debit, so nobody is promised a charge that won't happen.
 */
export async function isAutoDebitPayment(
  ctx: INotificationContext,
  params: { acceptedPaymentMethod?: string; payment?: any }
): Promise<boolean> {
  if (params.acceptedPaymentMethod) return params.acceptedPaymentMethod === 'auto-debit';

  const leaseId = params.payment?.lease?._id ?? params.payment?.lease;
  if (!leaseId || !ctx.leaseDAO) return false;
  try {
    const lease: any = await ctx.leaseDAO.findFirst({
      _id: new Types.ObjectId(leaseId.toString()),
    });
    return lease?.fees?.acceptedPaymentMethod === 'auto-debit';
  } catch (error) {
    ctx.log.error({ error, leaseId }, 'Failed to load lease payment method');
    return false;
  }
}

/** Link to the tenant's payments page (or one payment), or '' when the frontend URL is unset. */
export function buildTenantPaymentsUrl(
  cuid: string,
  tenant: ITenantRecipient,
  pytuid?: string
): string {
  const frontendUrl = envVariables.FRONTEND?.URL;
  if (!frontendUrl || !tenant.uid) return '';
  const base = `${frontendUrl}/tenants/${cuid}/${tenant.uid}/payments`;
  return pytuid ? `${base}/${pytuid}` : base;
}
