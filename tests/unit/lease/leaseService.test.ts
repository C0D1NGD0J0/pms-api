import { Types } from 'mongoose';
import { LeaseService } from '@services/lease/lease.service';
import { LeaseStatus, LeaseType } from '@interfaces/lease.interface';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';
import { IUserRole } from '@shared/constants/roles.constants';

const createMockDependencies = () => ({
  leaseDAO: {
    createLease: jest.fn(),
    getLeaseById: jest.fn(),
    getFilteredLeases: jest.fn(),
    updateLease: jest.fn(),
    deleteLease: jest.fn(),
    findFirst: jest.fn(),
    checkOverlappingLeases: jest.fn(),
    getActiveLeaseByTenant: jest.fn(),
    getActiveLeaseByUnit: jest.fn(),
    getExpiringLeases: jest.fn(),
    updateLeaseStatus: jest.fn(),
    terminateLease: jest.fn(),
    getLeaseStats: jest.fn(),
    startSession: jest.fn(),
    withTransaction: jest.fn(),
    update: jest.fn(),
  },
  propertyDAO: {
    findFirst: jest.fn(),
  },
  propertyUnitDAO: {
    findFirst: jest.fn(),
  },
  userDAO: {
    findFirst: jest.fn(),
  },
  profileDAO: {
    findFirst: jest.fn(),
    generateCurrentUserInfo: jest.fn(),
  },
  clientDAO: {
    getClientByCuid: jest.fn(),
  },
  assetService: {
    createAssets: jest.fn(),
    getAssetsByResource: jest.fn(),
    deleteAsset: jest.fn(),
  },
  emitterService: {
    emit: jest.fn(),
    on: jest.fn(),
  },
  notificationService: {
    handlePropertyUpdateNotifications: jest.fn(),
    notifyApprovalDecision: jest.fn(),
  },
});

const createMockUser = (role: string = IUserRole.ADMIN, cuid = 'C123') => ({
  uid: 'U123',
  sub: new Types.ObjectId().toString(),
  displayName: 'Test User',
  email: 'test@example.com',
  client: {
    cuid,
    role,
  },
});

const createMockLease = (overrides?: any) => ({
  _id: new Types.ObjectId(),
  luid: 'L-2025-ABC123',
  cuid: 'C123',
  leaseNumber: 'LEASE-2025-001',
  type: LeaseType.FIXED_TERM,
  status: LeaseStatus.DRAFT,
  tenantId: new Types.ObjectId(),
  property: {
    id: new Types.ObjectId(),
    address: '123 Main St',
  },
  duration: {
    startDate: new Date('2025-01-01'),
    endDate: new Date('2026-01-01'),
  },
  fees: {
    monthlyRent: 150000, // cents
    securityDeposit: 300000, // cents
    rentDueDay: 1,
    currency: 'USD',
  },
  createdBy: new Types.ObjectId(),
  approvalStatus: 'draft',
  approvalDetails: [],
  deletedAt: null,
  softDelete: jest.fn().mockResolvedValue(true),
  ...overrides,
});

