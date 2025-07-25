import Logger from 'bunyan';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { ProfileDAO } from '@dao/profileDAO';
import { IUserRoleType } from '@interfaces/user.interface';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { ProfileValidations } from '@shared/validations/ProfileValidation';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { IProfileDocument, EmployeeInfo, VendorInfo } from '@interfaces/profile.interface';

interface IConstructor {
  profileDAO: ProfileDAO;
}

export class ProfileService {
  private readonly profileDAO: ProfileDAO;
  private readonly logger: Logger;

  constructor({ profileDAO }: IConstructor) {
    this.profileDAO = profileDAO;
    this.logger = createLogger('ProfileService');
  }

  /**
   * Update employee-specific information for a profile
   */
  async updateEmployeeInfo(
    profileId: string,
    cuid: string,
    employeeInfo: any,
    userRole: IUserRoleType
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      // Validate input
      const validation = ProfileValidations.updateEmployeeInfo.safeParse(employeeInfo);
      if (!validation.success) {
        throw new BadRequestError({
          message: `Validation failed: ${validation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }

      // Check if user has appropriate role
      if (!['manager', 'staff', 'admin'].includes(userRole)) {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      // Ensure client role info exists
      await this.profileDAO.ensureClientRoleInfo(profileId, cuid);

      // Update employee info
      const result = await this.profileDAO.updateEmployeeInfo(profileId, cuid, validation.data);

      if (!result) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      this.logger.info(`Employee info updated for profile ${profileId}, client ${cuid}`);

      return {
        success: true,
        data: result,
        message: t('profile.success.employeeInfoUpdated'),
      };
    } catch (error) {
      this.logger.error(`Error updating employee info for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Update vendor-specific information for a profile
   */
  async updateVendorInfo(
    profileId: string,
    cuid: string,
    vendorInfo: any,
    userRole: IUserRoleType
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      // Validate input
      const validation = ProfileValidations.updateVendorInfo.safeParse(vendorInfo);
      if (!validation.success) {
        throw new BadRequestError({
          message: `Validation failed: ${validation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }

      // Check if user has vendor role
      if (userRole !== 'vendor') {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      // Ensure client role info exists
      await this.profileDAO.ensureClientRoleInfo(profileId, cuid);

      // Update vendor info
      const result = await this.profileDAO.updateVendorInfo(profileId, cuid, validation.data);

      if (!result) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      this.logger.info(`Vendor info updated for profile ${profileId}, client ${cuid}`);

      return {
        success: true,
        data: result,
        message: t('profile.success.vendorInfoUpdated'),
      };
    } catch (error) {
      this.logger.error(`Error updating vendor info for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Get role-specific information for a profile and client
   */
  async getRoleSpecificInfo(
    profileId: string,
    cuid: string,
    requestingUserRole: IUserRoleType
  ): Promise<ISuccessReturnData<{ employeeInfo?: EmployeeInfo; vendorInfo?: VendorInfo }>> {
    try {
      const result = await this.profileDAO.getRoleSpecificInfo(profileId, cuid);

      if (!result) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      // Filter based on requesting user's role
      const filteredResult: any = {};

      // Staff, admin, manager can see employee info
      if (result.employeeInfo && ['manager', 'staff', 'admin'].includes(requestingUserRole)) {
        filteredResult.employeeInfo = result.employeeInfo;
      }

      // Vendors can see vendor info
      if (result.vendorInfo && requestingUserRole === 'vendor') {
        filteredResult.vendorInfo = result.vendorInfo;
      }

      return {
        success: true,
        data: filteredResult,
        message: t('profile.success.roleInfoRetrieved'),
      };
    } catch (error) {
      this.logger.error(`Error getting role-specific info for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Clear role-specific information when user role changes
   */
  async clearRoleSpecificInfo(
    profileId: string,
    cuid: string,
    roleType: 'employee' | 'vendor',
    requestingUserRole: IUserRoleType
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      // Check permissions
      if (!['manager', 'admin'].includes(requestingUserRole)) {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      const result = await this.profileDAO.clearRoleSpecificInfo(profileId, cuid, roleType);

      if (!result) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      this.logger.info(`Cleared ${roleType} info for profile ${profileId}, client ${cuid}`);

      return {
        success: true,
        data: result,
        message: t('profile.success.roleInfoCleared'),
      };
    } catch (error) {
      this.logger.error(`Error clearing ${roleType} info for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Initialize role-specific information for new users during invitation acceptance
   */
  async initializeRoleInfo(
    profileId: string,
    cuid: string,
    role: IUserRoleType
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      // Ensure client role info exists
      await this.profileDAO.ensureClientRoleInfo(profileId, cuid);

      let result: IProfileDocument | null = null;

      // Initialize role-specific structure based on invitation role
      if (role === 'vendor') {
        // Initialize empty vendor structure
        result = await this.profileDAO.updateVendorInfo(profileId, cuid, {});
        this.logger.info(`Initialized vendor info for profile ${profileId}, client ${cuid}`);
      } else if (['manager', 'staff', 'admin'].includes(role)) {
        // Initialize empty employee structure
        result = await this.profileDAO.updateEmployeeInfo(profileId, cuid, {});
        this.logger.info(`Initialized employee info for profile ${profileId}, client ${cuid}`);
      }

      if (!result) {
        // If no role-specific initialization is needed, just ensure the client entry exists
        const profile = await this.profileDAO.findById(profileId);
        if (!profile) {
          throw new NotFoundError({
            message: t('profile.errors.notFound'),
          });
        }
        result = profile;
      }

      return {
        success: true,
        data: result,
        message: t('profile.success.roleInitialized'),
      };
    } catch (error) {
      this.logger.error(`Error initializing role info for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Update profile with role-specific information
   */
  async updateProfileWithRoleInfo(
    profileId: string,
    cuid: string,
    profileData: { employeeInfo?: any; vendorInfo?: any },
    userRole: IUserRoleType
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      // Validate the combined data
      const validation = ProfileValidations.profileUpdate.safeParse(profileData);
      if (!validation.success) {
        throw new BadRequestError({
          message: `Validation failed: ${validation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }

      let result: IProfileDocument | null = null;

      // Update employee info if provided
      if (profileData.employeeInfo) {
        const employeeResult = await this.updateEmployeeInfo(
          profileId,
          cuid,
          profileData.employeeInfo,
          userRole
        );
        result = employeeResult.data;
      }

      // Update vendor info if provided
      if (profileData.vendorInfo) {
        const vendorResult = await this.updateVendorInfo(
          profileId,
          cuid,
          profileData.vendorInfo,
          userRole
        );
        result = vendorResult.data;
      }

      if (!result) {
        throw new BadRequestError({
          message: 'No valid role-specific information provided',
        });
      }

      return {
        success: true,
        data: result,
        message: t('profile.success.profileUpdated'),
      };
    } catch (error) {
      this.logger.error(`Error updating profile with role info ${profileId}:`, error);
      throw error;
    }
  }
}
