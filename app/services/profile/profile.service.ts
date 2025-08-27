import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { VendorService } from '@services/index';
import { IUserRoleType } from '@interfaces/user.interface';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { ProfileValidations } from '@shared/validations/ProfileValidation';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';

interface IConstructor {
  vendorService: VendorService;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class ProfileService {
  private readonly profileDAO: ProfileDAO;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private readonly vendorService: VendorService;
  private readonly logger: Logger;

  constructor({ profileDAO, clientDAO, userDAO, vendorService }: IConstructor) {
    this.profileDAO = profileDAO;
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.vendorService = vendorService;
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
      if (userRole !== 'vendor') {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      // Get the profile to find the associated user
      const profile = await this.profileDAO.getProfileById(profileId);
      if (!profile) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      // Get the vendor entity for this user
      const vendor = await this.vendorService.getVendorByUserId(profile.user.toString());
      if (!vendor) {
        throw new NotFoundError({
          message: 'Vendor entity not found',
        });
      }

      // Update the vendor entity with new information
      await this.vendorService.updateVendorInfo(vendor._id.toString(), vendorInfo);

      // Update profile vendorInfo to maintain reference (if needed)
      await this.ensureClientRoleInfo(profileId, cuid);

      this.logger.info(`Vendor info updated for profile ${profileId}, client ${cuid}`);

      return {
        success: true,
        data: profile,
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
      if (userRole !== 'vendor') {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      // Get the profile to find the associated user
      const profile = await this.profileDAO.getProfileById(profileId);
      if (!profile) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      // Get the vendor entity for this user
      const vendor = await this.vendorService.getVendorByUserId(profile.user.toString());
      if (!vendor) {
        throw new NotFoundError({
          message: 'Vendor entity not found',
        });
      }

      // Update the vendor entity with new common information
      await this.vendorService.updateVendorInfo(vendor._id.toString(), vendorInfo);

      this.logger.info(`Common vendor info updated for profile ${profileId}`);

      return {
        success: true,
        data: profile,
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
      vendorEntityData?: any;
      isPrimaryVendor?: boolean;
      isVendorTeamMember?: boolean;
    }
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    await this.ensureClientRoleInfo(userId, cuid, role, linkedVendorId);
    const profile = await this.profileDAO.findFirst({ user: new Types.ObjectId(userId) });
    if (!profile) {
      throw new NotFoundError({
        message: t('profile.errors.notFound'),
      });
    }

    let result: IProfileDocument | null = profile;
    let createdVendor: any = null;

    if (role === 'vendor' && metadata?.isPrimaryVendor && metadata?.vendorEntityData) {
      // For primary vendors, create vendor entity first
      try {
        const vendorResult = await this.vendorService.createVendor({
          primaryAccountHolder: userId,
          ...metadata.vendorEntityData,
        });
        createdVendor = vendorResult.data;

        // Update profile with vendor reference
        if (createdVendor) {
          result = await this.profileDAO.updateVendorReference(profile.id, {
            vendorId: createdVendor._id.toString(),
            isLinkedAccount: false,
          });
        }

        this.logger.info(`Created vendor entity ${createdVendor?.vuid} for profile ${profile.id}`);
      } catch (error) {
        this.logger.error(`Error creating vendor entity for profile ${profile.id}:`, error);
        // Continue with profile creation even if vendor entity fails
        result = profile;
      }
    } else if (role === 'vendor' && metadata?.isVendorTeamMember) {
      // For vendor team members, update profile with linkedVendorId reference
      result = await this.profileDAO.updateVendorReference(profile.id, {
        linkedVendorId: linkedVendorId,
        isLinkedAccount: true,
      });
      this.logger.info(
        `Linked vendor team member profile ${profile.id} to vendor ${linkedVendorId}`
      );
    } else if (['manager', 'staff', 'admin'].includes(role)) {
      // For employees, initialize the common employee info with metadata if provided
      const employeeData = metadata?.employeeInfo || {};
      result = await this.profileDAO.updateCommonEmployeeInfo(profile.id, employeeData);
      this.logger.info(`Initialized employee info for profile ${profile.id} with metadata`);
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
      ...(createdVendor && { vendorEntity: createdVendor }),
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
