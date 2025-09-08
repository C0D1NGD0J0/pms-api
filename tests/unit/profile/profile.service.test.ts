import { Types } from 'mongoose';
import { ProfileService } from '@services/profile/profile.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  createMockTranslationFunction,
  createMockEmployeeInfo,
  createMockProfileDAO,
  createMockVendorInfo,
  createMockProfile,
  createMockClientDAO,
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
const mockUpdateVendorInfoSafeParse = ProfileValidations.updateVendorInfo
  .safeParse as jest.MockedFunction<typeof ProfileValidations.updateVendorInfo.safeParse>;
const mockProfileUpdateSafeParse = ProfileValidations.profileUpdate
  .safeParse as jest.MockedFunction<typeof ProfileValidations.profileUpdate.safeParse>;

describe('ProfileService', () => {
  let profileService: ProfileService;
  let mockProfileDAO: any;
  let mockClientDAO: any;
  let mockUserDAO: any;
  let mockTranslation: any;

  beforeEach(() => {
    mockProfileDAO = createMockProfileDAO();
    mockClientDAO = createMockClientDAO();
    mockUserDAO = createMockUserDAO();
    mockTranslation = createMockTranslationFunction();

    profileService = new ProfileService({
      profileDAO: mockProfileDAO,
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
    });

    (global as any).t = mockTranslation;

    jest.clearAllMocks();
  });

  describe('updateRoleInfo', () => {
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

      const result = await profileService.updateRoleInfo(
        profileId,
        cuid,
        employeeInfo,
        userRole,
        'employee'
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(mockProfileDAO.updateEmployeeInfo).toHaveBeenCalledWith(profileId, cuid, employeeInfo);
    });

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

      const result = await profileService.updateRoleInfo(profileId, cuid, vendorInfo, userRole, 'vendor');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(mockProfileDAO.updateVendorInfo).toHaveBeenCalledWith(profileId, cuid, vendorInfo);
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
        profileService.updateRoleInfo(profileId, cuid, invalidEmployeeInfo, userRole, 'employee')
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
        profileService.updateRoleInfo(profileId, cuid, employeeInfo, userRole, 'employee')
      ).rejects.toThrow(ForbiddenError);
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
        profileService.updateRoleInfo(profileId, cuid, vendorInfo, userRole, 'vendor')
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('updateCommonRoleInfo', () => {
    it('should successfully update common employee information', async () => {
      const profileId = new Types.ObjectId().toString();
      const employeeInfo = createMockEmployeeInfo();
      const userRole = 'admin';
      const mockUpdatedProfile = createMockProfile({ employeeInfo });

      mockUpdateEmployeeInfoSafeParse.mockReturnValue({
        success: true,
        data: employeeInfo,
      });
      mockProfileDAO.updateCommonEmployeeInfo.mockResolvedValue(mockUpdatedProfile);

      const result = await profileService.updateCommonRoleInfo(
        profileId,
        employeeInfo,
        userRole,
        'employee'
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(mockProfileDAO.updateCommonEmployeeInfo).toHaveBeenCalledWith(profileId, employeeInfo);
    });

    it('should successfully update common vendor information', async () => {
      const profileId = new Types.ObjectId().toString();
      const vendorInfo = createMockVendorInfo();
      const userRole = 'vendor'; // Use vendor role for vendor operations
      const mockUpdatedProfile = createMockProfile({ vendorInfo });

      mockUpdateVendorInfoSafeParse.mockReturnValue({
        success: true,
        data: vendorInfo,
      });
      mockProfileDAO.updateCommonVendorInfo.mockResolvedValue(mockUpdatedProfile);

      const result = await profileService.updateCommonRoleInfo(
        profileId,
        vendorInfo,
        userRole,
        'vendor'
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProfile);
      expect(mockProfileDAO.updateCommonVendorInfo).toHaveBeenCalledWith(profileId, vendorInfo);
    });
  });

  describe('initializeRoleInfo', () => {
    it('should successfully initialize employee role info', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const role = 'manager';
      const mockProfileObjectId = new Types.ObjectId();
      const mockUpdatedProfile = createMockProfile({ _id: mockProfileObjectId, id: mockProfileObjectId.toString() });

      mockProfileDAO.ensureClientRoleInfo.mockResolvedValue(undefined);
      mockProfileDAO.findFirst.mockResolvedValue(mockUpdatedProfile);
      mockProfileDAO.updateCommonEmployeeInfo.mockResolvedValue(mockUpdatedProfile);
      mockUpdateEmployeeInfoSafeParse.mockReturnValue({
        success: true,
        data: {},
      });

      // Mock updateCommonRoleInfo call
      jest.spyOn(profileService, 'updateCommonRoleInfo').mockResolvedValue({
        success: true,
        data: mockUpdatedProfile,
        message: 'Updated',
      });

      const result = await profileService.initializeRoleInfo(profileId, cuid, role);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(profileService.updateCommonRoleInfo).toHaveBeenCalledWith(mockUpdatedProfile.id, {}, 'admin', 'employee');
    });

    it('should successfully initialize vendor role info', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const role = 'vendor';
      const mockProfileObjectId = new Types.ObjectId();
      const mockUpdatedProfile = createMockProfile({ _id: mockProfileObjectId, id: mockProfileObjectId.toString() });

      mockProfileDAO.ensureClientRoleInfo.mockResolvedValue(undefined);
      mockProfileDAO.findFirst.mockResolvedValue(mockUpdatedProfile);
      mockProfileDAO.updateCommonVendorInfo.mockResolvedValue(mockUpdatedProfile);
      mockUpdateVendorInfoSafeParse.mockReturnValue({
        success: true,
        data: {},
      });

      // Mock updateCommonRoleInfo call
      jest.spyOn(profileService, 'updateCommonRoleInfo').mockResolvedValue({
        success: true,
        data: mockUpdatedProfile,
        message: 'Updated',
      });

      const result = await profileService.initializeRoleInfo(profileId, cuid, role);

      expect(result.success).toBe(true);
      expect(profileService.updateCommonRoleInfo).toHaveBeenCalledWith(mockUpdatedProfile.id, {}, 'admin', 'vendor');
    });

    it('should throw NotFoundError when client role info initialization fails', async () => {
      const profileId = new Types.ObjectId().toString();
      const cuid = 'test-cuid';
      const role = 'manager';

      // Mock clientDAO to return null to trigger NotFoundError in the private method
      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(profileService.initializeRoleInfo(profileId, cuid, role)).rejects.toThrow(
        NotFoundError
      );
    });
  });

});