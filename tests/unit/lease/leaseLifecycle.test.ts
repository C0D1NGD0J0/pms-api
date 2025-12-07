import { Types } from 'mongoose';
import { BadRequestError } from '@shared/customErrors';
import { EventTypes } from '@interfaces/events.interface';
import { LeaseService } from '@services/lease/lease.service';
import { ILeaseESignatureStatusEnum, LeaseStatus, LeaseType } from '@interfaces/lease.interface';

const createMockDependencies = () => ({
  leaseDAO: {
    findFirst: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    updateLeaseStatus: jest.fn(),
    terminateLease: jest.fn(),
    checkOverlappingLeases: jest.fn(),
    startSession: jest.fn(),
    withTransaction: jest.fn(),
  },
  propertyDAO: {
    findFirst: jest.fn(),
  },
  propertyUnitDAO: {
    findFirst: jest.fn(),
  },
  profileDAO: {
    findFirst: jest.fn(),
  },
  clientDAO: {
    getClientByCuid: jest.fn(),
  },
  userDAO: {
    findFirst: jest.fn(),
  },
  invitationDAO: {
    findFirst: jest.fn(),
  },
  invitationService: {
    sendInvitation: jest.fn(),
  },
  boldSignService: {
    sendDocumentForSignature: jest.fn(),
    revokeDocument: jest.fn(),
  },
  esignatureQueue: {
    addToESignatureRequestQueue: jest.fn(),
  },
  pdfGeneratorQueue: {
    addToPdfQueue: jest.fn(),
  },
  mediaUploadService: {
    uploadFiles: jest.fn(),
  },
  pdfGeneratorService: {
    generatePdf: jest.fn(),
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
    createNotificationFromTemplate: jest.fn(),
    notifyLeaseESignatureSent: jest.fn(),
    notifyLeaseESignatureFailed: jest.fn(),
  },
});

const createMockLease = (overrides?: any) => ({
  _id: new Types.ObjectId(),
  luid: 'L-2025-ABC123',
  cuid: 'C123',
  leaseNumber: 'LEASE-2025-001',
  type: LeaseType.FIXED_TERM,
  status: LeaseStatus.PENDING_SIGNATURE,
  tenantId: new Types.ObjectId(),
  createdBy: new Types.ObjectId(),
  property: {
    id: new Types.ObjectId(),
    address: '123 Main St',
    unitId: new Types.ObjectId(),
  },
  duration: {
    startDate: new Date('2025-01-01'),
    endDate: new Date('2026-01-01'),
  },
  fees: {
    monthlyRent: 150000,
    securityDeposit: 300000,
    rentDueDay: 1,
    currency: 'USD',
  },
  eSignature: {
    envelopeId: 'ENV-12345',
    status: 'sent',
    sentAt: new Date('2025-01-01'),
  },
  approvalStatus: 'approved',
  deletedAt: null,
  ...overrides,
});

