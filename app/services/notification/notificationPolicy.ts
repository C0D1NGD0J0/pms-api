import { MailType } from '@interfaces/utils.interface';
import { EmployeeDepartment } from '@interfaces/profile.interface';
import { IUserRoleType, ROLES } from '@shared/constants/roles.constants';
import {
  NOTIFICATION_CATEGORIES,
  INotificationSettings,
  NotificationCategory,
  NotificationTypeEnum,
} from '@interfaces/notification.interface';

/**
 * Single source of truth for who can control which notifications.
 *
 * - Channels (email, in-app, sms, push) are available to everyone.
 * - Categories are offered per role (and, for staff, per department) and apply to
 *   every channel.
 * - Required notifications (security/account, money owed or failed, legal lease
 *   notices…) ignore preferences entirely.
 */

export { NOTIFICATION_CATEGORIES };
export type { NotificationCategory };

/** Defaults for new profiles (and the fallback when a profile has none). */
export const DEFAULT_NOTIFICATION_SETTINGS: INotificationSettings = {
  emailNotifications: true,
  inAppNotifications: true,
  smsNotifications: false,
  pushNotifications: false,
  propertyUpdates: true,
  announcements: true,
  maintenance: true,
  guestPasses: true,
  approvals: true,
  payments: true,
  leases: true,
};

export type NotificationChannel = 'email' | 'inApp' | 'sms' | 'push';

const ALL_CATEGORIES: NotificationCategory[] = [...NOTIFICATION_CATEGORIES];

const STAFF_BASE_CATEGORIES: NotificationCategory[] = [
  'maintenance',
  'propertyUpdates',
  'announcements',
];

const STAFF_DEPARTMENT_CATEGORIES: Partial<Record<string, NotificationCategory[]>> = {
  [EmployeeDepartment.ACCOUNTING]: ['payments'],
  [EmployeeDepartment.SECURITY]: ['guestPasses'],
  [EmployeeDepartment.OPERATIONS]: ['payments', 'leases'],
  [EmployeeDepartment.MANAGEMENT]: ['payments', 'leases', 'approvals'],
};

const ROLE_CATEGORIES: Partial<Record<IUserRoleType, NotificationCategory[]>> = {
  [ROLES.TENANT]: ['payments', 'maintenance', 'leases', 'guestPasses', 'announcements'],
  [ROLES.VENDOR]: ['payments', 'maintenance', 'announcements'],
  [ROLES.MANAGER]: ALL_CATEGORIES,
  [ROLES.ADMIN]: ALL_CATEGORIES,
  [ROLES.SUPER_ADMIN]: ALL_CATEGORIES,
  [ROLES.ROOT_ADMIN]: ALL_CATEGORIES,
};

/** Categories a user can switch on/off, in display order. */
export function getCategoriesForRole(
  role: IUserRoleType | string | undefined,
  department?: string | null
): NotificationCategory[] {
  if (role === ROLES.STAFF) {
    const extras = (department && STAFF_DEPARTMENT_CATEGORIES[department]) || [];
    return ALL_CATEGORIES.filter(
      (category) => STAFF_BASE_CATEGORIES.includes(category) || extras.includes(category)
    );
  }
  return ROLE_CATEGORIES[role as IUserRoleType] ?? ['announcements'];
}

/** In-app/push notification type → preference category (null = not user-controllable). */
const TYPE_CATEGORY: Record<NotificationTypeEnum, NotificationCategory | null> = {
  [NotificationTypeEnum.ANNOUNCEMENT]: 'announcements',
  [NotificationTypeEnum.MAINTENANCE]: 'maintenance',
  [NotificationTypeEnum.INSPECTION]: 'maintenance',
  [NotificationTypeEnum.PAYMENT]: 'payments',
  [NotificationTypeEnum.LEASE]: 'leases',
  [NotificationTypeEnum.PROPERTY]: 'propertyUpdates',
  [NotificationTypeEnum.GUESTPASS]: 'guestPasses',
  [NotificationTypeEnum.TASK]: 'approvals',
  [NotificationTypeEnum.SYSTEM]: null,
  [NotificationTypeEnum.SUCCESS]: null,
  [NotificationTypeEnum.MESSAGE]: null,
  [NotificationTypeEnum.COMMENT]: null,
  [NotificationTypeEnum.ERROR]: null,
  [NotificationTypeEnum.USER]: null,
  [NotificationTypeEnum.INFO]: null,
};

