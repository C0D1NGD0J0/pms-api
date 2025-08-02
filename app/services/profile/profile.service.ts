import Logger from 'bunyan';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { ProfileDAO, UserDAO } from '@dao/index';
import { IUserRoleType } from '@interfaces/user.interface';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { ProfileValidations } from '@shared/validations/ProfileValidation';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';

interface IConstructor {
  profileDAO: ProfileDAO;
  userDAO: UserDAO;
}

export class ProfileService {
  private readonly profileDAO: ProfileDAO;
  private readonly userDAO: UserDAO;
  private readonly logger: Logger;

  constructor({ profileDAO, userDAO }: IConstructor) {
    this.profileDAO = profileDAO;
    this.userDAO = userDAO;
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
      const validation = ProfileValidations.updateEmployeeInfo.safeParse(employeeInfo);
      if (!validation.success) {
        throw new BadRequestError({
          message: `Validation failed: ${validation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }

      if (!['manager', 'staff', 'admin'].includes(userRole)) {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      await this.ensureClientRoleInfo(profileId, cuid);

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
      const validation = ProfileValidations.updateVendorInfo.safeParse(vendorInfo);
      if (!validation.success) {
        throw new BadRequestError({
          message: `Validation failed: ${validation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }

      if (userRole !== 'vendor') {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      await this.ensureClientRoleInfo(profileId, cuid);

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
   * Update common employee information that applies across all clients
   */
  async updateCommonEmployeeInfo(
    profileId: string,
    employeeInfo: any,
    userRole: IUserRoleType
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      const validation = ProfileValidations.updateEmployeeInfo.safeParse(employeeInfo);
      if (!validation.success) {
        throw new BadRequestError({
          message: `Validation failed: ${validation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }

      if (!['manager', 'staff', 'admin'].includes(userRole)) {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      const result = await this.profileDAO.updateCommonEmployeeInfo(profileId, validation.data);

      if (!result) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      this.logger.info(`Common employee info updated for profile ${profileId}`);

      return {
        success: true,
        data: result,
        message: t('profile.success.commonEmployeeInfoUpdated'),
      };
    } catch (error) {
      this.logger.error(`Error updating common employee info for profile ${profileId}:`, error);
      throw error;
    }
  }

  /**
   * Update common vendor information that applies across all clients
   */
  async updateCommonVendorInfo(
    profileId: string,
    vendorInfo: any,
    userRole: IUserRoleType
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      const validation = ProfileValidations.updateVendorInfo.safeParse(vendorInfo);
      if (!validation.success) {
        throw new BadRequestError({
          message: `Validation failed: ${validation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }

      if (userRole !== 'vendor') {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      const result = await this.profileDAO.updateCommonVendorInfo(profileId, validation.data);

      if (!result) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      this.logger.info(`Common vendor info updated for profile ${profileId}`);

      return {
        success: true,
        data: result,
        message: t('profile.success.commonVendorInfoUpdated'),
      };
    } catch (error) {
      this.logger.error(`Error updating common vendor info for profile ${profileId}:`, error);
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
  ): Promise<
    ISuccessReturnData<{
      role?: string;
      linkedVendorId?: string;
      isConnected?: boolean;
      isPrimaryVendor?: boolean;
      vendorInfo?: any;
      employeeInfo?: any;
    }>
  > {
    try {
      const result = await this.getClientRoleInfo(profileId, cuid);

      if (!result) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      const filteredResult: any = {
        role: result.role,
        isConnected: result.isConnected,
        isPrimaryVendor: result.isPrimaryVendor,
      };

      if (result.linkedVendorId) {
        filteredResult.linkedVendorId = result.linkedVendorId;
      }

      // Include relevant info based on role and permissions
      if (result.vendorInfo && requestingUserRole === 'vendor') {
        filteredResult.vendorInfo = result.vendorInfo;
      }

      if (result.employeeInfo && ['manager', 'staff', 'admin'].includes(requestingUserRole)) {
        filteredResult.employeeInfo = result.employeeInfo;
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
   * Helper method to ensure a client role exists for a user
   * Now implemented using UserDAO directly
   */
  private async ensureClientRoleInfo(
    profileId: string,
    cuid: string,
    role?: string
  ): Promise<void> {
    try {
      // Get the profile's user ID
      const userId = await this.profileDAO.getProfileUserId(profileId);
      if (!userId) {
        throw new Error('Profile not found');
      }

      // Get the user
      const user = await this.userDAO.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if the client connection already exists
      const hasClientConnection = user.cuids.some((c) => c.cuid === cuid);

      if (!hasClientConnection) {
        // Add the client connection to the user's cuids array
        await this.userDAO.updateById(userId, {
          $push: {
            cuids: {
              cuid,
              roles: [role || ('vendor' as IUserRoleType)], // Default to vendor if role not provided
              isConnected: true,
              displayName: user.email.split('@')[0], // Simple default display name
            },
          },
        });
      }
    } catch (error) {
      this.logger.error(`Error ensuring client role info: ${error.message}`);
      throw error;
    }
  }

  /**
   * Helper method to get role-specific information for a profile and client
   * Now implemented using both ProfileDAO and UserDAO
   */
  private async getClientRoleInfo(
    profileId: string,
    cuid: string
  ): Promise<{
    role?: string;
    linkedVendorId?: string;
    isConnected?: boolean;
    isPrimaryVendor?: boolean;
    vendorInfo?: any;
    employeeInfo?: any;
  } | null> {
    try {
      // Get the profile info
      const profileInfo = await this.profileDAO.getProfileInfo(profileId);
      if (!profileInfo) {
        return null;
      }

      // Get the user if userId exists
      const userId = profileInfo.userId;
      if (!userId) {
        return null;
      }

      const user = await this.userDAO.getUserById(userId);
      if (!user) {
        return null;
      }

      // Find the client connection in user's cuids array
      const clientConnection = user.cuids.find((c) => c.cuid === cuid);
      if (!clientConnection) {
        return null;
      }

      const result: any = {
        role: clientConnection.roles[0], // Taking first role as primary
        isConnected: clientConnection.isConnected,
      };

      if (clientConnection.linkedVendorId) {
        result.linkedVendorId = clientConnection.linkedVendorId;
        result.isPrimaryVendor = false;
      } else if (clientConnection.roles.includes('vendor' as IUserRoleType)) {
        // If this is a vendor without linkedVendorId, it's a primary vendor
        result.isPrimaryVendor = true;
      }

      // Include relevant info based on role
      if (clientConnection.roles.includes('vendor' as IUserRoleType) && profileInfo.vendorInfo) {
        result.vendorInfo = profileInfo.vendorInfo;
      }

      if (
        ['manager', 'admin', 'staff'].some((role) =>
          clientConnection.roles.includes(role as IUserRoleType)
        ) &&
        profileInfo.employeeInfo
      ) {
        result.employeeInfo = profileInfo.employeeInfo;
      }

      return result;
    } catch (error) {
      this.logger.error(`Error getting role-specific info: ${error.message}`);
      throw error;
    }
  }

  /**
   * Initialize role-specific information for new users during invitation acceptance
   */
  async initializeRoleInfo(
    profileId: string,
    cuid: string,
    role: IUserRoleType,
    isConnected: boolean = true,
    linkedVendorId?: string
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      // Ensure the client role info exists only once
      await this.ensureClientRoleInfo(profileId, cuid, role);

      // Get the profile's user ID
      const userId = await this.profileDAO.getProfileUserId(profileId);
      if (!userId) {
        throw new Error('Profile not found');
      }

      // If there's a linkedVendorId, set it in the user's cuids array
      if (linkedVendorId && role === 'vendor') {
        await this.userDAO.updateById(
          userId,
          {
            $set: {
              'cuids.$[elem].linkedVendorId': linkedVendorId,
              'cuids.$[elem].isConnected': isConnected,
            },
          },
          {
            arrayFilters: [{ 'elem.cuid': cuid }],
          }
        );
        this.logger.info(
          `Initialized linked vendor info for profile ${profileId}, client ${cuid}, linked to ${linkedVendorId}`
        );
      }

      let result: IProfileDocument | null = null;

      if (role === 'vendor') {
        // For primary vendors, initialize the common vendor info
        result = await this.profileDAO.updateCommonVendorInfo(profileId, {});
        this.logger.info(`Initialized vendor info for profile ${profileId}`);
      } else if (['manager', 'staff', 'admin'].includes(role)) {
        // For employees, initialize the common employee info
        result = await this.profileDAO.updateCommonEmployeeInfo(profileId, {});
        this.logger.info(`Initialized employee info for profile ${profileId}`);
      } else {
        const profile = await this.profileDAO.findById(profileId);
        if (!profile) {
          throw new NotFoundError({
            message: t('profile.errors.notFound'),
          });
        }
        result = profile;
      }

      if (!result) {
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
    profileData: {
      employeeInfo?: any;
      vendorInfo?: any;
      commonEmployeeInfo?: any;
      commonVendorInfo?: any;
    },
    userRole: IUserRoleType
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      const validation = ProfileValidations.profileUpdate.safeParse(profileData);
      if (!validation.success) {
        throw new BadRequestError({
          message: `Validation failed: ${validation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }

      let result: IProfileDocument | null = null;

      if (profileData.employeeInfo) {
        const employeeResult = await this.updateEmployeeInfo(
          profileId,
          cuid,
          profileData.employeeInfo,
          userRole
        );
        result = employeeResult.data;
      }

      if (profileData.vendorInfo) {
        const vendorResult = await this.updateVendorInfo(
          profileId,
          cuid,
          profileData.vendorInfo,
          userRole
        );
        result = vendorResult.data;
      }

      if (profileData.commonEmployeeInfo) {
        const commonEmployeeResult = await this.updateCommonEmployeeInfo(
          profileId,
          profileData.commonEmployeeInfo,
          userRole
        );
        result = commonEmployeeResult.data;
      }

      if (profileData.commonVendorInfo) {
        const commonVendorResult = await this.updateCommonVendorInfo(
          profileId,
          profileData.commonVendorInfo,
          userRole
        );
        result = commonVendorResult.data;
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