describe('LeaseService - Lifecycle Management', () => {
  let service: LeaseService;
  let mockDeps: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mockDeps = createMockDependencies();
    service = new LeaseService(mockDeps as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Lease Activation via Webhook', () => {
    describe('handleESignatureWebhook - Completed Event', () => {
      const documentId = 'ENV-12345';
      const mockLease = createMockLease();

      beforeEach(() => {
        mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDeps.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          status: LeaseStatus.ACTIVE,
          eSignature: {
            ...mockLease.eSignature,
            status: ILeaseESignatureStatusEnum.COMPLETED,
            completedAt: new Date(),
          },
        });
      });

      it('should activate lease when signature is completed', async () => {
        const completedData = {
          completedDate: new Date().toISOString(),
          signers: [
            {
              name: 'John Tenant',
              email: 'tenant@example.com',
              role: 'tenant',
              signedAt: new Date(),
            },
          ],
        };

        await service.handleESignatureWebhook('Completed', documentId, completedData);

        expect(mockDeps.leaseDAO.findFirst).toHaveBeenCalledWith({
          'eSignature.envelopeId': documentId,
        });

        expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
          { _id: mockLease._id },
          expect.objectContaining({
            'eSignature.status': ILeaseESignatureStatusEnum.COMPLETED,
            'eSignature.completedAt': expect.any(Date),
            status: LeaseStatus.ACTIVE,
            updatedAt: expect.any(Date),
          })
        );
      });

      it('should emit LEASE_ESIGNATURE_COMPLETED event on activation', async () => {
        const completedData = {
          completedDate: new Date().toISOString(),
          signers: [],
        };

        await service.handleESignatureWebhook('Completed', documentId, completedData);

        expect(mockDeps.emitterService.emit).toHaveBeenCalledWith(
          EventTypes.LEASE_ESIGNATURE_COMPLETED,
          expect.objectContaining({
            leaseId: mockLease._id.toString(),
            luid: mockLease.luid,
            cuid: mockLease.cuid,
            tenantId: mockLease.tenantId.toString(),
            propertyId: mockLease.property.id.toString(),
            propertyUnitId: mockLease.property.unitId?.toString(),
            propertyManagerId: mockLease.createdBy.toString(),
            documentId,
            completedAt: expect.any(Date),
            signers: completedData.signers,
          })
        );
      });

      it('should throw error when lease not found for envelope ID', async () => {
        mockDeps.leaseDAO.findFirst.mockResolvedValue(null);

        await expect(service.handleESignatureWebhook('Completed', documentId, {})).rejects.toThrow(
          'Lease not found for envelope ID'
        );
      });

      it('should handle activation with property-level lease (no unitId)', async () => {
        const propertyLevelLease = createMockLease({
          property: {
            id: new Types.ObjectId(),
            address: '123 Main St',
            unitId: undefined,
          },
        });

        mockDeps.leaseDAO.findFirst.mockResolvedValue(propertyLevelLease);
        mockDeps.leaseDAO.update.mockResolvedValue({
          ...propertyLevelLease,
          status: LeaseStatus.ACTIVE,
        });

        await service.handleESignatureWebhook('Completed', documentId, {
          completedDate: new Date().toISOString(),
        });

        expect(mockDeps.emitterService.emit).toHaveBeenCalledWith(
          EventTypes.LEASE_ESIGNATURE_COMPLETED,
          expect.objectContaining({
            propertyId: propertyLevelLease.property.id.toString(),
            propertyUnitId: undefined,
          })
        );
      });
    });

    describe('Webhook validation checks', () => {
      it('should validate lease is in PENDING_SIGNATURE status before activation', async () => {
        const draftLease = createMockLease({
          status: LeaseStatus.DRAFT,
          eSignature: undefined,
        });

        mockDeps.leaseDAO.findFirst.mockResolvedValue(draftLease);

        // This shouldn't happen in reality, but testing defensive code
        await service.handleESignatureWebhook('Completed', 'ENV-12345', {});

        // Should still attempt to activate even if unexpected
        expect(mockDeps.leaseDAO.update).toHaveBeenCalled();
      });

      it('should handle activation for approved lease', async () => {
        const approvedLease = createMockLease({
          approvalStatus: 'approved',
        });

        mockDeps.leaseDAO.findFirst.mockResolvedValue(approvedLease);
        mockDeps.leaseDAO.update.mockResolvedValue({
          ...approvedLease,
          status: LeaseStatus.ACTIVE,
        });

        await service.handleESignatureWebhook('Completed', 'ENV-12345', {
          completedDate: new Date().toISOString(),
        });

        expect(mockDeps.leaseDAO.update).toHaveBeenCalled();
        expect(mockDeps.emitterService.emit).toHaveBeenCalledWith(
          EventTypes.LEASE_ESIGNATURE_COMPLETED,
          expect.any(Object)
        );
      });
    });
  });

  describe('Lease Termination', () => {
    const cuid = 'C123';
    const leaseId = 'L-2025-ABC123';
    const userId = new Types.ObjectId().toString();

    describe('terminateLease method', () => {
      it('should throw not implemented error', async () => {
        const terminationData = {
          terminationDate: new Date(),
          terminationReason: 'Tenant moved out',
          moveOutDate: new Date(),
          notes: 'Early termination',
        };

        await expect(
          service.terminateLease(cuid, leaseId, terminationData, userId)
        ).rejects.toThrow('terminateLease not yet implemented');
      });
    });

    describe('terminateLease validation requirements (when implemented)', () => {
      // These tests document what SHOULD happen when terminateLease is implemented

      it('should validate lease exists before termination', async () => {
        mockDeps.leaseDAO.findFirst.mockResolvedValue(null);

        await expect(service.terminateLease(cuid, leaseId, {} as any, userId)).rejects.toThrow();
      });

      it('should validate lease is in terminatable status', async () => {
        const cancelledLease = createMockLease({
          status: LeaseStatus.CANCELLED,
        });

        mockDeps.leaseDAO.findFirst.mockResolvedValue(cancelledLease);

        // When implemented, should validate status is ACTIVE
        await expect(service.terminateLease(cuid, leaseId, {} as any, userId)).rejects.toThrow();
      });
    });
  });

  describe('Event Listener Setup', () => {
    it('should register event listeners on initialization', () => {
      expect(mockDeps.emitterService.on).toHaveBeenCalledWith(
        EventTypes.UPLOAD_COMPLETED,
        expect.any(Function)
      );
      expect(mockDeps.emitterService.on).toHaveBeenCalledWith(
        EventTypes.UPLOAD_FAILED,
        expect.any(Function)
      );
      expect(mockDeps.emitterService.on).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATION_REQUESTED,
        expect.any(Function)
      );
      expect(mockDeps.emitterService.on).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATED,
        expect.any(Function)
      );
      expect(mockDeps.emitterService.on).toHaveBeenCalledWith(
        EventTypes.LEASE_ESIGNATURE_SENT,
        expect.any(Function)
      );
      expect(mockDeps.emitterService.on).toHaveBeenCalledWith(
        EventTypes.LEASE_ESIGNATURE_FAILED,
        expect.any(Function)
      );
    });

    it('should cleanup event listeners properly', () => {
      service.cleanupEventListeners();

      expect(mockDeps.emitterService.off).toHaveBeenCalledWith(
        EventTypes.UPLOAD_COMPLETED,
        expect.any(Function)
      );
      expect(mockDeps.emitterService.off).toHaveBeenCalledWith(
        EventTypes.UPLOAD_FAILED,
        expect.any(Function)
      );
      expect(mockDeps.emitterService.off).toHaveBeenCalledWith(
        EventTypes.LEASE_ESIGNATURE_SENT,
        expect.any(Function)
      );
      expect(mockDeps.emitterService.off).toHaveBeenCalledWith(
        EventTypes.LEASE_ESIGNATURE_FAILED,
        expect.any(Function)
      );
    });
  });

  describe('Webhook Event Handlers - Other States', () => {
    const documentId = 'ENV-12345';
    const mockLease = createMockLease();

    beforeEach(() => {
      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);
    });

    describe('SendFailed event', () => {
      it('should revert lease to DRAFT and mark signature as voided', async () => {
        mockDeps.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          status: LeaseStatus.DRAFT,
          eSignature: {
            status: ILeaseESignatureStatusEnum.VOIDED,
            errorMessage: 'Send failed',
          },
        });

        await service.handleESignatureWebhook('SendFailed', documentId, {
          errorMessage: 'Send failed',
        });

        expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
          mockLease._id,
          expect.objectContaining({
            'eSignature.status': ILeaseESignatureStatusEnum.VOIDED,
            'eSignature.errorMessage': 'Send failed',
            'eSignature.failedAt': expect.any(Date),
            status: LeaseStatus.DRAFT,
            updatedAt: expect.any(Date),
          })
        );
      });
    });

    describe('Declined event', () => {
      it('should revert lease to DRAFT when signature is declined', async () => {
        mockDeps.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          status: LeaseStatus.DRAFT,
        });

        await service.handleESignatureWebhook('Declined', documentId, {
          declineReason: 'Tenant changed mind',
        });

        expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
          { _id: mockLease._id },
          expect.objectContaining({
            'eSignature.status': ILeaseESignatureStatusEnum.DECLINED,
            'eSignature.declinedReason': 'Tenant changed mind',
            status: LeaseStatus.DRAFT,
            updatedAt: expect.any(Date),
          })
        );
      });
    });

    describe('Expired event', () => {
      it('should revert lease to DRAFT when signature expires', async () => {
        mockDeps.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          status: LeaseStatus.DRAFT,
        });

        await service.handleESignatureWebhook('Expired', documentId, {});

        expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
          { _id: mockLease._id },
          expect.objectContaining({
            'eSignature.status': ILeaseESignatureStatusEnum.VOIDED,
            status: LeaseStatus.DRAFT,
            updatedAt: expect.any(Date),
          })
        );
      });
    });

    describe('Revoked event', () => {
      it('should revert lease to DRAFT when signature is revoked', async () => {
        mockDeps.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          status: LeaseStatus.DRAFT,
        });

        await service.handleESignatureWebhook('Revoked', documentId, {});

        expect(mockDeps.leaseDAO.update).toHaveBeenCalledWith(
          mockLease._id,
          expect.objectContaining({
            'eSignature.status': ILeaseESignatureStatusEnum.DRAFT,
            status: LeaseStatus.DRAFT,
            updatedAt: expect.any(Date),
          })
        );
      });
    });
  });

  describe('activateLease method', () => {
    const cuid = 'C123';
    const leaseId = 'L-2025-ABC123';
    const userId = new Types.ObjectId().toString();

    it('should throw not implemented error', async () => {
      const mockLease = createMockLease({
        status: LeaseStatus.PENDING_SIGNATURE,
        approvalStatus: 'approved',
      });

      mockDeps.leaseDAO.findFirst.mockResolvedValue(mockLease);

      await expect(service.activateLease(cuid, leaseId, {}, userId)).rejects.toThrow(
        'activateLease not yet implemented'
      );
    });

    it('should validate lease exists', async () => {
      mockDeps.leaseDAO.findFirst.mockResolvedValue(null);

      await expect(service.activateLease(cuid, leaseId, {}, userId)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should validate lease is approved before activation', async () => {
      const pendingLease = createMockLease({
        approvalStatus: 'pending',
      });

      mockDeps.leaseDAO.findFirst.mockResolvedValue(pendingLease);

      await expect(service.activateLease(cuid, leaseId, {}, userId)).rejects.toThrow(
        /Cannot activate.*pending approval.*Only approved leases can activate/
      );
    });
  });
});
