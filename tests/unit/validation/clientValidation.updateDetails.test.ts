import { describe, expect, it } from '@jest/globals';
import { UpdateClientDetailsSchema } from '@shared/validations/ClientValidation/schemas';

describe('UpdateClientDetailsSchema', () => {
  describe('settings fields', () => {
    it('keeps requireDepositRefundApproval (PaymentTab toggle payload)', () => {
      const result = UpdateClientDetailsSchema.safeParse({
        settings: { requireDepositRefundApproval: true },
      });

      expect(result.success).toBe(true);
      expect(result.data?.settings).toEqual({ requireDepositRefundApproval: true });
    });

    it('keeps defaultCurrency and normalises it to upper case', () => {
      const result = UpdateClientDetailsSchema.safeParse({
        settings: { defaultCurrency: 'cad', timeZone: 'America/Toronto' },
      });

      expect(result.success).toBe(true);
      expect(result.data?.settings).toEqual({
        defaultCurrency: 'CAD',
        timeZone: 'America/Toronto',
      });
    });

    it('rejects an unsupported currency code', () => {
      const result = UpdateClientDetailsSchema.safeParse({
        settings: { defaultCurrency: 'XYZ' },
      });

      expect(result.success).toBe(false);
    });

    it('keeps every settings field sent by the account-settings form', () => {
      const settings = {
        notificationPreferences: { email: true, sms: false, inApp: true },
        timeZone: 'America/Toronto',
        lang: 'en',
        vendorPayoutMode: 'express' as const,
        tenantFeatures: { tenantPortalActive: true, guestPass: false },
        defaultCurrency: 'EUR',
        requireDepositRefundApproval: false,
      };

      const result = UpdateClientDetailsSchema.safeParse({ settings });

      expect(result.success).toBe(true);
      expect(result.data?.settings).toEqual(settings);
    });
  });

  describe('companyProfile fields', () => {
    it('keeps companyProfile.logo', () => {
      const result = UpdateClientDetailsSchema.safeParse({
        companyProfile: { logo: 'https://cdn.example.com/logo.png', tradingName: 'Acme' },
      });

      expect(result.success).toBe(true);
      expect(result.data?.companyProfile).toEqual({
        logo: 'https://cdn.example.com/logo.png',
        tradingName: 'Acme',
      });
    });
  });

  describe('at least one field refine', () => {
    it.each([
      ['an empty body', {}],
      ['an empty settings object', { settings: {} }],
      ['an empty nested settings object', { settings: { tenantFeatures: {} } }],
      ['an empty companyProfile object', { companyProfile: { contactInfo: {} } }],
      ['only undeclared keys (stripped)', { status: 'invalid-status' }],
      ['only undeclared nested keys (stripped)', { settings: { unknownFlag: true } }],
    ])('rejects %s', (_label, body) => {
      const result = UpdateClientDetailsSchema.safeParse(body);

      expect(result.success).toBe(false);
      expect(result.error?.errors[0]?.message).toBe(
        'At least one field must be provided for update'
      );
    });

    it('rejects a malformed settings value', () => {
      const result = UpdateClientDetailsSchema.safeParse({ settings: 'not-an-object' });

      expect(result.success).toBe(false);
    });

    it('accepts a false boolean leaf as a real update', () => {
      const result = UpdateClientDetailsSchema.safeParse({
        settings: { requireDepositRefundApproval: false },
      });

      expect(result.success).toBe(true);
    });
  });
});
