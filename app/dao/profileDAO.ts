import Logger from 'bunyan';
import { t } from '@shared/languages';
import ROLES from '@shared/constants/roles.constants';
import { BadRequestError } from '@shared/customErrors';
import { generateShortUID, createLogger } from '@utils/index';
import { IProfileDocument } from '@interfaces/profile.interface';
import { ListResultWithPagination, ICurrentUser } from '@interfaces/index';
import { PipelineStage, ClientSession, FilterQuery, Types, Model } from 'mongoose';

import { BaseDAO } from './baseDAO';
import { IFindOptions, IProfileDAO } from './interfaces/index';

export class ProfileDAO extends BaseDAO<IProfileDocument> implements IProfileDAO {
  protected logger: Logger;

  constructor({ profileModel }: { profileModel: Model<IProfileDocument> }) {
    super(profileModel);
    this.logger = createLogger('ProfileDAO');
  }

  /**
   * @inheritdoc
   */
  async updatePersonalInfo(
    profileId: string,
    personalInfo: Partial<IProfileDocument['personalInfo']>
  ): Promise<IProfileDocument | null> {
    try {
      const updateFields: Record<string, any> = {};

      for (const [key, value] of Object.entries(personalInfo)) {
        updateFields[`personalInfo.${key}`] = value;
      }

      return await this.updateById(profileId, { $set: updateFields });
    } catch (error) {
      this.logger.error(`Error updating personal info for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateAvatar(
    profileId: string,
    avatarData: { url: string; filename?: string; key?: string }
  ): Promise<IProfileDocument | null> {
    try {
      return await this.updateById(profileId, {
        $set: { 'personalInfo.avatar': avatarData },
      });
    } catch (error) {
      this.logger.error(`Error updating avatar for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateTheme(profileId: string, theme: 'light' | 'dark'): Promise<IProfileDocument | null> {
    try {
      return await this.updateById(profileId, {
        $set: { 'settings.theme': theme },
      });
    } catch (error) {
      this.logger.error(`Error updating theme for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateLoginType(
    profileId: string,
    loginType: 'otp' | 'password'
  ): Promise<IProfileDocument | null> {
    try {
      return await this.updateById(profileId, {
        $set: { 'settings.loginType': loginType },
      });
    } catch (error) {
      this.logger.error(`Error updating login type for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateGDPRSettings(
    profileId: string,
    gdprSettings: Partial<IProfileDocument['settings']['gdprSettings']>
  ): Promise<IProfileDocument | null> {
    try {
      const updateFields: Record<string, any> = {};
      if (gdprSettings) {
        for (const [key, value] of Object.entries(gdprSettings)) {
          updateFields[`settings.gdprSettings.${key}`] = value;
        }
      }

      return await this.updateById(profileId, { $set: updateFields });
    } catch (error) {
      this.logger.error(`Error updating GDPR settings for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateIdentification(
    profileId: string,
    identificationData: {
      idType: string;
      issueDate: Date;
      expiryDate: Date;
      idNumber: string;
      authority?: string;
      issuingState: string;
    }
  ): Promise<IProfileDocument | null> {
    try {
      if (identificationData.expiryDate <= identificationData.issueDate) {
        throw new Error('Expiry date must be after issue date');
      }

      return await this.updateById(profileId, {
        $set: { 'personalInfo.identification': identificationData },
      });
    } catch (error) {
      this.logger.error(`Error updating identification for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateNotificationPreferences(
    profileId: string,
    preferences: {
      messages?: boolean;
      comments?: boolean;
      announcements?: boolean;
      maintenance?: boolean;
      payments?: boolean;
      system?: boolean;
      propertyUpdates?: boolean;
      emailNotifications?: boolean;
      inAppNotifications?: boolean;
      emailFrequency?: 'immediate' | 'daily';
    }
  ): Promise<IProfileDocument | null> {
    try {
      const updateFields: Record<string, boolean | string> = {};

      const booleanFields = [
        'messages',
        'comments',
        'announcements',
        'maintenance',
        'payments',
        'system',
        'propertyUpdates',
        'emailNotifications',
        'inAppNotifications',
      ];

      for (const field of booleanFields) {
        if (preferences[field as keyof typeof preferences] !== undefined) {
          updateFields[`settings.notifications.${field}`] = preferences[
            field as keyof typeof preferences
          ] as boolean;
        }
      }

      if (preferences.emailFrequency !== undefined) {
        updateFields['settings.notifications.emailFrequency'] = preferences.emailFrequency;
      }

      return await this.updateById(profileId, { $set: updateFields });
    } catch (error) {
      this.logger.error(`Error updating notification preferences for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get notification preferences for a user by their user ID
   */
  async getNotificationPreferences(
    userId: string
  ): Promise<IProfileDocument['settings']['notifications'] | null> {
    try {
      const profile = await this.findFirst({ user: new Types.ObjectId(userId) });
      return profile?.settings?.notifications || null;
    } catch (error) {
      this.logger.error(`Error getting notification preferences for user ${userId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateLocaleSettings(
    profileId: string,
    settings: { timeZone?: string; lang?: string }
  ): Promise<IProfileDocument | null> {
    try {
      const updateFields: Record<string, string> = {};

      if (settings.timeZone) {
        updateFields['settings.timeZone'] = settings.timeZone;
      }

      if (settings.lang) {
        updateFields['settings.lang'] = settings.lang;
      }

      return await this.updateById(profileId, { $set: updateFields });
    } catch (error) {
      this.logger.error(`Error updating locale settings for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async createUserProfile(
    userId: string | Types.ObjectId,
    profileData: Partial<IProfileDocument>,
    session?: ClientSession
  ): Promise<IProfileDocument> {
    try {
      const objectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

      const data = {
        ...profileData,
        user: objectId,
        puid: profileData.puid || generateShortUID(),
      };

      return await this.insert(data as Partial<IProfileDocument>, session);
    } catch (error) {
      this.logger.error(`Error creating profile for user ${userId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async searchProfiles(
    searchTerm: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IProfileDocument[]> {
    try {
      // Create a search filter that looks across various fields
      const filter: FilterQuery<IProfileDocument> = {
        $or: [
          { 'personalInfo.displayName': { $regex: searchTerm, $options: 'i' } },
          { 'personalInfo.firstName': { $regex: searchTerm, $options: 'i' } },
          { 'personalInfo.lastName': { $regex: searchTerm, $options: 'i' } },
          { 'personalInfo.bio': { $regex: searchTerm, $options: 'i' } },
          { 'personalInfo.headline': { $regex: searchTerm, $options: 'i' } },
          { 'personalInfo.location': { $regex: searchTerm, $options: 'i' } },
        ],
      };

      return await this.list(filter, opts);
    } catch (error) {
      this.logger.error(`Error searching profiles with term "${searchTerm}":`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async getProfileByUserId(userId: string | Types.ObjectId): Promise<IProfileDocument | null> {
    try {
      const objectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
      return await this.findFirst({ user: objectId });
    } catch (error) {
      this.logger.error(`Error finding profile for user ${userId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Retrieves the currently authenticated user along with their profile information.
   * Uses MongoDB aggregation to join user data with their profile data and formats it into a CurrentUser object.
   *
   * @param userId - The unique identifier for the user.
   * @returns A promise that resolves to a CurrentUser object or null if no user is found.
   */
  async generateCurrentUserInfo(userId: string): Promise<ICurrentUser | null> {
    try {
      const pipeline: PipelineStage[] = [
        {
          $match: {
            user: new Types.ObjectId(userId),
          },
        },

        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'userData',
          },
        },
        { $unwind: '$userData' },

        // add client information for all the user's clients
        {
          $lookup: {
            from: 'clients',
            let: { cuidList: '$userData.cuids.cuid' },
            pipeline: [
              {
                $match: {
                  $expr: { $in: ['$cuid', '$$cuidList'] },
                },
              },
              {
                $project: {
                  _id: 0,
                  cuid: '$cuid',
                  clientDisplayName: '$displayName',
                  isVerified: 1,
                },
              },
            ],
            as: 'clientsData',
          },
        },

        // transform data into ICurrentUser structure
        {
          $project: {
            _id: 0,
            uid: '$userData.uid',
            email: '$userData.email',
            isActive: '$userData.isActive',
            sub: { $toString: '$userData._id' },
            displayName: '$personalInfo.displayName',
            fullname: {
              $concat: ['$personalInfo.firstName', ' ', '$personalInfo.lastName'],
            },
            avatarUrl: {
              $ifNull: ['$personalInfo.avatar.url', ''],
            },

            // preferences
            preferences: {
              theme: { $ifNull: ['$settings.theme', 'light'] },
              lang: { $ifNull: ['$lang', 'en'] },
              timezone: { $ifNull: ['$timeZone', 'UTC'] },
            },

            // active client information
            client: {
              $let: {
                vars: {
                  activeClient: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: '$userData.cuids',
                          as: 'client',
                          cond: { $eq: ['$$client.cuid', '$userData.activecuid'] },
                        },
                      },
                      0,
                    ],
                  },
                },
                in: {
                  cuid: '$$activeClient.cuid',
                  clientDisplayName: '$$activeClient.clientDisplayName',
                  role: { $arrayElemAt: ['$$activeClient.roles', 0] },
                  linkedVendorUid: '$$activeClient.linkedVendorUid',
                  isPrimaryVendor: {
                    $cond: {
                      if: {
                        $and: [
                          { $in: [ROLES.VENDOR, '$$activeClient.roles'] },
                          { $not: '$$activeClient.linkedVendorUid' },
                        ],
                      },
                      then: true,
                      else: false,
                    },
                  },
                },
              },
            },

            // all client connections
            clients: {
              $map: {
                input: '$userData.cuids',
                as: 'conn',
                in: {
                  cuid: '$$conn.cuid',
                  clientDisplayName: '$$conn.displayName',
                  roles: '$$conn.roles',
                  isConnected: '$$conn.isConnected',
                },
              },
            },

            // gdpr settings if available
            gdpr: {
              $cond: {
                if: '$settings.gdprSettings',
                then: {
                  dataRetentionPolicy: '$settings.gdprSettings.dataRetentionPolicy',
                  dataProcessingConsent: '$settings.gdprSettings.dataProcessingConsent',
                  processingConsentDate: '$settings.gdprSettings.processingConsentDate',
                  retentionExpiryDate: '$settings.gdprSettings.retentionExpiryDate',
                },
                else: '$$REMOVE',
              },
            },

            employeeInfo: {
              $cond: {
                if: '$employeeInfo',
                then: {
                  department: '$employeeInfo.department',
                  jobTitle: '$employeeInfo.jobTitle',
                  employeeId: '$employeeInfo.employeeId',
                  startDate: '$employeeInfo.startDate',
                },
                else: '$$REMOVE',
              },
            },

            vendorInfo: {
              $cond: {
                if: '$vendorInfo',
                then: {
                  vendorId: { $toString: '$vendorInfo.vendorId' },
                  linkedVendorUid: '$vendorInfo.linkedVendorUid',
                  isPrimaryVendor: '$vendorInfo.isPrimaryVendor',
                  isLinkedAccount: '$vendorInfo.isLinkedAccount',
                },
                else: '$$REMOVE',
              },
            },

            tenantInfo: {
              $cond: {
                if: '$tenantInfo',
                then: {
                  hasActiveLease: { $ifNull: ['$tenantInfo.hasActiveLease', false] },
                  backgroundCheckStatus: '$tenantInfo.backgroundCheckStatus',
                  activeLease: { $ifNull: ['$tenantInfo.activeLease', null] },
                },
                else: '$$REMOVE',
              },
            },

            // NOTE: Permissions are intentionally NOT populated here.
            // They are dynamically generated in the authentication middleware
            // via PermissionService.populateUserPermissions() based on the user's
            // current role and department. This allows permissions to be refreshed
            // on each request and maintains separation of concerns between data
            // access and authorization.
            // See: app/shared/middlewares/middleware.ts:100-105
            // permissions: [], // DO NOT UNCOMMENT - see note above
          },
        },
      ];

      const result = await this.aggregate(pipeline);

      if (!result.length) {
        this.logger.warn(`No user profile found for userId: ${userId}`);
        return null;
      }

      const currentUser = result[0] as unknown as ICurrentUser;
      return currentUser;
    } catch (error) {
      this.logger.error(`Error generating current user info for ${userId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update common employee information that applies across all clients
   */
  async updateCommonEmployeeInfo(
    profileId: string,
    employeeInfo: Record<string, any>
  ): Promise<IProfileDocument | null> {
    try {
      if (!employeeInfo || typeof employeeInfo !== 'object') {
        throw new Error('Employee info must be a valid object');
      }

      const updateFields: Record<string, any> = {};

      for (const [key, value] of Object.entries(employeeInfo)) {
        updateFields[`employeeInfo.${key}`] = value;
      }

      return await this.updateById(profileId, { $set: updateFields });
    } catch (error) {
      this.logger.error(`Error updating common employee info for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update employee information
   * Now directly updates the top-level employeeInfo field
   */
  async updateEmployeeInfo(
    profileId: string,
    cuid: string,
    employeeInfo: Record<string, any>
  ): Promise<IProfileDocument | null> {
    try {
      if (!employeeInfo || typeof employeeInfo !== 'object') {
        throw new Error('Employee info must be a valid object');
      }

      const updateFields: Record<string, any> = {};

      // Since clientSettings is removed, we update the top-level employeeInfo
      for (const [key, value] of Object.entries(employeeInfo)) {
        if (
          [
            'permissions',
            'department',
            'employeeId',
            'reportsTo',
            'startDate',
            'jobTitle',
          ].includes(key)
        ) {
          updateFields[`employeeInfo.${key}`] = value;
        }
      }

      return await this.updateById(profileId, { $set: updateFields });
    } catch (error) {
      this.logger.error(
        `Error updating employee info for profile ${profileId}, client ${cuid}:`,
        error
      );
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update vendor reference information (vendorId, linkedVendorUid, isLinkedAccount)
   */
  async updateVendorReference(
    profileId: string,
    vendorReference: { vendorId?: string; linkedVendorUid?: string; isLinkedAccount?: boolean }
  ): Promise<IProfileDocument | null> {
    try {
      if (!vendorReference || typeof vendorReference !== 'object') {
        throw new BadRequestError({
          message: t('profile.errors.invalidParameters'),
        });
      }
      const updateFields: Record<string, any> = {};

      // Only allow updating vendor reference fields
      const allowedFields = ['vendorId', 'linkedVendorUid', 'isLinkedAccount'];
      for (const [key, value] of Object.entries(vendorReference)) {
        if (allowedFields.includes(key)) {
          updateFields[`vendorInfo.${key}`] = value;
        }
      }

      if (Object.keys(updateFields).length === 0) {
        this.logger.warn(`No valid vendor reference fields to update for profile ${profileId}`);
        return await this.findById(profileId);
      }

      return await this.updateById(profileId, { $set: updateFields });
    } catch (error) {
      this.logger.error(`Error updating vendor reference for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @deprecated Use VendorService to update vendor business information
   * This method now only handles vendor reference updates in the profile
   */
  async updateVendorInfo(
    profileId: string,
    cuid: string,
    vendorInfo: Record<string, any>
  ): Promise<IProfileDocument | null> {
    try {
      if (!vendorInfo || typeof vendorInfo !== 'object') {
        throw new Error('Vendor info must be a valid object');
      }

      this.logger.warn(
        `updateVendorInfo is deprecated. Use VendorService for business data updates. Profile: ${profileId}`
      );

      const profile = await this.findById(profileId);
      if (!profile) {
        throw new Error('Profile not found');
      }

      // Only update vendor reference fields, ignore business data
      const vendorReference = {
        vendorId: vendorInfo.vendorId,
        linkedVendorUid: vendorInfo.linkedVendorUid,
        isLinkedAccount: vendorInfo.isLinkedAccount,
      };

      return await this.updateVendorReference(profileId, vendorReference);
    } catch (error) {
      this.logger.error(
        `Error updating vendor info for profile ${profileId}, client ${cuid}:`,
        error
      );
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Clear role-specific information
   * This is now just a placeholder since role info is managed in UserDAO
   */
  async clearRoleSpecificInfo(
    profileId: string,
    cuid: string,
    roleType: 'employee' | 'vendor'
  ): Promise<IProfileDocument | null> {
    try {
      const profile = await this.findById(profileId);
      if (!profile) {
        throw new Error('Profile not found');
      }
      return profile;
    } catch (error) {
      this.logger.error(
        `Error clearing ${roleType} info for profile ${profileId}, client ${cuid}:`,
        error
      );
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get profile information only, without role data
   * Role data should be fetched and combined at the service layer
   */
  async getProfileInfo(profileId: string): Promise<{
    vendorInfo?: any;
    employeeInfo?: any;
    userId?: string;
  } | null> {
    try {
      const profile = await this.findById(profileId);

      if (!profile) {
        return null;
      }

      const result: any = {
        userId: profile.user.toString(),
      };

      if (profile.vendorInfo) {
        result.vendorInfo = profile.vendorInfo;
      }

      if (profile.employeeInfo) {
        result.employeeInfo = profile.employeeInfo;
      }

      return result;
    } catch (error) {
      this.logger.error(`Error getting profile info for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get profile's user ID
   */
  async getProfileUserId(userId: string): Promise<string | null> {
    try {
      const profile = await this.findFirst({ user: userId });

      if (!profile) {
        return null;
      }

      return profile.user.toString();
    } catch (error) {
      this.logger.error(`Error getting profile for user ID ${userId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }
}

export default ProfileDAO;
