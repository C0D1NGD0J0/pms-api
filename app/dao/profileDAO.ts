// app/dao/profileDAO.ts
import Logger from 'bunyan';
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

      for (const [key, value] of Object.entries(gdprSettings)) {
        updateFields[`settings.gdprSettings.${key}`] = value;
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

      return await this.updateById(profileId, { $set: { identification: identificationData } });
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
    preferences: { messages?: boolean; comments?: boolean; announcements?: boolean }
  ): Promise<IProfileDocument | null> {
    try {
      const updateFields: Record<string, boolean> = {};

      if (preferences.messages !== undefined) {
        updateFields['settings.notifications.messages'] = preferences.messages;
      }

      if (preferences.comments !== undefined) {
        updateFields['settings.notifications.comments'] = preferences.comments;
      }

      if (preferences.announcements !== undefined) {
        updateFields['settings.notifications.announcements'] = preferences.announcements;
      }

      return await this.updateById(profileId, { $set: updateFields });
    } catch (error) {
      this.logger.error(`Error updating notification preferences for profile ${profileId}:`, error);
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
        updateFields.timeZone = settings.timeZone;
      }

      if (settings.lang) {
        updateFields.lang = settings.lang;
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

      // Ensure we have the required fields
      const data = {
        ...profileData,
        user: objectId,
        puid: profileData.puid || generateShortUID(),
      };

      // If personalInfo isn't provided, create a minimal structure
      if (!data.personalInfo) {
        data.personalInfo = {
          firstName: '',
          lastName: '',
          displayName: '',
          location: profileData?.personalInfo?.location || '',
        } as any;
      }

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
                  displayname: '$displayName',
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
            sub: { $toString: '$userData._id' },
            email: '$userData.email',
            isActive: '$userData.isActive',
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
                  activeClientRoleInfo: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: '$clientRoleInfo',
                          as: 'roleInfo',
                          cond: { $eq: ['$$roleInfo.cuid', '$userData.activecuid'] },
                        },
                      },
                      0,
                    ],
                  },
                },
                in: {
                  cuid: '$$activeClient.cuid',
                  displayname: '$$activeClient.displayName',
                  role: { $arrayElemAt: ['$$activeClient.roles', 0] },
                  linkedVendorId: '$$activeClientRoleInfo.linkedVendorId',
                  isPrimaryVendor: {
                    $cond: {
                      if: {
                        $and: [
                          { $eq: [{ $arrayElemAt: ['$$activeClient.roles', 0] }, 'vendor'] },
                          { $not: '$$activeClientRoleInfo.linkedVendorId' },
                        ],
                      },
                      then: true,
                      else: false,
                    },
                  },
                },
              },
            },

            // common profile information if applicable
            vendorInfo: {
              $cond: {
                if: '$vendorInfo',
                then: '$vendorInfo',
                else: '$$REMOVE',
              },
            },

            employeeInfo: {
              $cond: {
                if: '$employeeInfo',
                then: '$employeeInfo',
                else: '$$REMOVE',
              },
            },

            // all client connections
            clients: {
              $map: {
                input: '$userData.cuids',
                as: 'conn',
                in: {
                  cuid: '$$conn.cuid',
                  displayName: '$$conn.displayName',
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

            // permissions array to be filled later
            permissions: [],
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
   * Update common vendor information that applies across all clients
   */
  async updateCommonVendorInfo(
    profileId: string,
    vendorInfo: Record<string, any>
  ): Promise<IProfileDocument | null> {
    try {
      if (!vendorInfo || typeof vendorInfo !== 'object') {
        throw new Error('Vendor info must be a valid object');
      }

      const updateFields: Record<string, any> = {};

      for (const [key, value] of Object.entries(vendorInfo)) {
        if (key === 'contactPerson' && typeof value === 'object') {
          for (const [subKey, subValue] of Object.entries(value)) {
            updateFields[`vendorInfo.contactPerson.${subKey}`] = subValue;
          }
        } else if (key === 'insuranceInfo' && typeof value === 'object') {
          for (const [subKey, subValue] of Object.entries(value)) {
            updateFields[`vendorInfo.insuranceInfo.${subKey}`] = subValue;
          }
        } else if (key === 'servicesOffered' && typeof value === 'object') {
          for (const [subKey, subValue] of Object.entries(value)) {
            updateFields[`vendorInfo.servicesOffered.${subKey}`] = subValue;
          }
        } else if (key === 'address' && typeof value === 'object') {
          for (const [subKey, subValue] of Object.entries(value)) {
            updateFields[`vendorInfo.address.${subKey}`] = subValue;
          }
        } else {
          updateFields[`vendorInfo.${key}`] = value;
        }
      }

      return await this.updateById(profileId, { $set: updateFields });
    } catch (error) {
      this.logger.error(`Error updating common vendor info for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update vendor information for a profile and client
   * Now distinguishes between primary vendor account and linked vendor accounts
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

      // Get the profile to check if it's a primary or linked vendor
      const profile = await this.findById(profileId);
      if (!profile) {
        throw new Error('Profile not found');
      }

      const clientRole = profile.clientRoleInfo?.find((info) => info.cuid === cuid);
      const isPrimaryVendor = !clientRole?.linkedVendorId;

      // Special case for linkedVendorId which remains at the top level of clientRoleInfo
      if (vendorInfo.linkedVendorId) {
        // Only update the linkedVendorId in clientRoleInfo
        return await this.updateById(
          profileId,
          { $set: { 'clientRoleInfo.$[client].linkedVendorId': vendorInfo.linkedVendorId } },
          { arrayFilters: [{ 'client.cuid': cuid }] }
        );
      }

      // For primary vendors, we update the top-level vendorInfo
      if (isPrimaryVendor) {
        return await this.updateCommonVendorInfo(profileId, vendorInfo);
      } else {
        // For linked vendors, we don't update the vendorInfo
        // Instead, return the profile without changes
        this.logger.info(`Linked vendor account (${profileId}) cannot update vendor info directly`);
        return profile;
      }
    } catch (error) {
      this.logger.error(
        `Error updating vendor info for profile ${profileId}, client ${cuid}:`,
        error
      );
      throw this.throwErrorHandler(error);
    }
  }

  async clearRoleSpecificInfo(
    profileId: string,
    cuid: string,
    roleType: 'employee' | 'vendor'
  ): Promise<IProfileDocument | null> {
    try {
      // Since clientSettings is removed, we only remove linkedVendorId if it exists
      return await this.updateById(
        profileId,
        { $unset: { 'clientRoleInfo.$[client].linkedVendorId': '' } },
        { arrayFilters: [{ 'client.cuid': cuid }] }
      );
    } catch (error) {
      this.logger.error(
        `Error clearing ${roleType} info for profile ${profileId}, client ${cuid}:`,
        error
      );
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get role-specific information for a profile and client
   */
  async getRoleSpecificInfo(
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
      const profile = await this.findById(profileId);

      if (!profile) {
        return null;
      }

      const clientRoleInfo = profile.clientRoleInfo?.find((info) => info.cuid === cuid);

      if (!clientRoleInfo) {
        return null;
      }

      const result: any = {
        role: clientRoleInfo.role,
        isConnected: clientRoleInfo.isConnected,
      };

      if (clientRoleInfo.linkedVendorId) {
        result.linkedVendorId = clientRoleInfo.linkedVendorId;
        result.isPrimaryVendor = false;
      } else if (clientRoleInfo.role === 'vendor') {
        // If this is a vendor without linkedVendorId, it's a primary vendor
        result.isPrimaryVendor = true;
      }

      // Include relevant info based on role
      if (clientRoleInfo.role === 'vendor' && profile.vendorInfo) {
        result.vendorInfo = profile.vendorInfo;
      }

      if (['manager', 'admin', 'staff'].includes(clientRoleInfo.role) && profile.employeeInfo) {
        result.employeeInfo = profile.employeeInfo;
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Error getting role-specific info for profile ${profileId}, client ${cuid}:`,
        error
      );
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Ensure client role info exists for a profile
   */
  async ensureClientRoleInfo(profileId: string, cuid: string, role?: string): Promise<void> {
    try {
      const profile = await this.findById(profileId);

      if (!profile) {
        throw new Error('Profile not found');
      }

      const hasClientRoleInfo = profile.clientRoleInfo?.some((info) => info.cuid === cuid);

      if (!hasClientRoleInfo) {
        await this.updateById(profileId, {
          $push: {
            clientRoleInfo: {
              cuid,
              role: role || 'vendor', // Default to vendor if role not provided
              isConnected: true,
            },
          },
        });
      }
    } catch (error) {
      this.logger.error(
        `Error ensuring client role info for profile ${profileId}, client ${cuid}:`,
        error
      );
      throw this.throwErrorHandler(error);
    }
  }
}

export default ProfileDAO;