describe('LeaseService', () => {
  let leaseService: LeaseService;
  let mockDependencies: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mockDependencies = createMockDependencies();
    leaseService = new LeaseService(mockDependencies as any);
    jest.clearAllMocks();
  });

  describe('createLease', () => {
    it.todo('should create a lease successfully');
    it.todo('should validate tenant exists');
    it.todo('should validate property exists');
    it.todo('should validate unit exists if provided');
    it.todo('should validate dates (endDate > startDate)');
    it.todo('should validate financial terms (rent > 0, deposit >= 0)');
    it.todo('should check for overlapping leases');
    it.todo('should throw error if overlapping lease exists');
    it.todo('should set status to draft by default');
    it.todo('should emit LEASE_CREATED event');

    // Example test structure (uncomment when implementing):
    // it('should create a lease successfully', async () => {
    //   const mockLeaseData = {
    //     tenantId: 'T123',
    //     propertyId: 'P123',
    //     startDate: new Date('2025-01-01'),
    //     endDate: new Date('2026-01-01'),
    //     monthlyRent: 1500,
    //     securityDeposit: 1500,
    //     rentDueDay: 1,
    //   };
    //
    //   mockDependencies.userService.getUserById.mockResolvedValue({
    //     success: true,
    //     data: { uid: 'T123', role: 'tenant' },
    //   });
    //
    //   mockDependencies.propertyService.getPropertyById.mockResolvedValue({
    //     success: true,
    //     data: { pid: 'P123', name: 'Test Property' },
    //   });
    //
    //   mockDependencies.leaseDAO.checkOverlappingLeases.mockResolvedValue([]);
    //
    //   mockDependencies.leaseDAO.createLease.mockResolvedValue({
    //     luid: 'L123',
    //     ...mockLeaseData,
    //     status: 'draft',
    //   });
    //
    //   const result = await leaseService.createLease('C123', mockLeaseData, 'U123');
    //
    //   expect(result.success).toBe(true);
    //   expect(result.data.luid).toBe('L123');
    //   expect(mockDependencies.emitterService.emit).toHaveBeenCalledWith(
    //     'LEASE_CREATED',
    //     expect.any(Object)
    //   );
    // });
  });

  describe('getFilteredLeases', () => {
    it.todo('should get leases with filters');
    it.todo('should apply status filter');
    it.todo('should apply date range filters');
    it.todo('should apply property/unit filters');
    it.todo('should return paginated results');
  });

  describe('getLeaseById', () => {
    it.todo('should get lease by ID');
    it.todo('should throw error if lease not found');
    it.todo('should populate tenant/property references');
  });

  describe('updateLease', () => {
    it.todo('should update lease successfully');
    it.todo('should prevent updates to locked fields on active leases');
    it.todo('should re-validate dates if changed');
    it.todo('should update lastModifiedBy');
  });

  describe('deleteLease', () => {
    it.todo('should delete draft lease');
    it.todo('should throw error when deleting active lease');
    it.todo('should perform soft delete');
    it.todo('should emit LEASE_DELETED event');
  });

  describe('activateLease', () => {
    it.todo('should activate lease successfully');
    it.todo('should validate lease is in correct status');
    it.todo('should check no overlapping active leases');
    it.todo('should set signedDate if not set');
    it.todo('should emit LEASE_ACTIVATED event');
  });

  describe('terminateLease', () => {
    it.todo('should terminate active lease');
    it.todo('should set termination fields');
    it.todo('should update status to terminated');
    it.todo('should emit LEASE_TERMINATED event');
  });

  describe('uploadLeaseDocument', () => {
    it.todo('should upload document to S3');
    it.todo('should create Asset record');
    it.todo('should validate file is PDF');
    it.todo('should validate file size <= 10MB');
    it.todo('should emit LEASE_DOCUMENT_UPLOADED event');
  });

  describe('getLeaseAssets', () => {
    it.todo('should get all lease assets');
    it.todo('should filter by fieldName');
    it.todo('should filter by type (document/image)');
  });

  describe('deleteLeaseAsset', () => {
    it.todo('should soft delete asset');
    it.todo('should validate asset belongs to lease');
    it.todo('should emit LEASE_ASSET_DELETED event');
  });

  describe('getLeaseDocumentUrl', () => {
    it.todo('should return S3 URL');
    it.todo('should generate signed URL for private files');
  });

  describe('generateAndStoreLeasePDF', () => {
    it.todo('should generate PDF from lease data');
    it.todo('should upload PDF to S3');
    it.todo('should create Asset record with fieldName "generatedPDF"');
  });

  describe('sendLeaseForSignature', () => {
    it.todo('should send lease for e-signature');
    it.todo('should validate lease has document');
    it.todo('should prepare signers array');
    it.todo('should update lease with envelope ID');
    it.todo('should emit LEASE_SENT_FOR_SIGNATURE event');
  });

  describe('markAsManualySigned', () => {
    it.todo('should mark lease as manually signed');
    it.todo('should auto-activate lease');
    it.todo('should emit LEASE_MANUALLY_SIGNED event');
  });

  describe('getSignatureDetails', () => {
    it.todo('should return signature status');
    it.todo('should include signing URLs');
    it.todo('should include signer details');
  });

  describe('getExpiringLeases', () => {
    it.todo('should get leases expiring within X days');
    it.todo('should only return active leases');
  });

  describe('getLeaseStats', () => {
    it.todo('should return lease statistics');
    it.todo('should include leases by status');
    it.todo('should calculate total monthly rent');
    it.todo('should calculate average lease duration');
  });

  describe('exportLeases', () => {
    it.todo('should export leases to CSV');
    it.todo('should export leases to Excel');
    it.todo('should apply filters to export');
  });

  describe('validateLeaseCreation', () => {
    it.todo('should validate all required fields present');
    it.todo('should throw error for missing fields');
  });

  describe('validateDates', () => {
    it.todo('should accept valid dates (end > start)');
    it.todo('should throw error if end <= start');
    it.todo('should validate moveInDate >= startDate');
  });

  describe('validateFinancialTerms', () => {
    it.todo('should accept valid financial terms');
    it.todo('should throw error if rent <= 0');
    it.todo('should throw error if deposit < 0');
    it.todo('should validate rentDueDay between 1-31');
  });

  describe('checkOverlappingLeases', () => {
    it.todo('should return empty array when no overlap');
    it.todo('should return overlapping leases');
    it.todo('should exclude specified lease ID');
  });

  // ============================================================================
  // APPROVAL WORKFLOW TESTS
  // ============================================================================

  describe('Approval Workflow', () => {
    describe('createLease - approval status', () => {
      it.todo('should auto-approve lease created by admin');
      it.todo('should set lease to pending when created by staff');

      // TODO: Fix validation mocks - these tests require extensive mocking of validation dependencies
      /*
      it('should auto-approve lease created by admin', async () => {
        const mockUser = createMockUser(IUserRole.ADMIN);
        const mockClient = { cuid: 'C123', name: 'Test Client' };
        const mockLease = createMockLease({ approvalStatus: 'approved' });

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.userDAO.findFirst.mockResolvedValue({
          uid: 'T123',
          role: 'tenant',
          user: new Types.ObjectId(),
        });
        mockDependencies.profileDAO.generateCurrentUserInfo.mockResolvedValue({
          client: { role: 'tenant' },
        });
        mockDependencies.propertyDAO.findFirst.mockResolvedValue({ pid: 'P123' });
        mockDependencies.propertyUnitDAO.findFirst.mockResolvedValue(null); // No unit
        mockDependencies.leaseDAO.checkOverlappingLeases.mockResolvedValue([]);
        mockDependencies.leaseDAO.startSession.mockResolvedValue(null);
        mockDependencies.leaseDAO.withTransaction.mockImplementation(async (session, fn) =>
          fn(session)
        );
        mockDependencies.leaseDAO.createLease.mockResolvedValue(mockLease);

        const leaseData: any = {
          type: LeaseType.FIXED_TERM,
          tenantId: 'T123',
          property: { id: 'P123', address: '123 Main St' },
          duration: {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
          },
          fees: {
            monthlyRent: '1500.00',
            securityDeposit: '3000.00',
            rentDueDay: 1,
            currency: 'USD',
          },
        };

        const result = await leaseService.createLease('C123', leaseData, {
          currentuser: mockUser,
        });

        expect(result.success).toBe(true);
        expect(mockDependencies.leaseDAO.createLease).toHaveBeenCalledWith(
          'C123',
          expect.objectContaining({
            approvalStatus: 'approved',
            approvalDetails: expect.arrayContaining([
              expect.objectContaining({
                action: 'created',
                notes: 'Auto-approved by admin/manager',
              }),
            ]),
          }),
          null
        );
        expect(result.message).toContain('approved');
      });

      it('should set lease to pending when created by staff', async () => {
        const mockUser = createMockUser(IUserRole.STAFF);
        const mockClient = { cuid: 'C123', name: 'Test Client' };
        const mockLease = createMockLease({ approvalStatus: 'pending' });

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.userDAO.findFirst.mockResolvedValue({
          uid: 'T123',
          role: 'tenant',
          user: new Types.ObjectId(),
        });
        mockDependencies.profileDAO.generateCurrentUserInfo.mockResolvedValue({
          client: { role: 'tenant' },
        });
        mockDependencies.propertyDAO.findFirst.mockResolvedValue({ pid: 'P123' });
        mockDependencies.propertyUnitDAO.findFirst.mockResolvedValue(null); // No unit
        mockDependencies.leaseDAO.checkOverlappingLeases.mockResolvedValue([]);
        mockDependencies.leaseDAO.startSession.mockResolvedValue(null);
        mockDependencies.leaseDAO.withTransaction.mockImplementation(async (session, fn) =>
          fn(session)
        );
        mockDependencies.leaseDAO.createLease.mockResolvedValue(mockLease);

        const leaseData: any = {
          type: LeaseType.FIXED_TERM,
          tenantId: 'T123',
          property: { id: 'P123', address: '123 Main St' },
          duration: {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
          },
          fees: {
            monthlyRent: '1500.00',
            securityDeposit: '3000.00',
            rentDueDay: 1,
            currency: 'USD',
          },
        };

        const result = await leaseService.createLease('C123', leaseData, {
          currentuser: mockUser,
        });

        expect(result.success).toBe(true);
        expect(mockDependencies.leaseDAO.createLease).toHaveBeenCalledWith(
          'C123',
          expect.objectContaining({
            approvalStatus: 'pending',
            approvalDetails: expect.arrayContaining([
              expect.objectContaining({
                action: 'created',
              }),
            ]),
          }),
          null
        );
        expect(mockDependencies.notificationService.handlePropertyUpdateNotifications).toHaveBeenCalled();
        expect(result.message).toContain('approval');
      });
      */
    });

    describe('approveLease', () => {
      it('should approve lease and apply pending changes', async () => {
        const mockUser = createMockUser(IUserRole.ADMIN);
        const mockLease = createMockLease({
          approvalStatus: 'pending',
          pendingChanges: {
            internalNotes: 'Updated notes',
            updatedBy: new Types.ObjectId(),
            updatedAt: new Date(),
          },
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDependencies.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          approvalStatus: 'approved',
          internalNotes: 'Updated notes',
          pendingChanges: null,
        });

        const result = await leaseService.approveLease(
          'C123',
          'L-2025-ABC123',
          mockUser,
          'Looks good'
        );

        expect(result.success).toBe(true);
        expect(mockDependencies.leaseDAO.update).toHaveBeenCalledWith(
          { luid: 'L-2025-ABC123', cuid: 'C123', deletedAt: null },
          expect.objectContaining({
            $set: expect.objectContaining({
              approvalStatus: 'approved',
              internalNotes: 'Updated notes',
              pendingChanges: null,
            }),
            $push: expect.objectContaining({
              approvalDetails: expect.objectContaining({
                action: 'approved',
                notes: 'Looks good',
              }),
            }),
          })
        );
        expect(mockDependencies.notificationService.notifyApprovalDecision).toHaveBeenCalled();
      });

      it('should throw error when non-admin tries to approve', async () => {
        const mockUser = createMockUser(IUserRole.STAFF);

        await expect(
          leaseService.approveLease('C123', 'L-2025-ABC123', mockUser, 'test')
        ).rejects.toThrow('not authorized to approve');
      });

      it('should throw error if lease not found', async () => {
        const mockUser = createMockUser(IUserRole.ADMIN);
        mockDependencies.leaseDAO.findFirst.mockResolvedValue(null);

        await expect(
          leaseService.approveLease('C123', 'L-2025-ABC123', mockUser)
        ).rejects.toThrow();
      });
    });

    describe('rejectLease', () => {
      it('should reject lease and clear pending changes', async () => {
        const mockUser = createMockUser(IUserRole.ADMIN);
        const mockLease = createMockLease({
          approvalStatus: 'pending',
          pendingChanges: { internalNotes: 'test' },
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDependencies.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          approvalStatus: 'rejected',
          pendingChanges: null,
        });

        const result = await leaseService.rejectLease(
          'C123',
          'L-2025-ABC123',
          mockUser,
          'Needs corrections'
        );

        expect(result.success).toBe(true);
        expect(mockDependencies.leaseDAO.update).toHaveBeenCalledWith(
          { luid: 'L-2025-ABC123', cuid: 'C123', deletedAt: null },
          expect.objectContaining({
            $set: expect.objectContaining({
              approvalStatus: 'rejected',
              pendingChanges: null,
            }),
            $push: expect.objectContaining({
              approvalDetails: expect.objectContaining({
                action: 'rejected',
                notes: 'Needs corrections',
              }),
            }),
          })
        );
        expect(mockDependencies.notificationService.notifyApprovalDecision).toHaveBeenCalled();
      });

      it('should throw error when non-admin tries to reject', async () => {
        const mockUser = createMockUser(IUserRole.STAFF);

        await expect(
          leaseService.rejectLease('C123', 'L-2025-ABC123', mockUser, 'test')
        ).rejects.toThrow('not authorized');
      });
    });
  });

  // ============================================================================
  // BUSINESS RULE TESTS
  // ============================================================================

  describe('Business Rules', () => {
    describe('Status Transition Validation', () => {
      it.todo('should allow valid transition from DRAFT to ACTIVE');
      it.todo('should allow valid transition from DRAFT to PENDING_SIGNATURE');
      it.todo('should allow valid transition from ACTIVE to TERMINATED');
      it.todo('should block invalid transition from EXPIRED to ACTIVE');
      it.todo('should block invalid transition from TERMINATED to ACTIVE');
      it.todo('should block invalid transition from CANCELLED to ACTIVE');

      // Tests below are commented out until updateLease is implemented
      /*
      it('should allow valid transition from DRAFT to ACTIVE', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.DRAFT,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDependencies.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          status: LeaseStatus.ACTIVE,
        });

        // This should not throw
        const result = await leaseService.updateLease('C123', 'L-2025-ABC123', {
          status: LeaseStatus.ACTIVE,
        });

        expect(result.success).toBe(true);
      });

      it('should allow valid transition from DRAFT to PENDING_SIGNATURE', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.DRAFT,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDependencies.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          status: LeaseStatus.PENDING_SIGNATURE,
        });

        const result = await leaseService.updateLease('C123', 'L-2025-ABC123', {
          status: LeaseStatus.PENDING_SIGNATURE,
        });

        expect(result.success).toBe(true);
      });

      it('should allow valid transition from ACTIVE to TERMINATED', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDependencies.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          status: LeaseStatus.TERMINATED,
        });

        const result = await leaseService.updateLease('C123', 'L-2025-ABC123', {
          status: LeaseStatus.TERMINATED,
        });

        expect(result.success).toBe(true);
      });

      it('should block invalid transition from EXPIRED to ACTIVE', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.EXPIRED,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.updateLease('C123', 'L-2025-ABC123', {
            status: LeaseStatus.ACTIVE,
          })
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should block invalid transition from TERMINATED to ACTIVE', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.TERMINATED,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.updateLease('C123', 'L-2025-ABC123', {
            status: LeaseStatus.ACTIVE,
          })
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should block invalid transition from CANCELLED to ACTIVE', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.CANCELLED,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.updateLease('C123', 'L-2025-ABC123', {
            status: LeaseStatus.ACTIVE,
          })
        ).rejects.toThrow(ValidationRequestError);
      });
      */
    });

    describe('Lease Deletion Rules', () => {
      it('should allow deletion of DRAFT lease', async () => {
        const userId = new Types.ObjectId().toString();
        const mockLease = createMockLease({ status: LeaseStatus.DRAFT });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        const result = await leaseService.deleteLease('C123', 'L-2025-ABC123', userId);

        expect(result.success).toBe(true);
        expect(mockLease.softDelete).toHaveBeenCalled();
      });

      it('should allow deletion of CANCELLED lease', async () => {
        const userId = new Types.ObjectId().toString();
        const mockLease = createMockLease({ status: LeaseStatus.CANCELLED });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        const result = await leaseService.deleteLease('C123', 'L-2025-ABC123', userId);

        expect(result.success).toBe(true);
        expect(mockLease.softDelete).toHaveBeenCalled();
      });

      it('should block deletion of ACTIVE lease', async () => {
        const mockLease = createMockLease({ status: LeaseStatus.ACTIVE });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')
        ).rejects.toThrow(ValidationRequestError);

        await expect(
          leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')
        ).rejects.toThrow('Cannot delete active lease');
      });

      it('should block deletion of PENDING_SIGNATURE lease', async () => {
        const mockLease = createMockLease({ status: LeaseStatus.PENDING_SIGNATURE });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should block deletion of TERMINATED lease', async () => {
        const mockLease = createMockLease({ status: LeaseStatus.TERMINATED });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should block deletion of EXPIRED lease', async () => {
        const mockLease = createMockLease({ status: LeaseStatus.EXPIRED });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should throw error if lease not found for deletion', async () => {
        mockDependencies.leaseDAO.findFirst.mockResolvedValue(null);

        await expect(
          leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')
        ).rejects.toThrow(BadRequestError);
      });
    });

    describe('Active Lease Field Locking', () => {
      it.todo('should allow updates to mutable fields on ACTIVE lease');
      it.todo('should block updates to tenantId on ACTIVE lease');
      it.todo('should block updates to property.id on ACTIVE lease');
      it.todo('should block updates to fees.monthlyRent on ACTIVE lease');
      it.todo('should block updates to duration.startDate on ACTIVE lease');
      it.todo('should block updates to duration.endDate on ACTIVE lease');
      it.todo('should allow all updates on DRAFT lease');

      // Tests below are commented out until updateLease is implemented
      /*
      it('should allow updates to mutable fields on ACTIVE lease', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDependencies.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          internalNotes: 'Updated notes',
        });

        // internalNotes is allowed to be updated
        const result = await leaseService.updateLease('C123', 'L-2025-ABC123', {
          internalNotes: 'Updated notes',
        });

        expect(result.success).toBe(true);
      });

      it('should block updates to tenantId on ACTIVE lease', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.updateLease('C123', 'L-2025-ABC123', {
            tenantId: new Types.ObjectId().toString(),
          })
        ).rejects.toThrow(ValidationRequestError);

        await expect(
          leaseService.updateLease('C123', 'L-2025-ABC123', {
            tenantId: new Types.ObjectId().toString(),
          })
        ).rejects.toThrow('Cannot modify immutable fields');
      });

      it('should block updates to property.id on ACTIVE lease', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.updateLease('C123', 'L-2025-ABC123', {
            property: { id: new Types.ObjectId() },
          })
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should block updates to fees.monthlyRent on ACTIVE lease', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.updateLease('C123', 'L-2025-ABC123', {
            fees: { monthlyRent: '2000.00' },
          })
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should block updates to duration.startDate on ACTIVE lease', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.updateLease('C123', 'L-2025-ABC123', {
            duration: { startDate: new Date('2025-02-01') },
          })
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should block updates to duration.endDate on ACTIVE lease', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.updateLease('C123', 'L-2025-ABC123', {
            duration: { endDate: new Date('2027-01-01') },
          })
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should allow all updates on DRAFT lease', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.DRAFT,
          approvalStatus: 'draft',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDependencies.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          tenantId: new Types.ObjectId(),
        });

        // All fields can be updated on DRAFT lease
        const result = await leaseService.updateLease('C123', 'L-2025-ABC123', {
          tenantId: new Types.ObjectId().toString(),
        });

        expect(result.success).toBe(true);
      });
      */
    });

    describe('Approval Requirement Enforcement', () => {
      it('should block activating lease with pending approval status', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.DRAFT,
          approvalStatus: 'pending',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(leaseService.activateLease('C123', 'L-2025-ABC123', 'U123')).rejects.toThrow(
          'pending approval'
        );
      });

      it('should block activating lease with rejected approval status', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.DRAFT,
          approvalStatus: 'rejected',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(leaseService.activateLease('C123', 'L-2025-ABC123', 'U123')).rejects.toThrow(
          'has been rejected'
        );
      });

      it('should block activating lease with draft approval status', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.DRAFT,
          approvalStatus: 'draft',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(leaseService.activateLease('C123', 'L-2025-ABC123', 'U123')).rejects.toThrow(
          'draft status'
        );
      });

      it.todo('should allow activating approved lease');

      // TODO: activateLease is not yet fully implemented
      /*
      it('should allow activating approved lease', async () => {
        const tenantId = new Types.ObjectId();
        const mockLease = createMockLease({
          tenantId,
          status: LeaseStatus.DRAFT,
          approvalStatus: 'approved',
          leaseDocument: [{ filename: 'lease.pdf', key: 'key1', url: 'url1' }],
          signatures: [{ userId: tenantId, role: 'tenant', signedAt: new Date() }],
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDependencies.leaseDAO.update.mockResolvedValue({
          ...mockLease,
          status: LeaseStatus.ACTIVE,
        });

        const result = await leaseService.activateLease('C123', 'L-2025-ABC123', 'U123');

        expect(result.success).toBe(true);
      });
      */
    });
  });
});