interface MailPolicy {
  category: NotificationCategory | null;
  required: boolean;
}

export function getCategoryForType(type: NotificationTypeEnum): NotificationCategory | null {
  return TYPE_CATEGORY[type] ?? null;
}

const required = (category: NotificationCategory | null = null): MailPolicy => ({
  category,
  required: true,
});
const optional = (category: NotificationCategory): MailPolicy => ({ category, required: false });

/** Every email the platform sends, with its category and whether it can be switched off. */
export const MAIL_POLICY: Record<MailType, MailPolicy> = {
  // Account & security — always sent
  [MailType.ACCOUNT_ACTIVATION]: required(),
  [MailType.FORGOT_PASSWORD]: required(),
  [MailType.PASSWORD_RESET]: required(),
  [MailType.INVITATION]: required(),
  [MailType.INVITATION_REMINDER]: required(),
  [MailType.ACCOUNT_DISCONNECTED]: required(),
  [MailType.ACCOUNT_UPDATE]: required(),
  [MailType.USER_CREATED]: required(),
  [MailType.COMPANY_CLOSURE_OWNER]: required(),
  [MailType.COMPANY_CLOSURE_STAFF]: required(),
  [MailType.COMPANY_CLOSURE_TENANT]: required(),
  [MailType.COMPANY_CLOSURE_VENDOR]: required(),
  // Owner billing — always sent
  [MailType.SUBSCRIPTION_RENEWAL_UPCOMING]: required('payments'),
  [MailType.SUBSCRIPTION_RENEWAL_RECEIPT]: required('payments'),
  [MailType.SUBSCRIPTION_UPDATED]: required('payments'),
  [MailType.SUBSCRIPTION_CANCELED]: required('payments'),
  // Money owed / paid by a tenant — always sent (PAD notices are regulatory)
  [MailType.PAYMENT_FAILED]: required('payments'),
  [MailType.PAYMENT_RECEIPT]: required('payments'),
  [MailType.PAYMENT_REQUEST_CREATED]: required('payments'),
  [MailType.LEASE_PAYMENT_REMINDER]: required('payments'),
  [MailType.PAD_MANDATE_CONFIRMATION]: required('payments'),
  [MailType.PAD_PRE_DEBIT_NOTIFICATION]: required('payments'),
  [MailType.MAINTENANCE_CHARGE_CREATED]: required('payments'),
  [MailType.MAINTENANCE_VENDOR_PAID]: optional('payments'),
  // Lease legal notices — always sent
  [MailType.LEASE_ACTIVATED]: required('leases'),
  [MailType.LEASE_TERMINATED]: required('leases'),
  [MailType.LEASE_EXPIRED]: required('leases'),
  [MailType.LEASE_ENDING_SOON]: required('leases'),
  [MailType.LEASE_ADMIN_UPDATED]: required('leases'),
  // Maintenance & inspections
  [MailType.MAINTENANCE_REQUEST_CREATED]: optional('maintenance'),
  [MailType.MAINTENANCE_REQUEST_ASSIGNED]: optional('maintenance'),
  [MailType.MAINTENANCE_REQUEST_ACCEPTED]: optional('maintenance'),
  [MailType.MAINTENANCE_REQUEST_DECLINED]: optional('maintenance'),
  [MailType.MAINTENANCE_REQUEST_COMPLETED]: optional('maintenance'),
  [MailType.MAINTENANCE_INVOICE_SUBMITTED]: optional('maintenance'),
  [MailType.MAINTENANCE_INVOICE_APPROVED]: optional('maintenance'),
  [MailType.MAINTENANCE_INVOICE_REJECTED]: optional('maintenance'),
  [MailType.MAINTENANCE_WORK_ORDER_SUBMITTED]: optional('maintenance'),
  [MailType.MAINTENANCE_WORK_ORDER_APPROVED]: optional('maintenance'),
  [MailType.MAINTENANCE_WORK_ORDER_REJECTED]: optional('maintenance'),
  // Tenant is told a vendor will enter their unit — entry notice
  [MailType.MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT]: required('maintenance'),
  [MailType.INSPECTION_SCHEDULED]: required('maintenance'),
  [MailType.INSPECTION_APPROVED]: optional('maintenance'),
  [MailType.INSPECTION_REJECTED]: optional('maintenance'),
  [MailType.INSPECTION_CANCELLED]: optional('maintenance'),
  [MailType.INSPECTION_SUBMITTED]: optional('maintenance'),
  // Not user notifications (external recipients / explicit requests)
  [MailType.GUEST_PASS_CODE]: required(),
  [MailType.REPORT_READY]: required(),
  [MailType.USER_FEEDBACK]: required(),
};

