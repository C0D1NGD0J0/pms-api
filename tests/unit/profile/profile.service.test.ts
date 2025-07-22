import { Types } from 'mongoose';
import { ProfileService } from '@services/profile/profile.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  createMockTranslationFunction,
  createMockEmployeeInfo,
  createMockProfileDAO,
  createMockVendorInfo,
  createMockProfile,
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
const mockUpdateVendorInfoSafeParse = ProfileValidations.updateVendorInfo
  .safeParse as jest.MockedFunction<typeof ProfileValidations.updateVendorInfo.safeParse>;
const mockProfileUpdateSafeParse = ProfileValidations.profileUpdate
  .safeParse as jest.MockedFunction<typeof ProfileValidations.profileUpdate.safeParse>;

describe('ProfileService', () => {
  let profileService: ProfileService;
  let mockProfileDAO: any;
  let mockTranslation: any;

  beforeEach(() => {
    mockProfileDAO = createMockProfileDAO();
    mockTranslation = createMockTranslationFunction();

    profileService = new ProfileService({
      profileDAO: mockProfileDAO,
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
      mockProfileDAO.ensureClientRoleInfo.mockResolvedValue(true);
      mockProfileDAO.updateEmployeeInfo.mockResolvedValue(mockUpdatedProfile);

      const result = await profileService.updateEmployeeInfo(
        profileId,
        cuid,
        employeeInfo,
        userRole
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(mockProfileDAO.ensureClientRoleInfo).toHaveBeenCalledWith(profileId, cuid);
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

      expect(mockProfileDAO.ensureClientRoleInfo).not.toHaveBeenCalled();
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

    it('should throw NotFoundError when client role info not found', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const employeeInfo = createMockEmployeeInfo();
      const userRole = 'manager';

      mockUpdateEmployeeInfoSafeParse.mockReturnValue({
        success: true,
        data: employeeInfo,
      });
      mockProfileDAO.ensureClientRoleInfo.mockRejectedValue(
        new NotFoundError({ message: 'Profile not found' })
      );

      await expect(
        profileService.updateEmployeeInfo(profileId, cuid, employeeInfo, userRole)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateVendorInfo', () => {
    it('should successfully update vendor information', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const vendorInfo = createMockVendorInfo();
      const userRole = 'vendor';
      const mockUpdatedProfile = createMockProfile({
        clientRoleInfo: [
          {
            cuid,
            role: 'vendor',
            vendorInfo,
          },
        ],
      });

      mockUpdateVendorInfoSafeParse.mockReturnValue({
        success: true,
        data: vendorInfo,
      });
      mockProfileDAO.ensureClientRoleInfo.mockResolvedValue(true);
      mockProfileDAO.updateVendorInfo.mockResolvedValue(mockUpdatedProfile);

      const result = await profileService.updateVendorInfo(profileId, cuid, vendorInfo, userRole);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(mockProfileDAO.updateVendorInfo).toHaveBeenCalledWith(profileId, cuid, vendorInfo);
    });

    it('should throw ForbiddenError for non-vendor user role', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const vendorInfo = createMockVendorInfo();
      const userRole = 'manager'; // Invalid role for vendor operations

      mockUpdateVendorInfoSafeParse.mockReturnValue({
        success: true,
        data: vendorInfo,
      });

      await expect(
        profileService.updateVendorInfo(profileId, cuid, vendorInfo, userRole)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should throw BadRequestError for invalid vendor data', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const invalidVendorInfo = { invalid: 'data' } as any;
      const userRole = 'vendor';

      mockUpdateVendorInfoSafeParse.mockReturnValue({
        success: false,
        error: {
          issues: [{ path: ['companyName'], message: 'Company name is required', code: 'custom' }],
        } as any,
      });

      await expect(
        profileService.updateVendorInfo(profileId, cuid, invalidVendorInfo, userRole)
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('getRoleSpecificInfo', () => {
    it('should return employee info for authorized roles', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const requestingUserRole = 'manager';
      const employeeInfo = createMockEmployeeInfo();

      mockProfileDAO.getRoleSpecificInfo.mockResolvedValue({
        employeeInfo,
        vendorInfo: null,
      });

      const result = await profileService.getRoleSpecificInfo(profileId, cuid, requestingUserRole);

      expect(result.success).toBe(true);
      expect(result.data.employeeInfo).toEqual(employeeInfo);
      expect(result.data.vendorInfo).toBeUndefined();
    });

    it('should return vendor info for vendor role', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const requestingUserRole = 'vendor';
      const vendorInfo = createMockVendorInfo();

      mockProfileDAO.getRoleSpecificInfo.mockResolvedValue({
        employeeInfo: null,
        vendorInfo,
      });

      const result = await profileService.getRoleSpecificInfo(profileId, cuid, requestingUserRole);

      expect(result.success).toBe(true);
      expect(result.data.employeeInfo).toBeUndefined();
      expect(result.data.vendorInfo).toEqual(vendorInfo);
    });

    it('should filter results based on requesting user role', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const requestingUserRole = 'tenant';

      mockProfileDAO.getRoleSpecificInfo.mockResolvedValue({
        employeeInfo: createMockEmployeeInfo(),
        vendorInfo: createMockVendorInfo(),
      });

      const result = await profileService.getRoleSpecificInfo(profileId, cuid, requestingUserRole);

      expect(result.success).toBe(true);
      expect(result.data.employeeInfo).toBeUndefined();
      expect(result.data.vendorInfo).toBeUndefined();
    });

    it('should throw NotFoundError when role info not found', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const requestingUserRole = 'manager';

      mockProfileDAO.getRoleSpecificInfo.mockRejectedValue(
        new NotFoundError({ message: 'Role info not found' })
      );

      await expect(
        profileService.getRoleSpecificInfo(profileId, cuid, requestingUserRole)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('clearRoleSpecificInfo', () => {
    it('should successfully clear employee info for authorized user', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const roleType = 'employee';
      const requestingUserRole = 'manager';
      const mockUpdatedProfile = createMockProfile();

      mockProfileDAO.clearRoleSpecificInfo.mockResolvedValue(mockUpdatedProfile);

      const result = await profileService.clearRoleSpecificInfo(
        profileId,
        cuid,
        roleType,
        requestingUserRole
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(mockProfileDAO.clearRoleSpecificInfo).toHaveBeenCalledWith(profileId, cuid, roleType);
    });

    it('should throw ForbiddenError for unauthorized user', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const roleType = 'employee';
      const requestingUserRole = 'vendor'; // Unauthorized role

      await expect(
        profileService.clearRoleSpecificInfo(profileId, cuid, roleType, requestingUserRole)
      ).rejects.toThrow(ForbiddenError);

      expect(mockProfileDAO.clearRoleSpecificInfo).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError when profile not found', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const roleType = 'employee';
      const requestingUserRole = 'admin';

      mockProfileDAO.clearRoleSpecificInfo.mockRejectedValue(
        new NotFoundError({ message: 'Profile not found' })
      );

      await expect(
        profileService.clearRoleSpecificInfo(profileId, cuid, roleType, requestingUserRole)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('initializeRoleInfo', () => {
    it('should successfully initialize employee role info', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const role = 'manager';
      const mockUpdatedProfile = createMockProfile();

      mockProfileDAO.ensureClientRoleInfo.mockResolvedValue(undefined);
      mockProfileDAO.updateEmployeeInfo.mockResolvedValue(mockUpdatedProfile);
      mockProfileDAO.findById.mockResolvedValue(mockUpdatedProfile);

      const result = await profileService.initializeRoleInfo(profileId, cuid, role);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(mockProfileDAO.ensureClientRoleInfo).toHaveBeenCalledWith(profileId, cuid);
    });

    it('should successfully initialize vendor role info', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const role = 'vendor';
      const mockUpdatedProfile = createMockProfile();

      mockProfileDAO.ensureClientRoleInfo.mockResolvedValue(undefined);
      mockProfileDAO.updateVendorInfo.mockResolvedValue(mockUpdatedProfile);
      mockProfileDAO.findById.mockResolvedValue(mockUpdatedProfile);

      const result = await profileService.initializeRoleInfo(profileId, cuid, role);

      expect(result.success).toBe(true);
      expect(mockProfileDAO.ensureClientRoleInfo).toHaveBeenCalledWith(profileId, cuid);
    });

    it('should throw NotFoundError when client role info initialization fails', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const role = 'manager';

      mockProfileDAO.ensureClientRoleInfo.mockRejectedValue(
        new NotFoundError({ message: 'Profile not found' })
      );

      await expect(profileService.initializeRoleInfo(profileId, cuid, role)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('updateProfileWithRoleInfo', () => {
    it('should successfully update profile with employee information', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const userRole = 'manager';
      const profileData = {
        personalInfo: {
          firstName: 'John',
          lastName: 'Doe',
        },
        employeeInfo: createMockEmployeeInfo(),
      };
      const mockUpdatedProfile = createMockProfile();

      mockProfileUpdateSafeParse.mockReturnValue({
        success: true,
        data: profileData,
      });

      // Mock the updateEmployeeInfo method on the service instance
      jest.spyOn(profileService, 'updateEmployeeInfo').mockResolvedValue({
        success: true,
        data: mockUpdatedProfile,
        message: 'Updated',
      });

      const result = await profileService.updateProfileWithRoleInfo(
        profileId,
        cuid,
        profileData,
        userRole
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(profileService.updateEmployeeInfo).toHaveBeenCalledWith(
        profileId,
        cuid,
        profileData.employeeInfo,
        userRole
      );
    });

    it('should successfully update profile with vendor information', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const userRole = 'vendor';
      const profileData = {
        personalInfo: {
          firstName: 'Jane',
          lastName: 'Smith',
        },
        vendorInfo: createMockVendorInfo(),
      };
      const mockUpdatedProfile = createMockProfile();

      mockProfileUpdateSafeParse.mockReturnValue({
        success: true,
        data: profileData,
      });

      jest.spyOn(profileService, 'updateVendorInfo').mockResolvedValue({
        success: true,
        data: mockUpdatedProfile,
        message: 'Updated',
      });

      const result = await profileService.updateProfileWithRoleInfo(
        profileId,
        cuid,
        profileData,
        userRole
      );

      expect(result.success).toBe(true);
      expect(profileService.updateVendorInfo).toHaveBeenCalledWith(
        profileId,
        cuid,
        profileData.vendorInfo,
        userRole
      );
    });

    it('should throw BadRequestError for invalid profile data', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const userRole = 'manager';
      const invalidProfileData = { invalid: 'data' } as any;

      mockProfileUpdateSafeParse.mockReturnValue({
        success: false,
        error: {
          issues: [
            { path: ['personalInfo'], message: 'Personal info is required', code: 'custom' },
          ],
        } as any,
      });

      await expect(
        profileService.updateProfileWithRoleInfo(profileId, cuid, invalidProfileData, userRole)
      ).rejects.toThrow(BadRequestError);
    });

    it('should handle mixed employee and vendor data appropriately', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const userRole = 'admin';
      const profileData = {
        personalInfo: {
          firstName: 'Admin',
          lastName: 'User',
        },
        employeeInfo: createMockEmployeeInfo(),
        vendorInfo: createMockVendorInfo(),
      };
      const mockUpdatedProfile = createMockProfile();

      mockProfileUpdateSafeParse.mockReturnValue({
        success: true,
        data: profileData,
      });

      jest.spyOn(profileService, 'updateEmployeeInfo').mockResolvedValue({
        success: true,
        data: mockUpdatedProfile,
        message: 'Updated',
      });
      jest.spyOn(profileService, 'updateVendorInfo').mockResolvedValue({
        success: true,
        data: mockUpdatedProfile,
        message: 'Updated',
      });

      const result = await profileService.updateProfileWithRoleInfo(
        profileId,
        cuid,
        profileData,
        userRole
      );

      expect(result.success).toBe(true);
      // Both methods should be called when both types of info are provided
      expect(profileService.updateEmployeeInfo).toHaveBeenCalled();
      expect(profileService.updateVendorInfo).toHaveBeenCalled();
    });
  });
});
