import { Types } from 'mongoose';
import { LeaseService } from '@services/lease/lease.service';
import { EventTypes } from '@interfaces/events.interface';
import { LeaseStatus, ILeaseESignatureStatusEnum } from '@interfaces/lease.interface';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';

const createMockDependencies = () => ({
  leaseDAO: {
    findFirst: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    startSession: jest.fn(),
    withTransaction: jest.fn(),
  },
  propertyDAO: {
    findFirst: jest.fn(),
  },
  propertyUnitDAO: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  userDAO: {
    findFirst: jest.fn(),
  },
  profileDAO: {
    findFirst: jest.fn(),
  },
  clientDAO: {
    getClientByCuid: jest.fn(),
  },
  invitationDAO: {
    findFirst: jest.fn(),
  },
  invitationService: {
    sendInvitation: jest.fn(),
  },
  emitterService: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  },
  leaseCache: {
    getClientLeases: jest.fn(),
    saveClientLeases: jest.fn(),
    invalidateLease: jest.fn(),
    invalidateLeaseLists: jest.fn(),
  },
  notificationService: {
    handlePropertyUpdateNotifications: jest.fn(),
    notifyApprovalDecision: jest.fn(),
    notifyLeaseESignatureSent: jest.fn(),
    notifyLeaseESignatureFailed: jest.fn(),
  },
  pdfGeneratorService: {
    generatePdf: jest.fn(),
  },
  mediaUploadService: {
    handleBuffer: jest.fn(),
  },
  pdfGeneratorQueue: {
    addToPdfQueue: jest.fn(),
  },
  boldSignService: {
    sendDocumentForSignature: jest.fn(),
    getDocumentStatus: jest.fn(),
    revokeDocument: jest.fn(),
    processWebhookData: jest.fn(),
  },
  eSignatureQueue: {
    addToESignatureRequestQueue: jest.fn(),
  },
});

const createMockLease = (overrides?: any) => ({
  _id: new Types.ObjectId(),
  luid: 'L-2025-ABC123',
  cuid: 'C123',
  leaseNumber: 'LEASE-2025-001',
  status: LeaseStatus.PENDING_SIGNATURE,
  tenantId: new Types.ObjectId(),
  createdBy: new Types.ObjectId(),
  property: {
    id: new Types.ObjectId(),
    unitId: new Types.ObjectId(),
  },
  eSignature: {
    envelopeId: 'ENV123456',
    status: 'sent',
    sentAt: new Date(),
  },
  signatures: [],
  coTenants: [],
  ...overrides,
});

const createMockPropertyUnit = (overrides?: any) => ({
  _id: new Types.ObjectId(),
  unitNumber: '101',
  status: PropertyUnitStatusEnum.AVAILABLE,
  ...overrides,
});

