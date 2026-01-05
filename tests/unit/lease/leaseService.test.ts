import { Types } from 'mongoose';
import { LeaseService } from '@services/lease/lease.service';
import { IUserRole } from '@shared/constants/roles.constants';
import { LeaseStatus, LeaseType } from '@interfaces/lease.interface';
import { calculateFinancialSummary } from '@services/lease/leaseHelpers';
import { ValidationRequestError, BadRequestError, ForbiddenError } from '@shared/customErrors';
import { generatePendingChangesPreview, shouldShowPendingChanges, generateChangesSummary } from '@services/lease/leaseHelpers';

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
    updateMany: jest.fn(),
    updateLeaseDocuments: jest.fn(),
    getTenantInfo: jest.fn(),
    getLeasesPendingTenantAcceptance: jest.fn(),
    updateLeaseDocumentStatus: jest.fn(),
  },
  propertyDAO: {
    findFirst: jest.fn(),
  },
  propertyUnitDAO: {
    findFirst: jest.fn(),
  },
  userDAO: {
    findFirst: jest.fn(),
    getUserById: jest.fn(),
    getUserByEmail: jest.fn(),
  },
  profileDAO: {
    findFirst: jest.fn(),
    generateCurrentUserInfo: jest.fn(),
  },
  clientDAO: {
    getClientByCuid: jest.fn(),
  },
  invitationDAO: {
    findFirst: jest.fn(),
    findOne: jest.fn(),
    findPendingInvitation: jest.fn(),
  },
  invitationService: {
    sendInvitation: jest.fn(),
  },
  assetService: {
    createAssets: jest.fn(),
    getAssetsByResource: jest.fn(),
    deleteAsset: jest.fn(),
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
  useInvitationIdAsTenantId: false,
  tenantInfo: {
    fullname: 'Test Tenant',
    user: {
      email: 'tenant@example.com',
    },
    personalInfo: {
      phoneNumber: '555-1234',
      avatar: null,
    },
    email: 'tenant@example.com',
  },
  propertyInfo: {
    _id: new Types.ObjectId(),
    address: '123 Main St',
    name: 'Test Property',
  },
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
    acceptedPaymentMethod: 'bank_transfer',
  },
  createdBy: new Types.ObjectId(),
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-01'),
  approvalStatus: 'draft',
  approvalDetails: [],
  deletedAt: null,
  leaseDocument: [],
  softDelete: jest.fn().mockResolvedValue(true),
  ...overrides,
});

const createMockProperty = (overrides?: any) => ({
  _id: new Types.ObjectId(),
  pid: 'P-2025-ABC',
  cuid: 'C123',
  propertyType: 'apartment',
  name: 'Test Apartment Complex',
  address: {
    fullAddress: '123 Main St',
    city: 'San Francisco',
    state: 'CA',
  },
  fees: {
    rentalAmount: 150000,
    securityDeposit: 300000,
    currency: 'USD',
  },
  approvalStatus: 'approved',
  maxAllowedUnits: 10,
  deletedAt: null,
  owner: {
    type: 'company_owned',
  },
  authorization: {
    isActive: true,
  },
  isManagementAuthorized: jest.fn().mockReturnValue(true),
  getAuthorizationStatus: jest.fn().mockReturnValue({ isAuthorized: true }),
  ...overrides,
});

const createMockUnit = (overrides?: any) => ({
  _id: new Types.ObjectId(),
  puid: 'U-2025-001',
  cuid: 'C123',
  propertyId: new Types.ObjectId(),
  unitNumber: '101',
  status: 'available',
  fees: {
    rentAmount: 150000,
    securityDeposit: 300000,
    currency: 'USD',
  },
  specifications: {
    bedrooms: 2,
    bathrooms: 2,
    totalArea: 1000,
  },
  ...overrides,
});

const createMockInvitation = (overrides?: any) => ({
  _id: new Types.ObjectId(),
  inviteeEmail: 'tenant@example.com',
  clientId: new Types.ObjectId(),
  role: 'tenant',
  status: 'pending',
  ...overrides,
});

const createMockClient = (overrides?: any) => ({
  id: new Types.ObjectId(),
  cuid: 'C123',
  accountType: {
    isCorporate: true,
  },
  accountAdmin: new Types.ObjectId(),
  companyProfile: {
    legalEntityName: 'Test Property Management LLC',
    companyAddress: '123 Business Ave, San Francisco, CA 94102',
    companyEmail: 'admin@testpm.com',
    companyPhone: '+1-555-0100',
  },
  ...overrides,
});

