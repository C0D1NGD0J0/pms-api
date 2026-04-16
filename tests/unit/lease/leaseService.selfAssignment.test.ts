import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { ClientDAO } from '@dao/clientDAO';
import { ProfileDAO } from '@dao/profileDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { InvitationDAO } from '@dao/invitationDAO';
import { ForbiddenError } from '@shared/customErrors';
import { IRequestContext } from '@interfaces/utils.interface';
import { ILeaseFormData, LeaseStatus } from '@interfaces/lease.interface';

// Break the circular import chain: lease.service → @shared/middlewares → @di/index → registerResources → lease.service (undefined)
jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { LeaseService } from '@services/lease/lease.service';

describe('LeaseService - Tenant Self-Assignment Prevention', () => {
  let leaseService: LeaseService;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockPropertyDAO: jest.Mocked<PropertyDAO>;
  let mockInvitationDAO: jest.Mocked<InvitationDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;

  const mockUserId = new Types.ObjectId();
  const mockClientId = new Types.ObjectId();
  const mockPropertyId = new Types.ObjectId();
  const testCuid = 'TESTCLIENT123';
  const testLuid = 'LEASE123';

  const mockContext: Partial<IRequestContext> = {
    currentuser: {
      sub: mockUserId.toString(),
      email: 'staff@example.com',
      fullname: 'Staff User',
      client: {
        cuid: testCuid,
        role: 'staff',
      },
    } as any,
    request: {
      params: { cuid: testCuid },
    } as any,
  };

  const _mockTenantContext: Partial<IRequestContext> = {
    currentuser: {
      sub: mockUserId.toString(),
      email: 'tenant@example.com',
      fullname: 'Tenant User',
      client: {
        cuid: testCuid,
        role: 'tenant',
      },
    } as any,
    request: {
      params: { cuid: testCuid },
    } as any,
  };

  beforeEach(() => {
    mockLeaseDAO = {
      createLease: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      startSession: jest.fn(),
      withTransaction: jest.fn((session, callback) => callback(session)),
      checkOverlappingLeases: jest.fn().mockResolvedValue([]),
    } as any;

    mockUserDAO = {
      findFirst: jest.fn(),
    } as any;

    mockClientDAO = {
      getClientByCuid: jest.fn().mockResolvedValue({
        _id: mockClientId,
        cuid: testCuid,
        accountAdmin: mockUserId,
        accountType: { isEnterpriseAccount: false, category: 'individual' },
      }),
    } as any;

    mockPropertyDAO = {
      findFirst: jest.fn(),
    } as any;

    mockInvitationDAO = {
      findFirst: jest.fn(),
    } as any;

    mockProfileDAO = {
      findFirst: jest.fn().mockResolvedValue({
        personalInfo: {
          firstName: 'Test',
          lastName: 'Landlord',
          location: '123 Test St',
        },
        user: {
          email: 'landlord@example.com',
        },
      }),
    } as any;

    const mockEmitterService = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    } as any;

    leaseService = new LeaseService({
      leaseDAO: mockLeaseDAO,
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      propertyDAO: mockPropertyDAO,
      invitationDAO: mockInvitationDAO,
      profileDAO: mockProfileDAO,
      mailerService: {} as any,
      invitationService: {} as any,
      leaseCache: {
        invalidateLease: jest.fn(),
        invalidateLeaseLists: jest.fn(),
      } as any,
      emitterService: mockEmitterService,
      notificationService: {} as any,
      leaseSignatureService: {} as any,
      leaseDocumentService: {} as any,
      leaseRenewalService: {} as any,
      mediaUploadService: {} as any,
      leasePdfService: {} as any,
      boldSignService: {} as any,
      propertyUnitDAO: {} as any,
      queueFactory: {} as any,
      userService: {} as any,
    });
  });

  describe('createLease - Self-Assignment Prevention', () => {
    it('should prevent user from creating lease for themselves as tenant', async () => {
      const mockProperty = {
        _id: mockPropertyId,
        address: { fullAddress: '123 Test St' },
        approvalStatus: 'approved',
        cuid: testCuid,
        isManagementAuthorized: () => true,
        owner: { type: 'company_owned' },
        propertyType: 'residential',
      };

      const mockTenantUser = {
        _id: mockUserId, // Same as currentuser.sub
        uid: 'tenant-uid',
        cuids: [{ cuid: testCuid, roles: ['tenant'], isConnected: true }],
      };

      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty as any);
      mockUserDAO.findFirst.mockResolvedValue(mockTenantUser as any);

      const leaseData = {
        tenantInfo: {
          id: mockUserId.toString(), // User trying to assign themselves
        },
        property: {
          id: mockPropertyId.toString(),
        },
        duration: {
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000),
        },
        fees: {
          monthlyRent: 1000,
          securityDeposit: 2000,
        },
      } as any;

      await expect(
        leaseService.createLease(testCuid, leaseData, mockContext as IRequestContext)
      ).rejects.toThrow(ForbiddenError);

      await expect(
        leaseService.createLease(testCuid, leaseData, mockContext as IRequestContext)
      ).rejects.toThrow(/cannotCreateOwnLease/);
    });

    it('should allow creating lease for different tenant', async () => {
      const differentTenantId = new Types.ObjectId();

      const mockProperty = {
        _id: mockPropertyId,
        address: { fullAddress: '123 Test St' },
        approvalStatus: 'approved',
        cuid: testCuid,
        isManagementAuthorized: () => true,
        owner: { type: 'company_owned' },
        propertyType: 'residential',
      };

      const mockTenantUser = {
        _id: differentTenantId, // Different user
        uid: 'other-tenant-uid',
        cuids: [{ cuid: testCuid, roles: ['tenant'], isConnected: true }],
      };

      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty as any);
      mockUserDAO.findFirst.mockResolvedValue(mockTenantUser as any);
      mockLeaseDAO.createLease.mockResolvedValue({
        _id: new Types.ObjectId(),
        luid: testLuid,
        tenantId: differentTenantId,
      } as any);

      const leaseData = {
        tenantInfo: {
          id: differentTenantId.toString(), // Different tenant
        },
        property: {
          id: mockPropertyId.toString(),
        },
        duration: {
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000),
        },
        fees: {
          monthlyRent: 1000,
          securityDeposit: 2000,
        },
      } as any;

      const result = await leaseService.createLease(
        testCuid,
        leaseData,
        mockContext as IRequestContext
      );

      expect(result.success).toBe(true);
      expect(mockLeaseDAO.createLease).toHaveBeenCalled();
    });

    it('should allow creating lease with invitation (useInvitationIdAsTenantId)', async () => {
      const invitationId = new Types.ObjectId();

      const mockProperty = {
        _id: mockPropertyId,
        address: { fullAddress: '123 Test St' },
        approvalStatus: 'approved',
        cuid: testCuid,
        isManagementAuthorized: () => true,
        owner: { type: 'company_owned' },
        propertyType: 'residential',
      };

      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty as any);
      mockInvitationDAO.findFirst.mockResolvedValue({
        _id: invitationId,
        inviteeEmail: 'newtenant@example.com',
        status: 'pending',
        role: 'tenant',
      } as any);
      mockLeaseDAO.createLease.mockResolvedValue({
        _id: new Types.ObjectId(),
        luid: testLuid,
        tenantId: invitationId,
      } as any);

      const leaseData = {
        tenantInfo: {
          email: 'newtenant@example.com',
        },
        property: {
          id: mockPropertyId.toString(),
        },
        duration: {
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000),
        },
        fees: {
          monthlyRent: 1000,
          securityDeposit: 2000,
        },
      } as any;

      const result = await leaseService.createLease(
        testCuid,
        leaseData,
        mockContext as IRequestContext
      );

      expect(result.success).toBe(true);
      expect(mockLeaseDAO.createLease).toHaveBeenCalled();
    });
  });

  describe('updateLease - Self-Update Prevention', () => {
    it('should prevent tenant from updating their own lease', async () => {
      const staffTenantContext: Partial<IRequestContext> = {
        currentuser: {
          sub: mockUserId.toString(),
          email: 'stafftenant@example.com',
          fullname: 'Staff Tenant User',
          client: {
            cuid: testCuid,
            role: 'staff',
          },
        } as any,
        request: {
          params: { cuid: testCuid },
        } as any,
      };

      const mockLease = {
        _id: new Types.ObjectId(),
        luid: testLuid,
        cuid: testCuid,
        tenantId: mockUserId, // Same as currentUser.sub - CONFLICT
        status: 'active',
      };

      mockLeaseDAO.findFirst.mockResolvedValue(mockLease as any);

      const updateData: Partial<ILeaseFormData> = {
        fees: { monthlyRent: 500 } as ILeaseFormData['fees'],
      };

      // Should fail even though user has staff role, because they're the tenant
      await expect(
        leaseService.updateLease(staffTenantContext as IRequestContext, testLuid, updateData)
      ).rejects.toThrow(ForbiddenError);

      await expect(
        leaseService.updateLease(staffTenantContext as IRequestContext, testLuid, updateData)
      ).rejects.toThrow(/cannotUpdateOwnLease/);

      expect(mockLeaseDAO.update).not.toHaveBeenCalled();
    });

    it('should allow staff/admin to update tenant lease', async () => {
      const mockLease = {
        _id: new Types.ObjectId(),
        luid: testLuid,
        cuid: testCuid,
        tenantId: mockUserId,
        status: 'active',
      };

      const adminContext: Partial<IRequestContext> = {
        currentuser: {
          sub: new Types.ObjectId().toString(), // Different user (admin)
          email: 'admin@example.com',
          fullname: 'Admin User',
          client: {
            cuid: testCuid,
            role: 'admin',
          },
        } as any,
        request: {
          params: { cuid: testCuid },
        } as any,
      };

      mockLeaseDAO.findFirst.mockResolvedValue(mockLease as any);
      mockLeaseDAO.update.mockResolvedValue({
        ...mockLease,
        fees: { monthlyRent: 1200, securityDeposit: 2000 },
      } as any);

      const updateData: Partial<ILeaseFormData> = {
        fees: { monthlyRent: 1200 } as ILeaseFormData['fees'],
      };

      const result = await leaseService.updateLease(
        adminContext as IRequestContext,
        testLuid,
        updateData
      );

      expect(result.success).toBe(true);
      expect(mockLeaseDAO.update).toHaveBeenCalled();
    });

    it('should handle tenantId as ObjectId correctly', async () => {
      const mockLease = {
        _id: new Types.ObjectId(),
        luid: testLuid,
        cuid: testCuid,
        tenantId: new Types.ObjectId(mockUserId.toString()), // ObjectId format
        status: 'active',
      };

      mockLeaseDAO.findFirst.mockResolvedValue(mockLease as any);

      const staffTenantContext: Partial<IRequestContext> = {
        currentuser: {
          sub: mockUserId.toString(),
          email: 'stafftenant@example.com',
          fullname: 'Staff Tenant User',
          client: {
            cuid: testCuid,
            role: 'staff',
          },
        } as any,
        request: {
          params: { cuid: testCuid },
        } as any,
      };

      const updateData: Partial<ILeaseFormData> = { fees: { monthlyRent: 500 } as ILeaseFormData['fees'] };

      await expect(
        leaseService.updateLease(staffTenantContext as IRequestContext, testLuid, updateData)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow staff to update lease for different tenant', async () => {
      const differentTenantId = new Types.ObjectId();

      const mockLease = {
        _id: new Types.ObjectId(),
        luid: testLuid,
        cuid: testCuid,
        tenantId: differentTenantId, // Different tenant
        status: 'active',
      };

      mockLeaseDAO.findFirst.mockResolvedValue(mockLease as any);
      mockLeaseDAO.update.mockResolvedValue(mockLease as any);

      const updateData: Partial<ILeaseFormData> = { fees: { monthlyRent: 1200 } as ILeaseFormData['fees'] };

      // This should succeed because lease tenant !== current user
      const result = await leaseService.updateLease(
        mockContext as IRequestContext,
        testLuid,
        updateData
      );

      expect(result.success).toBe(true);
    });
  });

  describe('Cross-Account Prevention', () => {
    it('should prevent self-assignment across different client accounts', async () => {
      const mockProperty = {
        _id: mockPropertyId,
        address: { fullAddress: '123 Test St' },
        approvalStatus: 'approved',
        cuid: testCuid,
        isManagementAuthorized: () => true,
        owner: { type: 'company_owned' },
        propertyType: 'residential',
      };

      // User is tenant in THIS account but trying to create lease
      const mockMultiTenantUser = {
        _id: mockUserId,
        uid: 'multi-tenant-uid',
        cuids: [
          { cuid: 'OTHER_CLIENT', roles: ['tenant'], isConnected: true },
          { cuid: testCuid, roles: ['staff', 'tenant'], isConnected: true }, // Has both roles
        ],
      };

      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty as any);
      mockUserDAO.findFirst.mockResolvedValue(mockMultiTenantUser as any);

      const leaseData = {
        tenantInfo: {
          id: mockUserId.toString(), // Trying to assign themselves
        },
        property: {
          id: mockPropertyId.toString(),
        },
        duration: {
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000),
        },
        fees: {
          monthlyRent: 1000,
          securityDeposit: 2000,
        },
      } as any;

      // Should still block - user ID matches regardless of account
      await expect(
        leaseService.createLease(testCuid, leaseData, mockContext as IRequestContext)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getFilteredLeases - Tenant Context Enforcement', () => {
    const TENANT_VISIBLE_STATUSES: LeaseStatus[] = [
      LeaseStatus.ACTIVE,
      LeaseStatus.EXPIRED,
      LeaseStatus.TERMINATED,
      LeaseStatus.RENEWED,
    ];

    const mockLeaseList = [
      { luid: 'L-001', status: LeaseStatus.ACTIVE },
      { luid: 'L-002', status: LeaseStatus.EXPIRED },
    ];

    const mockPagination = { total: 2, page: 1, perPage: 10, totalPages: 1, hasMoreResource: false };

    beforeEach(() => {
      // Provide full leaseCache mock required by getFilteredLeases
      leaseService = new LeaseService({
        leaseDAO: mockLeaseDAO,
        userDAO: mockUserDAO,
        clientDAO: mockClientDAO,
        propertyDAO: mockPropertyDAO,
        invitationDAO: mockInvitationDAO,
        profileDAO: mockProfileDAO,
        mailerService: {} as any,
        invitationService: {} as any,
        leaseCache: {
          invalidateLease: jest.fn(),
          invalidateLeaseLists: jest.fn(),
          getClientLeases: jest.fn().mockResolvedValue({ success: false, data: null }),
          saveClientLeases: jest.fn().mockResolvedValue(undefined),
        } as any,
        emitterService: { on: jest.fn(), off: jest.fn(), emit: jest.fn() } as any,
        notificationService: {} as any,
        leaseSignatureService: {} as any,
        leaseDocumentService: {} as any,
        leaseRenewalService: {} as any,
        mediaUploadService: {} as any,
        leasePdfService: {} as any,
        boldSignService: {} as any,
        propertyUnitDAO: {} as any,
        queueFactory: {} as any,
        userService: {} as any,
      });

      (mockLeaseDAO as any).getFilteredLeases = jest.fn().mockResolvedValue({
        items: mockLeaseList,
        pagination: mockPagination,
      });
    });

    it('should pass filters through unchanged when caller is not a tenant', async () => {
      const nonTenantContext: Partial<IRequestContext> = {
        currentuser: {
          sub: mockUserId.toString(),
          email: 'admin@example.com',
          fullname: 'Admin User',
          client: { cuid: testCuid, role: 'admin' },
        } as any,
      };

      await leaseService.getFilteredLeases(
        testCuid,
        { status: LeaseStatus.DRAFT },
        { limit: 10, skip: 0 },
        nonTenantContext as IRequestContext
      );

      const [, capturedFilters] = (mockLeaseDAO as any).getFilteredLeases.mock.calls[0];
      expect(capturedFilters.status).toBe(LeaseStatus.DRAFT);
    });

    it('should pass filters through unchanged when no context is provided', async () => {
      await leaseService.getFilteredLeases(
        testCuid,
        { status: LeaseStatus.DRAFT },
        { limit: 10, skip: 0 }
      );

      const [, capturedFilters] = (mockLeaseDAO as any).getFilteredLeases.mock.calls[0];
      expect(capturedFilters.status).toBe(LeaseStatus.DRAFT);
    });

    it('should restrict status to tenant-visible list when caller is a tenant with no status filter', async () => {
      await leaseService.getFilteredLeases(
        testCuid,
        {},
        { limit: 10, skip: 0 },
        _mockTenantContext as IRequestContext
      );

      const [, capturedFilters] = (mockLeaseDAO as any).getFilteredLeases.mock.calls[0];
      expect(Array.isArray(capturedFilters.status)).toBe(true);
      expect(capturedFilters.status).toEqual(expect.arrayContaining(TENANT_VISIBLE_STATUSES));
      expect(capturedFilters.status).toHaveLength(TENANT_VISIBLE_STATUSES.length);
    });

    it('should strip DRAFT from status filter and fall back to full allowed list when tenant requests DRAFT', async () => {
      await leaseService.getFilteredLeases(
        testCuid,
        { status: LeaseStatus.DRAFT },
        { limit: 10, skip: 0 },
        _mockTenantContext as IRequestContext
      );

      const [, capturedFilters] = (mockLeaseDAO as any).getFilteredLeases.mock.calls[0];
      expect(Array.isArray(capturedFilters.status)).toBe(true);
      expect(capturedFilters.status).not.toContain(LeaseStatus.DRAFT);
      expect(capturedFilters.status).toEqual(expect.arrayContaining(TENANT_VISIBLE_STATUSES));
    });

    it('should strip hidden statuses (DRAFT, DRAFT_RENEWAL, CANCELLED, READY_FOR_SIGNATURE, PENDING_SIGNATURE) when tenant requests them', async () => {
      const hiddenStatuses = [
        LeaseStatus.DRAFT,
        LeaseStatus.DRAFT_RENEWAL,
        LeaseStatus.CANCELLED,
        LeaseStatus.READY_FOR_SIGNATURE,
        LeaseStatus.PENDING_SIGNATURE,
      ];

      for (const hiddenStatus of hiddenStatuses) {
        (mockLeaseDAO as any).getFilteredLeases.mockClear();

        await leaseService.getFilteredLeases(
          testCuid,
          { status: hiddenStatus },
          { limit: 10, skip: 0 },
          _mockTenantContext as IRequestContext
        );

        const [, capturedFilters] = (mockLeaseDAO as any).getFilteredLeases.mock.calls[0];
        expect(capturedFilters.status).not.toContain(hiddenStatus);
      }
    });

    it('should keep only the tenant-visible portion when tenant requests a mixed status array', async () => {
      await leaseService.getFilteredLeases(
        testCuid,
        { status: [LeaseStatus.ACTIVE, LeaseStatus.DRAFT] as any },
        { limit: 10, skip: 0 },
        _mockTenantContext as IRequestContext
      );

      const [, capturedFilters] = (mockLeaseDAO as any).getFilteredLeases.mock.calls[0];
      expect(capturedFilters.status).toContain(LeaseStatus.ACTIVE);
      expect(capturedFilters.status).not.toContain(LeaseStatus.DRAFT);
    });

    it('should force tenantId to context.currentuser.sub when tenant provides no tenantId', async () => {
      await leaseService.getFilteredLeases(
        testCuid,
        {},
        { limit: 10, skip: 0 },
        _mockTenantContext as IRequestContext
      );

      const [, capturedFilters] = (mockLeaseDAO as any).getFilteredLeases.mock.calls[0];
      expect(capturedFilters.tenantId).toBe(mockUserId.toString());
    });

    it('should preserve an explicitly provided tenantId for tenant callers', async () => {
      const explicitTenantId = new Types.ObjectId().toString();

      await leaseService.getFilteredLeases(
        testCuid,
        { tenantId: explicitTenantId } as any,
        { limit: 10, skip: 0 },
        _mockTenantContext as IRequestContext
      );

      const [, capturedFilters] = (mockLeaseDAO as any).getFilteredLeases.mock.calls[0];
      expect(capturedFilters.tenantId).toBe(explicitTenantId);
    });
  });
});
