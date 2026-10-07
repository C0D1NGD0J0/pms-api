import { MailType } from '@interfaces/utils.interface';
import { NotificationTypeEnum } from '@interfaces/notification.interface';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  sanitizeNotificationUpdate,
  getDisabledCategories,
  getCategoriesForRole,
  getCategoryForType,
  getMailPolicy,
  shouldDeliver,
} from '@services/notification/notificationPolicy';

describe('notificationPolicy', () => {
  describe('getCategoriesForRole', () => {
    it('gives tenants their own money, maintenance, lease, guest pass and announcement updates', () => {
      expect(getCategoriesForRole('tenant')).toEqual([
        'payments',
        'maintenance',
        'leases',
        'guestPasses',
        'announcements',
      ]);
    });

    it('gives vendors payouts, jobs and announcements only', () => {
      expect(getCategoriesForRole('vendor')).toEqual(['payments', 'maintenance', 'announcements']);
    });

    it.each(['manager', 'admin', 'super-admin'])('gives %s every category', (role) => {
      expect(getCategoriesForRole(role)).toHaveLength(7);
    });

    it.each([
      [undefined, ['maintenance', 'propertyUpdates', 'announcements']],
      ['maintenance', ['maintenance', 'propertyUpdates', 'announcements']],
      ['accounting', ['payments', 'maintenance', 'propertyUpdates', 'announcements']],
      ['security', ['maintenance', 'propertyUpdates', 'guestPasses', 'announcements']],
      ['operations', ['payments', 'maintenance', 'leases', 'propertyUpdates', 'announcements']],
      [
        'management',
        ['payments', 'maintenance', 'leases', 'propertyUpdates', 'approvals', 'announcements'],
      ],
    ])('gives staff in the %s department the right categories', (department, expected) => {
      expect(getCategoriesForRole('staff', department)).toEqual(expected);
    });
  });

  describe('shouldDeliver', () => {
    const prefs = { ...DEFAULT_NOTIFICATION_SETTINGS };

    it('always delivers required notifications, whatever the preferences', () => {
      expect(
        shouldDeliver({
          prefs: { ...prefs, emailNotifications: false, payments: false },
          channel: 'email',
          category: 'payments',
          required: true,
        })
      ).toBe(true);
    });

    it('respects a switched-off channel', () => {
      expect(
        shouldDeliver({
          prefs: { ...prefs, emailNotifications: false },
          channel: 'email',
          category: 'maintenance',
        })
      ).toBe(false);
    });

    it('applies a switched-off category to every channel', () => {
      const off = { ...prefs, maintenance: false, smsNotifications: true, pushNotifications: true };
      (['email', 'inApp', 'sms', 'push'] as const).forEach((channel) =>
        expect(shouldDeliver({ prefs: off, channel, category: 'maintenance' })).toBe(false)
      );
    });

    it('treats SMS and push as opt-in channels', () => {
      expect(shouldDeliver({ prefs, channel: 'sms', category: 'maintenance' })).toBe(false);
      expect(shouldDeliver({ prefs, channel: 'push', category: 'maintenance' })).toBe(false);
    });

    it('delivers when preferences are missing — a lookup failure must not swallow notices', () => {
      expect(shouldDeliver({ prefs: null, channel: 'email', category: 'maintenance' })).toBe(true);
    });

    it('delivers uncategorised notifications when the channel is on', () => {
      expect(shouldDeliver({ prefs, channel: 'inApp', category: null })).toBe(true);
    });
  });

  describe('email policy', () => {
    it.each([
      MailType.FORGOT_PASSWORD,
      MailType.INVITATION,
      MailType.PAYMENT_FAILED,
      MailType.PAYMENT_RECEIPT,
      MailType.PAD_PRE_DEBIT_NOTIFICATION,
      MailType.LEASE_EXPIRED,
      MailType.INSPECTION_SCHEDULED,
      MailType.SUBSCRIPTION_RENEWAL_UPCOMING,
    ])('%s is always sent', (type) => {
      expect(getMailPolicy(type).required).toBe(true);
    });

    it('lets users switch off routine maintenance emails', () => {
      expect(getMailPolicy(MailType.MAINTENANCE_REQUEST_COMPLETED)).toEqual({
        category: 'maintenance',
        required: false,
      });
    });

    it('sends unknown email types (never silently dropped)', () => {
      expect(getMailPolicy('SOMETHING_NEW').required).toBe(true);
    });
  });

  it('maps notification types to categories (system/ad-hoc types are uncategorised)', () => {
    expect(getCategoryForType(NotificationTypeEnum.INSPECTION)).toBe('maintenance');
    expect(getCategoryForType(NotificationTypeEnum.GUESTPASS)).toBe('guestPasses');
    expect(getCategoryForType(NotificationTypeEnum.TASK)).toBe('approvals');
    expect(getCategoryForType(NotificationTypeEnum.SYSTEM)).toBeNull();
  });

  it('lists the categories a user switched off', () => {
    expect(getDisabledCategories({ payments: false, maintenance: true, leases: false })).toEqual([
      'payments',
      'leases',
    ]);
    expect(getDisabledCategories(null)).toEqual([]);
  });

  describe('sanitizeNotificationUpdate', () => {
    it("drops categories the user's role isn't offered", () => {
      const result = sanitizeNotificationUpdate({
        update: { payments: false, propertyUpdates: false, approvals: false },
        current: DEFAULT_NOTIFICATION_SETTINGS,
        role: 'tenant',
      });
      expect(result).toEqual({ update: { payments: false } });
    });

    it('uses the staff department to decide', () => {
      const result = sanitizeNotificationUpdate({
        update: { guestPasses: false, payments: false },
        current: DEFAULT_NOTIFICATION_SETTINGS,
        role: 'staff',
        department: 'security',
      });
      expect(result).toEqual({ update: { guestPasses: false } });
    });

    it('rejects switching off email when in-app is already off', () => {
      const result = sanitizeNotificationUpdate({
        update: { emailNotifications: false },
        current: { ...DEFAULT_NOTIFICATION_SETTINGS, inAppNotifications: false },
        role: 'tenant',
      });
      expect(result).toHaveProperty('error');
    });

    it('ignores retired and non-boolean fields', () => {
      const result = sanitizeNotificationUpdate({
        update: { system: false, emailFrequency: 'daily', smsNotifications: true },
        current: DEFAULT_NOTIFICATION_SETTINGS,
        role: 'manager',
      });
      expect(result).toEqual({ update: { smsNotifications: true } });
    });
  });
});
