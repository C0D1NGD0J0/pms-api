import { Types } from 'mongoose';
import { ROLES } from '@shared/constants/roles.constants';
import { ProfileService } from '@services/profile/profile.service';
import { BackgroundCheckStatus } from '@interfaces/profile.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  createMockTranslationFunction,
  createMockEmployeeInfo,
  createMockProfileDAO,
  createMockVendorInfo,
  createMockClientDAO,
  createMockProfile,
  createMockUserDAO,
} from '@tests/helpers';

jest.mock('@shared/validations/ProfileValidation', () => ({
  ProfileValidations: {
    updateEmployeeInfo: {
      safeParse: jest.fn(),
    },
    updateVendorInfo: {
      safeParse: jest.fn(),
    },
    updateTenantInfo: {
      safeParse: jest.fn(),
    },
    tenantInfo: {
      safeParse: jest.fn(),
    },
    profileUpdate: {
      safeParse: jest.fn(),
    },
  },
}));

// Import after mocking to get the mocked version
import { ProfileValidations } from '@shared/validations/ProfileValidation';
const mockUpdateEmployeeInfoSafeParse = ProfileValidations.updateEmployeeInfo
  .safeParse as jest.MockedFunction<typeof ProfileValidations.updateEmployeeInfo.safeParse>;
const mockUpdateTenantInfoSafeParse = ProfileValidations.updateTenantInfo
  .safeParse as jest.MockedFunction<typeof ProfileValidations.updateTenantInfo.safeParse>;

