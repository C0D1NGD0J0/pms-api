import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { ILeaseESignatureStatusEnum, LeaseStatus } from '@interfaces/lease.interface';

// Break the circular import chain that runs through @di/index → registerResources
jest.mock('@di/index', () => ({ container: {} }));

import { LeaseSignatureService } from '@services/lease/leaseSignature.service';

const testCuid = 'TESTCLIENT123';
const testLuid = 'LEASE-SEND-001';
const leaseId = new Types.ObjectId();
const propertyId = new Types.ObjectId();
const tenantUserId = new Types.ObjectId();

const makeLease = (overrides: Record<string, any> = {}) => ({
  _id: leaseId,
  cuid: testCuid,
  luid: testLuid,
  tenantId: tenantUserId,
  status: LeaseStatus.READY_FOR_SIGNATURE,
  approvalStatus: 'approved',
  signingMethod: 'electronic',
  templateType: 'residential-apartment',
  eSignature: { status: ILeaseESignatureStatusEnum.NOT_SENT },
  duration: {
    startDate: dayjs().add(10, 'days').toDate(),
    endDate: dayjs().add(1, 'year').toDate(),
  },
  property: { id: propertyId, propertyType: 'apartment' },
  leaseDocuments: [],
  ...overrides,
});

const buildService = (lease: Record<string, any>, propertyOverrides: Record<string, any> = {}) => {
  const pdfQueue = { addToPdfQueue: jest.fn().mockReturnValue(Promise.resolve({ id: 'pdf-1' })) };
  const mocks = {
    leaseDAO: {
      findFirst: jest.fn().mockReturnValue(Promise.resolve(lease)),
      update: jest.fn(),
    },
    clientDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve({ cuid: testCuid })) },
    profileDAO: {
      findFirst: jest.fn().mockReturnValue(Promise.resolve({ user: { email: 't@test.com' } })),
    },
    propertyDAO: {
      findFirst: jest.fn().mockReturnValue(
        Promise.resolve({
          operationalStatus: 'available',
          owner: { type: 'company_owned' },
          isManagementAuthorized: () => true,
          verificationStatus: 'verified',
          authorization: { isActive: true },
          ...propertyOverrides,
        })
      ),
    },
    propertyUnitDAO: { findFirst: jest.fn() },
    queueFactory: { getQueue: jest.fn().mockReturnValue(pdfQueue) },
    emitterService: { on: jest.fn(), emit: jest.fn() },
    notificationService: {},
    boldSignService: {},
    leaseCache: {},
    sseService: {},
  } as any;
  return { service: new LeaseSignatureService(mocks), pdfQueue };
};

const managerContext = {
  request: { params: { cuid: testCuid, luid: testLuid } },
  currentuser: { sub: new Types.ObjectId().toString(), client: { role: 'manager' } },
} as any;

describe('LeaseSignatureService.sendLeaseForSignature - PDF not generated yet', () => {
  it("queues PDF generation with the lease's template, not the raw property type", async () => {
    const { service, pdfQueue } = buildService(makeLease());

    const result = await service.sendLeaseForSignature(managerContext);

    expect(result.data.status).toBe('pdf_generation_pending');
    expect(pdfQueue.addToPdfQueue).toHaveBeenCalledWith(
      expect.objectContaining({ templateType: 'residential-apartment' })
    );
  });

  it('falls back to the template mapped from the property type when the lease has none', async () => {
    const { service, pdfQueue } = buildService(
      makeLease({
        templateType: undefined,
        property: { id: propertyId, propertyType: 'condominium' },
      })
    );

    await service.sendLeaseForSignature(managerContext);

    expect(pdfQueue.addToPdfQueue).toHaveBeenCalledWith(
      expect.objectContaining({ templateType: 'residential-apartment' })
    );
  });
});

describe('LeaseSignatureService.sendLeaseForSignature - property ownership', () => {
  it('refuses to send when the property is no longer verified (e.g. a grace period expired)', async () => {
    const { service, pdfQueue } = buildService(makeLease(), {
      verificationStatus: 'unverified',
      verificationGracePeriod: { expiresAt: dayjs().subtract(1, 'day').toDate() },
    });

    await expect(service.sendLeaseForSignature(managerContext)).rejects.toThrow(
      'lease.errors.ownershipUnverified'
    );
    expect(pdfQueue.addToPdfQueue).not.toHaveBeenCalled();
  });

  it('still sends without a management agreement, since the external owner signs directly', async () => {
    const { service, pdfQueue } = buildService(makeLease(), {
      owner: { type: 'external_owner', email: 'owner@example.com' },
      isManagementAuthorized: () => false,
      authorization: undefined,
    });

    await service.sendLeaseForSignature(managerContext);

    expect(pdfQueue.addToPdfQueue).toHaveBeenCalled();
  });
});
