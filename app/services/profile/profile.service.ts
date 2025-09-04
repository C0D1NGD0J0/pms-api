import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { VendorService } from '@services/index';
import { UserService } from '@services/user/user.service';
import { IUserRoleType } from '@interfaces/user.interface';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { ProfileValidations } from '@shared/validations/ProfileValidation';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';

interface IConstructor {
  vendorService: VendorService;
  userService: UserService;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class ProfileService {
  private readonly profileDAO: ProfileDAO;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private readonly vendorService: VendorService;
  private readonly userService: UserService;
  private readonly logger: Logger;

  constructor({ profileDAO, clientDAO, userDAO, vendorService, userService }: IConstructor) {
    this.profileDAO = profileDAO;
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.vendorService = vendorService;
    this.userService = userService;
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

      const profile = await this.profileDAO.findFirst({ id: profileId });
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
      const profile = await this.profileDAO.findFirst({ id: profileId });
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
      linkedVendorUid?: string;
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

      if (result.linkedVendorUid) {
        filteredResult.linkedVendorUid = result.linkedVendorUid;
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
    linkedVendorUid?: string
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
              linkedVendorUid: role === 'vendor' ? linkedVendorUid : null,
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
    linkedVendorUid?: string;
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

      if (clientConnection.linkedVendorUid) {
        result.linkedVendorUid = clientConnection.linkedVendorUid;
        result.isPrimaryVendor = false;
      } else if (clientConnection.roles.includes('vendor' as IUserRoleType)) {
        // If this is a vendor without linkedVendorUid, it's a primary vendor
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
   * Validate inputs and prepare context for role initialization
   */
  private async validateAndPrepareContext(
    userId: string,
    cuid: string,
    role: IUserRoleType,
    linkedVendorUid?: string
  ): Promise<{ userId: string; cuid: string; role: IUserRoleType; linkedVendorUid?: string }> {
    await this.ensureClientRoleInfo(userId, cuid, role, linkedVendorUid);
    return { userId, cuid, role, linkedVendorUid };
  }

  /**
   * Fetch user profile with proper error handling
   */
  private async fetchUserProfile(context: { userId: string }): Promise<IProfileDocument> {
    const profile = await this.profileDAO.findFirst({ user: new Types.ObjectId(context.userId) });
    if (!profile) {
      throw new NotFoundError({
        message: t('profile.errors.notFound'),
      });
    }
    return profile;
  }

  /**
   * Handle vendor role initialization if needed
   */
  private async handleVendorRoleIfNeeded(
    context: { userId: string; cuid: string; role: IUserRoleType; linkedVendorUid?: string },
    profile: IProfileDocument,
    metadata?: {
      vendorEntityData?: any;
      isPrimaryVendor?: boolean;
      isVendorTeamMember?: boolean;
    }
  ): Promise<{ profile: IProfileDocument; createdVendor?: any }> {
    if (context.role !== 'vendor') {
      return { profile };
    }

    // Handle primary vendor creation
    if (metadata?.isPrimaryVendor && metadata?.vendorEntityData) {
      return await this.createPrimaryVendor(context, profile, metadata.vendorEntityData);
    }

    // Handle vendor team member linking
    if (metadata?.isVendorTeamMember) {
      return await this.linkVendorTeamMember(context, profile);
    }

    return { profile };
  }

  /**
   * Create primary vendor entity and update profile
   */
  private async createPrimaryVendor(
    context: { userId: string; cuid: string; linkedVendorUid?: string },
    profile: IProfileDocument,
    vendorEntityData: any
  ): Promise<{ profile: IProfileDocument; createdVendor?: any }> {
    try {
      const vendorData = {
        isPrimaryAccountHolder: true,
        connectedClients: [
          {
            cuid: context.cuid,
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(context.userId),
          },
        ],
        ...vendorEntityData,
      };

      const vendorResult = await this.vendorService.createVendor(
        vendorData,
        undefined,
        context.linkedVendorUid
      );
      const createdVendor = vendorResult.data;

      // Update profile with vendor reference
      if (createdVendor) {
        const updatedProfile = await this.profileDAO.updateVendorReference(profile.id, {
          vendorId: createdVendor._id.toString(),
          isLinkedAccount: false,
        });

        this.logger.info(`Created vendor entity ${createdVendor.vuid} for profile ${profile.id}`);
        return { profile: updatedProfile || profile, createdVendor };
      }

      return { profile, createdVendor };
    } catch (error) {
      this.logger.error(`Error creating vendor entity for profile ${profile.id}:`, error);
      // Continue with original profile if vendor creation fails
      return { profile };
    }
  }

  /**
   * Link vendor team member to existing vendor
   */
  private async linkVendorTeamMember(
    context: { linkedVendorUid?: string },
    profile: IProfileDocument
  ): Promise<{ profile: IProfileDocument }> {
    const updatedProfile = await this.profileDAO.updateVendorReference(profile.id, {
      linkedVendorUid: context.linkedVendorUid,
      isLinkedAccount: true,
    });

    this.logger.info(
      `Linked vendor team member profile ${profile.id} to vendor ${context.linkedVendorUid}`
    );

    return { profile: updatedProfile || profile };
  }

  /**
   * Handle employee role initialization if needed
   */
  private async handleEmployeeRoleIfNeeded(
    context: { role: IUserRoleType },
    profile: IProfileDocument,
    metadata?: { employeeInfo?: any }
  ): Promise<IProfileDocument> {
    const employeeRoles = ['manager', 'staff', 'admin'];

    if (!employeeRoles.includes(context.role)) {
      return profile;
    }

    const employeeData = metadata?.employeeInfo || {};
    const updatedProfile = await this.profileDAO.updateCommonEmployeeInfo(profile.id, employeeData);

    this.logger.info(`Initialized employee info for profile ${profile.id} with metadata`);

    return updatedProfile || profile;
  }

  /**
   * Build success response for role initialization
   */
  private buildSuccessResponse(
    profile: IProfileDocument,
    createdVendor?: any
  ): ISuccessReturnData<IProfileDocument> {
    if (!profile) {
      throw new NotFoundError({
        message: 'Error initializing user role.',
      });
    }

    return {
      success: true,
      data: profile,
      message: t('profile.success.roleInitialized'),
      ...(createdVendor && { vendorEntity: createdVendor }),
    };
  }

  /**
   * Initialize role-specific information for new users during invitation acceptance
   */
  async initializeRoleInfo(
    userId: string,
    cuid: string,
    role: IUserRoleType,
    linkedVendorUid?: string,
    metadata?: {
      employeeInfo?: any;
      vendorInfo?: any;
      vendorEntityData?: any;
      isPrimaryVendor?: boolean;
      isVendorTeamMember?: boolean;
    }
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    const context = await this.validateAndPrepareContext(userId, cuid, role, linkedVendorUid);
    const profile = await this.fetchUserProfile(context);
    const vendorResult = await this.handleVendorRoleIfNeeded(context, profile, metadata);
    const finalProfile = await this.handleEmployeeRoleIfNeeded(
      context,
      vendorResult.profile,
      metadata
    );

    return this.buildSuccessResponse(finalProfile, vendorResult.createdVendor);
  }

  /**
   * Get user profile data for editing/display
   */
  async getUserProfileForEdit(
    context: any,
    uid: string | undefined
  ): Promise<ISuccessReturnData<any>> {
    const currentUser = context.currentuser!;
    const cuid = context.request.params.cuid;
    const targetUid = uid || currentUser.uid;

    try {
      if (
        targetUid !== currentUser.uid &&
        !(
          currentUser.client.cuid === cuid && ['manager', 'admin'].includes(currentUser.client.role)
        )
      ) {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      const userDoc = await this.userService.getClientUserInfo(context, targetUid);
      if (!userDoc.success || !userDoc.data) {
        throw new NotFoundError({
          message: t('user.errors.notFound'),
        });
      }

      const profileDoc = await this.profileDAO.getProfileByUserId(userDoc.data.profile.id);
      if (!profileDoc) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      const profileData = {
        personalInfo: {
          ...profileDoc.personalInfo,
          uid: targetUid,
          email: userDoc.data.profile.email,
          isActive: true,
        },
        identification: profileDoc.identification,
        settings: {
          ...profileDoc.settings,
          timeZone: profileDoc.timeZone,
          lang: profileDoc.lang,
        },
        userType: userDoc.data.profile.userType,
        roles: userDoc.data.profile.roles,
      };

      return {
        success: true,
        data: profileData,
        message: t('profile.success.profileRetrieved'),
      };
    } catch (error) {
      this.logger.error(`Error getting user profile for edit (uid: ${targetUid}):`, error);
      throw error;
    }
  }

  async updateProfileWithRoleInfo(
    profileId: string,
    cuid: string,
    profileData: {
      userInfo?: any;
      personalInfo?: any;
      settings?: any;
      identification?: any;
      profileMeta?: any;
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
      let hasUpdates = false;
      let userId: string | null = null;

      // Get the profile to extract user ID for User model updates
      if (profileData.userInfo) {
        const profile = await this.profileDAO.findFirst({ id: profileId });
        if (!profile) {
          throw new NotFoundError({ message: t('profile.errors.notFound') });
        }
        userId = profile.user.toString();
      }

      // Handle User model updates
      if (profileData.userInfo && userId) {
        const userValidation = ProfileValidations.updateUserInfo.safeParse(profileData.userInfo);
        if (!userValidation.success) {
          throw new BadRequestError({
            message: `User info validation failed: ${userValidation.error.issues.map((i) => i.message).join(', ')}`,
          });
        }

        await this.userService.updateUserInfo(userId, userValidation.data);
        hasUpdates = true;
      }

      if (profileData.personalInfo) {
        const personalValidation = ProfileValidations.updatePersonalInfo.safeParse(
          profileData.personalInfo
        );
        if (!personalValidation.success) {
          throw new BadRequestError({
            message: `Personal info validation failed: ${personalValidation.error.issues.map((i) => i.message).join(', ')}`,
          });
        }

        // Use dot notation for nested updates to avoid overwriting entire object
        const updateFields: any = {};
        Object.keys(personalValidation.data).forEach((key) => {
          updateFields[`personalInfo.${key}`] = (personalValidation.data as any)[key];
        });

        result = await this.profileDAO.updateById(profileId, updateFields);
        hasUpdates = true;
      }

      if (profileData.settings) {
        const settingsValidation = ProfileValidations.updateSettings.safeParse(
          profileData.settings
        );
        if (!settingsValidation.success) {
          throw new BadRequestError({
            message: `Settings validation failed: ${settingsValidation.error.issues.map((i) => i.message).join(', ')}`,
          });
        }

        // Use dot notation for nested updates
        const updateFields: any = {};
        Object.keys(settingsValidation.data).forEach((key) => {
          const validatedData = settingsValidation.data as any;
          if (key === 'notifications' || key === 'gdprSettings') {
            // Handle nested objects
            Object.keys(validatedData[key]).forEach((subKey) => {
              updateFields[`settings.${key}.${subKey}`] = validatedData[key][subKey];
            });
          } else {
            updateFields[`settings.${key}`] = validatedData[key];
          }
        });

        result = await this.profileDAO.updateById(profileId, updateFields);
        hasUpdates = true;
      }

      // Handle Profile model updates - Identification
      if (profileData.identification) {
        const identificationValidation = ProfileValidations.updateIdentification.safeParse(
          profileData.identification
        );
        if (!identificationValidation.success) {
          throw new BadRequestError({
            message: `Identification validation failed: ${identificationValidation.error.issues.map((i) => i.message).join(', ')}`,
          });
        }

        const updateFields: any = {};
        Object.keys(identificationValidation.data).forEach((key) => {
          updateFields[`identification.${key}`] = (identificationValidation.data as any)[key];
        });

        result = await this.profileDAO.updateById(profileId, updateFields);
        hasUpdates = true;
      }

      // Handle Profile model updates - Meta information
      if (profileData.profileMeta) {
        const metaValidation = ProfileValidations.updateProfileMeta.safeParse(
          profileData.profileMeta
        );
        if (!metaValidation.success) {
          throw new BadRequestError({
            message: `Profile meta validation failed: ${metaValidation.error.issues.map((i) => i.message).join(', ')}`,
          });
        }

        result = await this.profileDAO.updateById(profileId, metaValidation.data);
        hasUpdates = true;
      }

      // Handle role-specific updates
      if (profileData.employeeInfo) {
        const employeeResult = await this.updateEmployeeInfo(
          profileId,
          cuid,
          profileData.employeeInfo,
          userRole
        );
        result = employeeResult.data;
        hasUpdates = true;
      }

      if (profileData.vendorInfo) {
        const vendorResult = await this.updateVendorInfo(
          profileId,
          cuid,
          profileData.vendorInfo,
          userRole
        );
        result = vendorResult.data;
        hasUpdates = true;
      }

      if (profileData.commonEmployeeInfo) {
        const commonEmployeeResult = await this.updateCommonEmployeeInfo(
          profileId,
          profileData.commonEmployeeInfo,
          userRole
        );
        result = commonEmployeeResult.data;
        hasUpdates = true;
      }

      if (profileData.commonVendorInfo) {
        const commonVendorResult = await this.updateCommonVendorInfo(
          profileId,
          profileData.commonVendorInfo,
          userRole
        );
        result = commonVendorResult.data;
        hasUpdates = true;
      }

      if (!hasUpdates) {
        throw new BadRequestError({
          message: 'No valid information provided for update',
        });
      }

      // if no role-specific update was performed, get the updated profile
      if (!result) {
        result = await this.profileDAO.findFirst({ id: profileId });
      }

      return {
        success: true,
        data: result!,
        message: t('profile.success.profileUpdated'),
      };
    } catch (error) {
      this.logger.error(`Error updating profile with role info ${profileId}:`, error);
      throw error;
    }
  }
}
