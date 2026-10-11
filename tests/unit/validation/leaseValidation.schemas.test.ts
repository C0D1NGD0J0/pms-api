import {
  SignatureActionSchema,
  TerminateLeaseSchema,
  CreateLeaseSchema,
  UpdateLeaseSchema,
  RenewLeaseSchema,
} from '@shared/validations/LeaseValidation/schemas';

jest.mock('@di/setup', () => ({
  container: { cradle: {} },
}));

const baseCreatePayload = {
  tenantInfo: { id: null, email: 'new.tenant@example.com', firstName: 'Ada', lastName: 'Lovelace' },
  property: { id: '507f1f77bcf86cd799439011', unitId: '507f1f77bcf86cd799439012' },
  duration: { startDate: '2026-01-01', endDate: '2026-12-31', moveInDate: '2026-01-01' },
  fees: { rentAmount: 1500, currency: 'CAD', rentDueDay: 1, securityDeposit: 1500 },
  type: 'fixed_term',
};

// Shape returned by GET /leases/:cuid/:luid/lease_renewal and submitted back unchanged by the UI
const renewalFormPayload = {
  property: { id: '507f1f77bcf86cd799439011', unitId: '', address: '1 Main St' },
  tenant: { id: '507f1f77bcf86cd799439013', fullname: 'Ada Lovelace' },
  duration: { startDate: '2027-01-01', endDate: '2027-12-31', moveInDate: '2027-01-01' },
  fees: {
    rentAmount: 1600,
    currency: 'CAD',
    rentDueDay: 5,
    securityDeposit: 1500,
    lateFeeAmount: 50,
    lateFeeDays: 5,
    lateFeeType: 'fixed',
    acceptedPaymentMethod: 'e-transfer',
  },
  type: 'fixed_term',
  signingMethod: 'electronic',
  renewalOptions: { autoRenew: true, renewalTermMonths: 12, noticePeriodDays: 30 },
  status: 'active',
  petPolicy: { allowed: true, types: ['cat'], maxPets: 2, deposit: 200, monthlyFee: 25 },
  utilitiesIncluded: ['water', 'heating'],
  legalTerms: { text: 'No smoking' },
  coTenants: [{ name: 'Charles Babbage', email: 'charles@example.com', phone: '4165551234' }],
  templateType: 'residential-apartment',
  leaseNumber: 'L-2026-001',
  internalNotes: 'Tenant asked for a longer term',
};

