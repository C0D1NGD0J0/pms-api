import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { buildDotNotation, createLogger } from '@utils/index';
import { IUserRoleType } from '@shared/constants/roles.constants';
import { ROLE_GROUPS, ROLES } from '@shared/constants/roles.constants';
import { ProfileValidations } from '@shared/validations/ProfileValidation';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import { EventEmitterService, VendorService, UserService } from '@services/index';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  IProfileUpdateData,
  ISuccessReturnData,
  IProfileDocument,
  IProfileEditData,
  IRequestContext,
  ICurrentUser,
  EventTypes,
} from '@interfaces/index';

interface IConstructor {
  mediaUploadService: MediaUploadService;
  emitterService: EventEmitterService;
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
  private readonly emitterService: EventEmitterService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly logger: Logger;

  constructor({
    profileDAO,
    clientDAO,
    userDAO,
    vendorService,
    userService,
    emitterService,
    mediaUploadService,
  }: IConstructor) {
    this.profileDAO = profileDAO;
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.vendorService = vendorService;
    this.userService = userService;
    this.emitterService = emitterService;
    this.mediaUploadService = mediaUploadService;
    this.logger = createLogger('ProfileService');
    this.setupEventListeners();
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

      if (!ROLE_GROUPS.EMPLOYEE_ROLES.includes(userRole as any)) {
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
      if (userRole !== ROLES.VENDOR) {
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

      // Get the updated profile to return current data
      const updatedProfile = await this.profileDAO.findFirst({ id: profileId });
      if (!updatedProfile) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      this.logger.info(`Vendor info updated for profile ${profileId}, client ${cuid}`);

      return {
        success: true,
        data: updatedProfile,
        message: t('profile.success.vendorInfoUpdated'),
      };
    } catch (error) {
      this.logger.error(`Error updating vendor info for profile ${profileId}:`, error);
      throw error;
    }
  }

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
              roles: [role || (ROLES.VENDOR as IUserRoleType)],
              isConnected: true,
              displayName: clientInfo.displayName,
              linkedVendorUid: role === ROLES.VENDOR ? linkedVendorUid : null,
            },
          },
        });
      }
    } catch (error) {
      this.logger.error(`Error ensuring client role info: ${error.message}`);
      throw error;
    }
  }

  private async validateAndPrepareContext(
    userId: string,
    cuid: string,
    role: IUserRoleType,
    linkedVendorUid?: string
  ): Promise<{ userId: string; cuid: string; role: IUserRoleType; linkedVendorUid?: string }> {
    await this.ensureClientRoleInfo(userId, cuid, role, linkedVendorUid);
    return { userId, cuid, role, linkedVendorUid };
  }

  private async fetchUserProfile(context: { userId: string }): Promise<IProfileDocument> {
    const profile = await this.profileDAO.findFirst({ user: new Types.ObjectId(context.userId) });
    if (!profile) {
      throw new NotFoundError({
        message: t('profile.errors.notFound'),
      });
    }
    return profile;
  }

  private async handleVendorRoleIfNeeded(
    context: { userId: string; cuid: string; role: IUserRoleType; linkedVendorUid?: string },
    profile: IProfileDocument,
    metadata?: {
      vendorEntityData?: any;
      isPrimaryVendor?: boolean;
      isVendorTeamMember?: boolean;
    }
  ): Promise<{ profile: IProfileDocument; createdVendor?: any }> {
    if (context.role !== ROLES.VENDOR) {
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

  private async handleEmployeeRoleIfNeeded(
    context: { role: IUserRoleType; cuid: string },
    profile: IProfileDocument,
    metadata?: { employeeInfo?: any }
  ): Promise<IProfileDocument> {
    const employeeRoles = ROLE_GROUPS.EMPLOYEE_ROLES;

    if (!employeeRoles.includes(context.role as any)) {
      return profile;
    }

    const employeeData = metadata?.employeeInfo || {};
    const updatedProfile = await this.profileDAO.updateEmployeeInfo(
      profile.id,
      context.cuid,
      employeeData
    );

    this.logger.info(`Initialized employee info for profile ${profile.id} with metadata`);

    return updatedProfile || profile;
  }

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

  async getUserProfileForEdit(
    context: IRequestContext,
    uid: string | undefined
  ): Promise<ISuccessReturnData<IProfileEditData>> {
    const currentUser = context.currentuser!;
    const cuid = context.request.params.cuid;
    const targetUid = uid || currentUser.uid;

    try {
      if (
        targetUid !== currentUser.uid &&
        !(
          currentUser.client.cuid === cuid &&
          ROLE_GROUPS.MANAGEMENT_ROLES.includes(currentUser.client.role as any)
        )
      ) {
        throw new ForbiddenError({
          message: t('auth.errors.insufficientPermissions'),
        });
      }

      const userDoc = await this.userService.getClientUserInfo(cuid, targetUid, currentUser);
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

      const profileData: IProfileEditData = {
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
        userType: userDoc.data.profile.userType as
          | 'employee'
          | 'vendor'
          | 'tenant'
          | 'primary_account_holder',
        roles: userDoc.data.profile.roles as IUserRoleType[],
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

  private async validateAndGetProfileContext(
    cuid: string,
    uid: string,
    currentuser: ICurrentUser
  ): Promise<{
    profileId: string;
    userRole: IUserRoleType;
    userId: string;
  }> {
    if (
      currentuser.uid !== uid &&
      !(
        currentuser.client.cuid === cuid &&
        ROLE_GROUPS.MANAGEMENT_ROLES.includes(currentuser.client.role as any)
      )
    ) {
      throw new ForbiddenError({
        message: t('auth.errors.insufficientPermissions'),
      });
    }

    const userData = await this.userService.getClientUserInfo(cuid, uid, currentuser);
    if (!userData.success || !userData.data) {
      throw new NotFoundError({
        message: t('user.errors.notFound'),
      });
    }

    const userDoc = await this.userDAO.findFirst({ uid });
    const profileDoc = await this.profileDAO.getProfileByUserId(userDoc?._id.toString() || '');
    if (!profileDoc) {
      throw new NotFoundError({
        message: t('profile.errors.notFound'),
      });
    }

    return {
      profileId: profileDoc._id.toString(),
      userRole: userData.data.profile.roles?.[0] as IUserRoleType,
      userId: profileDoc.user.toString(),
    };
  }

  /**
   * Process and validate profile data updates
   */
  private async processProfileUpdates(
    profileData: IProfileUpdateData,
    profileId: string,
    userId: string,
    cuid: string,
    userRole: IUserRoleType
  ): Promise<{ result: IProfileDocument | null; hasUpdates: boolean }> {
    const validation = ProfileValidations.profileUpdate.safeParse(profileData);
    if (!validation.success) {
      throw new BadRequestError({
        message: `Validation failed: ${validation.error.issues.map((i) => i.message).join(', ')}`,
      });
    }

    let hasUpdates = false;
    const validatedData: any = {};

    // Handle User model updates (separate collection, needs its own call)
    if (profileData.userInfo) {
      const userValidation = ProfileValidations.updateUserInfo.safeParse(profileData.userInfo);
      if (!userValidation.success) {
        throw new BadRequestError({
          message: `User info validation failed: ${userValidation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }

      await this.userService.updateUserInfo(userId, userValidation.data);
      hasUpdates = true;
    }

    // Validate and collect all profile updates
    if (profileData.personalInfo) {
      const personalValidation = ProfileValidations.updatePersonalInfo.safeParse(
        profileData.personalInfo
      );
      if (!personalValidation.success) {
        throw new BadRequestError({
          message: `Personal info validation failed: ${personalValidation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }
      validatedData.personalInfo = personalValidation.data;
      hasUpdates = true;
    }

    if (profileData.settings) {
      const settingsValidation = ProfileValidations.updateSettings.safeParse(profileData.settings);
      if (!settingsValidation.success) {
        throw new BadRequestError({
          message: `Settings validation failed: ${settingsValidation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }
      validatedData.settings = settingsValidation.data;
      hasUpdates = true;
    }

    if (profileData.identification) {
      const identificationValidation = ProfileValidations.updateIdentification.safeParse(
        profileData.identification
      );
      if (!identificationValidation.success) {
        throw new BadRequestError({
          message: `Identification validation failed: ${identificationValidation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }
      validatedData.identification = identificationValidation.data;
      hasUpdates = true;
    }

    if (profileData.profileMeta) {
      const metaValidation = ProfileValidations.updateProfileMeta.safeParse(
        profileData.profileMeta
      );
      if (!metaValidation.success) {
        throw new BadRequestError({
          message: `Profile meta validation failed: ${metaValidation.error.issues.map((i) => i.message).join(', ')}`,
        });
      }
      validatedData.profileMeta = metaValidation.data;
      hasUpdates = true;
    }

    let result: IProfileDocument | null = null;
    if (Object.keys(validatedData).length > 0) {
      const dotNotationData = buildDotNotation(validatedData);
      result = await this.profileDAO.updateById(profileId, { $set: dotNotationData });
    }

    // Handle role-specific updates (these go to different services/collections)
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

    // Get the final updated profile if we made updates but don't have the result yet
    if (hasUpdates && !result) {
      result = await this.profileDAO.findFirst({ id: profileId });
    }

    return { result, hasUpdates };
  }

  async updateUserProfile(
    context: IRequestContext,
    profileData: IProfileUpdateData
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    const { uid } = context.request.query;
    const { cuid } = context.request.params;
    const targetUid = uid ?? context.currentuser!.uid;
    try {
      const { profileId, userRole, userId } = await this.validateAndGetProfileContext(
        cuid,
        targetUid,
        context.currentuser!
      );

      const { result } = await this.processProfileUpdates(
        profileData,
        profileId,
        userId,
        cuid,
        userRole
      );

      const finalProfile = result || (await this.profileDAO.findFirst({ id: profileId }));

      if (!finalProfile) {
        throw new NotFoundError({
          message: t('profile.errors.notFound'),
        });
      }

      return {
        success: true,
        data: finalProfile,
        message: t('profile.success.profileUpdated'),
      };
    } catch (error) {
      this.logger.error(`Error updating user profile for uid ${uid}:`, error);
      throw error;
    }
  }

  /**
   * Update user avatar information from upload results
   */
  async updateAvatarInfo(
    userUid: string,
    uploadResults: Array<{ url: string; filename: string; publicuid: string }>
  ): Promise<ISuccessReturnData<IProfileDocument>> {
    try {
      if (!uploadResults || uploadResults.length === 0) {
        throw new BadRequestError({
          message: 'No upload results provided for avatar update',
        });
      }

      const avatarResult = uploadResults[0];
      const userToUpdate = await this.userDAO.findFirst({ uid: userUid }, { populate: 'profile' });
      if (!userToUpdate || !userToUpdate.profile) {
        throw new NotFoundError({
          message: t('user.errors.notFound'),
        });
      }

      // Get current avatar to handle deletion of old one
      const currentProfile = await this.profileDAO.findFirst({
        id: userToUpdate.profile._id?.toString(),
      });
      const currentAvatar = currentProfile?.personalInfo?.avatar;

      // Handle deletion of old avatar if exists
      if (currentAvatar?.key) {
        const newAvatar = {
          key: avatarResult.publicuid,
        };

        await this.mediaUploadService.handleAvatarDeletion(currentAvatar, newAvatar);
      }

      const avatarUpdateData = {
        'personalInfo.avatar.url': avatarResult.url,
        'personalInfo.avatar.filename': avatarResult.filename,
        'personalInfo.avatar.key': avatarResult.publicuid,
      };

      const updatedProfile = await this.profileDAO.updateById(
        userToUpdate.profile._id?.toString(),
        {
          $set: avatarUpdateData,
        }
      );

      if (!updatedProfile) {
        throw new NotFoundError({
          message: 'Failed to update profile avatar',
        });
      }

      this.logger.info(`Avatar updated for user ${userUid} - new avatar: ${avatarResult.filename}`);

      return {
        success: true,
        data: updatedProfile,
        message: 'Avatar updated successfully',
      };
    } catch (error) {
      this.logger.error(`Error updating avatar for user ${userUid}:`, error);
      throw error;
    }
  }

  /**
   * Setup event listeners for profile-related events
   */
  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted.bind(this));
    this.logger.info('Profile service event listeners initialized');
  }

  /**
   * Handle upload completion events - only process avatar uploads
   */
  private async handleUploadCompleted(data: any): Promise<void> {
    try {
      // Only handle avatar uploads (profile-specific uploads)
      if (
        data.resourceName === 'profile' &&
        data.fieldName === 'avatar' &&
        data.results?.length > 0
      ) {
        await this.updateAvatarInfo(data.resourceId, data.results);
        this.logger.info(`Avatar updated for user ${data.resourceId}`);
      }
      // Ignore other upload types - they're handled by other services
    } catch (error) {
      this.logger.error('Error handling upload completion in ProfileService:', error);
    }
  }

  /**
   * Get user notification preferences by user ID
   * Returns default preferences if user profile doesn't exist
   */
  async getUserNotificationPreferences(
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData<IProfileDocument['settings']['notifications']>> {
    try {
      this.logger.info(`Getting notification preferences for user ${userId} in client ${cuid}`);

      const preferences = await this.profileDAO.getNotificationPreferences(userId);

      if (!preferences) {
        this.logger.warn(
          `No notification preferences found for user ${userId}, returning defaults`
        );
        const defaultPreferences: IProfileDocument['settings']['notifications'] = {
          messages: false,
          comments: false,
          announcements: true,
          maintenance: true,
          payments: true,
          system: true,
          propertyUpdates: true,
          emailNotifications: true,
          inAppNotifications: true,
          emailFrequency: 'immediate' as const,
        };

        return {
          success: true,
          message: 'Default notification preferences retrieved',
          data: defaultPreferences,
        };
      }

      return {
        success: true,
        message: 'Notification preferences retrieved successfully',
        data: preferences,
      };
    } catch (error) {
      this.logger.error(`Error getting notification preferences for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up event listeners when service is destroyed
   */
  destroy(): void {
    this.emitterService.off(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted);
    this.logger.info('Profile service event listeners removed');
  }
}