describe('ProfileService', () => {
  let profileService: ProfileService;
  let mockProfileDAO: any;
  let mockClientDAO: any;
  let mockUserDAO: any;
  let mockVendorService: any;
  let mockUserService: any;
  let mockTranslation: any;

  beforeEach(() => {
    mockProfileDAO = createMockProfileDAO();
    mockClientDAO = createMockClientDAO();
    mockUserDAO = createMockUserDAO();
    mockVendorService = {
      getVendorByUserId: jest.fn(),
      updateVendorInfo: jest.fn(),
      createVendor: jest.fn(),
    };
    mockUserService = {
      getClientUserInfo: jest.fn(),
      updateUserInfo: jest.fn(),
    };
    mockTranslation = createMockTranslationFunction();

    const mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn(),
      listenerCount: jest.fn(),
      destroy: jest.fn(),
    } as any;

    const mockMediaUploadService = {
      handleMediaDeletion: jest.fn(),
      handleAvatarDeletion: jest.fn(),
    } as any;

    // Set global translation function before creating service
    (global as any).t = mockTranslation;

    profileService = new ProfileService({
      profileDAO: mockProfileDAO,
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      vendorService: mockVendorService,
      userService: mockUserService,
      emitterService: mockEmitterService,
      mediaUploadService: mockMediaUploadService,
    });

    jest.clearAllMocks();
  });

  describe('updateEmployeeInfo', () => {
    it('should successfully update employee information', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const employeeInfo = createMockEmployeeInfo();
      const userRole = ROLES.MANAGER;
      const mockUpdatedProfile = createMockProfile({
        clientRoleInfo: [
          {
            cuid,
            role: ROLES.MANAGER,
            employeeInfo,
          },
        ],
      });

      mockUpdateEmployeeInfoSafeParse.mockReturnValue({
        success: true,
        data: employeeInfo,
      });
      mockClientDAO.getClientByCuid.mockResolvedValue({ displayName: 'Test Client' });
      mockUserDAO.getUserById.mockResolvedValue({ cuids: [] });
      mockUserDAO.updateById.mockResolvedValue(true);
      mockProfileDAO.updateEmployeeInfo.mockResolvedValue(mockUpdatedProfile);

      const result = await profileService.updateEmployeeInfo(
        profileId,
        cuid,
        employeeInfo,
        userRole
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(mockProfileDAO.updateEmployeeInfo).toHaveBeenCalledWith(profileId, cuid, employeeInfo);
    });

    it('should throw BadRequestError for invalid employee data', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const invalidEmployeeInfo = { invalid: 'data' } as any;
      const userRole = ROLES.MANAGER;

      mockUpdateEmployeeInfoSafeParse.mockReturnValue({
        success: false,
        error: {
          issues: [{ path: ['department'], message: 'Department is required', code: 'custom' }],
        } as any,
      });

      await expect(
        profileService.updateEmployeeInfo(profileId, cuid, invalidEmployeeInfo, userRole)
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw ForbiddenError for invalid user role', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const employeeInfo = createMockEmployeeInfo();
      const userRole = 'tenant'; // Invalid role for this operation

      mockUpdateEmployeeInfoSafeParse.mockReturnValue({
        success: true,
        data: employeeInfo,
      });

      await expect(
        profileService.updateEmployeeInfo(profileId, cuid, employeeInfo, userRole)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('updateVendorInfo', () => {
    it('should successfully update vendor information', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const vendorInfo = createMockVendorInfo();
      const userRole = 'vendor';
      const mockProfile = createMockProfile({ user: new Types.ObjectId() });
      const mockVendor = { _id: new Types.ObjectId() };
      const mockUpdatedProfile = createMockProfile({
        clientRoleInfo: [
          {
            cuid,
            role: 'vendor',
            vendorInfo,
          },
        ],
      });

      mockProfileDAO.findFirst.mockResolvedValue(mockProfile);
      mockVendorService.getVendorByUserId.mockResolvedValue(mockVendor);
      mockVendorService.updateVendorInfo.mockResolvedValue(true);
      mockClientDAO.getClientByCuid.mockResolvedValue({ displayName: 'Test Client' });
      mockUserDAO.getUserById.mockResolvedValue({ cuids: [] });
      mockUserDAO.updateById.mockResolvedValue(true);
      mockProfileDAO.findFirst
        .mockResolvedValueOnce(mockProfile)
        .mockResolvedValueOnce(mockUpdatedProfile);

      const result = await profileService.updateVendorInfo(profileId, cuid, vendorInfo, userRole);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(mockVendorService.updateVendorInfo).toHaveBeenCalledWith(
        mockVendor._id.toString(),
        vendorInfo
      );
    });

    it('should throw ForbiddenError for non-vendor user role', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const vendorInfo = createMockVendorInfo();
      const userRole = ROLES.MANAGER; // Invalid role for vendor operations

      await expect(
        profileService.updateVendorInfo(profileId, cuid, vendorInfo, userRole)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw NotFoundError when vendor entity not found', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const vendorInfo = createMockVendorInfo();
      const userRole = 'vendor';
      const mockProfile = createMockProfile({ user: new Types.ObjectId() });

      mockProfileDAO.findFirst.mockResolvedValue(mockProfile);
      mockVendorService.getVendorByUserId.mockResolvedValue(null);

      await expect(
        profileService.updateVendorInfo(profileId, cuid, vendorInfo, userRole)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateTenantInfo', () => {
    const createMockTenantInfo = () => ({
      activeLease: {
        leaseId: new Types.ObjectId().toString(),
        propertyId: new Types.ObjectId().toString(),
        unitId: new Types.ObjectId().toString(),
        durationMonths: 12,
        rentAmount: 1500,
        paymentDueDate: new Date('2024-01-01'),
      },
      employerInfo: {
        companyName: 'Test Company',
        position: 'Software Engineer',
        monthlyIncome: 5000,
      },
      rentalReferences: [
        {
          landlordName: 'John Doe',
          propertyAddress: '123 Main St, City, State',
        },
      ],
      pets: [
        {
          type: 'dog',
          breed: 'Golden Retriever',
          isServiceAnimal: false,
        },
      ],
      emergencyContact: {
        name: 'Jane Doe',
        phone: '+1234567890',
        relationship: 'spouse',
        email: 'jane@example.com',
      },
      backgroundCheckStatus: BackgroundCheckStatus.APPROVED,
    });

    it('should successfully update tenant information using buildDotNotation', async () => {
      const cuid = 'test-cuid';
      const profileId = new Types.ObjectId().toString();
      const tenantInfo = createMockTenantInfo();
      const mockUpdatedProfile = createMockProfile({
        tenantInfo,
      });

      mockUpdateTenantInfoSafeParse.mockReturnValue({
        success: true,
        data: tenantInfo,
      });
      mockClientDAO.getClientByCuid.mockResolvedValue({ displayName: 'Test Client' });
      mockUserDAO.getUserById.mockResolvedValue({ cuids: [] });
      mockUserDAO.updateById.mockResolvedValue(true);
      mockProfileDAO.updateById.mockResolvedValue(mockUpdatedProfile);

      const result = await profileService.updateTenantInfo(cuid, profileId, tenantInfo);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(mockProfileDAO.updateById).toHaveBeenCalledWith(profileId, {
        $set: {
          'tenantInfo.activeLease': tenantInfo.activeLease,
          'tenantInfo.employerInfo': tenantInfo.employerInfo,
          'tenantInfo.rentalReferences': tenantInfo.rentalReferences,
          'tenantInfo.pets': tenantInfo.pets,
          'tenantInfo.emergencyContact': tenantInfo.emergencyContact,
          'tenantInfo.backgroundCheckStatus': tenantInfo.backgroundCheckStatus,
        },
      });
    });

    it('should throw BadRequestError for invalid tenant data', async () => {
      const cuid = 'test-cuid';
      const profileId = new Types.ObjectId().toString();
      const invalidTenantInfo = { invalid: 'data' } as any;

      mockUpdateTenantInfoSafeParse.mockReturnValue({
        success: false,
        error: {
          issues: [{ path: ['activeLease'], message: 'Invalid lease information', code: 'custom' }],
        } as any,
      });

      await expect(
        profileService.updateTenantInfo(cuid, profileId, invalidTenantInfo)
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw NotFoundError when profile update fails', async () => {
      const cuid = 'test-cuid';
      const profileId = new Types.ObjectId().toString();
      const tenantInfo = createMockTenantInfo();

      mockUpdateTenantInfoSafeParse.mockReturnValue({
        success: true,
        data: tenantInfo,
      });
      mockClientDAO.getClientByCuid.mockResolvedValue({ displayName: 'Test Client' });
      mockUserDAO.getUserById.mockResolvedValue({ cuids: [] });
      mockUserDAO.updateById.mockResolvedValue(true);
      mockProfileDAO.updateById.mockResolvedValue(null);

      await expect(profileService.updateTenantInfo(cuid, profileId, tenantInfo)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('initializeRoleInfo', () => {
    it('should successfully initialize employee role info', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const role = 'manager';
      const mockProfileObjectId = new Types.ObjectId();
      const mockUpdatedProfile = createMockProfile({
        _id: mockProfileObjectId,
        id: mockProfileObjectId.toString(),
        user: new Types.ObjectId(userId),
      });

      mockClientDAO.getClientByCuid.mockResolvedValue({ displayName: 'Test Client' });
      mockUserDAO.getUserById.mockResolvedValue({ cuids: [] });
      mockUserDAO.updateById.mockResolvedValue(true);
      mockProfileDAO.findFirst.mockResolvedValue(mockUpdatedProfile);
      mockProfileDAO.updateEmployeeInfo.mockResolvedValue(mockUpdatedProfile);

      const result = await profileService.initializeRoleInfo(userId, cuid, role);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should successfully initialize vendor role info', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const role = 'vendor';
      const mockProfileObjectId = new Types.ObjectId();
      const mockUpdatedProfile = createMockProfile({
        _id: mockProfileObjectId,
        id: mockProfileObjectId.toString(),
        user: new Types.ObjectId(userId),
      });

      mockClientDAO.getClientByCuid.mockResolvedValue({ displayName: 'Test Client' });
      mockUserDAO.getUserById.mockResolvedValue({ cuids: [] });
      mockUserDAO.updateById.mockResolvedValue(true);
      mockProfileDAO.findFirst.mockResolvedValue(mockUpdatedProfile);

      const result = await profileService.initializeRoleInfo(userId, cuid, role);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should throw NotFoundError when client role info initialization fails', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const role = 'manager';

      // Mock clientDAO to return null to trigger NotFoundError in the private method
      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(profileService.initializeRoleInfo(userId, cuid, role)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('getUserNotificationPreferences', () => {
    it('should return user notification preferences successfully', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const mockPreferences = {
        messages: false,
        comments: true,
        announcements: true,
        maintenance: true,
        payments: true,
        system: true,
        propertyUpdates: true,
        emailNotifications: true,
        inAppNotifications: true,
        emailFrequency: 'immediate' as const,
      };

      mockProfileDAO.getNotificationPreferences.mockResolvedValue(mockPreferences);

      const result = await profileService.getUserNotificationPreferences(userId, cuid);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockPreferences);
      expect(result.message).toBe('Notification preferences retrieved successfully');
      expect(mockProfileDAO.getNotificationPreferences).toHaveBeenCalledWith(userId);
    });

    it('should return default preferences when user profile not found', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';

      mockProfileDAO.getNotificationPreferences.mockResolvedValue(null);

      const result = await profileService.getUserNotificationPreferences(userId, cuid);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Default notification preferences retrieved');
      expect(result.data).toEqual({
        messages: false,
        comments: false,
        announcements: true,
        maintenance: true,
        payments: true,
        system: true,
        propertyUpdates: true,
        emailNotifications: true,
        inAppNotifications: true,
        emailFrequency: 'immediate',
      });
    });

    it('should handle errors and throw them', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const mockError = new Error('Database error');

      mockProfileDAO.getNotificationPreferences.mockRejectedValue(mockError);

      await expect(profileService.getUserNotificationPreferences(userId, cuid)).rejects.toThrow(
        'Database error'
      );
    });
  });
});
