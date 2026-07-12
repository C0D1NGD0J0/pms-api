import { Types } from 'mongoose';
import { ESignatureWorker } from '@workers/esignature.worker';
import { OwnershipType } from '@interfaces/property.interface';

// ── shared IDs ──────────────────────────────────────────────────────────
const leaseId = new Types.ObjectId();
const tenantUserId = new Types.ObjectId();
const tenantProfileId = new Types.ObjectId();
const pmUserId = new Types.ObjectId();
const pmProfileId = new Types.ObjectId();
const propertyId = new Types.ObjectId();
const testCuid = 'TESTCLIENT123';
const testLuid = 'LEASE123';

// ── factory helpers ─────────────────────────────────────────────────────
const makeLease = (overrides: Record<string, any> = {}) => ({
  _id: leaseId,
  cuid: testCuid,
  luid: testLuid,
  tenantId: tenantUserId,
  property: { id: propertyId, unitId: null },
  leaseDocuments: [{ documentType: 'lease_agreement', status: 'active', key: 's3-key-test' }],
  coTenants: [],
  ...overrides,
});

const makeProperty = (
  ownerType: OwnershipType,
  opts: { isAuthorized?: boolean; ownerEmail?: string; ownerName?: string } = {}
) => ({
  _id: propertyId,
  managedBy: pmUserId,
  name: 'Test Property',
  address: { fullAddress: '123 Main St' },
  owner: {
    type: ownerType,
    name: opts.ownerName ?? 'John Landlord',
    email: opts.ownerEmail ?? 'landlord@example.com',
    phone: '555-0100',
  },
  isManagementAuthorized: jest.fn().mockReturnValue(opts.isAuthorized ?? true),
});

const makeTenantProfile = () => ({
  _id: tenantProfileId,
  personalInfo: { firstName: 'Jane', lastName: 'Tenant' },
  user: { _id: tenantUserId, email: 'tenant@example.com' },
});

const makePmProfile = () => ({
  _id: pmProfileId,
  personalInfo: { firstName: 'Mike', lastName: 'Manager' },
  user: { _id: pmUserId, email: 'pm@example.com' },
});

const makeJob = () =>
  ({
    id: 'job-1',
    data: {
      resource: {
        actorId: pmUserId.toString(),
        resourceId: leaseId.toString(),
        resourceName: 'lease',
        resourceType: 'document',
        fieldName: 'eSignature',
      },
      cuid: testCuid,
      luid: testLuid,
      leaseId: leaseId.toString(),
      senderInfo: { email: 'sender@example.com', name: 'Sender' },
    },
    progress: jest.fn(),
  }) as any;

// ── mock builders ───────────────────────────────────────────────────────
const buildMocks = (property: ReturnType<typeof makeProperty>) => {
  const leaseDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(makeLease())),
  } as any;

  const profileDAO = {
    findFirst: jest.fn().mockImplementation((_filter: any) => {
      const userId = _filter.user?.toString?.() ?? _filter.user;
      if (userId === tenantUserId.toString()) {
        return Promise.resolve(makeTenantProfile());
      }
      if (userId === pmUserId.toString()) {
        return Promise.resolve(makePmProfile());
      }
      return Promise.resolve(null);
    }),
  } as any;

  const propertyDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(property)),
  } as any;

  const boldSignService = {
    sendDocumentForSignature: jest
      .fn()
      .mockReturnValue(Promise.resolve({ documentId: 'boldsign-doc-123' })),
  } as any;

  const mediaUploadService = {
    downloadFileAsBuffer: jest.fn().mockReturnValue(Promise.resolve(Buffer.from('pdf-content'))),
  } as any;

  const emitterService = {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  } as any;

  return { leaseDAO, profileDAO, propertyDAO, boldSignService, mediaUploadService, emitterService };
};

