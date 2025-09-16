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
  let invitationDAO: InvitationDAO;
  let profileDAO: ProfileDAO;
  let clientDAO: ClientDAO;
  let userDAO: UserDAO;
  let emailQueue: EmailQueue;
  let invitationQueue: InvitationQueue;
  let emitterService: EventEmitterService;

  const mockClientId = new Types.ObjectId();
  const mockUserId = new Types.ObjectId();
  const mockInvitationId = new Types.ObjectId();
  const mockProfileId = new Types.ObjectId();

  beforeEach(() => {
    // Create mock instances
    invitationDAO = {
      findByToken: jest.fn(),
      acceptInvitation: jest.fn(),
      startSession: jest.fn(),
      withTransaction: jest.fn(),
      createInvitation: jest.fn(),
      findPendingInvitation: jest.fn(),
    } as any;

    profileDAO = {
      createUserProfile: jest.fn(),
      findFirst: jest.fn(),
      updateCommonEmployeeInfo: jest.fn(),
      updateCommonVendorInfo: jest.fn(),
    } as any;

    clientDAO = {
      getClientByCuid: jest.fn(),
    } as any;

    userDAO = {
      getActiveUserByEmail: jest.fn(),
      createUserFromInvitation: jest.fn(),
      getUserById: jest.fn(),
      getUserWithClientAccess: jest.fn(),
      updateById: jest.fn(),
    } as any;

    emailQueue = {
      addToEmailQueue: jest.fn(),
    } as any;

    invitationQueue = {} as any;
    emitterService = {
      on: jest.fn(),
      off: jest.fn(),
    } as any;

    // Create ProfileService instance with required dependencies
    const mockVendorService = {
      getVendorByUserId: jest.fn(),
      updateVendorInfo: jest.fn(),
      createVendor: jest.fn(),
    } as any;
    const mockUserService = {
      getClientUserInfo: jest.fn(),
      updateUserInfo: jest.fn(),
    } as any;

    profileService = new ProfileService({
      profileDAO,
      clientDAO,
      userDAO,
      vendorService: mockVendorService,
      userService: mockUserService,
      emitterService,
    });

    // Create InvitationService instance with required dependencies
    const mockVendorServiceForInvitation = {
      createVendor: jest.fn(),
      linkVendorToClient: jest.fn(),
    } as any;

    invitationService = new InvitationService({
      invitationDAO,
      emailQueue,
      userDAO,
      profileDAO,
      clientDAO,
      invitationQueue,
      emitterService,
      profileService,
      vendorService: mockVendorServiceForInvitation,
    });

    // Spy on the initializeRoleInfo method
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
        _id: mockInvitationId,
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
        clientId: mockClientId,
      };

      const mockUser = {
        _id: mockUserId,
        email: 'employee@example.com',
        uid: 'user-uid-123',
        cuids: [],
      };

      const mockClient = {
        id: mockClientId,
        cuid: 'client-123',
        displayName: 'Test Company',
      };

      const mockProfile = {
        id: mockProfileId,
        user: mockUserId,
      };

      // Setup mocks
      (invitationDAO.startSession as jest.Mock).mockResolvedValue({});
      (invitationDAO.withTransaction as jest.Mock).mockImplementation(async (session, callback) => {
        return callback(session);
      });
      (invitationDAO.findByToken as jest.Mock).mockResolvedValue(mockInvitation);
      (userDAO.getActiveUserByEmail as jest.Mock).mockResolvedValue(null);
      (clientDAO.getClientByCuid as jest.Mock).mockResolvedValue(mockClient);
      (userDAO.createUserFromInvitation as jest.Mock).mockResolvedValue(mockUser);
      (profileDAO.createUserProfile as jest.Mock).mockResolvedValue(mockProfile);
      (invitationDAO.acceptInvitation as jest.Mock).mockResolvedValue(true);
      (profileDAO.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (profileDAO.updateCommonEmployeeInfo as jest.Mock).mockResolvedValue(mockProfile);
      (userDAO.getUserById as jest.Mock).mockResolvedValue(mockUser);

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
        mockUserId.toString(),
        'client-123',
        'manager',
        undefined,
        {
          employeeInfo: mockEmployeeInfo,
          vendorInfo: undefined,
        }
      );

      // Verify that updateCommonEmployeeInfo was called with the employee data
      expect(profileDAO.updateCommonEmployeeInfo).toHaveBeenCalledWith(
        mockProfileId,
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
        _id: mockInvitationId,
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
        clientId: mockClientId,
      };

      const mockUser = {
        _id: mockUserId,
        email: 'vendor@example.com',
        uid: 'vendor-uid-456',
        cuids: [],
      };

      const mockClient = {
        id: mockClientId,
        cuid: 'client-123',
        displayName: 'Test Company',
      };

      const mockProfile = {
        id: mockProfileId,
        user: mockUserId,
      };

      // Setup mocks
      (invitationDAO.startSession as jest.Mock).mockResolvedValue({});
      (invitationDAO.withTransaction as jest.Mock).mockImplementation(async (session, callback) => {
        return callback(session);
      });
      (invitationDAO.findByToken as jest.Mock).mockResolvedValue(mockInvitation);
      (userDAO.getActiveUserByEmail as jest.Mock).mockResolvedValue(null);
      (clientDAO.getClientByCuid as jest.Mock).mockResolvedValue(mockClient);
      (userDAO.createUserFromInvitation as jest.Mock).mockResolvedValue(mockUser);
      (profileDAO.createUserProfile as jest.Mock).mockResolvedValue(mockProfile);
      (invitationDAO.acceptInvitation as jest.Mock).mockResolvedValue(true);
      (profileDAO.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (profileDAO.updateVendorInfo as jest.Mock).mockResolvedValue(mockProfile);
      (userDAO.getUserById as jest.Mock).mockResolvedValue(mockUser);

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
        mockUserId.toString(),
        'client-123',
        'vendor',
        undefined,
        {
          employeeInfo: undefined,
          vendorInfo: mockVendorInfo,
        }
      );

      // Verify that updateCommonVendorInfo was called with the vendor data
      expect(profileDAO.updateVendorInfo).toHaveBeenCalledWith(mockProfileId, mockVendorInfo);
    });
  });

  describe('No Metadata Scenario', () => {
    it('should handle invitation acceptance when no metadata is provided', async () => {
      const mockInvitation = {
        _id: mockInvitationId,
        inviteeEmail: 'staff@example.com',
        role: 'staff',
        metadata: {}, // Empty metadata
        personalInfo: {
          firstName: 'Alice',
          lastName: 'Staff',
        },
        inviteeFullName: 'Alice Staff',
        isValid: () => true,
        clientId: mockClientId,
      };

      const mockUser = {
        _id: mockUserId,
        email: 'staff@example.com',
        uid: 'staff-uid-789',
        cuids: [],
      };

      const mockClient = {
        id: mockClientId,
        cuid: 'client-123',
        displayName: 'Test Company',
      };

      const mockProfile = {
        id: mockProfileId,
        user: mockUserId,
      };

      // Setup mocks
      (invitationDAO.startSession as jest.Mock).mockResolvedValue({});
      (invitationDAO.withTransaction as jest.Mock).mockImplementation(async (session, callback) => {
        return callback(session);
      });
      (invitationDAO.findByToken as jest.Mock).mockResolvedValue(mockInvitation);
      (userDAO.getActiveUserByEmail as jest.Mock).mockResolvedValue(null);
      (clientDAO.getClientByCuid as jest.Mock).mockResolvedValue(mockClient);
      (userDAO.createUserFromInvitation as jest.Mock).mockResolvedValue(mockUser);
      (profileDAO.createUserProfile as jest.Mock).mockResolvedValue(mockProfile);
      (invitationDAO.acceptInvitation as jest.Mock).mockResolvedValue(true);
      (profileDAO.findFirst as jest.Mock).mockResolvedValue(mockProfile);
      (profileDAO.updateCommonEmployeeInfo as jest.Mock).mockResolvedValue(mockProfile);
      (userDAO.getUserById as jest.Mock).mockResolvedValue(mockUser);

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
        mockUserId.toString(),
        'client-123',
        'staff',
        undefined,
        {
          employeeInfo: undefined,
          vendorInfo: undefined,
        }
      );

      // Verify that updateCommonEmployeeInfo was called with empty object
      expect(profileDAO.updateCommonEmployeeInfo).toHaveBeenCalledWith(mockProfileId, {});
    });
  });
});
