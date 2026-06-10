import { Types } from 'mongoose';
import { EventTypes } from '@interfaces/events.interface';
import { ILeaseESignatureStatusEnum, LeaseStatus } from '@interfaces/lease.interface';

// Break the circular import chain that runs through @di/index → registerResources
jest.mock('@di/index', () => ({ container: {} }));

import { LeaseSignatureService } from '@services/lease/leaseSignature.service';

// ── shared IDs ────────────────────────────────────────────────────────────────
const leaseId = new Types.ObjectId();
const tenantUserId = new Types.ObjectId();
const pmUserId = new Types.ObjectId();
const propertyId = new Types.ObjectId();
const testCuid = 'TESTCLIENT123';
const testLuid = 'LEASE-WEBHOOK-001';
const testEnvelopeId = 'boldsign-envelope-abc';

// ── factory helpers ───────────────────────────────────────────────────────────
const makeLease = (overrides: Record<string, any> = {}) => ({
  _id: leaseId,
  cuid: testCuid,
  luid: testLuid,
  leaseNumber: 'LN-001',
  tenantId: tenantUserId,
  createdBy: pmUserId,
  property: { id: propertyId, unitId: null },
  eSignature: { envelopeId: testEnvelopeId },
  status: LeaseStatus.PENDING_SIGNATURE,
  signatures: [],
  coTenants: [],
  ...overrides,
});

// ── mock builder ──────────────────────────────────────────────────────────────
const buildMocks = () => {
  const leaseDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(makeLease())),
    update: jest.fn().mockReturnValue(Promise.resolve(makeLease({ status: LeaseStatus.ACTIVE }))),
  } as any;

  const emitterService = {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  } as any;

  const notificationService = {
    notifyLeaseESignatureSent: jest.fn().mockReturnValue(Promise.resolve()),
    notifyLeaseESignatureFailed: jest.fn().mockReturnValue(Promise.resolve()),
  } as any;

  const sseService = {
    sendToUser: jest.fn().mockReturnValue(Promise.resolve(true)),
  } as any;

  const boldSignService = {
    revokeDocument: jest.fn().mockReturnValue(Promise.resolve()),
    sendDocumentForSignature: jest.fn().mockReturnValue(Promise.resolve({ documentId: 'doc-123' })),
  } as any;

  const profileDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
  } as any;

  const propertyDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
  } as any;

  const propertyUnitDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
  } as any;

  const leaseCache = {
    invalidateLease: jest.fn().mockReturnValue(Promise.resolve()),
    invalidateLeaseLists: jest.fn().mockReturnValue(Promise.resolve()),
  } as any;

  const clientDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
  } as any;

  const queueFactory = {
    getQueue: jest.fn().mockReturnValue({
      addToESignatureRequestQueue: jest.fn().mockReturnValue(Promise.resolve({ id: 'job-1' })),
      addToPdfQueue: jest.fn().mockReturnValue(Promise.resolve({ id: 'job-2' })),
    }),
  } as any;

  return {
    leaseDAO,
    emitterService,
    notificationService,
    sseService,
    boldSignService,
    profileDAO,
    propertyDAO,
    propertyUnitDAO,
    leaseCache,
    clientDAO,
    queueFactory,
  };
};

const buildService = (mocks: ReturnType<typeof buildMocks>) =>
  new LeaseSignatureService(mocks);

