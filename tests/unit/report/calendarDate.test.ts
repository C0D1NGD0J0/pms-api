import { calendarDate } from '@shared/validations/UtilsValidation';

const schema = calendarDate();

describe('calendarDate validator (dayjs)', () => {
  describe('valid dates', () => {
    it('should accept ISO date string', () => {
      const result = schema.safeParse('2026-08-15');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBeInstanceOf(Date);
    });

    it('should accept ISO datetime string', () => {
      const result = schema.safeParse('2026-08-15T10:30:00Z');
      expect(result.success).toBe(true);
    });

    it('should accept Date object', () => {
      const result = schema.safeParse(new Date('2026-08-15'));
      expect(result.success).toBe(true);
    });

    it('should accept leap year Feb 29', () => {
      const result = schema.safeParse('2028-02-29');
      expect(result.success).toBe(true);
    });

    it('should transform string to Date object', () => {
      const result = schema.safeParse('2026-03-15');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeInstanceOf(Date);
        expect(result.data.getUTCFullYear()).toBe(2026);
      }
    });
  });

  describe('invalid dates', () => {
    it('should reject Feb 30 (impossible date)', () => {
      const result = schema.safeParse('2026-02-30');
      expect(result.success).toBe(false);
    });

    it('should reject Feb 29 on non-leap year', () => {
      const result = schema.safeParse('2025-02-29');
      expect(result.success).toBe(false);
    });

    it('should reject Jan 32', () => {
      const result = schema.safeParse('2026-01-32');
      expect(result.success).toBe(false);
    });

    it('should reject month 13', () => {
      const result = schema.safeParse('2026-13-01');
      expect(result.success).toBe(false);
    });

    it('should reject garbage string', () => {
      const result = schema.safeParse('not-a-date');
      expect(result.success).toBe(false);
    });

    it('should reject empty string', () => {
      const result = schema.safeParse('');
      expect(result.success).toBe(false);
    });

    it('should reject invalid Date object', () => {
      const result = schema.safeParse(new Date('invalid'));
      expect(result.success).toBe(false);
    });
  });

  // A date-only string must mean the same calendar day in every server time zone. East of
  // UTC, local midnight is still the previous day in UTC, which used to reject valid dates.
  describe.each(['Asia/Tokyo', 'America/Toronto'])('in the %s time zone', (timeZone) => {
    const originalTimeZone = process.env.TZ;

    beforeAll(() => {
      process.env.TZ = timeZone;
    });

    afterAll(() => {
      // Assigning undefined would store the string "undefined", so remove the variable instead
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    });

    it('accepts a date-only string and keeps its calendar day', () => {
      const result = schema.safeParse('2026-08-15');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.toISOString().startsWith('2026-08-15')).toBe(true);
    });

    it('accepts the first day of a year', () => {
      expect(schema.safeParse('2027-01-01').success).toBe(true);
    });

    it('still rejects impossible dates', () => {
      expect(schema.safeParse('2026-02-30').success).toBe(false);
      expect(schema.safeParse('2025-02-29').success).toBe(false);
    });
  });

  describe('custom error message', () => {
    it('should use provided error message', () => {
      const customSchema = calendarDate('Move-in date is invalid');
      const result = customSchema.safeParse('2026-02-30');
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages).toContain('Move-in date is invalid');
      }
    });
  });
});
