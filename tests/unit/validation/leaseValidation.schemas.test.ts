import {
  LeaseStatsQuerySchema,
  SignatureActionSchema,
  TerminateLeaseSchema,
  ActivateLeaseSchema,
  InternalNoteSchema,
  CreateLeaseSchema,
  UpdateLeaseSchema,
  RenewLeaseSchema,
} from '@shared/validations/LeaseValidation/schemas';

jest.mock('@di/setup', () => ({
  container: { cradle: {} },
}));

const baseCreatePayload = {
  tenantInfo: {
    uid: null,
    email: 'new.tenant@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
  },
  property: { pid: 'PROPERTY0001', puid: 'UNIT00000001' },
  duration: { startDate: '2026-01-01', endDate: '2026-12-31', moveInDate: '2026-01-01' },
  fees: { rentAmount: 1500, currency: 'CAD', rentDueDay: 1, securityDeposit: 1500 },
  type: 'fixed_term',
};

// Shape returned by GET /leases/:cuid/:luid/lease_renewal and submitted back unchanged by the UI
const renewalFormPayload = {
  property: { pid: 'PROPERTY0001', puid: '', address: '1 Main St', managedBy: 'MANAGER00001' },
  tenantInfo: { uid: 'TENANT000001' },
  tenant: { fullname: 'Ada Lovelace' },
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

    it('identifies the property, unit, manager and tenant by public ids only', async () => {
      const result = await CreateLeaseSchema.parseAsync({
        ...baseCreatePayload,
        tenantInfo: { uid: 'TENANT000001' },
        property: { pid: 'PROPERTY0001', puid: '', managedBy: 'MANAGER00001', id: 'x' },
      });

      expect(result.tenantInfo).toEqual({ uid: 'TENANT000001' });
      // a blank unit means none; the legacy ObjectId field is stripped
      expect(result.property).toEqual({ pid: 'PROPERTY0001', managedBy: 'MANAGER00001' });
    });

    it.each([
      ['an ObjectId property ref', { property: { id: '507f1f77bcf86cd799439011' } }],
      ['an ObjectId tenant id', { tenantInfo: { uid: '507f1f77bcf86cd799439013' } }],
      [
        'an ObjectId manager',
        { property: { pid: 'PROPERTY0001', managedBy: '507f1f77bcf86cd7994390' } },
      ],
    ])('rejects %s', async (_label, override) => {
      const result = await CreateLeaseSchema.safeParseAsync({ ...baseCreatePayload, ...override });

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

    it('strips lifecycle-managed fields so status/signature only change via lease actions', async () => {
      const result = await UpdateLeaseSchema.parseAsync({
        status: 'active',
        eSignature: { status: 'signed', envelopeId: 'forged-envelope' },
        signedDate: new Date().toISOString(),
        approvalStatus: 'approved',
        signatures: [{ signatureMethod: 'manual' }],
        internalNotes: [{ note: 'Checked', author: 'Admin', authorId: 'ADMIN0000001' }],
      });

      expect(result).toEqual({
        internalNotes: [{ note: 'Checked', author: 'Admin', authorId: 'ADMIN0000001' }],
      });
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
      for (const field of ['status', 'tenant', 'leaseNumber', 'signingMethod']) {
        expect(result).not.toHaveProperty(field);
      }
    });

    it('names the property, unit, manager and tenant by public ids only', async () => {
      const result = await RenewLeaseSchema.parseAsync({
        ...renewalFormPayload,
        property: { ...renewalFormPayload.property, id: '507f1f77bcf86cd799439011' },
      });

      // a blank unit means none; the address and the legacy ObjectId field are stripped
      expect(result.property).toEqual({ pid: 'PROPERTY0001', managedBy: 'MANAGER00001' });
      expect(result.tenantInfo).toEqual({ uid: 'TENANT000001' });
    });

    it.each([
      ['an ObjectId property', { property: { pid: '507f1f77bcf86cd799439011' } }],
      ['an ObjectId unit', { property: { puid: '507f1f77bcf86cd799439012' } }],
      ['an ObjectId manager', { property: { managedBy: '507f1f77bcf86cd799439014' } }],
      ['an ObjectId tenant', { tenantInfo: { uid: '507f1f77bcf86cd799439013' } }],
    ])('rejects %s', async (_label, override) => {
      const result = await RenewLeaseSchema.safeParseAsync({ ...renewalFormPayload, ...override });

      expect(result.success).toBe(false);
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

  describe('InternalNoteSchema', () => {
    const note = { note: 'Called the tenant', author: 'Pat Manager' };

    it("names the author by user uid, or not at all for the current user's new note", async () => {
      expect(
        (await InternalNoteSchema.parseAsync({ ...note, authorId: 'MANAGER00001' })).authorId
      ).toBe('MANAGER00001');
      expect(
        (await InternalNoteSchema.parseAsync({ ...note, authorId: '' })).authorId
      ).toBeUndefined();
    });

    it('rejects an ObjectId author', async () => {
      const result = await InternalNoteSchema.safeParseAsync({
        ...note,
        authorId: '507f1f77bcf86cd799439011',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('LeaseStatsQuerySchema', () => {
    it('filters by the property pid, not its ObjectId', async () => {
      expect((await LeaseStatsQuerySchema.parseAsync({ pid: 'PROPERTY0001' })).pid).toBe(
        'PROPERTY0001'
      );
      expect(
        (await LeaseStatsQuerySchema.safeParseAsync({ pid: '507f1f77bcf86cd799439011' })).success
      ).toBe(false);
      expect(
        await LeaseStatsQuerySchema.parseAsync({ propertyId: '507f1f77bcf86cd799439011' })
      ).toEqual({});
    });
  });

  describe('SignatureActionSchema', () => {
    it('accepts send and cancel', async () => {
      expect(await SignatureActionSchema.parseAsync({ action: 'send' })).toEqual({
        action: 'send',
      });
      expect(await SignatureActionSchema.parseAsync({ action: 'cancel' })).toEqual({
        action: 'cancel',
      });
    });

    it('rejects manual signing (it goes through the activate endpoint)', async () => {
      const result = await SignatureActionSchema.safeParseAsync({ action: 'manual' });

      expect(result.success).toBe(false);
    });
  });

  describe('ActivateLeaseSchema', () => {
    const today = () => new Date().toISOString().split('T')[0];
    const daysFromToday = (days: number) =>
      new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    it('keeps signedBy (sent as a JSON string in multipart, parsed before validation)', async () => {
      const signedBy = [
        { name: 'Ada Lovelace', email: 'ada@example.com', role: 'tenant' },
        { name: 'Pat Landlord', email: 'pat@example.com', role: 'landlord' },
      ];

      const result = await ActivateLeaseSchema.parseAsync({ signedDate: today(), signedBy });

      expect(result.signedBy).toEqual(signedBy);
      expect(result.signedDate).toBeInstanceOf(Date);
    });

    it('requires signedDate and rejects a future one', async () => {
      expect((await ActivateLeaseSchema.safeParseAsync({})).success).toBe(false);
      const future = await ActivateLeaseSchema.safeParseAsync({ signedDate: daysFromToday(2) });
      expect(future.success).toBe(false);
      expect(future.error?.issues[0].message).toBe('Signed date cannot be in the future');
    });

    it('treats blank multipart fields as not set', async () => {
      const result = await ActivateLeaseSchema.parseAsync({
        signedDate: today(),
        moveInDate: '',
        notes: '',
      });

      expect(result.moveInDate).toBeUndefined();
      expect(result.notes).toBeUndefined();
    });

    it('rejects signers with an unknown role and long notes', async () => {
      const badSigner = await ActivateLeaseSchema.safeParseAsync({
        signedDate: today(),
        signedBy: [{ name: 'Ada', email: 'ada@example.com', role: 'owner' }],
      });
      const longNotes = await ActivateLeaseSchema.safeParseAsync({
        signedDate: today(),
        notes: 'x'.repeat(501),
      });

      expect(badSigner.success).toBe(false);
      expect(longNotes.success).toBe(false);
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

    it('accepts a structured reasonCode alongside the free-text reason', async () => {
      const result = await TerminateLeaseSchema.parseAsync({
        terminationDate: '2026-06-30',
        terminationReason: 'Fire made the unit uninhabitable',
        reasonCode: 'emergency',
      });

      expect(result.reasonCode).toBe('emergency');
    });

    it('rejects an unknown reasonCode', async () => {
      const result = await TerminateLeaseSchema.safeParseAsync({
        terminationDate: '2026-06-30',
        terminationReason: 'Fire made the unit uninhabitable',
        reasonCode: 'tenant_annoying',
      });

      expect(result.success).toBe(false);
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