// ── tests ─────────────────────────────────────────────────────────────────────
describe('LeaseSignatureService - handleESignatureWebhook', () => {
  describe('Completed event', () => {
    it('should update lease status to ACTIVE', async () => {
      const mocks = buildMocks();
      const service = buildService(mocks);
      const completedDate = new Date().toISOString();

      await service.handleESignatureWebhook('Completed', testEnvelopeId, {
        completedDate,
        signers: [],
      });

      expect(mocks.leaseDAO.update).toHaveBeenCalledWith(
        { _id: leaseId },
        expect.objectContaining({
          status: LeaseStatus.ACTIVE,
          'eSignature.status': ILeaseESignatureStatusEnum.COMPLETED,
        })
      );
    });

    it('should fire SSE to both tenant and PM', async () => {
      const mocks = buildMocks();
      const service = buildService(mocks);
      const lease = makeLease();

      await service.handleESignatureWebhook('Completed', testEnvelopeId, {
        completedDate: new Date().toISOString(),
        signers: [],
      });

      expect(mocks.sseService.sendToUser).toHaveBeenCalledTimes(2);

      const calls: Array<[string, string, any, string]> =
        mocks.sseService.sendToUser.mock.calls;

      const tenantCall = calls.find(([userId]) => userId === lease.tenantId.toString());
      const pmCall = calls.find(([userId]) => userId === lease.createdBy.toString());

      expect(tenantCall).toBeDefined();
      expect(tenantCall![2]).toMatchObject({ resourceUId: testLuid, status: LeaseStatus.ACTIVE });
      expect(tenantCall![3]).toBe('resource-event');

      expect(pmCall).toBeDefined();
      expect(pmCall![2]).toMatchObject({ resourceUId: testLuid, status: LeaseStatus.ACTIVE });
      expect(pmCall![3]).toBe('resource-event');
    });

    it('should not throw if tenant SSE session is offline (sendToUser returns false)', async () => {
      const mocks = buildMocks();
      // Tenant's session is offline — sendToUser returns false
      mocks.sseService.sendToUser
        .mockReturnValueOnce(Promise.resolve(false))  // tenant
        .mockReturnValueOnce(Promise.resolve(true));  // PM

      const service = buildService(mocks);

      await expect(
        service.handleESignatureWebhook('Completed', testEnvelopeId, {
          completedDate: new Date().toISOString(),
          signers: [],
        })
      ).resolves.not.toThrow();

      // Both calls must still have been attempted despite the first returning false
      expect(mocks.sseService.sendToUser).toHaveBeenCalledTimes(2);
    });

    it('should emit LEASE_ESIGNATURE_COMPLETED event', async () => {
      const mocks = buildMocks();
      const service = buildService(mocks);
      const lease = makeLease();

      await service.handleESignatureWebhook('Completed', testEnvelopeId, {
        completedDate: new Date().toISOString(),
        signers: [],
      });

      expect(mocks.emitterService.emit).toHaveBeenCalledWith(
        EventTypes.LEASE_ESIGNATURE_COMPLETED,
        expect.objectContaining({
          leaseId: leaseId.toString(),
          luid: testLuid,
          cuid: testCuid,
          tenantId: lease.tenantId.toString(),
          propertyManagerId: lease.createdBy.toString(),
          documentId: testEnvelopeId,
        })
      );
    });
  });

  describe('Completed event — SSE failure isolation', () => {
    it('should still resolve when both SSE sends reject', async () => {
      const mocks = buildMocks();
      mocks.sseService.sendToUser.mockReturnValue(
        Promise.reject(new Error('SSE transport error'))
      );
      const service = buildService(mocks);

      // Promise.allSettled swallows rejections — the webhook handler must not rethrow
      await expect(
        service.handleESignatureWebhook('Completed', testEnvelopeId, {
          completedDate: new Date().toISOString(),
          signers: [],
        })
      ).resolves.toBeUndefined();
    });
  });

  describe('Non-Completed events — SSE not called', () => {
    it('should not call sseService for a Declined event', async () => {
      const mocks = buildMocks();
      const service = buildService(mocks);

      await service.handleESignatureWebhook('Declined', testEnvelopeId, {
        declineReason: 'Not agreeable',
      });

      expect(mocks.sseService.sendToUser).not.toHaveBeenCalled();
    });

    it('should not call sseService for an Expired event', async () => {
      const mocks = buildMocks();
      const service = buildService(mocks);

      await service.handleESignatureWebhook('Expired', testEnvelopeId, {});

      expect(mocks.sseService.sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('Lease not found', () => {
    it('should throw when no lease matches the envelope ID', async () => {
      const mocks = buildMocks();
      mocks.leaseDAO.findFirst.mockReturnValue(Promise.resolve(null));
      const service = buildService(mocks);

      await expect(
        service.handleESignatureWebhook('Completed', 'unknown-envelope', {})
      ).rejects.toThrow('Lease not found for envelope ID');
    });
  });
});
