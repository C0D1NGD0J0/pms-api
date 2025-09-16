import { Types } from 'mongoose';
import { ProfileService } from '@services/profile/profile.service';
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
    profileUpdate: {
      safeParse: jest.fn(),
    },
  },
}));

// Import after mocking to get the mocked version
import { ProfileValidations } from '@shared/validations/ProfileValidation';
const mockUpdateEmployeeInfoSafeParse = ProfileValidations.updateEmployeeInfo
  .safeParse as jest.MockedFunction<typeof ProfileValidations.updateEmployeeInfo.safeParse>;

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

    profileService = new ProfileService({
      profileDAO: mockProfileDAO,
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      vendorService: mockVendorService,
      userService: mockUserService,
      emitterService: mockEmitterService,
    });

    (global as any).t = mockTranslation;

    jest.clearAllMocks();
  });

  describe('updateEmployeeInfo', () => {
    it('should successfully update employee information', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const employeeInfo = createMockEmployeeInfo();
      const userRole = 'manager';
      const mockUpdatedProfile = createMockProfile({
        clientRoleInfo: [
          {
            cuid,
            role: 'manager',
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
      const userRole = 'manager';

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
      const userRole = 'manager'; // Invalid role for vendor operations

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
});
