import { Types } from 'mongoose';
import { InvitationQueue, EmailQueue } from '@queues/index';
import { EventEmitterService } from '@services/eventEmitter';
import { EmployeeDepartment } from '@interfaces/profile.interface';
import { ProfileService } from '@services/profile/profile.service';
import { IInvitationAcceptance } from '@interfaces/invitation.interface';
import { InvitationDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { InvitationService } from '@services/invitation/invitation.service';

describe('Invitation Metadata Transfer', () => {
  let invitationService: InvitationService;
  let profileService: ProfileService;
  let mockDAOs: {
    invitationDAO: InvitationDAO;
    profileDAO: ProfileDAO;
    clientDAO: ClientDAO;
    userDAO: UserDAO;
  };
  let mockQueues: {
    emailQueue: EmailQueue;
    invitationQueue: InvitationQueue;
  };
  let emitterService: EventEmitterService;

  const mockIds = {
    client: new Types.ObjectId(),
    user: new Types.ObjectId(),
    invitation: new Types.ObjectId(),
    profile: new Types.ObjectId(),
  };

  const createMockDAOs = () => ({
    invitationDAO: {
      findByToken: jest.fn(),
      acceptInvitation: jest.fn(),
      startSession: jest.fn(),
      withTransaction: jest.fn(),
      createInvitation: jest.fn(),
      findPendingInvitation: jest.fn(),
    } as any,
    profileDAO: {
      createUserProfile: jest.fn(),
      findFirst: jest.fn(),
      updateCommonEmployeeInfo: jest.fn(),
      updateCommonVendorInfo: jest.fn(),
      updateEmployeeInfo: jest.fn(),
      updateVendorInfo: jest.fn(),
      updateVendorReference: jest.fn(),
    } as any,
    clientDAO: {
      getClientByCuid: jest.fn(),
    } as any,
    userDAO: {
      getActiveUserByEmail: jest.fn(),
      createUserFromInvitation: jest.fn(),
      getUserById: jest.fn(),
      getUserWithClientAccess: jest.fn(),
      updateById: jest.fn(),
    } as any,
  });

  const createMockQueues = () => ({
    emailQueue: {
      addToEmailQueue: jest.fn(),
    } as any,
    invitationQueue: {} as any,
  });

  beforeEach(() => {
    mockDAOs = createMockDAOs();
    mockQueues = createMockQueues();
    emitterService = {
      on: jest.fn(),
      off: jest.fn(),
    } as any;

    const mockVendorService = {
      getVendorByUserId: jest.fn(),
      updateVendorInfo: jest.fn(),
      createVendor: jest.fn(),
      linkVendorToClient: jest.fn(),
    } as any;

    const mockUserService = {
      getClientUserInfo: jest.fn(),
      updateUserInfo: jest.fn(),
    } as any;

    const mockMediaUploadService = {
      handleMediaDeletion: jest.fn(),
    } as any;

    profileService = new ProfileService({
      ...mockDAOs,
      vendorService: mockVendorService,
      userService: mockUserService,
      emitterService,
      mediaUploadService: mockMediaUploadService,
    });

    invitationService = new InvitationService({
      ...mockDAOs,
      ...mockQueues,
      emitterService,
      profileService,
      vendorService: mockVendorService,
    });

    jest.spyOn(profileService, 'initializeRoleInfo');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Employee Info Transfer', () => {
    it('should transfer employeeInfo metadata to profile during invitation acceptance', async () => {
      const mockEmployeeInfo = {
        department: EmployeeDepartment.MAINTENANCE,
        jobTitle: 'Senior Maintenance Manager',
        employeeId: 'EMP-001',
        startDate: new Date('2024-01-15'),
        reportsTo: 'John Doe',
      };

      const mockInvitation = {
        _id: mockIds.invitation,
        inviteeEmail: 'employee@example.com',
        role: 'manager',
        metadata: {
          employeeInfo: mockEmployeeInfo,
        },
        personalInfo: {
          firstName: 'Jane',
          lastName: 'Smith',
        },
        inviteeFullName: 'Jane Smith',
        isValid: () => true,
        clientId: mockIds.client,
      };

      const mockUser = {
        _id: mockIds.user,
        email: 'employee@example.com',
        uid: 'user-uid-123',
        cuids: [],
      };

      const mockClient = {
        id: mockIds.client,
        cuid: 'client-123',
        displayName: 'Test Company',
      };

      const mockProfile = {
        id: mockIds.profile,
        user: mockIds.user,
      };

      // Setup mocks
      (mockDAOs.invitationDAO.startSession as jest.Mock).mockResolvedValue({});
      (mockDAOs.invitationDAO.withTransaction as jest.Mock).mockImplementation(
        async (session, callback) => {
          return callback(session);
        }
      );
      (mockDAOs.invitationDAO.findByToken as jest.Mock).mockResolvedValue(mockInvitation);
      (mockDAOs.userDAO.getActiveUserByEmail as jest.Mock).mockResolvedValue(null);
      (mockDAOs.clientDAO.getClientByCuid as jest.Mock).mockResolvedValue(mockClient);
      (mockDAOs.userDAO.createUserFromInvitation as jest.Mock).mockResolvedValue(mockUser);
      (mockDAOs.profileDAO.createUserProfile as jest.Mock).mockResolvedValue(mockProfile);
      (mockDAOs.invitationDAO.acceptInvitation as jest.Mock).mockResolvedValue(true);
      (mockDAOs.profileDAO.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (mockDAOs.profileDAO.updateCommonEmployeeInfo as jest.Mock).mockResolvedValue(mockProfile);
      (mockDAOs.userDAO.getUserById as jest.Mock).mockResolvedValue(mockUser);

      const acceptanceData: IInvitationAcceptance = {
        token: 'test-token',
        email: 'employee@example.com',
        password: 'SecurePassword123!',
        confirmPassword: 'SecurePassword123!',
        termsAccepted: true,
        newsletterOptIn: false,
        phoneNumber: '+1234567890',
        location: 'New York',
        timeZone: 'America/New_York',
        lang: 'en',
        cuid: 'client-123',
      };

      // Execute
      await invitationService.acceptInvitation('client-123', acceptanceData);

      // Verify that initializeRoleInfo was called with the employee metadata
      expect(profileService.initializeRoleInfo).toHaveBeenCalledWith(
        mockIds.user.toString(),
        'client-123',
        'manager',
        undefined,
        {
          employeeInfo: mockEmployeeInfo,
          vendorInfo: undefined,
        }
      );

      // Verify that updateEmployeeInfo was called with the employee data
      expect(mockDAOs.profileDAO.updateEmployeeInfo).toHaveBeenCalledWith(
        mockIds.profile,
        'client-123',
        mockEmployeeInfo
      );
    });
  });

  describe('Vendor Info Transfer', () => {
    it('should transfer vendorInfo metadata to profile during invitation acceptance', async () => {
      const mockVendorInfo = {
        companyName: 'ABC Maintenance Services',
        businessType: 'LLC',
        yearsInBusiness: 10,
        taxId: 'TAX-123456',
        registrationNumber: 'REG-789',
        servicesOffered: {
          plumbing: true,
          electrical: true,
          hvac: true,
          maintenance: true,
        },
        contactPerson: {
          name: 'John Manager',
          jobTitle: 'Operations Manager',
          email: 'manager@abcservices.com',
          phone: '+1987654321',
        },
      };

      const mockInvitation = {
        _id: mockIds.invitation,
        inviteeEmail: 'vendor@example.com',
        role: 'vendor',
        metadata: {
          vendorInfo: mockVendorInfo,
        },
        personalInfo: {
          firstName: 'Bob',
          lastName: 'Vendor',
        },
        inviteeFullName: 'Bob Vendor',
        isValid: () => true,
        clientId: mockIds.client,
      };

      const mockUser = {
        _id: mockIds.user,
        email: 'vendor@example.com',
        uid: 'vendor-uid-456',
        cuids: [],
      };

      const mockClient = {
        id: mockIds.client,
        cuid: 'client-123',
        displayName: 'Test Company',
      };

      const mockProfile = {
        id: mockIds.profile,
        user: mockIds.user,
      };

      // Setup mocks
      (mockDAOs.invitationDAO.startSession as jest.Mock).mockResolvedValue({});
      (mockDAOs.invitationDAO.withTransaction as jest.Mock).mockImplementation(
        async (session, callback) => {
          return callback(session);
        }
      );
      (mockDAOs.invitationDAO.findByToken as jest.Mock).mockResolvedValue(mockInvitation);
      (mockDAOs.userDAO.getActiveUserByEmail as jest.Mock).mockResolvedValue(null);
      (mockDAOs.clientDAO.getClientByCuid as jest.Mock).mockResolvedValue(mockClient);
      (mockDAOs.userDAO.createUserFromInvitation as jest.Mock).mockResolvedValue(mockUser);
      (mockDAOs.profileDAO.createUserProfile as jest.Mock).mockResolvedValue(mockProfile);
      (mockDAOs.invitationDAO.acceptInvitation as jest.Mock).mockResolvedValue(true);
      (mockDAOs.profileDAO.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (mockDAOs.profileDAO.updateVendorReference as jest.Mock).mockResolvedValue(mockProfile);
      (mockDAOs.userDAO.getUserById as jest.Mock).mockResolvedValue(mockUser);

      // Mock vendor service
      const mockVendorServiceForInvitation = (invitationService as any).vendorService;
      mockVendorServiceForInvitation.createVendor.mockResolvedValue({
        success: true,
        data: { _id: new Types.ObjectId(), vuid: 'vendor-123' },
      });

      const acceptanceData: IInvitationAcceptance = {
        token: 'vendor-token',
        email: 'vendor@example.com',
        password: 'VendorPass123!',
        confirmPassword: 'VendorPass123!',
        termsAccepted: true,
        newsletterOptIn: true,
        phoneNumber: '+1234567890',
        location: 'Los Angeles',
        timeZone: 'America/Los_Angeles',
        lang: 'en',
        cuid: 'client-123',
      };

      // Execute
      await invitationService.acceptInvitation('client-123', acceptanceData);

      // Verify that initializeRoleInfo was called with the vendor metadata
      expect(profileService.initializeRoleInfo).toHaveBeenCalledWith(
        mockIds.user.toString(),
        'client-123',
        'vendor',
        undefined,
        {
          employeeInfo: undefined,
          vendorInfo: mockVendorInfo,
        }
      );

      // Verify that for simple vendorInfo without isPrimaryVendor, no vendor entity is created
      // since the profile service only creates vendors for primary vendors or team members
      expect(mockVendorServiceForInvitation.createVendor).not.toHaveBeenCalled();
      expect(mockDAOs.profileDAO.updateVendorReference).not.toHaveBeenCalled();
    });
  });

  describe('No Metadata Scenario', () => {
    it('should handle invitation acceptance when no metadata is provided', async () => {
      const mockInvitation = {
        _id: mockIds.invitation,
        inviteeEmail: 'staff@example.com',
        role: 'staff',
        metadata: {}, // Empty metadata
        personalInfo: {
          firstName: 'Alice',
          lastName: 'Staff',
        },
        inviteeFullName: 'Alice Staff',
        isValid: () => true,
        clientId: mockIds.client,
      };

      const mockUser = {
        _id: mockIds.user,
        email: 'staff@example.com',
        uid: 'staff-uid-789',
        cuids: [],
      };

      const mockClient = {
        id: mockIds.client,
        cuid: 'client-123',
        displayName: 'Test Company',
      };

      const mockProfile = {
        id: mockIds.profile,
        user: mockIds.user,
      };

      // Setup mocks
      (mockDAOs.invitationDAO.startSession as jest.Mock).mockResolvedValue({});
      (mockDAOs.invitationDAO.withTransaction as jest.Mock).mockImplementation(
        async (session, callback) => {
          return callback(session);
        }
      );
      (mockDAOs.invitationDAO.findByToken as jest.Mock).mockResolvedValue(mockInvitation);
      (mockDAOs.userDAO.getActiveUserByEmail as jest.Mock).mockResolvedValue(null);
      (mockDAOs.clientDAO.getClientByCuid as jest.Mock).mockResolvedValue(mockClient);
      (mockDAOs.userDAO.createUserFromInvitation as jest.Mock).mockResolvedValue(mockUser);
      (mockDAOs.profileDAO.createUserProfile as jest.Mock).mockResolvedValue(mockProfile);
      (mockDAOs.invitationDAO.acceptInvitation as jest.Mock).mockResolvedValue(true);
      (mockDAOs.profileDAO.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (mockDAOs.profileDAO.updateEmployeeInfo as jest.Mock).mockResolvedValue(mockProfile);
      (mockDAOs.userDAO.getUserById as jest.Mock).mockResolvedValue(mockUser);

      const acceptanceData: IInvitationAcceptance = {
        token: 'staff-token',
        email: 'staff@example.com',
        password: 'StaffPass123!',
        confirmPassword: 'StaffPass123!',
        termsAccepted: true,
        newsletterOptIn: false,
        phoneNumber: '+1234567890',
        location: 'Chicago',
        timeZone: 'America/Chicago',
        lang: 'en',
        cuid: 'client-123',
      };

      // Execute
      await invitationService.acceptInvitation('client-123', acceptanceData);

      // Verify that initializeRoleInfo was called with empty metadata
      expect(profileService.initializeRoleInfo).toHaveBeenCalledWith(
        mockIds.user.toString(),
        'client-123',
        'staff',
        undefined,
        {
          employeeInfo: undefined,
          vendorInfo: undefined,
        }
      );

      // Verify that updateEmployeeInfo was called with empty object
      expect(mockDAOs.profileDAO.updateEmployeeInfo).toHaveBeenCalledWith(
        mockIds.profile,
        'client-123',
        {}
      );
    });
  });
});