const createMockProfile = (overrides?: any) => ({
  _id: new Types.ObjectId(),
  user: {
    _id: new Types.ObjectId(),
    uid: 'U123',
    email: 'admin@testpm.com',
    isActive: true,
    activecuid: 'C123',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  personalInfo: {
    firstName: 'John',
    lastName: 'Doe',
    phoneNumber: '+1-555-0100',
    location: '123 Business Ave, San Francisco, CA 94102',
  },
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
    it.todo('should create lease with pending invitation using email');
    it.todo('should use invitation ID as temporary tenantId when tenant not accepted');
    it.todo('should set useInvitationIdAsTenantId to true for pending invitations');
    it.todo('should use user ID when invitation already accepted');

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

    describe('multi-unit property validation', () => {
      it('should require unitId for apartment properties', async () => {
        const mockProperty = createMockProperty({ propertyType: 'apartment' });
        const mockClient = { id: new Types.ObjectId(), cuid: 'C123' };
        const mockUser = createMockUser(IUserRole.MANAGER);

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
        mockDependencies.userDAO.getUserById.mockResolvedValue({
          _id: new Types.ObjectId(),
          cuids: [{ cuid: 'C123', roles: ['tenant'] }],
        });
        mockDependencies.leaseDAO.checkOverlappingLeases.mockResolvedValue([]);

        const leaseData = {
          tenantInfo: { id: 'T123', email: undefined },
          property: {
            id: mockProperty._id.toString(),
            address: '123 Main St',
            // unitId missing!
          },
          duration: {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
          },
          fees: {
            monthlyRent: 1500,
            securityDeposit: 1500,
            rentDueDay: 1,
            currency: 'USD',
          },
          type: LeaseType.FIXED_TERM,
          leaseNumber: 'LEASE-TEST-001',
        };

        await expect(
          leaseService.createLease('C123', leaseData, { currentuser: mockUser } as any)
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should validate unit exists and belongs to property', async () => {
        const mockProperty = createMockProperty({ propertyType: 'apartment' });
        const mockClient = { id: new Types.ObjectId(), cuid: 'C123' };
        const mockUser = createMockUser(IUserRole.MANAGER);

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
        mockDependencies.propertyUnitDAO.findFirst.mockResolvedValue(null); // Unit not found!
        mockDependencies.userDAO.getUserById.mockResolvedValue({
          _id: new Types.ObjectId(),
          cuids: [{ cuid: 'C123', roles: ['tenant'] }],
        });
        mockDependencies.leaseDAO.checkOverlappingLeases.mockResolvedValue([]);

        const leaseData = {
          tenantInfo: { id: 'T123', email: undefined },
          property: {
            id: mockProperty._id.toString(),
            unitId: 'INVALID-UNIT-ID',
            address: '123 Main St',
          },
          duration: {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
          },
          fees: {
            monthlyRent: 1500,
            securityDeposit: 1500,
            rentDueDay: 1,
            currency: 'USD',
          },
          type: LeaseType.FIXED_TERM,
          leaseNumber: 'LEASE-TEST-002',
        };

        await expect(
          leaseService.createLease('C123', leaseData, { currentuser: mockUser } as any)
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should reject occupied units', async () => {
        const mockProperty = createMockProperty({ propertyType: 'apartment' });
        const mockUnit = createMockUnit({
          status: 'occupied', // OCCUPIED!
          propertyId: mockProperty._id,
        });
        const mockClient = { id: new Types.ObjectId(), cuid: 'C123' };
        const mockUser = createMockUser(IUserRole.MANAGER);

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
        mockDependencies.propertyUnitDAO.findFirst.mockResolvedValue(mockUnit);
        mockDependencies.userDAO.getUserById.mockResolvedValue({
          _id: new Types.ObjectId(),
          cuids: [{ cuid: 'C123', roles: ['tenant'] }],
        });
        mockDependencies.leaseDAO.checkOverlappingLeases.mockResolvedValue([]);

        const leaseData = {
          tenantInfo: { id: 'T123', email: undefined },
          property: {
            id: mockProperty._id.toString(),
            unitId: mockUnit._id.toString(),
            address: '123 Main St',
          },
          duration: {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
          },
          fees: {
            monthlyRent: 1500,
            securityDeposit: 1500,
            rentDueDay: 1,
            currency: 'USD',
          },
          type: LeaseType.FIXED_TERM,
          leaseNumber: 'LEASE-TEST-003',
        };

        await expect(
          leaseService.createLease('C123', leaseData, { currentuser: mockUser } as any)
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should NOT require unitId for single-unit properties', async () => {
        const mockProperty = createMockProperty({
          propertyType: 'house', // Single-unit property
          maxAllowedUnits: 1,
        });
        const mockClient = createMockClient();
        const mockProfile = createMockProfile();
        const mockUser = createMockUser(IUserRole.MANAGER);
        const mockLease = createMockLease();

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
        mockDependencies.profileDAO.findFirst.mockResolvedValue(mockProfile);
        const tenantId = new Types.ObjectId();
        mockDependencies.userDAO.findFirst.mockResolvedValue({
          _id: tenantId,
          cuids: [{ cuid: 'C123', roles: ['tenant'] }],
        });
        mockDependencies.leaseDAO.checkOverlappingLeases.mockResolvedValue([]);
        mockDependencies.leaseDAO.startSession.mockResolvedValue({});
        mockDependencies.leaseDAO.withTransaction.mockImplementation(async (session, callback) => {
          return callback(session);
        });
        mockDependencies.leaseDAO.createLease.mockResolvedValue(mockLease);

        const leaseData = {
          tenantInfo: { id: tenantId.toString(), email: undefined },
          property: {
            id: mockProperty._id.toString(),
            // NO unitId for house - should be fine!
            address: '456 Oak St',
          },
          duration: {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
          },
          fees: {
            monthlyRent: 2500,
            securityDeposit: 2500,
            rentDueDay: 1,
            currency: 'USD',
          },
          type: LeaseType.FIXED_TERM,
          leaseNumber: 'LEASE-TEST-004',
        };

        const result = await leaseService.createLease('C123', leaseData, {
          currentuser: mockUser,
        } as any);

        expect(result.success).toBe(true);
        expect(mockDependencies.leaseDAO.createLease).toHaveBeenCalled();
      });
    });

    describe('invitation-based tenant creation', () => {
      it('should create lease with pending invitation using email', async () => {
        const mockInvitation = createMockInvitation({ status: 'pending' });
        const mockProperty = createMockProperty({ propertyType: 'house' });
        const mockClient = createMockClient({ id: mockInvitation.clientId });
        const mockProfile = createMockProfile();
        const mockUser = createMockUser(IUserRole.MANAGER);
        const mockLease = createMockLease({
          tenantId: mockInvitation._id,
          useInvitationIdAsTenantId: true,
        });

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
        mockDependencies.profileDAO.findFirst.mockResolvedValue(mockProfile);
        mockDependencies.invitationDAO.findFirst.mockResolvedValue(mockInvitation);
        mockDependencies.leaseDAO.checkOverlappingLeases.mockResolvedValue([]);
        mockDependencies.leaseDAO.startSession.mockResolvedValue({});
        mockDependencies.leaseDAO.withTransaction.mockImplementation(async (session, callback) => {
          return callback(session);
        });
        mockDependencies.leaseDAO.createLease.mockResolvedValue(mockLease);

        const leaseData = {
          tenantInfo: {
            id: null,
            email: 'tenant@example.com', // Using email!
          },
          property: {
            id: mockProperty._id.toString(),
            address: '456 Oak St',
          },
          duration: {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
          },
          fees: {
            monthlyRent: 2500,
            securityDeposit: 2500,
            rentDueDay: 1,
            currency: 'USD',
          },
          type: LeaseType.FIXED_TERM,
          leaseNumber: 'LEASE-TEST-005',
        };

        const result = await leaseService.createLease('C123', leaseData, {
          currentuser: mockUser,
        } as any);

        expect(result.success).toBe(true);
        expect(result.data.tenantId).toBe(mockInvitation._id);
        expect(result.data.useInvitationIdAsTenantId).toBe(true);
      });

      it('should reject lease for tenant with no invitation', async () => {
        const mockProperty = createMockProperty({ propertyType: 'house' });
        const mockClient = { id: new Types.ObjectId(), cuid: 'C123' };
        const mockUser = createMockUser(IUserRole.MANAGER);

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
        mockDependencies.invitationDAO.findFirst.mockResolvedValue(null); // No invitation!
        mockDependencies.leaseDAO.checkOverlappingLeases.mockResolvedValue([]);

        const leaseData = {
          tenantInfo: {
            id: null,
            email: 'noinvite@example.com',
          },
          property: {
            id: mockProperty._id.toString(),
            address: '456 Oak St',
          },
          duration: {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
          },
          fees: {
            monthlyRent: 2500,
            securityDeposit: 2500,
            rentDueDay: 1,
            currency: 'USD',
          },
          type: LeaseType.FIXED_TERM,
          leaseNumber: 'LEASE-TEST-006',
        };

        await expect(
          leaseService.createLease('C123', leaseData, { currentuser: mockUser } as any)
        ).rejects.toThrow(ValidationRequestError);
      });
    });
  });

  describe('getFilteredLeases', () => {
    it('should get leases with filters and include sentForSignature/tenantActivated', async () => {
      const mockFilters = { status: LeaseStatus.ACTIVE };
      const mockPaginationOpts = { page: 1, limit: 10 };
      const mockLeaseData = {
        items: [
          {
            luid: 'L-2025-001',
            leaseNumber: 'LEASE-001',
            tenantName: 'John Doe',
            propertyAddress: '123 Main St',
            unitNumber: '101',
            monthlyRent: 1500,
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
            status: LeaseStatus.ACTIVE,
            sentForSignature: true,
            tenantActivated: true,
          },
        ],
        pagination: { total: 1, currentPage: 1, totalPages: 1, perPage: 10 },
      };

      mockDependencies.leaseCache.getClientLeases.mockResolvedValue({
        success: false,
        data: null,
      });

      mockDependencies.leaseDAO.getFilteredLeases.mockResolvedValue(mockLeaseData);

      const result = await leaseService.getFilteredLeases('C123', mockFilters, mockPaginationOpts);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        sentForSignature: true,
        tenantActivated: true,
      });
      expect(mockDependencies.leaseDAO.getFilteredLeases).toHaveBeenCalledWith(
        'C123',
        mockFilters,
        mockPaginationOpts
      );
    });

    it('should return sentForSignature=false for non-electronic leases', async () => {
      const mockLeaseData = {
        items: [
          {
            luid: 'L-2025-002',
            leaseNumber: 'LEASE-002',
            tenantName: 'Jane Smith',
            propertyAddress: '456 Oak Ave',
            unitNumber: null,
            monthlyRent: 2000,
            startDate: new Date('2025-02-01'),
            endDate: new Date('2026-02-01'),
            status: LeaseStatus.DRAFT,
            sentForSignature: false,
            tenantActivated: false,
          },
        ],
        pagination: { total: 1, currentPage: 1, totalPages: 1, perPage: 10 },
      };

      // Mock cache miss
      mockDependencies.leaseCache.getClientLeases.mockResolvedValue({
        success: false,
        data: null,
      });

      mockDependencies.leaseDAO.getFilteredLeases.mockResolvedValue(mockLeaseData);

      const result = await leaseService.getFilteredLeases('C123', {}, { page: 1, limit: 10 });

      expect((result as any).data[0]).toMatchObject({
        sentForSignature: false,
        tenantActivated: false,
      });
    });

    it.todo('should apply status filter');
    it.todo('should apply date range filters');
    it.todo('should apply property/unit filters');
    it.todo('should return paginated results');
  });

  describe('getLeaseById', () => {
    it.todo('should get lease by ID');
    it.todo('should throw error if lease not found');
    it.todo('should populate tenant/property references');

    describe('constructActivityFeed', () => {
      it('should construct activity feed with lastModifiedBy events', async () => {
        const mockUser = createMockUser(IUserRole.MANAGER);
        const modifiedById = new Types.ObjectId();
        const mockLease = createMockLease({
          createdAt: new Date('2025-01-01'),
          lastModifiedBy: [
            {
              userId: modifiedById,
              name: 'John Manager',
              date: new Date('2025-01-15'),
              action: 'updated',
            },
            {
              userId: modifiedById,
              name: 'John Manager',
              date: new Date('2025-01-20'),
              action: 'activated',
            },
          ],
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        const result = await leaseService.getLeaseById(
          { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
          mockLease.luid
        );

        expect(result.success).toBe(true);
        // Activity feed should include creation + 2 modification events
        expect(result.data.activity).toHaveLength(3);
        expect(result.data.activity[0].type).toBe('activated'); // Most recent first
        expect(result.data.activity[1].type).toBe('updated');
        expect(result.data.activity[2].type).toBe('created');
      });

      it('should construct activity feed with approvalDetails events', async () => {
        const mockUser = createMockUser(IUserRole.MANAGER);
        const actorId = new Types.ObjectId();
        const mockLease = createMockLease({
          createdAt: new Date('2025-01-01'),
          approvalDetails: [
            {
              action: 'created',
              actor: actorId,
              timestamp: new Date('2025-01-01'),
              notes: 'Initial creation',
            },
            {
              action: 'submitted',
              actor: actorId,
              timestamp: new Date('2025-01-02'),
              notes: 'Submitted for approval',
            },
            {
              action: 'approved',
              actor: actorId,
              timestamp: new Date('2025-01-03'),
              notes: 'Approved by manager',
            },
          ],
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        const result = await leaseService.getLeaseById(
          { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
          mockLease.luid
        );

        expect(result.success).toBe(true);
        expect(result.data.activity.length).toBe(4);
        const approvalEvents = result.data.activity.filter((a: any) =>
          ['submitted', 'approved', 'created'].includes(a.type)
        );
        expect(approvalEvents.length).toBe(4);
      });

      it('should include rejection reason in activity feed when lease is rejected', async () => {
        const mockUser = createMockUser(IUserRole.MANAGER);
        const actorId = new Types.ObjectId();
        const mockLease = createMockLease({
          createdAt: new Date('2025-01-01'),
          approvalDetails: [
            {
              action: 'rejected',
              actor: actorId,
              timestamp: new Date('2025-01-05'),
              notes: 'Additional review needed',
              rejectionReason: 'Missing tenant documentation',
            },
          ],
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        const result = await leaseService.getLeaseById(
          { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
          mockLease.luid
        );

        expect(result.success).toBe(true);
        const rejectionEvent = result.data.activity.find((a: any) => a.type === 'rejected');
        expect(rejectionEvent).toBeDefined();
        expect(rejectionEvent.description).toContain('Missing tenant documentation');
        expect(rejectionEvent.rejectionReason).toBe('Missing tenant documentation');
      });

      it('should construct activity feed with signature events', async () => {
        const mockUser = createMockUser(IUserRole.MANAGER);
        const tenantId = new Types.ObjectId();
        const landlordId = new Types.ObjectId();
        const mockLease = createMockLease({
          createdAt: new Date('2025-01-01'),
          signatures: [
            {
              userId: tenantId,
              role: 'tenant',
              signatureMethod: 'electronic',
              signedAt: new Date('2025-01-10'),
            },
            {
              userId: landlordId,
              role: 'landlord',
              signatureMethod: 'electronic',
              signedAt: new Date('2025-01-11'),
            },
          ],
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        const result = await leaseService.getLeaseById(
          { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
          mockLease.luid
        );

        expect(result.success).toBe(true);
        const signatureEvents = result.data.activity.filter((a: any) => a.type === 'signed');
        expect(signatureEvents).toHaveLength(2);
        expect(signatureEvents[0].role).toBe('landlord'); // Most recent first
        expect(signatureEvents[1].role).toBe('tenant');
      });

      it('should construct activity feed with termination event', async () => {
        const mockUser = createMockUser(IUserRole.MANAGER);
        const mockLease = createMockLease({
          createdAt: new Date('2025-01-01'),
          status: LeaseStatus.TERMINATED,
          terminationReason: 'Tenant requested early termination',
          duration: {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
            terminationDate: new Date('2025-06-15'),
          },
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        const result = await leaseService.getLeaseById(
          { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
          mockLease.luid
        );

        expect(result.success).toBe(true);
        const terminationEvent = result.data.activity.find((a: any) => a.type === 'terminated');
        expect(terminationEvent).toBeDefined();
        expect(terminationEvent.description).toContain('Tenant requested early termination');
      });

      it('should sort activity feed by timestamp descending', async () => {
        const mockUser = createMockUser(IUserRole.MANAGER);
        const mockLease = createMockLease({
          createdAt: new Date('2025-01-01'),
          lastModifiedBy: [
            {
              userId: new Types.ObjectId(),
              name: 'Manager',
              date: new Date('2025-01-10'),
              action: 'updated',
            },
          ],
          approvalDetails: [
            {
              action: 'approved',
              actor: new Types.ObjectId(),
              timestamp: new Date('2025-01-05'),
            },
          ],
          signatures: [
            {
              userId: new Types.ObjectId(),
              role: 'tenant',
              signatureMethod: 'electronic',
              signedAt: new Date('2025-01-15'),
            },
          ],
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        const result = await leaseService.getLeaseById(
          { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
          mockLease.luid
        );

        expect(result.success).toBe(true);
        const timestamps = result.data.activity.map((a: any) => new Date(a.timestamp).getTime());

        // Verify descending order (most recent first)
        for (let i = 0; i < timestamps.length - 1; i++) {
          expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
        }
      });

      it('should include metadata in approval events when provided', async () => {
        const mockUser = createMockUser(IUserRole.MANAGER);
        const actorId = new Types.ObjectId();
        const mockLease = createMockLease({
          createdAt: new Date('2025-01-01'),
          approvalDetails: [
            {
              action: 'approved',
              actor: actorId,
              timestamp: new Date('2025-01-03'),
              notes: 'Approved',
              metadata: {
                approverRole: 'regional_manager',
                approvalLevel: 'level2',
                previousApprovers: ['manager1', 'manager2'],
              },
            },
          ],
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        const result = await leaseService.getLeaseById(
          { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
          mockLease.luid
        );

        expect(result.success).toBe(true);
        const approvalEvent = result.data.activity.find((a: any) => a.type === 'approved');
        expect(approvalEvent).toBeDefined();
        expect(approvalEvent.metadata).toBeDefined();
        expect(approvalEvent.metadata.approverRole).toBe('regional_manager');
        expect(approvalEvent.metadata.previousApprovers).toHaveLength(2);
      });
    });
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
          leaseService.approveLease('C123', 'L-2025-ABC123', mockUser, '')
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

        await expect(leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')).rejects.toThrow(
          ValidationRequestError
        );

        await expect(leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')).rejects.toThrow(
          'Cannot delete active lease'
        );
      });

      it('should block deletion of PENDING_SIGNATURE lease', async () => {
        const mockLease = createMockLease({ status: LeaseStatus.PENDING_SIGNATURE });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')).rejects.toThrow(
          ValidationRequestError
        );
      });

      it('should block deletion of TERMINATED lease', async () => {
        const mockLease = createMockLease({ status: LeaseStatus.TERMINATED });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')).rejects.toThrow(
          ValidationRequestError
        );
      });

      it('should block deletion of EXPIRED lease', async () => {
        const mockLease = createMockLease({ status: LeaseStatus.EXPIRED });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')).rejects.toThrow(
          ValidationRequestError
        );
      });

      it('should throw error if lease not found for deletion', async () => {
        mockDependencies.leaseDAO.findFirst.mockResolvedValue(null);

        await expect(leaseService.deleteLease('C123', 'L-2025-ABC123', 'U123')).rejects.toThrow(
          BadRequestError
        );
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

        await expect(
          leaseService.activateLease('C123', 'L-2025-ABC123', 'U123', '')
        ).rejects.toThrow('pending approval');
      });

      it('should block activating lease with rejected approval status', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.DRAFT,
          approvalStatus: 'rejected',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.activateLease('C123', 'L-2025-ABC123', 'U123', '')
        ).rejects.toThrow('has been rejected');
      });

      it('should block activating lease with draft approval status', async () => {
        const mockLease = createMockLease({
          status: LeaseStatus.DRAFT,
          approvalStatus: 'draft',
        });

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

        await expect(
          leaseService.activateLease('C123', 'L-2025-ABC123', 'U123', '')
        ).rejects.toThrow('draft status');
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

  describe('Property Ownership Integration', () => {
    describe('buildLandlordInfo', () => {
      const propertyId = new Types.ObjectId().toString();
      const cuid = 'C123';

      it('should return external owner as landlord with management company for external_owner type', async () => {
        const mockClient = {
          _id: new Types.ObjectId(),
          cuid,
          email: 'client@example.com',
          accountType: { isCorporate: true },
          companyProfile: {
            legalEntityName: 'ABC Property Management',
            companyAddress: '456 Business Ave',
            companyEmail: 'contact@abcproperty.com',
            companyPhone: '555-0123',
          },
        };

        const mockProperty = {
          _id: new Types.ObjectId(propertyId),
          cuid,
          owner: {
            type: 'external_owner',
            name: 'John Property Owner',
            email: 'john@owner.com',
            phone: '555-9999',
            notes: '789 Owner Street',
          },
          authorization: {
            isActive: true,
          },
          isManagementAuthorized: jest.fn().mockReturnValue(true),
        };

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);

        const result = await (leaseService as any).buildLandlordInfo(cuid, propertyId);

        expect(result).toEqual({
          landlordName: 'John Property Owner',
          landlordAddress: '789 Owner Street',
          landlordEmail: 'john@owner.com',
          landlordPhone: '555-9999',
          managementCompanyName: 'ABC Property Management',
          managementCompanyAddress: '456 Business Ave',
          managementCompanyEmail: 'contact@abcproperty.com',
          managementCompanyPhone: '555-0123',
          isExternalOwner: true,
        });
      });

      it('should return client as landlord for company_owned type', async () => {
        const mockClient = {
          _id: new Types.ObjectId(),
          cuid,
          firstName: 'Jane',
          lastName: 'Manager',
          email: 'jane@company.com',
          phone: '555-0100',
          address: '123 Company Blvd',
          accountType: { isCorporate: true },
          companyProfile: {
            legalEntityName: 'XYZ Property LLC',
            companyAddress: '123 Company Blvd',
            companyEmail: 'info@xyzproperty.com',
            companyPhone: '555-0100',
          },
        };

        const mockProperty = {
          _id: new Types.ObjectId(propertyId),
          cuid,
          owner: {
            type: 'company_owned',
          },
          authorization: {
            isActive: true,
          },
          isManagementAuthorized: jest.fn().mockReturnValue(true),
        };

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);

        const result = await (leaseService as any).buildLandlordInfo(cuid, propertyId);

        expect(result).toEqual({
          landlordName: 'XYZ Property LLC',
          landlordAddress: '123 Company Blvd',
          landlordEmail: 'info@xyzproperty.com',
          landlordPhone: '555-0100',
          isExternalOwner: false,
        });
      });

      it('should return property owner as landlord for self_owned type', async () => {
        const mockClient = {
          _id: new Types.ObjectId(),
          cuid,
          email: 'client@example.com',
          accountType: { isCorporate: false },
        };

        const mockProperty = {
          _id: new Types.ObjectId(propertyId),
          cuid,
          owner: {
            type: 'self_owned',
            name: 'Self Owner Bob',
            email: 'bob@selfowned.com',
            phone: '555-7777',
            notes: '999 Self Street',
          },
          authorization: {
            isActive: true,
          },
          isManagementAuthorized: jest.fn().mockReturnValue(true),
        };

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);

        const result = await (leaseService as any).buildLandlordInfo(cuid, propertyId);

        expect(result).toEqual({
          landlordName: 'Self Owner Bob',
          landlordAddress: '999 Self Street',
          landlordEmail: 'bob@selfowned.com',
          landlordPhone: '555-7777',
          isExternalOwner: false,
        });
      });

      it('should throw error if property is not authorized for management', async () => {
        const mockClient = {
          _id: new Types.ObjectId(),
          cuid,
          email: 'client@example.com',
          accountType: { isCorporate: true },
        };

        const mockProperty = {
          _id: new Types.ObjectId(propertyId),
          cuid,
          owner: {
            type: 'external_owner',
            name: 'Owner',
          },
          authorization: {
            isActive: false,
          },
          isManagementAuthorized: jest.fn().mockReturnValue(false),
        };

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);

        await expect((leaseService as any).buildLandlordInfo(cuid, propertyId)).rejects.toThrow(
          'Property has not been authorized for management.'
        );
      });

      it('should throw error if property not found', async () => {
        const mockClient = {
          _id: new Types.ObjectId(),
          cuid,
          email: 'client@example.com',
        };

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(null);

        await expect((leaseService as any).buildLandlordInfo(cuid, propertyId)).rejects.toThrow(
          'Property not found'
        );
      });

      it('should throw error if client not found', async () => {
        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(null);

        await expect((leaseService as any).buildLandlordInfo(cuid, propertyId)).rejects.toThrow(
          'Client not found'
        );
      });
    });

    describe('generateLeasePreview with landlord info', () => {
      it('should include landlord info in preview data', async () => {
        const cuid = 'C123';
        const propertyId = new Types.ObjectId().toString();

        const mockClient = {
          _id: new Types.ObjectId(),
          cuid,
          email: 'client@example.com',
          accountType: { isCorporate: true },
          accountAdmin: new Types.ObjectId(),
          companyProfile: {
            legalEntityName: 'Test Property LLC',
            companyAddress: '123 Test St',
            companyEmail: 'info@test.com',
            companyPhone: '555-0001',
          },
        };

        const mockProperty = {
          _id: new Types.ObjectId(propertyId),
          cuid,
          name: 'Test Property',
          propertyType: 'single_family',
          owner: {
            type: 'company_owned',
          },
          authorization: {
            isActive: true,
          },
          address: {
            fullAddress: '123 Test St',
            city: 'San Francisco',
            state: 'CA',
            country: 'USA',
          },
          isManagementAuthorized: jest.fn().mockReturnValue(true),
        };

        const mockLease = createMockLease({
          property: { id: propertyId, address: '123 Test St' },
          type: LeaseType.FIXED_TERM,
          fees: { monthlyRent: 1500, securityDeposit: 1500, rentDueDay: 1, currency: 'USD' },
          templateType: 'residential-single-family',
        });
        mockLease.tenantInfo = {
          fullname: 'Test Tenant',
          email: 'test@example.com',
          phoneNumber: '555-1234',
        } as any;

        const mockProfile = createMockProfile();

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
        mockDependencies.profileDAO.findFirst.mockResolvedValue(mockProfile);

        const result = await leaseService.generateLeasePreview(cuid, mockLease.luid);

        expect(result).toMatchObject({
          templateType: 'residential-single-family',
          monthlyRent: 1500,
          landlordName: 'Test Property LLC',
          landlordAddress: '123 Test St',
          landlordEmail: 'info@test.com',
          landlordPhone: '555-0001',
          isExternalOwner: false,
        });
      });

      it('should set hasUnitOwner=true for external_owner with unit number', async () => {
        const cuid = 'C123';
        const propertyId = new Types.ObjectId().toString();

        const mockClient = createMockClient();
        const mockProfile = createMockProfile();

        const mockProperty = {
          _id: new Types.ObjectId(propertyId),
          cuid,
          name: 'Test Apartment Complex',
          propertyType: 'apartment',
          maxAllowedUnits: 10,
          address: {
            fullAddress: '123 Test St',
            city: 'San Francisco',
            state: 'CA',
            country: 'USA',
          },
          owner: {
            type: 'external_owner',
            name: 'John Smith',
            email: 'john@example.com',
            phone: '555-1234',
          },
          authorization: {
            isActive: true,
          },
          isManagementAuthorized: jest.fn().mockReturnValue(true),
        };

        const unitId = new Types.ObjectId();
        const mockLease = createMockLease({
          property: { id: propertyId, address: '123 Test St', unitId },
          type: LeaseType.FIXED_TERM,
          fees: { monthlyRent: 1500, securityDeposit: 1500, rentDueDay: 1, currency: 'USD' },
          templateType: 'residential-apartment',
        });
        mockLease.tenantInfo = {
          fullname: 'Test Tenant',
          email: 'test@example.com',
          phoneNumber: '555-1234',
        } as any;

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
        mockDependencies.profileDAO.findFirst.mockResolvedValue(mockProfile);
        mockDependencies.propertyUnitDAO.findFirst.mockResolvedValue({
          unitNumber: '101',
        });

        const result = await leaseService.generateLeasePreview(cuid, mockLease.luid);

        expect(result.landlordName).toBe('John Smith');
        expect(result.isExternalOwner).toBe(true);
      });

      it('should set hasUnitOwner=false for company_owned with unit number', async () => {
        const cuid = 'C123';
        const propertyId = new Types.ObjectId().toString();

        const mockClient = createMockClient();
        const mockProfile = createMockProfile();

        const mockProperty = {
          _id: new Types.ObjectId(propertyId),
          cuid,
          name: 'Test Apartment Complex',
          propertyType: 'apartment',
          maxAllowedUnits: 10,
          address: {
            fullAddress: '123 Test St',
            city: 'San Francisco',
            state: 'CA',
            country: 'USA',
          },
          owner: {
            type: 'company_owned',
          },
          authorization: {
            isActive: true,
          },
          isManagementAuthorized: jest.fn().mockReturnValue(true),
        };

        const unitId = new Types.ObjectId();
        const mockLease = createMockLease({
          property: { id: propertyId, address: '123 Test St', unitId },
          type: LeaseType.FIXED_TERM,
          fees: { monthlyRent: 1500, securityDeposit: 1500, rentDueDay: 1, currency: 'USD' },
          templateType: 'residential-apartment',
        });
        mockLease.tenantInfo = {
          fullname: 'Test Tenant',
          email: 'test@example.com',
          phoneNumber: '555-1234',
        } as any;

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
        mockDependencies.profileDAO.findFirst.mockResolvedValue(mockProfile);
        mockDependencies.propertyUnitDAO.findFirst.mockResolvedValue({
          unitNumber: '101',
        });

        const result = await leaseService.generateLeasePreview(cuid, mockLease.luid);

        expect(result.landlordName).toBe('Test Property Management LLC');
        expect(result.isExternalOwner).toBe(false);
      });
    });

    describe('createLease with metadata storage', () => {
      it.todo('should store landlord info in lease metadata');
      /*
      it('should store landlord info in lease metadata', async () => {
        const mockUser = createMockUser(IUserRole.ADMIN);
        const propertyId = new Types.ObjectId();
        const mockProperty = createMockProperty({
          _id: propertyId,
          owner: {
            type: 'company_owned',
          },
          authorization: {
            isActive: true,
          },
          isManagementAuthorized: jest.fn().mockReturnValue(true),
        });

        const mockClient = {
          _id: new Types.ObjectId(),
          cuid: 'C123',
          email: 'client@example.com',
          firstName: 'Test',
          lastName: 'Client',
          accountType: { isCorporate: true },
          companyProfile: {
            legalEntityName: 'Test Company',
            companyAddress: '123 Test St',
            companyEmail: 'info@testcompany.com',
            companyPhone: '555-0000',
          },
        };

        const leaseData: any = {
          property: {
            id: propertyId.toString(),
          },
          tenantInfo: {
            id: new Types.ObjectId().toString(),
            email: 'tenant@example.com',
          },
          duration: {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2026-01-01'),
          },
          fees: {
            monthlyRent: 1500,
            securityDeposit: 3000,
            rentDueDay: 1,
            currency: 'USD',
          },
          type: LeaseType.FIXED_TERM,
        };

        const mockLease = createMockLease({
          metadata: {
            landlordName: 'Test Company',
            landlordAddress: '123 Test St',
            landlordEmail: 'info@testcompany.com',
            landlordPhone: '555-0000',
            isExternalOwner: false,
          },
        });

        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
        mockDependencies.userDAO.findFirst.mockResolvedValue({ _id: leaseData.tenantInfo.id });
        mockDependencies.leaseDAO.checkOverlappingLeases.mockResolvedValue(false);
        mockDependencies.leaseDAO.startSession.mockResolvedValue({});
        mockDependencies.leaseDAO.withTransaction.mockImplementation(async (_session, callback) => {
          return await callback({});
        });
        mockDependencies.leaseDAO.createLease.mockResolvedValue(mockLease);

        const result = await leaseService.createLease('C123', leaseData, {
          currentuser: mockUser,
        } as any);

        expect(result.success).toBe(true);
        expect(mockDependencies.leaseDAO.createLease).toHaveBeenCalled();
        const createLeaseCall = mockDependencies.leaseDAO.createLease.mock.calls[0][1];
        expect(createLeaseCall.metadata).toBeDefined();
        expect(createLeaseCall.metadata.landlordName).toBe('Test Company');
        expect(createLeaseCall.metadata.isExternalOwner).toBe(false);
      });
      */
    });
  });

  describe('Pending Changes Preview', () => {
    describe('shouldShowPendingChanges', () => {
      it('should return false if lease has no pending changes', () => {
        const lease = createMockLease({ pendingChanges: null });
        const currentUser = { client: { role: 'admin' }, sub: 'user123' } as any;

        const result = shouldShowPendingChanges(currentUser, lease);

        expect(result).toBe(false);
      });

      it('should return true for admin/manager roles', () => {
        const lease = createMockLease({ pendingChanges: { updatedBy: 'user456', fees: {} } });
        const adminUser = { client: { role: 'admin' }, sub: 'user123' } as any;
        const managerUser = { client: { role: 'manager' }, sub: 'user123' } as any;

        expect(shouldShowPendingChanges(adminUser, lease)).toBe(true);
        expect(shouldShowPendingChanges(managerUser, lease)).toBe(true);
      });

      it('should return true for staff viewing their own pending changes', () => {
        const lease = createMockLease({ pendingChanges: { updatedBy: 'user123', fees: {} } });
        const staffUser = { client: { role: 'staff' }, sub: 'user123' } as any;

        const result = shouldShowPendingChanges(staffUser, lease);

        expect(result).toBe(true);
      });

      it('should return false for staff viewing other staff pending changes', () => {
        const lease = createMockLease({ pendingChanges: { updatedBy: 'user456', fees: {} } });
        const staffUser = { client: { role: 'staff' }, sub: 'user123' } as any;

        const result = shouldShowPendingChanges(staffUser, lease);

        expect(result).toBe(false);
      });

      it('should return false for tenant role', () => {
        const lease = createMockLease({ pendingChanges: { updatedBy: 'user123', fees: {} } });
        const tenantUser = { client: { role: 'tenant' }, sub: 'user123' } as any;

        const result = shouldShowPendingChanges(tenantUser, lease);

        expect(result).toBe(false);
      });
    });

    describe('generateChangesSummary', () => {
      it('should return "No changes" for empty array', () => {
        const result = generateChangesSummary([]);

        expect(result).toBe('No changes');
      });

      it('should format single field change', () => {
        const result = generateChangesSummary(['monthlyRent']);

        expect(result).toBe('Modified Monthly Rent');
      });

      it('should format two field changes', () => {
        const result = generateChangesSummary([
          'monthlyRent',
          'securityDeposit',
        ]);

        expect(result).toBe('Modified Monthly Rent and Security Deposit');
      });

      it('should format multiple field changes', () => {
        const result = generateChangesSummary([
          'monthlyRent',
          'securityDeposit',
          'rentDueDay',
        ]);

        expect(result).toBe('Modified Monthly Rent, Security Deposit, and Rent Due Day');
      });

      it('should format nested fields correctly', () => {
        const result = generateChangesSummary(['fees.monthlyRent']);

        expect(result).toBe('Modified Fees > monthly Rent');
      });
    });

    describe('generatePendingChangesPreview', () => {
      it('should return undefined if no pending changes', () => {
        const lease = createMockLease({ pendingChanges: null });
        const currentUser = { client: { role: 'admin' }, sub: 'user123' } as any;

        const result = generatePendingChangesPreview(lease, currentUser);

        expect(result).toBeUndefined();
      });

      it('should return undefined if user cannot see pending changes', () => {
        const lease = createMockLease({ pendingChanges: { updatedBy: 'user456', fees: {} } });
        const tenantUser = { client: { role: 'tenant' }, sub: 'user123' } as any;

        const result = generatePendingChangesPreview(lease, tenantUser);

        expect(result).toBeUndefined();
      });

      it('should return formatted preview for admin user', () => {
        const lease = createMockLease({
          pendingChanges: {
            updatedBy: 'user123',
            updatedAt: new Date('2025-01-15'),
            displayName: 'John Doe',
            fees: { monthlyRent: 300000 },
          },
          fees: { currency: 'USD' },
        });
        const adminUser = { client: { role: 'admin' }, sub: 'user123' } as any;

        const result = generatePendingChangesPreview(lease, adminUser);

        expect(result).toBeDefined();
        expect(result.updatedFields).toEqual(['fees']);
        expect(result.updatedBy).toBe('user123');
        expect(result.displayName).toBe('John Doe');
        expect(result.summary).toBe('Modified Fees');
        expect(result.changes.fees).toBeDefined();
      });
    });
  });

  describe('Generate Preview From Existing Lease', () => {
    it('should throw error if lease not found', async () => {
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(null);

      await expect(leaseService.generateLeasePreview('C123', 'L123')).rejects.toThrow(
        'Lease not found'
      );
    });

    it('should throw error if property not found', async () => {
      const mockLease = createMockLease();
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDependencies.propertyDAO.findFirst.mockResolvedValue(null);

      await expect(leaseService.generateLeasePreview('C123', 'L123')).rejects.toThrow(
        'Property not found'
      );
    });

    it('should generate preview data from existing lease', async () => {
      const mockLease = createMockLease();
      const mockClient = createMockClient();
      const mockProperty = {
        _id: 'P123',
        name: 'Test Property',
        propertyType: 'apartment',
        address: {
          street: '123 Main St',
          city: 'Boston',
          state: 'MA',
          postCode: '02101',
          country: 'USA',
        },
        owner: { type: 'company_owned' },
        authorization: {
          isActive: true,
        },
        isManagementAuthorized: jest.fn().mockReturnValue(true),
      };

      const mockLeaseWithVirtuals = {
        ...mockLease,
        property: { id: 'P123', address: '123 Main St' },
        templateType: 'residential-apartment',
        tenantInfo: {
          fullname: 'John Doe',
          email: 'john@example.com',
          phoneNumber: '555-1234',
        },
        createdAt: new Date('2025-01-01'),
        signedDate: new Date('2025-01-15'),
      };

      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLeaseWithVirtuals);
      mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockDependencies.profileDAO.findFirst.mockResolvedValue({
        personalInfo: {
          firstName: 'Owner',
          lastName: 'Name',
          phoneNumber: '555-5678',
        },
        user: { email: 'owner@example.com' },
      });

      const result = await leaseService.generateLeasePreview('C123', 'L123');

      expect(result).toBeDefined();
      expect((result as any).leaseNumber).toBe(mockLease.leaseNumber);
      expect(result.tenantName).toBe('John Doe');
      expect(result.tenantEmail).toBe('john@example.com');
      expect(result.propertyAddress).toContain('123 Main St');
      expect(result.monthlyRent).toBe(mockLease.fees.monthlyRent);
      expect(result.templateType).toBe('residential-apartment');
    });

    it('should use correct template type based on property type', async () => {
      const mockLease = createMockLease();
      const mockClient = createMockClient();
      const testCases = [
        { propertyType: 'single_family', expected: 'residential-single-family' },
        { propertyType: 'apartment', expected: 'residential-apartment' },
        { propertyType: 'office', expected: 'commercial-office' },
        { propertyType: 'retail', expected: 'commercial-retail' },
        { propertyType: 'short_term', expected: 'short-term-rental' },
        { propertyType: 'unknown', expected: 'residential-single-family' },
      ];

      for (const { propertyType, expected } of testCases) {
        const mockProperty = {
          _id: 'P123',
          name: 'Test Property',
          propertyType,
          address: { street: '123 Main St', city: 'Boston', state: 'MA', country: 'USA' },
          owner: { type: 'company_owned' },
          authorization: {
            isActive: true,
          },
          isManagementAuthorized: jest.fn().mockReturnValue(true),
        };

        const mockLeaseWithVirtuals = {
          ...mockLease,
          property: { id: 'P123', address: '123 Main St' },
          templateType: expected,
          tenantInfo: { fullname: 'John Doe', email: 'john@example.com' },
        };

        mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLeaseWithVirtuals);
        mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);
        mockDependencies.propertyDAO.findFirst.mockResolvedValue(mockProperty);
        mockDependencies.profileDAO.findFirst.mockResolvedValue({
          personalInfo: { firstName: 'Owner', lastName: 'Name' },
          user: { email: 'owner@example.com' },
        });

        const result = await leaseService.generateLeasePreview('C123', 'L123');

        expect(result.templateType).toBe(expected);
      }
    });
  });

  describe('Calculate Financial Summary with Pet Fees', () => {
    it('should calculate total monthly rent including pet fees', () => {
      const leaseWithPetFee = createMockLease({
        fees: { monthlyRent: 250000, securityDeposit: 500000, currency: 'USD', rentDueDay: 1 },
        petPolicy: { allowed: true, monthlyFee: 5000 },
        duration: { startDate: new Date('2025-01-01') },
        totalMonthlyFees: 255000, // virtual field: 250000 + 5000
      });

      const result = calculateFinancialSummary(leaseWithPetFee);

      expect(result.monthlyRentRaw).toBe(255000); // Total including pet fee
      expect(result.petFeeRaw).toBe(5000);
      expect(result.petFee).toBeDefined();
    });

    it('should not include pet fee if no pet policy', () => {
      const leaseWithoutPets = createMockLease({
        fees: { monthlyRent: 250000, securityDeposit: 500000, currency: 'USD', rentDueDay: 1 },
        petPolicy: null,
        duration: { startDate: new Date('2025-01-01') },
      });

      const result = calculateFinancialSummary(leaseWithoutPets);

      expect(result.monthlyRentRaw).toBe(250000);
      expect(result.petFeeRaw).toBe(0);
      expect(result.petFee).toBeUndefined();
    });

    it('should calculate totalExpected using total monthly rent with pet fees', () => {
      const leaseWithPetFee = createMockLease({
        fees: { monthlyRent: 250000, securityDeposit: 500000, currency: 'USD', rentDueDay: 1 },
        petPolicy: { allowed: true, monthlyFee: 5000 },
        duration: { startDate: new Date('2024-01-01') }, // 1+ year ago
        totalMonthlyFees: 255000,
      });

      const result = calculateFinancialSummary(leaseWithPetFee);

      // totalExpected should use total rent (255000) not just base rent (250000)
      // Since the lease started in 2024, it should have accumulated several months of rent
      expect(result.totalExpected).toBeGreaterThan(0);
      // The total should be a multiple of the total monthly rent (base + pet fee)
      const monthsElapsed = Math.floor(
        (new Date().getTime() - new Date('2024-01-01').getTime()) / (1000 * 60 * 60 * 24 * 30)
      );
      expect(result.totalExpected).toBe(255000 * monthsElapsed);
    });
  });

  describe('updateLease', () => {
    it('should reject unauthorized users', async () => {
      const mockUser = createMockUser(IUserRole.TENANT);
      const mockLease = createMockLease();
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

      await expect(
        leaseService.updateLease(
          { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
          'L123',
          { internalNotes: 'Test' }
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow admin to update DRAFT lease directly', async () => {
      const mockUser = createMockUser(IUserRole.ADMIN);
      const mockLease = createMockLease({ status: LeaseStatus.DRAFT });
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDependencies.leaseDAO.update.mockResolvedValue({
        ...mockLease,
        fees: { monthlyRent: 1500 },
      });

      const result = await leaseService.updateLease(
        { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
        'L123',
        { fees: { monthlyRent: 1500 } } as any
      );

      expect(result.success).toBe(true);
      expect(result.data.requiresApproval).toBe(false);
    });

    it('should require approval for staff high-impact changes in DRAFT', async () => {
      const mockUser = createMockUser(IUserRole.STAFF);
      const mockLease = createMockLease({ status: LeaseStatus.DRAFT });
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDependencies.leaseDAO.update.mockResolvedValue({ ...mockLease, pendingChanges: {} });
      mockDependencies.profileDAO.findFirst.mockResolvedValue({
        personalInfo: { firstName: 'Test', lastName: 'User' },
      });

      const result = await leaseService.updateLease(
        { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
        'L123',
        { property: { id: new Types.ObjectId().toString(), address: 'Test Address' } } as any
      );

      expect(result.success).toBe(true);
      expect(result.data.requiresApproval).toBe(true);
    });

    it('should allow staff low-impact changes in DRAFT directly', async () => {
      const mockUser = createMockUser(IUserRole.STAFF);
      const mockLease = createMockLease({ status: LeaseStatus.DRAFT });
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDependencies.leaseDAO.update.mockResolvedValue({
        ...mockLease,
        internalNotes: 'Staff note',
      });

      const result = await leaseService.updateLease(
        { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
        'L123',
        { internalNotes: 'Staff note' }
      );

      expect(result.success).toBe(true);
      expect(result.data.requiresApproval).toBe(false);
    });

    it('should reject staff updates on PENDING_SIGNATURE', async () => {
      const mockUser = createMockUser(IUserRole.STAFF);
      const mockLease = createMockLease({ status: LeaseStatus.PENDING_SIGNATURE });
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

      await expect(
        leaseService.updateLease(
          { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
          'L123',
          { internalNotes: 'Test' }
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should reject staff updates on EXPIRED leases', async () => {
      const mockUser = createMockUser(IUserRole.STAFF);
      const mockLease = createMockLease({ status: LeaseStatus.EXPIRED });
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);

      await expect(
        leaseService.updateLease(
          { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
          'L123',
          { internalNotes: 'Test' }
        )
      ).rejects.toThrow(BadRequestError);
    });

    it('should require approval for staff high-impact changes in ACTIVE', async () => {
      const mockUser = createMockUser(IUserRole.STAFF);
      const mockLease = createMockLease({ status: LeaseStatus.ACTIVE });
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDependencies.leaseDAO.update.mockResolvedValue({ ...mockLease, pendingChanges: {} });
      mockDependencies.profileDAO.findFirst.mockResolvedValue({
        personalInfo: { firstName: 'Test', lastName: 'User' },
      });

      const result = await leaseService.updateLease(
        { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
        'L123',
        { fees: { monthlyRent: 1500 } } as any
      );

      expect(result.success).toBe(true);
      expect(result.data.requiresApproval).toBe(true);
    });

    it('should sanitize empty unitId to undefined', async () => {
      const mockUser = createMockUser(IUserRole.ADMIN);
      const mockLease = createMockLease({ status: LeaseStatus.DRAFT });
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDependencies.leaseDAO.update.mockResolvedValue(mockLease);

      await leaseService.updateLease(
        { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
        'L123',
        {
          property: { id: mockLease.property.id.toString(), unitId: '', address: 'Test Address' },
        } as any
      );

      const updateCall = mockDependencies.leaseDAO.update.mock.calls[0];
      // The createSafeMongoUpdate flattens to dot notation
      expect(updateCall[1].$set['property.unitId']).toBeUndefined();
    });

    it('should invalidate cache after update', async () => {
      const mockUser = createMockUser(IUserRole.ADMIN);
      const mockLease = createMockLease({ status: LeaseStatus.DRAFT });
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDependencies.leaseDAO.update.mockResolvedValue(mockLease);

      await leaseService.updateLease(
        { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
        mockLease.luid,
        { internalNotes: 'Test' }
      );

      expect(mockDependencies.leaseCache.invalidateLease).toHaveBeenCalledWith('C123', mockLease.luid);
    });

    it('should throw error if lease not found', async () => {
      const mockUser = createMockUser(IUserRole.ADMIN);
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(null);

      await expect(
        leaseService.updateLease(
          { request: { params: { cuid: 'C123' } }, currentuser: mockUser } as any,
          'L123',
          { internalNotes: 'Test' }
        )
      ).rejects.toThrow(BadRequestError);
    });
  });
});

// ==================== PDF GENERATION TESTS ====================

describe('LeaseService - PDF Generation', () => {
  let leaseService: LeaseService;
  let mockDependencies: any;
  const mockUser = createMockUser();

  beforeEach(() => {
    mockDependencies = {
      ...createMockDependencies(),
      pdfGeneratorService: {
        generatePdf: jest.fn(),
      },
      mediaUploadService: {
        handleBuffer: jest.fn(),
      },
      pdfGeneratorQueue: {
        addToPdfQueue: jest.fn(),
      },
    };
    leaseService = new LeaseService(mockDependencies);
  });

  describe('queueLeasePdfGeneration', () => {
    it('should queue PDF generation and return job ID', async () => {
      const mockLease = createMockLease();
      const mockJob = { id: '123' };

      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDependencies.pdfGeneratorQueue.addToPdfQueue.mockResolvedValue(mockJob);

      const result = await leaseService.queueLeasePdfGeneration(
        mockLease._id.toString(),
        'C123',
        { currentuser: mockUser } as any,
        'residential-single-family'
      );

      expect(result.success).toBe(true);
      expect(result.jobId).toBe('123');
      expect(mockDependencies.pdfGeneratorQueue.addToPdfQueue).toHaveBeenCalledWith(
        expect.objectContaining({
          cuid: 'C123',
          templateType: 'residential-single-family',
        })
      );
    });

    it('should return error when lease not found', async () => {
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(null);

      const result = await leaseService.queueLeasePdfGeneration(
        new Types.ObjectId().toString(),
        'C123',
        { currentuser: mockUser } as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle queue errors gracefully', async () => {
      const mockLease = createMockLease();
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDependencies.pdfGeneratorQueue.addToPdfQueue.mockRejectedValue(new Error('Queue full'));

      const result = await leaseService.queueLeasePdfGeneration(mockLease._id.toString(), 'C123', {
        currentuser: mockUser,
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Queue full');
    });
  });

  describe('generateLeasePDF', () => {
    // Complex integration test - tested via API/integration tests
    it.todo('should generate PDF successfully with populated lease data');

    it('should query lease by ObjectId when leaseId is ObjectId', async () => {
      const objectId = new Types.ObjectId();
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(null);

      try {
        await leaseService.generateLeasePDF('C123', objectId.toString());
      } catch (error) {
        // Expected to fail
      }

      expect(mockDependencies.leaseDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Types.ObjectId),
        }),
        expect.any(Object)
      );
    });

    it.todo('should handle missing tenant gracefully');

    it.todo('should handle PDF generation failure');
  });

  describe('updateLeaseDocuments', () => {
    it('should update lease documents with ObjectId', async () => {
      const objectId = new Types.ObjectId();
      const mockLease = createMockLease();
      const uploadResults = [
        {
          url: 'https://s3.amazonaws.com/test.pdf',
          key: 'lease_test.pdf',
          filename: 'test.pdf',
        },
      ];

      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDependencies.leaseDAO.updateLeaseDocuments.mockResolvedValue(mockLease);

      const result = await leaseService.updateLeaseDocuments(
        objectId.toString(),
        uploadResults as any,
        'user123'
      );

      expect(result.success).toBe(true);
      expect(mockDependencies.leaseDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Types.ObjectId),
        })
      );
    });

    it('should update lease documents with luid', async () => {
      const mockLease = createMockLease();
      const uploadResults = [{ url: 'test.pdf', key: 'key', filename: 'test.pdf' }];

      mockDependencies.leaseDAO.findFirst.mockResolvedValue(mockLease);
      mockDependencies.leaseDAO.updateLeaseDocuments.mockResolvedValue(mockLease);

      const result = await leaseService.updateLeaseDocuments(
        'L-2025-ABC',
        uploadResults as any,
        'user123'
      );

      expect(result.success).toBe(true);
      expect(mockDependencies.leaseDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          luid: 'L-2025-ABC',
        })
      );
    });

    it('should throw error when lease not found', async () => {
      mockDependencies.leaseDAO.findFirst.mockResolvedValue(null);

      await expect(
        leaseService.updateLeaseDocuments('invalid-id', [] as any, 'user123')
      ).rejects.toThrow();
    });
  });
});
