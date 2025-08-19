import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { IUserRoleType } from '@interfaces/user.interface';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { ProfileValidations } from '@shared/validations/ProfileValidation';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';

interface IConstructor {
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class ProfileService {
  private readonly profileDAO: ProfileDAO;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private readonly logger: Logger;

  constructor({ profileDAO, clientDAO, userDAO }: IConstructor) {
    this.profileDAO = profileDAO;
    this.clientDAO = clientDAO;
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
    userId: string,
    cuid: string,
    role?: string,
    linkedVendorId?: string
  ): Promise<void> {
    try {
      if (!userId || !cuid) {
        throw new BadRequestError({
          message: 'Profile not found',
        });
      }

      const [clientInfo, userInfo] = await Promise.all([
        this.clientDAO.getClientByCuid(cuid),
        this.userDAO.getUserById(userId),
      ]);

      if (!userInfo || !clientInfo) {
        throw new NotFoundError({
          message: t('user.errors.notFound'),
        });
      }

      const hasClientConnection = userInfo.cuids.some((c) => c.cuid === cuid);

      if (!hasClientConnection) {
        await this.userDAO.updateById(userId, {
          $push: {
            cuids: {
              cuid,
              roles: [role || ('vendor' as IUserRoleType)],
              isConnected: true,
              displayName: clientInfo.displayName,
              linkedVendorId: role === 'vendor' ? linkedVendorId : null,
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
    userId: string,
    cuid: string,
    role: IUserRoleType,
    linkedVendorId?: string,
    metadata?: {
      employeeInfo?: any;
      vendorInfo?: any;
    }
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    await this.ensureClientRoleInfo(userId, cuid, role, linkedVendorId);
    const profile = await this.profileDAO.findFirst({ user: new Types.ObjectId(userId) });
    if (!profile) {
      throw new NotFoundError({
        message: t('profile.errors.notFound'),
      });
    }

    let result: IProfileDocument | null = null;

    if (role === 'vendor' && !linkedVendorId) {
      // For primary vendors, initialize the common vendor info with metadata if provided
      const vendorData = metadata?.vendorInfo || {};
      result = await this.profileDAO.updateCommonVendorInfo(profile.id, vendorData);
      this.logger.info(`Initialized vendor info for profile ${profile.id} with metadata`);
    } else if (['manager', 'staff', 'admin'].includes(role)) {
      // For employees, initialize the common employee info with metadata if provided
      const employeeData = metadata?.employeeInfo || {};
      result = await this.profileDAO.updateCommonEmployeeInfo(profile.id, employeeData);
      this.logger.info(`Initialized employee info for profile ${profile.id} with metadata`);
    } else {
      result = profile;
    }
    if (!result) {
      throw new NotFoundError({
        message: 'Error initializing user role.',
      });
    }
    return {
      success: true,
      data: result,
      message: t('profile.success.roleInitialized'),
    };
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