describe('LeaseValidation schemas — fields kept after strict parsing', () => {
  describe('CreateLeaseSchema', () => {
    it('keeps tenantInfo.firstName/lastName needed to invite a new tenant by email', async () => {
      const result = await CreateLeaseSchema.parseAsync(baseCreatePayload);

      expect(result.tenantInfo).toEqual({
        id: null,
        email: 'new.tenant@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });
    });

    it('keeps templateType and the lease option flags', async () => {
      const result = await CreateLeaseSchema.parseAsync({
        ...baseCreatePayload,
        templateType: 'commercial-office',
        includeManagementFee: true,
        includeParkingInfo: true,
        generateFirstPaymentOnActivation: true,
        autoScheduleInspection: { moveIn: true, moveOut: true },
      });

      expect(result).toMatchObject({
        templateType: 'commercial-office',
        includeManagementFee: true,
        includeParkingInfo: true,
        generateFirstPaymentOnActivation: true,
        autoScheduleInspection: { moveIn: true, moveOut: true },
      });
    });

    it("accepts the model's 'generic' template and treats '' as not selected", async () => {
      const generic = await CreateLeaseSchema.parseAsync({
        ...baseCreatePayload,
        templateType: 'generic',
      });
      const blank = await CreateLeaseSchema.parseAsync({ ...baseCreatePayload, templateType: '' });

      expect(generic.templateType).toBe('generic');
      expect(blank.templateType).toBeUndefined();
    });

    it('rejects an unknown templateType', async () => {
      const result = await CreateLeaseSchema.safeParseAsync({
        ...baseCreatePayload,
        templateType: 'castle',
      });

      expect(result.success).toBe(false);
    });

    it('still strips undeclared keys (mass-assignment guard)', async () => {
      const result = await CreateLeaseSchema.parseAsync({
        ...baseCreatePayload,
        status: 'active',
        approvalStatus: 'approved',
        tenantId: '507f1f77bcf86cd799439099',
      });

      expect(result).not.toHaveProperty('status');
      expect(result).not.toHaveProperty('approvalStatus');
      expect(result).not.toHaveProperty('tenantId');
    });
  });

  describe('UpdateLeaseSchema', () => {
    it.each([
      ['includeManagementFee', true],
      ['includeParkingInfo', false],
      ['generateFirstPaymentOnActivation', true],
      ['autoScheduleInspection', { moveIn: false, moveOut: true }],
      ['templateType', 'residential-apartment'],
    ])('keeps %s when it is the only change', async (field, value) => {
      const result = await UpdateLeaseSchema.parseAsync({ [field]: value });

      expect(result).toEqual({ [field]: value });
    });
  });

  describe('RenewLeaseSchema', () => {
    it('keeps every field the renewal service reads from the submitted form', async () => {
      const result = await RenewLeaseSchema.parseAsync(renewalFormPayload);

      expect(result.duration?.moveInDate).toBeInstanceOf(Date);
      expect(result.fees).toMatchObject({
        rentAmount: 1600,
        rentDueDay: 5,
        securityDeposit: 1500,
        acceptedPaymentMethod: 'e-transfer',
      });
      expect(result.petPolicy).toEqual({
        allowed: true,
        types: ['cat'],
        maxPets: 2,
        deposit: 200,
        monthlyFee: 25,
      });
      expect(result.renewalOptions).toMatchObject({ renewalTermMonths: 12, noticePeriodDays: 30 });
      expect(result.utilitiesIncluded).toEqual(['water', 'heating']);
      expect(result.coTenants).toHaveLength(1);
      expect(result.legalTerms).toEqual({ text: 'No smoking' });
      expect(result.internalNotes).toBe('Tenant asked for a longer term');
    });

    it('keeps money in major units (the service converts to cents)', async () => {
      const result = await RenewLeaseSchema.parseAsync({ fees: { rentAmount: '1600.50' } });

      expect(result.fees?.rentAmount).toBe(1600.5);
    });

    it('does not let a renewal change currency or other read-only lease fields', async () => {
      const result = await RenewLeaseSchema.parseAsync(renewalFormPayload);

      expect(result.fees).not.toHaveProperty('currency');
      for (const field of ['status', 'tenant', 'property', 'leaseNumber', 'signingMethod']) {
        expect(result).not.toHaveProperty(field);
      }
    });

    it("accepts the '' placeholders the renewal form data uses for unset values", async () => {
      const result = await RenewLeaseSchema.parseAsync({
        ...renewalFormPayload,
        legalTerms: '',
        fees: { ...renewalFormPayload.fees, acceptedPaymentMethod: '' },
        internalNotes: '',
      });

      expect(result.legalTerms).toBeUndefined();
      expect(result.fees?.acceptedPaymentMethod).toBeUndefined();
    });

    it('does not require auto-renew scheduling fields copied from older leases', async () => {
      const result = await RenewLeaseSchema.safeParseAsync({
        renewalOptions: { autoRenew: true, renewalTermMonths: 12 },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('SignatureActionSchema', () => {
    it('keeps signedBy for manual signing', async () => {
      const signedBy = [
        { name: 'Ada Lovelace', email: 'ada@example.com', role: 'tenant' },
        { name: 'Pat Landlord', email: 'pat@example.com', role: 'landlord' },
      ];

      const result = await SignatureActionSchema.parseAsync({ action: 'manual', signedBy });

      expect(result).toEqual({ action: 'manual', signedBy });
    });

    it('rejects signers with an unknown role', async () => {
      const result = await SignatureActionSchema.safeParseAsync({
        action: 'manual',
        signedBy: [{ name: 'Ada', email: 'ada@example.com', role: 'owner' }],
      });

      expect(result.success).toBe(false);
    });
  });

  describe('TerminateLeaseSchema', () => {
    it('accepts the payload the UI terminate modal sends', async () => {
      const result = await TerminateLeaseSchema.parseAsync({
        terminationDate: '2026-06-30',
        terminationReason: 'Tenant relocating for work',
        notes: 'Keys returned',
      });

      expect(result.terminationReason).toBe('Tenant relocating for work');
    });

    it('rejects the legacy `reason` field name', async () => {
      const result = await TerminateLeaseSchema.safeParseAsync({
        terminationDate: '2026-06-30',
        reason: 'Tenant relocating for work',
      });

      expect(result.success).toBe(false);
    });
  });
});