type ChannelPrefs = Partial<
  Pick<
    INotificationSettings,
    'emailNotifications' | 'inAppNotifications' | 'smsNotifications' | 'pushNotifications'
  >
> &
  Partial<Record<NotificationCategory, boolean>>;

export function getMailPolicy(emailType: string | undefined): MailPolicy {
  return MAIL_POLICY[emailType as MailType] ?? required();
}

const CHANNEL_ENABLED: Record<NotificationChannel, (prefs: ChannelPrefs) => boolean> = {
  email: (prefs) => prefs.emailNotifications !== false,
  inApp: (prefs) => prefs.inAppNotifications !== false,
  // Opt-in channels
  sms: (prefs) => prefs.smsNotifications === true,
  push: (prefs) => prefs.pushNotifications === true,
};

const CHANNEL_KEYS = [
  'emailNotifications',
  'inAppNotifications',
  'smsNotifications',
  'pushNotifications',
];

/**
 * Cleans a (partial) preference update for a user:
 * - drops categories their role/department isn't offered,
 * - rejects turning off both email and in-app (checked against the saved values).
 * Returns the cleaned update, or an error message.
 */
export function sanitizeNotificationUpdate({
  update,
  current,
  role,
  department,
}: {
  update: Record<string, unknown>;
  current: Partial<INotificationSettings> | null | undefined;
  role: IUserRoleType | string | undefined;
  department?: string | null;
}): { update: Partial<INotificationSettings> } | { error: string } {
  const allowedCategories = getCategoriesForRole(role, department);
  const cleaned: Record<string, boolean> = {};

  for (const [key, value] of Object.entries(update)) {
    if (typeof value !== 'boolean') continue;
    const isChannel = CHANNEL_KEYS.includes(key);
    const isAllowedCategory = allowedCategories.includes(key as NotificationCategory);
    if (isChannel || isAllowedCategory) cleaned[key] = value;
  }

  const email = cleaned.emailNotifications ?? current?.emailNotifications ?? true;
  const inApp = cleaned.inAppNotifications ?? current?.inAppNotifications ?? true;
  if (!email && !inApp) {
    return { error: 'Keep at least one of email or in-app notifications on' };
  }

  return { update: cleaned as Partial<INotificationSettings> };
}

/**
 * Whether a notification may reach a user on a channel.
 * Missing preferences mean "allow" — a lookup failure must never swallow a notice.
 */
export function shouldDeliver({
  prefs,
  channel,
  category,
  required: isRequired = false,
}: {
  prefs: ChannelPrefs | null | undefined;
  channel: NotificationChannel;
  category: NotificationCategory | null;
  required?: boolean;
}): boolean {
  if (isRequired || !prefs) return true;
  if (!CHANNEL_ENABLED[channel](prefs)) return false;
  return category ? prefs[category] !== false : true;
}

/** Categories the user has switched off (used to filter role/department announcements). */
export function getDisabledCategories(
  prefs: ChannelPrefs | null | undefined
): NotificationCategory[] {
  if (!prefs) return [];
  return NOTIFICATION_CATEGORIES.filter((category) => prefs[category] === false);
}