describe('LeaseService - BoldSign Integration', () => {
  let leaseService: LeaseService;
  let mockDeps: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDeps = createMockDependencies();
    leaseService = new LeaseService(mockDeps as any);
  });

  afterEach(() => {
    leaseService.cleanupEventListeners();
  });

  describe('handleESignatureWebhook - Completed Event', () => {
    it('should update lease to ACTIVE status when signature is completed', async () => {
      const mockLease = createMockLease();
      const mockUnit = createMockPropertyUnit();
      const completedDate = new Date('2025-01-15T10:00:00Z');

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.leaseDAO.update.mockResolvedValue({
        ...mockLease,
        status: LeaseStatus.ACTIVE,
        eSignature: {
          ...mockLease.eSignature,
          status: ILeaseESignatureStatusEnum.COMPLETED,
          completedAt: completedDate,
        },
      });

      await leaseService.handleESignatureWebhook(
        'Completed',
        'ENV123456',
        { completedDate: completedDate.toISOString(), signers: [] },
        { documentId: 'ENV123456', completedSignerEmails: [] }
      );

      expect(mockDeps.leaseDAO.findFirst).toHaveBeenCalledWith({
        'eSignature.envelopeId': 'ENV123456',
      });

      expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
        { _id: mockLease._id },
        expect.objectContaining({
          'eSignature.status': ILeaseESignatureStatusEnum.COMPLETED,
          'eSignature.completedAt': completedDate,
          status: LeaseStatus.ACTIVE,
        })
      );
    });

    it('should emit LEASE_ESIGNATURE_COMPLETED event with correct payload', async () => {
      const mockLease = createMockLease();
      const completedDate = new Date('2025-01-15T10:00:00Z');

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.leaseDAO.update.mockResolvedValue(mockLease);

      await leaseService.handleESignatureWebhook('Completed', 'ENV123456', {
        completedDate: completedDate.toISOString(),
        signers: [{ email: 'tenant@test.com', name: 'Tenant' }],
      });

      expect(mockDeps.emitterService.emit).toHaveBeenCalledWith(
        EventTypes.LEASE_ESIGNATURE_COMPLETED,
        expect.objectContaining({
          leaseId: mockLease._id.toString(),
          luid: mockLease.luid,
          cuid: mockLease.cuid,
          tenantId: mockLease.tenantId.toString(),
          propertyId: mockLease.property.id.toString(),
          propertyUnitId: mockLease.property.unitId.toString(),
          propertyManagerId: mockLease.createdBy.toString(),
          documentId: 'ENV123456',
          completedAt: completedDate,
          signers: expect.any(Array),
        })
      );
    });

    it('should throw error if lease not found for envelope ID', async () => {
      mockDeps.leaseDAO.findFirst.mockResolvedValue(null);

      await expect(
        leaseService.handleESignatureWebhook('Completed', 'INVALID_ENV', {})
      ).rejects.toThrow('Lease not found for envelope ID');

      expect(mockDeps.leaseDAO.update).not.toHaveBeenCalled();
      expect(mockDeps.emitterService.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleESignatureWebhook - Declined Event', () => {
    it('should update lease to DRAFT status when signature is declined', async () => {
      const mockLease = createMockLease();
      const declineReason = 'Terms not acceptable';

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.leaseDAO.update.mockResolvedValue({
        ...mockLease,
        status: LeaseStatus.DRAFT,
        eSignature: {
          ...mockLease.eSignature,
          status: ILeaseESignatureStatusEnum.DECLINED,
          declinedReason: declineReason,
        },
      });

      await leaseService.handleESignatureWebhook('Declined', 'ENV123456', {
        declineReason,
      });

      expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
        { _id: mockLease._id },
        expect.objectContaining({
          'eSignature.status': ILeaseESignatureStatusEnum.DECLINED,
          'eSignature.declinedReason': declineReason,
          status: LeaseStatus.DRAFT,
        })
      );
    });

    it('should not emit LEASE_ESIGNATURE_COMPLETED event for declined signature', async () => {
      const mockLease = createMockLease();

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.leaseDAO.update.mockResolvedValue(mockLease);

      await leaseService.handleESignatureWebhook('Declined', 'ENV123456', {
        declineReason: 'User declined',
      });

      expect(mockDeps.emitterService.emit).not.toHaveBeenCalledWith(
        EventTypes.LEASE_ESIGNATURE_COMPLETED,
        expect.anything()
      );
    });
  });

  describe('handleESignatureWebhook - Expired Event', () => {
    it('should update lease status to DRAFT and eSignature status to VOIDED when expired', async () => {
      const mockLease = createMockLease();

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.leaseDAO.update.mockResolvedValue({
        ...mockLease,
        status: LeaseStatus.DRAFT,
        eSignature: {
          ...mockLease.eSignature,
          status: ILeaseESignatureStatusEnum.VOIDED,
        },
      });

      await leaseService.handleESignatureWebhook('Expired', 'ENV123456', {});

      expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
        { _id: mockLease._id },
        expect.objectContaining({
          'eSignature.status': ILeaseESignatureStatusEnum.VOIDED,
          status: LeaseStatus.DRAFT,
        })
      );
    });
  });

  describe('handleESignatureWebhook - Revoked Event', () => {
    it('should update lease status to DRAFT when revoked', async () => {
      const mockLease = createMockLease();

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.leaseDAO.update.mockResolvedValue({
        ...mockLease,
        status: LeaseStatus.DRAFT,
        eSignature: {
          ...mockLease.eSignature,
          status: ILeaseESignatureStatusEnum.DRAFT,
        },
      });

      await leaseService.handleESignatureWebhook('Revoked', 'ENV123456', {});

      expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
        mockLease._id,
        expect.objectContaining({
          'eSignature.status': ILeaseESignatureStatusEnum.DRAFT,
          status: LeaseStatus.DRAFT,
        })
      );
    });
  });

  describe('handleESignatureWebhook - SendFailed Event', () => {
    it('should update lease to DRAFT status and set error message', async () => {
      const mockLease = createMockLease();
      const errorMessage = 'Invalid recipient email';

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.leaseDAO.update.mockResolvedValue({
        ...mockLease,
        status: LeaseStatus.DRAFT,
        eSignature: {
          ...mockLease.eSignature,
          status: ILeaseESignatureStatusEnum.VOIDED,
          errorMessage,
        },
      });

      await leaseService.handleESignatureWebhook('SendFailed', 'ENV123456', {
        errorMessage,
      });

      expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
        mockLease._id,
        expect.objectContaining({
          'eSignature.status': ILeaseESignatureStatusEnum.VOIDED,
          'eSignature.errorMessage': errorMessage,
          'eSignature.failedAt': expect.any(Date),
          status: LeaseStatus.DRAFT,
        })
      );
    });

    it('should use default error message if none provided', async () => {
      const mockLease = createMockLease();

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.leaseDAO.update.mockResolvedValue(mockLease);

      await leaseService.handleESignatureWebhook('SendFailed', 'ENV123456', {});

      expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
        mockLease._id,
        expect.objectContaining({
          'eSignature.errorMessage': 'Send failed',
        })
      );
    });
  });

  describe('handleESignatureWebhook - Signed Event', () => {
    it('should record tenant signature when tenant signs', async () => {
      const tenantId = new Types.ObjectId();
      const mockLease = createMockLease({
        tenantId,
      });

      const mockTenant = {
        user: {
          email: 'tenant@test.com',
        },
      };

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.profileDAO.findFirst.mockResolvedValueOnce(mockTenant);
      mockDeps.leaseDAO.update.mockResolvedValue(mockLease);

      const signedAt = new Date();
      await leaseService.handleESignatureWebhook(
        'Signed',
        'ENV123456',
        {},
        {
          documentId: 'ENV123456',
          completedSignerEmails: [],
          recentSigner: {
            email: 'tenant@test.com',
            name: 'Test Tenant',
            signedAt,
          },
        }
      );

      expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
        { _id: mockLease._id },
        {
          $push: {
            signatures: expect.objectContaining({
              role: 'tenant',
              userId: tenantId,
              signatureMethod: 'electronic',
              signedAt,
            }),
          },
        }
      );
    });

    it('should record co-tenant signature when co-tenant signs', async () => {
      const mockLease = createMockLease({
        coTenants: [
          { name: 'Co-Tenant Name', email: 'cotenant@test.com', phone: '555-0100' },
        ],
      });

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.profileDAO.findFirst.mockResolvedValueOnce({
        user: { email: 'different@test.com' },
      });
      mockDeps.leaseDAO.update.mockResolvedValue(mockLease);

      const signedAt = new Date();
      await leaseService.handleESignatureWebhook(
        'Signed',
        'ENV123456',
        {},
        {
          documentId: 'ENV123456',
          completedSignerEmails: [],
          recentSigner: {
            email: 'cotenant@test.com',
            name: 'Co-Tenant Name',
            signedAt,
          },
        }
      );

      expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
        { _id: mockLease._id },
        {
          $push: {
            signatures: expect.objectContaining({
              role: 'co_tenant',
              signatureMethod: 'electronic',
              signedAt,
              coTenantInfo: {
                name: 'Co-Tenant Name',
                email: 'cotenant@test.com',
              },
            }),
          },
        }
      );
    });

    it('should not add duplicate signature for the same user', async () => {
      const tenantId = new Types.ObjectId();
      const mockLease = createMockLease({
        tenantId,
        signatures: [
          {
            userId: tenantId,
            role: 'tenant',
            signatureMethod: 'electronic',
            signedAt: new Date(),
          },
        ],
      });

      const mockTenant = {
        user: {
          email: 'tenant@test.com',
        },
      };

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.profileDAO.findFirst.mockResolvedValueOnce(mockTenant);

      await leaseService.handleESignatureWebhook(
        'Signed',
        'ENV123456',
        {},
        {
          documentId: 'ENV123456',
          completedSignerEmails: [],
          recentSigner: {
            email: 'tenant@test.com',
            name: 'Test Tenant',
            signedAt: new Date(),
          },
        }
      );

      expect(mockDeps.leaseDAO.update).not.toHaveBeenCalled();
    });

    it('should handle Signed event when no recentSigner provided', async () => {
      const mockLease = createMockLease();

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);

      await leaseService.handleESignatureWebhook(
        'Signed',
        'ENV123456',
        {},
        {
          documentId: 'ENV123456',
          completedSignerEmails: [],
        }
      );

      expect(mockDeps.leaseDAO.update).not.toHaveBeenCalled();
    });
  });

  describe('revokeLease', () => {
    it('should revoke lease document via BoldSign service', async () => {
      const mockLease = createMockLease();
      const reason = 'Tenant requested cancellation';

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.boldSignService.revokeDocument.mockResolvedValue({ success: true });

      await leaseService.revokeLease(mockLease.luid, reason);

      expect(mockDeps.leaseDAO.findFirst).toHaveBeenCalledWith({
        luid: mockLease.luid,
      });

      expect(mockDeps.boldSignService.revokeDocument).toHaveBeenCalledWith(
        mockLease.eSignature.envelopeId,
        reason
      );
    });

    it('should throw error if lease not found', async () => {
      mockDeps.leaseDAO.findFirst.mockResolvedValue(null);

      await expect(
        leaseService.revokeLease('INVALID_LUID', 'Reason')
      ).rejects.toThrow('Lease not found');

      expect(mockDeps.boldSignService.revokeDocument).not.toHaveBeenCalled();
    });

    it('should propagate BoldSign service errors', async () => {
      const mockLease = createMockLease();

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDeps.boldSignService.revokeDocument.mockRejectedValue(
        new Error('BoldSign API Error: Service unavailable')
      );

      await expect(
        leaseService.revokeLease(mockLease.luid, 'Reason')
      ).rejects.toThrow('BoldSign API Error: Service unavailable');
    });
  });
});