// ── tests ───────────────────────────────────────────────────────────────
describe('ESignatureWorker — Landlord Signer Selection', () => {
  describe('company_owned property', () => {
    it('should include PM as signer (not landlord)', async () => {
      const property = makeProperty(OwnershipType.COMPANY_OWNED, { isAuthorized: true });
      const mocks = buildMocks(property);
      const worker = new ESignatureWorker(mocks);

      const result = await worker.sendForSignature(makeJob());

      expect(result.success).toBe(true);
      const signersArg = mocks.boldSignService.sendDocumentForSignature.mock.calls[0][0].signers;
      expect(signersArg).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'property_manager', email: 'pm@example.com' }),
          expect.objectContaining({ role: 'tenant', email: 'tenant@example.com' }),
        ])
      );
      expect(signersArg.find((s: any) => s.role === 'landlord')).toBeUndefined();
    });
  });

  describe('self_owned property', () => {
    it('should include PM as signer (not landlord)', async () => {
      const property = makeProperty(OwnershipType.SELF_OWNED, { isAuthorized: true });
      const mocks = buildMocks(property);
      const worker = new ESignatureWorker(mocks);

      const result = await worker.sendForSignature(makeJob());

      expect(result.success).toBe(true);
      const signersArg = mocks.boldSignService.sendDocumentForSignature.mock.calls[0][0].signers;
      expect(signersArg.find((s: any) => s.role === 'property_manager')).toBeDefined();
      expect(signersArg.find((s: any) => s.role === 'landlord')).toBeUndefined();
    });
  });

  describe('external_owner with PM authorized', () => {
    it('should include PM as signer (not landlord)', async () => {
      const property = makeProperty(OwnershipType.EXTERNAL_OWNER, { isAuthorized: true });
      const mocks = buildMocks(property);
      const worker = new ESignatureWorker(mocks);

      const result = await worker.sendForSignature(makeJob());

      expect(result.success).toBe(true);
      const signersArg = mocks.boldSignService.sendDocumentForSignature.mock.calls[0][0].signers;
      expect(signersArg.find((s: any) => s.role === 'property_manager')).toBeDefined();
      expect(signersArg.find((s: any) => s.role === 'landlord')).toBeUndefined();
    });
  });

  describe('external_owner with PM NOT authorized', () => {
    it('should include landlord as signer and exclude PM', async () => {
      const property = makeProperty(OwnershipType.EXTERNAL_OWNER, { isAuthorized: false });
      const mocks = buildMocks(property);
      const worker = new ESignatureWorker(mocks);

      const result = await worker.sendForSignature(makeJob());

      expect(result.success).toBe(true);
      const signersArg = mocks.boldSignService.sendDocumentForSignature.mock.calls[0][0].signers;
      expect(signersArg).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'landlord',
            email: 'landlord@example.com',
            name: 'John Landlord',
          }),
          expect.objectContaining({ role: 'tenant', email: 'tenant@example.com' }),
        ])
      );
      expect(signersArg.find((s: any) => s.role === 'property_manager')).toBeUndefined();
    });

    it('should not fetch PM profile when landlord signs', async () => {
      const property = makeProperty(OwnershipType.EXTERNAL_OWNER, { isAuthorized: false });
      const mocks = buildMocks(property);
      const worker = new ESignatureWorker(mocks);

      await worker.sendForSignature(makeJob());

      // profileDAO.findFirst should only be called for tenant, not for PM
      const profileCalls = mocks.profileDAO.findFirst.mock.calls;
      const pmLookup = profileCalls.find(
        (call: any) => call[0]?.user?.toString() === pmUserId.toString()
      );
      expect(pmLookup).toBeUndefined();
    });

    it('should fail with clear error when external owner has no email', async () => {
      const property = makeProperty(OwnershipType.EXTERNAL_OWNER, {
        isAuthorized: false,
        ownerEmail: undefined,
      });
      // Remove the email from the owner object
      property.owner.email = undefined as any;
      const mocks = buildMocks(property);
      const worker = new ESignatureWorker(mocks);

      const result = await worker.sendForSignature(makeJob());

      expect(result.success).toBe(false);
      expect(result.error).toContain('External owner email is required');
    });

    it('should use "Property Owner" as fallback name when owner name is missing', async () => {
      const property = makeProperty(OwnershipType.EXTERNAL_OWNER, {
        isAuthorized: false,
        ownerName: undefined,
      });
      property.owner.name = undefined as any;
      const mocks = buildMocks(property);
      const worker = new ESignatureWorker(mocks);

      const result = await worker.sendForSignature(makeJob());

      expect(result.success).toBe(true);
      const signersArg = mocks.boldSignService.sendDocumentForSignature.mock.calls[0][0].signers;
      const landlordSigner = signersArg.find((s: any) => s.role === 'landlord');
      expect(landlordSigner.name).toBe('Property Owner');
    });
  });

  describe('tenant and co-tenants always included', () => {
    it('should always include tenant regardless of ownership type', async () => {
      const property = makeProperty(OwnershipType.EXTERNAL_OWNER, { isAuthorized: false });
      const mocks = buildMocks(property);
      const worker = new ESignatureWorker(mocks);

      const result = await worker.sendForSignature(makeJob());

      expect(result.success).toBe(true);
      const signersArg = mocks.boldSignService.sendDocumentForSignature.mock.calls[0][0].signers;
      expect(signersArg.find((s: any) => s.role === 'tenant')).toBeDefined();
    });

    it('should include co-tenants when present', async () => {
      const property = makeProperty(OwnershipType.COMPANY_OWNED);
      const mocks = buildMocks(property);
      mocks.leaseDAO.findFirst.mockReturnValue(
        Promise.resolve(
          makeLease({
            coTenants: [
              { name: 'Co-Tenant 1', email: 'co1@example.com', phone: '555-1111' },
              { name: 'Co-Tenant 2', email: 'co2@example.com', phone: '555-2222' },
            ],
          })
        )
      );
      const worker = new ESignatureWorker(mocks);

      const result = await worker.sendForSignature(makeJob());

      expect(result.success).toBe(true);
      const signersArg = mocks.boldSignService.sendDocumentForSignature.mock.calls[0][0].signers;
      const coTenants = signersArg.filter((s: any) => s.role === 'co_tenant');
      expect(coTenants).toHaveLength(2);
    });
  });

  describe('error handling emits failure event', () => {
    it('should emit LEASE_ESIGNATURE_FAILED on error', async () => {
      const property = makeProperty(OwnershipType.EXTERNAL_OWNER, {
        isAuthorized: false,
        ownerEmail: undefined,
      });
      property.owner.email = undefined as any;
      const mocks = buildMocks(property);
      const worker = new ESignatureWorker(mocks);

      await worker.sendForSignature(makeJob());

      expect(mocks.emitterService.emit).toHaveBeenCalledWith(
        expect.stringContaining('esignature:failed'),
        expect.objectContaining({
          error: expect.stringContaining('External owner email is required'),
        })
      );
    });
  });
});
