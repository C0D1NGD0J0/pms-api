import fs from 'fs';
import path from 'path';
import i18next from 'i18next';
import {
  translateNotificationText,
  getNotificationTemplate,
} from '@services/notification/notificationMessages';

const LOCALES_DIR = path.join(__dirname, '../../../app/shared/languages/locales');
const loadLocale = (lng: string): Record<string, any> =>
  JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${lng}.json`), 'utf8'));

// Every locale i18next can serve; en-nig is an overlay that falls back to en (fallbackLng).
const FULL_LOCALES = ['en', 'fr'];
const OVERLAY_LOCALES = ['en-nig'];
const locales = Object.fromEntries(
  [...FULL_LOCALES, ...OVERLAY_LOCALES].map((lng) => [lng, loadLocale(lng)])
);

const PAYMENT_NOTICE_KEYS = [
  'payment.requested',
  'payment.requestedManual',
  'payment.overdue',
  'payment.overdueTenant',
  'payment.failedTenant',
  'payment.failedTenantWithReason',
  'payment.refundedTenant',
  'payment.retriedWithCard',
  'payment.retriedWithCardTenant',
  'payment.depositRefundFailed',
  'maintenance.chargeCreated',
  'maintenance.chargeCreatedManual',
  'maintenance.chargeSkipped',
  'maintenance.autoVendorPaid',
];

const FRAGMENT_KEYS = [
  'fragments.paymentTypes.rent',
  'fragments.paymentTypes.maintenance',
  'fragments.paymentTypes.late_fee',
  'fragments.paymentTypes.security_deposit',
  'fragments.paymentTypes.deposit_refund',
  'fragments.paymentTypes.default',
  'fragments.refundKinds.partial',
  'fragments.refundKinds.full',
  'fragments.cardDescriptions.endingIn',
  'fragments.cardDescriptions.onFile',
  'fragments.chargeSkippedReasons.tenant_profile_not_found',
  'fragments.chargeSkippedReasons.no_tenant',
  'fragments.chargeSkippedReasons.default',
  'fragments.unknownError',
];

const ALL_STRING_KEYS = [
  ...PAYMENT_NOTICE_KEYS.flatMap((key) => [`${key}.title`, `${key}.message`]),
  ...FRAGMENT_KEYS,
].map((key) => `notifications.${key}`);

const lookup = (resource: Record<string, any>, dottedKey: string): unknown =>
  dottedKey.split('.').reduce<any>((node, part) => node?.[part], resource);

const interpolationVars = (text: string): string[] =>
  [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

describe('payment notification i18n keys', () => {
  describe.each(FULL_LOCALES)('%s locale', (lng) => {
    it.each(ALL_STRING_KEYS)('defines %s as a non-empty string', (key) => {
      const value = lookup(locales[lng], key);
      expect(typeof value).toBe('string');
      expect((value as string).trim()).not.toBe('');
      expect(value as string).not.toMatch(/^\[FR\]/);
    });
  });

  it.each(ALL_STRING_KEYS)('%s uses the same interpolation variables in every locale', (key) => {
    const englishVars = interpolationVars(lookup(locales.en, key) as string);
    for (const lng of FULL_LOCALES) {
      expect(interpolationVars(lookup(locales[lng], key) as string)).toEqual(englishVars);
    }
    for (const lng of OVERLAY_LOCALES) {
      const overlayValue = lookup(locales[lng], key);
      if (overlayValue !== undefined) {
        expect(interpolationVars(overlayValue as string)).toEqual(englishVars);
      }
    }
  });

  it.each(PAYMENT_NOTICE_KEYS)(
    'en.json %s matches the built-in English fallback template',
    (key) => {
      const template = getNotificationTemplate(key);
      expect(template).not.toBeNull();
      expect(lookup(locales.en, `notifications.${key}`)).toEqual({
        title: template!.title,
        message: template!.message,
      });
    }
  );

  it('renders French notices with every variable substituted', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: 'fr',
      fallbackLng: 'en',
      resources: { en: { translation: locales.en }, fr: { translation: locales.fr } },
      interpolation: { escapeValue: false },
    });

    const message = i18n.t('notifications.payment.refundedTenant.message', {
      refundKind: i18n.t('notifications.fragments.refundKinds.partial'),
      amount: '50,00 $',
      pytuid: 'PYT-1',
    });
    expect(message).toBe('Un remboursement partiel de 50,00 $ a été émis pour le paiement PYT-1.');

    const title = i18n.t('notifications.payment.overdueTenant.title', {
      paymentTitle: i18n.t('notifications.fragments.paymentTypes.security_deposit'),
    });
    expect(title).toBe('Paiement en retard : Dépôt de garantie');
  });

  it('leaves no [FR] placeholders in payment-area strings', () => {
    const paymentAreaKeys = [
      'auth.errors.unsupportedCountry',
      'auth.errors.tenantOnlyPaymentSetup',
      'auth.errors.tenantOnlyViewPaymentMethods',
      'auth.errors.tenantOnlyRemovePaymentMethods',
      'auth.errors.noPaymentMethodOnFile',
      'auth.errors.mustKeepOnePaymentMethod',
      'auth.errors.noPaymentMethodForManager',
      'auth.errors.tenantOnlyFirstPayment',
      'vendor.errors.payoutAccountNotFound',
      ...Object.keys(locales.fr.payment.errors).map((key) => `payment.errors.${key}`),
    ];
    for (const key of paymentAreaKeys) {
      const value = lookup(locales.fr, key) as string;
      expect(value).toBeDefined();
      expect(value).not.toMatch(/^\[FR\]/);
      expect(interpolationVars(value)).toEqual(
        interpolationVars(lookup(locales.en, key) as string)
      );
    }
  });
});

describe('translateNotificationText', () => {
  it('falls back to the English template, interpolated, when i18n has no translation', () => {
    expect(
      translateNotificationText('fragments.doesNotExist', 'your card ending in {{cardLast4}}', {
        cardLast4: '4242',
      })
    ).toBe('your card ending in 4242');
  });
});
