// Mock the DI container for UtilsValidation async refines (cuid DB lookup)
jest.mock('@di/setup', () => ({
  container: {
    cradle: {
      clientDAO: {
        findFirst: jest.fn().mockResolvedValue({ cuid: 'valid-cuid' }),
      },
    },
  },
}));

import { ReportValidations } from '@shared/validations/ReportValidation';

describe('ReportValidations', () => {
  // ─── generateBody ─────────────────────────────────────────────────

  describe('generateBody', () => {
    it('should accept valid last_30_days request', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'last_30_days',
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid last_90_days request with sections', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'last_90_days',
        sections: ['financial_overview', 'payment_analysis'],
      });
      expect(result.success).toBe(true);
    });

    it('should accept custom period with valid dates', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'custom',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-03-31T23:59:59Z',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing period', () => {
      const result = ReportValidations.generateBody.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject invalid period value', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'weekly',
      });
      expect(result.success).toBe(false);
    });

    it('should reject custom period without dates', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'custom',
      });
      expect(result.success).toBe(false);
    });

    it('should reject custom period with only startDate', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'custom',
        startDate: '2026-01-01T00:00:00Z',
      });
      expect(result.success).toBe(false);
    });

    it('should reject startDate after endDate', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'custom',
        startDate: '2026-06-01T00:00:00Z',
        endDate: '2026-01-01T00:00:00Z',
      });
      expect(result.success).toBe(false);
    });

    it('should reject date range exceeding 1 year', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'custom',
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2026-06-01T00:00:00Z',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid section values', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'last_30_days',
        sections: ['financial_overview', 'invalid_section'],
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty sections array', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'last_30_days',
        sections: [],
      });
      expect(result.success).toBe(false);
    });

    it('should accept up to 10 email recipients', () => {
      const recipients = Array.from({ length: 10 }, (_, i) => `user${i}@test.com`);
      const result = ReportValidations.generateBody.safeParse({
        period: 'last_30_days',
        emailRecipients: recipients,
      });
      expect(result.success).toBe(true);
    });

    it('should reject more than 10 email recipients', () => {
      const recipients = Array.from({ length: 11 }, (_, i) => `user${i}@test.com`);
      const result = ReportValidations.generateBody.safeParse({
        period: 'last_30_days',
        emailRecipients: recipients,
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid email addresses', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'last_30_days',
        emailRecipients: ['not-an-email'],
      });
      expect(result.success).toBe(false);
    });

    it('should accept request with all optional fields omitted', () => {
      const result = ReportValidations.generateBody.safeParse({
        period: 'last_30_days',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sections).toBeUndefined();
        expect(result.data.emailRecipients).toBeUndefined();
        expect(result.data.propertyId).toBeUndefined();
      }
    });
  });

  // ─── scheduleBody ─────────────────────────────────────────────────

  describe('scheduleBody', () => {
    it('should accept valid monthly schedule', () => {
      const result = ReportValidations.scheduleBody.safeParse({
        frequency: 'monthly',
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid quarterly schedule with options', () => {
      const result = ReportValidations.scheduleBody.safeParse({
        frequency: 'quarterly',
        sections: ['executive_summary', 'lease_occupancy'],
        emailRecipients: ['pm@example.com'],
        isActive: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing frequency', () => {
      const result = ReportValidations.scheduleBody.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject invalid frequency', () => {
      const result = ReportValidations.scheduleBody.safeParse({
        frequency: 'weekly',
      });
      expect(result.success).toBe(false);
    });

    it('should reject more than 10 email recipients', () => {
      const recipients = Array.from({ length: 11 }, (_, i) => `user${i}@test.com`);
      const result = ReportValidations.scheduleBody.safeParse({
        frequency: 'monthly',
        emailRecipients: recipients,
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── listQuery ─────────────────────────────────────────────────────

  describe('listQuery', () => {
    it('should accept empty query (all optional)', () => {
      const result = ReportValidations.listQuery.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should coerce string page/limit to numbers', () => {
      const result = ReportValidations.listQuery.safeParse({ page: '2', limit: '25' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(25);
      }
    });

    it('should reject page less than 1', () => {
      const result = ReportValidations.listQuery.safeParse({ page: '0' });
      expect(result.success).toBe(false);
    });

    it('should reject limit exceeding 100', () => {
      const result = ReportValidations.listQuery.safeParse({ limit: '200' });
      expect(result.success).toBe(false);
    });

    it('should accept valid status filter', () => {
      const result = ReportValidations.listQuery.safeParse({ status: 'completed' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status filter', () => {
      const result = ReportValidations.listQuery.safeParse({ status: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  // ─── reportIdParam ────────────────────────────────────────────────

  describe('reportIdParam', () => {
    it('should accept valid cuid and reportId', async () => {
      const result = await ReportValidations.reportIdParam.safeParseAsync({
        cuid: 'valid-cuid',
        reportId: '507f1f77bcf86cd799439011',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing cuid', async () => {
      const result = await ReportValidations.reportIdParam.safeParseAsync({
        reportId: '507f1f77bcf86cd799439011',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid reportId format', async () => {
      const result = await ReportValidations.reportIdParam.safeParseAsync({
        cuid: 'valid-cuid',
        reportId: 'not-a-valid-objectid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty reportId', async () => {
      const result = await ReportValidations.reportIdParam.safeParseAsync({
        cuid: 'valid-cuid',
        reportId: '',
      });
      expect(result.success).toBe(false);
    });
  });
});
