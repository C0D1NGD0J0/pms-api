import Logger from 'bunyan';
import { t } from '@shared/languages';
import ROLES from '@shared/constants/roles.constants';
import { BadRequestError } from '@shared/customErrors';
import { IProfileDocument } from '@interfaces/profile.interface';
import { ListResultWithPagination, ICurrentUser } from '@interfaces/index';
import { generateShortUID, createLogger, escapeRegExp } from '@utils/index';
import { PipelineStage, ClientSession, FilterQuery, Types, Model } from 'mongoose';

import { BaseDAO } from './baseDAO';
import { IUserBasicInfo, IFindOptions, IProfileDAO } from './interfaces/index';

export class ProfileDAO extends BaseDAO<IProfileDocument> implements IProfileDAO {
  protected logger: Logger;

  constructor({ profileModel }: { profileModel: Model<IProfileDocument> }) {
    super(profileModel);
    this.logger = createLogger('ProfileDAO');
  }

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

  async updateTenantInfo(
    profileId: string,
    tenantInfo: Partial<IProfileDocument['tenantInfo']>
  ): Promise<IProfileDocument | null> {
    try {
      const updateFields: Record<string, any> = {};

      const safeInfo: Record<string, any> = tenantInfo ?? {};
      for (const [key, value] of Object.entries(safeInfo)) {
        updateFields[`tenantInfo.${key}`] = value;
      }

      return await this.updateById(profileId, { $set: updateFields });
    } catch (error) {
      this.logger.error(`Error updating tenant info for profile ${profileId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

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

  async searchProfiles(
    searchTerm: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IProfileDocument[]> {
    try {
      // Create a search filter that looks across various fields
      const filter: FilterQuery<IProfileDocument> = {
        $or: [
          { 'personalInfo.displayName': { $regex: escapeRegExp(searchTerm), $options: 'i' } },
          { 'personalInfo.firstName': { $regex: escapeRegExp(searchTerm), $options: 'i' } },
          { 'personalInfo.lastName': { $regex: escapeRegExp(searchTerm), $options: 'i' } },
          { 'personalInfo.bio': { $regex: escapeRegExp(searchTerm), $options: 'i' } },
          { 'personalInfo.headline': { $regex: escapeRegExp(searchTerm), $options: 'i' } },
          { 'personalInfo.location': { $regex: escapeRegExp(searchTerm), $options: 'i' } },
        ],
      };

      return await this.list(filter, opts);
    } catch (error) {
      this.logger.error(`Error searching profiles with term "${searchTerm}":`, error);
      throw this.throwErrorHandler(error);
    }
  }

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
  async generateCurrentUserInfo(userId: string, cuid?: string): Promise<ICurrentUser | null> {
    try {
      // When cuid is provided (e.g. from JWT in the auth middleware), use it to select the
      // active client context. This prevents concurrent sessions from loading the wrong client
      // when user.activecuid in the DB has been updated by a different session.
      const activeCuidExpr: any = cuid ? { $literal: cuid } : '$userData.activecuid';

      const pipeline: PipelineStage[] = [
        { $match: { user: new Types.ObjectId(userId) } },

        // ── User data ─────────────────────────────────────────────────────────
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'userData',
          },
        },
        { $unwind: '$userData' },

        // Fetch only the active client document — no need for the full list
        {
          $lookup: {
            from: 'clients',
            let: { activeCuid: activeCuidExpr },
            pipeline: [
              { $match: { $expr: { $eq: ['$cuid', '$$activeCuid'] } } },
              {
                $project: {
                  _id: 0,
                  cuid: 1,
                  isVerified: 1,
                  vendorPayoutMode: '$settings.vendorPayoutMode',
                  tenantFeatures: '$settings.tenantFeatures',
                },
              },
            ],
            as: 'clientsData',
          },
        },

        // Derive active role once — used by subscription, employeeInfo, paymentProcessor guards
        {
          $addFields: {
            activeClientRole: {
              $let: {
                vars: {
                  ac: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: '$userData.cuids',
                          as: 'c',
                          cond: { $eq: ['$$c.cuid', activeCuidExpr] },
                        },
                      },
                      0,
                    ],
                  },
                },
                in: { $ifNull: ['$$ac.primaryRole', { $arrayElemAt: ['$$ac.roles', 0] }] },
              },
            },
          },
        },

        // ── Lookups ───────────────────────────────────────────────────────────
        {
          $lookup: {
            from: 'subscriptions',
            let: { activeCuid: activeCuidExpr },
            pipeline: [{ $match: { $expr: { $eq: ['$cuid', '$$activeCuid'] } } }],
            as: 'subscriptionData',
          },
        },
        // Payment processor for active client (super-admin only)
        {
          $lookup: {
            from: 'paymentprocessors',
            let: { activeCuid: activeCuidExpr },
            pipeline: [{ $match: { $expr: { $eq: ['$cuid', '$$activeCuid'] } } }],
            as: 'paymentProcessorData',
          },
        },
        // Vendor document — resolves vuid for vendor portal routing
        {
          $lookup: {
            from: 'vendors',
            localField: 'vendorInfo.vendorId',
            foreignField: '_id',
            as: 'vendorDocData',
          },
        },

        // Extract first-element results in a single stage; vendorDoc must be set before the payout lookup below
        {
          $addFields: {
            subscriptionInfo: { $arrayElemAt: ['$subscriptionData', 0] },
            paymentProcessorInfo: { $arrayElemAt: ['$paymentProcessorData', 0] },
            vendorDoc: { $arrayElemAt: ['$vendorDocData', 0] },
          },
        },

        // Vendor payout processor — depends on vendorDoc.vuid resolved above
        {
          $lookup: {
            from: 'paymentprocessors',
            let: { vuid: '$vendorDoc.vuid', activeCuid: activeCuidExpr },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$vuid', '$$vuid'] },
                      { $eq: ['$cuid', '$$activeCuid'] },
                      { $eq: ['$ownerType', 'vendor'] },
                    ],
                  },
                },
              },
            ],
            as: 'vendorPayoutData',
          },
        },
        { $addFields: { vendorPayoutInfo: { $arrayElemAt: ['$vendorPayoutData', 0] } } },

        // ── Shape ICurrentUser output ─────────────────────────────────────────
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
            avatarUrl: { $ifNull: ['$personalInfo.avatar.url', ''] },

            preferences: {
              theme: { $ifNull: ['$settings.theme', 'light'] },
              lang: { $ifNull: ['$settings.lang', 'en'] },
              timezone: { $ifNull: ['$settings.timeZone', 'UTC'] },
            },

            // Active client — resolved via $let to avoid re-filtering userData.cuids
            client: {
              $let: {
                vars: {
                  ac: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: '$userData.cuids',
                          as: 'c',
                          cond: { $eq: ['$$c.cuid', activeCuidExpr] },
                        },
                      },
                      0,
                    ],
                  },
                  // clientsData is now a single-element array (active client only)
                  acd: { $arrayElemAt: ['$clientsData', 0] },
                },
                in: {
                  cuid: '$$ac.cuid',
                  clientDisplayName: '$$ac.clientDisplayName',
                  role: '$activeClientRole',
                  linkedVendorUid: '$$ac.linkedVendorUid',
                  isVerified: { $ifNull: ['$$acd.isVerified', false] },
                  requiresOnboarding: { $ifNull: ['$$ac.requiresOnboarding', false] },
                  isFormerTenant: { $ifNull: ['$$ac.isFormerTenant', false] },
                  tenantFeatures: { $ifNull: ['$$acd.tenantFeatures', '$$REMOVE'] },
                  // vendor-only fields
                  vendorPayoutMode: {
                    $cond: {
                      if: { $in: [ROLES.VENDOR, '$$ac.roles'] },
                      then: { $ifNull: ['$$acd.vendorPayoutMode', 'platform_hold'] },
                      else: '$$REMOVE',
                    },
                  },
                  isPrimaryVendor: {
                    $cond: {
                      if: { $in: [ROLES.VENDOR, '$$ac.roles'] },
                      then: { $cond: { if: '$$ac.linkedVendorUid', then: false, else: true } },
                      else: '$$REMOVE',
                    },
                  },
                },
              },
            },

            // All client connections (account switcher)
            clients: {
              $map: {
                input: '$userData.cuids',
                as: 'conn',
                in: {
                  cuid: '$$conn.cuid',
                  clientDisplayName: '$$conn.clientDisplayName',
                  roles: '$$conn.roles',
                  isConnected: '$$conn.isConnected',
                },
              },
            },

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

            // PM staff only
            employeeInfo: {
              $cond: {
                if: {
                  $and: [
                    '$employeeInfo',
                    { $in: ['$activeClientRole', [ROLES.ADMIN, ROLES.MANAGER, ROLES.STAFF]] },
                  ],
                },
                then: {
                  department: '$employeeInfo.department',
                  jobTitle: '$employeeInfo.jobTitle',
                  employeeId: '$employeeInfo.employeeId',
                  startDate: '$employeeInfo.startDate',
                },
                else: '$$REMOVE',
              },
            },

            // Vendor only
            vendorInfo: {
              $cond: {
                if: '$vendorInfo',
                then: {
                  vendorId: { $toString: '$vendorInfo.vendorId' },
                  vuid: '$vendorDoc.vuid',
                  linkedVendorUid: '$vendorInfo.linkedVendorUid',
                  // primary vendor = the originally invited account owner (no linkedVendorUid)
                  // null isLinkedAccount defaults true → isPrimaryVendor false (safe fallback)
                  isPrimaryVendor: { $not: { $ifNull: ['$vendorInfo.isLinkedAccount', true] } },
                  isLinkedAccount: '$vendorInfo.isLinkedAccount',
                  payoutAccount: {
                    $cond: {
                      if: '$vendorPayoutInfo',
                      then: {
                        isSetup: { $ifNull: ['$vendorPayoutInfo.detailsSubmitted', false] },
                        payoutsEnabled: { $ifNull: ['$vendorPayoutInfo.payoutsEnabled', false] },
                        chargesEnabled: { $ifNull: ['$vendorPayoutInfo.chargesEnabled', false] },
                      },
                      else: { isSetup: false, payoutsEnabled: false, chargesEnabled: false },
                    },
                  },
                },
                else: '$$REMOVE',
              },
            },

            // Tenant only — $let filters activeLeases once for both hasActiveLease and activeLease
            tenantInfo: {
              $cond: {
                if: '$tenantInfo',
                then: {
                  $let: {
                    vars: {
                      activeLeaseForCuid: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: { $ifNull: ['$tenantInfo.activeLeases', []] },
                              as: 'al',
                              cond: { $eq: ['$$al.cuid', activeCuidExpr] },
                            },
                          },
                          0,
                        ],
                      },
                      latestCheck: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: { $ifNull: ['$tenantInfo.backgroundChecks', []] },
                              as: 'bc',
                              cond: { $eq: ['$$bc.cuid', activeCuidExpr] },
                            },
                          },
                          -1,
                        ],
                      },
                      employerInfoForCuid: {
                        $filter: {
                          input: { $ifNull: ['$tenantInfo.employerInfo', []] },
                          as: 'emp',
                          cond: { $eq: ['$$emp.cuid', activeCuidExpr] },
                        },
                      },
                    },
                    in: {
                      hasActiveLease: {
                        $cond: { if: '$$activeLeaseForCuid', then: true, else: false },
                      },
                      backgroundCheckStatus: { $ifNull: ['$$latestCheck.status', null] },
                      activeLease: { $ifNull: ['$$activeLeaseForCuid', '$$REMOVE'] },
                      employerInfo: '$$employerInfoForCuid',
                    },
                  },
                },
                else: '$$REMOVE',
              },
            },

            // Subscription information — only for PM roles (admin, manager, staff, super-admin)
            // Tenants and vendors use tenantFeatures / vendorInfo for their feature access
            subscription: {
              $cond: {
                if: {
                  $and: [
                    '$subscriptionInfo',
                    {
                      $in: [
                        '$activeClientRole',
                        [ROLES.ADMIN, ROLES.MANAGER, ROLES.STAFF, 'super-admin'],
                      ],
                    },
                  ],
                },
                then: {
                  $let: {
                    vars: {
                      sub: '$subscriptionInfo',
                      now: new Date(),
                      isSuperAdmin: { $eq: ['$activeClientRole', 'super-admin'] },
                    },
                    in: {
                      plan: {
                        name: '$$sub.planName',
                        status: {
                          $cond: {
                            if: {
                              $and: [
                                { $eq: ['$$sub.status', 'active'] },
                                { $eq: [{ $ifNull: ['$$sub.billing.subscriberId', ''] }, ''] },
                              ],
                            },
                            then: 'pending_payment',
                            else: '$$sub.status',
                          },
                        },
                        billingInterval: '$$sub.billingInterval',
                      },
                      entitlements: {
                        $ifNull: [
                          '$$sub.entitlements',
                          {
                            eSignature: false,
                            RepairRequestService: false,
                            VisitorPassService: false,
                            reportingAnalytics: false,
                            leaseTemplates: false,
                          },
                        ],
                      },
                      paymentFlow: {
                        requiresPayment: {
                          $cond: {
                            if: {
                              $and: [
                                '$$isSuperAdmin',
                                {
                                  $or: [
                                    { $eq: ['$$sub.status', 'pending_payment'] },
                                    {
                                      $and: [
                                        { $eq: ['$$sub.status', 'active'] },
                                        {
                                          $eq: [
                                            { $ifNull: ['$$sub.billing.subscriberId', ''] },
                                            '',
                                          ],
                                        },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                            then: true,
                            else: {
                              $cond: {
                                if: {
                                  $and: [
                                    '$$isSuperAdmin',
                                    { $eq: ['$$sub.status', 'active'] },
                                    { $ne: ['$$sub.planName', 'essential'] },
                                    { $lt: [{ $ifNull: ['$$sub.endDate', '$$now'] }, '$$now'] },
                                  ],
                                },
                                then: true,
                                else: false,
                              },
                            },
                          },
                        },
                        reason: {
                          $cond: {
                            if: {
                              $and: [
                                '$$isSuperAdmin',
                                { $eq: ['$$sub.status', 'pending_payment'] },
                              ],
                            },
                            then: {
                              $cond: {
                                if: {
                                  $and: [
                                    '$$sub.pendingDowngradeAt',
                                    {
                                      $lte: [
                                        {
                                          $divide: [
                                            {
                                              $subtract: ['$$sub.pendingDowngradeAt', '$$now'],
                                            },
                                            86400000,
                                          ],
                                        },
                                        1,
                                      ],
                                    },
                                  ],
                                },
                                then: 'grace_period',
                                else: 'pending_signup',
                              },
                            },
                            else: {
                              $cond: {
                                if: {
                                  $and: [
                                    '$$isSuperAdmin',
                                    { $eq: ['$$sub.status', 'active'] },
                                    { $ne: ['$$sub.planName', 'essential'] },
                                    { $lt: [{ $ifNull: ['$$sub.endDate', '$$now'] }, '$$now'] },
                                  ],
                                },
                                then: 'expired',
                                else: null,
                              },
                            },
                          },
                        },
                        gracePeriodEndsAt: {
                          $cond: {
                            if: '$$sub.pendingDowngradeAt',
                            then: '$$sub.pendingDowngradeAt',
                            else: null,
                          },
                        },
                        daysUntilDowngrade: {
                          $cond: {
                            if: '$$sub.pendingDowngradeAt',
                            then: {
                              $ceil: {
                                $divide: [
                                  { $subtract: ['$$sub.pendingDowngradeAt', '$$now'] },
                                  86400000,
                                ],
                              },
                            },
                            else: null,
                          },
                        },
                      },
                    },
                  },
                },
                else: '$$REMOVE',
              },
            },

            // Payment processor status — only exposed for SUPER_ADMIN
            paymentProcessor: {
              $cond: {
                if: {
                  $and: [
                    { $ne: ['$paymentProcessorInfo', null] },
                    { $eq: ['$activeClientRole', 'super-admin'] },
                  ],
                },
                then: {
                  isSetup: { $literal: true },
                  chargesEnabled: { $ifNull: ['$paymentProcessorInfo.chargesEnabled', false] },
                  payoutsEnabled: { $ifNull: ['$paymentProcessorInfo.payoutsEnabled', false] },
                  needsOnboarding: {
                    $not: {
                      $and: [
                        { $ifNull: ['$paymentProcessorInfo.chargesEnabled', false] },
                        { $ifNull: ['$paymentProcessorInfo.payoutsEnabled', false] },
                      ],
                    },
                  },
                  accountId: { $ifNull: ['$paymentProcessorInfo.accountId', null] },
                  accountType: { $ifNull: ['$paymentProcessorInfo.accountType', null] },
                  onboardedAt: { $ifNull: ['$paymentProcessorInfo.onboardedAt', null] },
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

  /**
   * Get basic user information for a specific client context.
   * Lightweight alternative to generateCurrentUserInfo() for cases where only
   * basic contact/profile info is needed (e.g., email notifications, user lists).
   *
   * @param userId - The unique identifier for the user
   * @param cuid - The client ID for multi-tenancy context
   * @returns A promise that resolves to basic user info or null if not found
   */
  async getUserBasicInfo(userId: string, cuid: string): Promise<IUserBasicInfo | null> {
    try {
      const profile = await this.findFirst(
        { user: new Types.ObjectId(userId), cuid },
        { populate: 'user' }
      );

      if (!profile || !profile.user) {
        return null;
      }

      const user = profile.user as any;
      const clientConnection = user.cuids?.find((c: any) => c.cuid === cuid);
      const role = clientConnection?.roles?.[0] || 'unknown';

      return {
        userId: user._id.toString(),
        profileId: profile._id.toString(),
        cuid,
        role,
        firstName: profile.personalInfo.firstName,
        lastName: profile.personalInfo.lastName,
        fullName: `${profile.personalInfo.firstName} ${profile.personalInfo.lastName}`.trim(),
        displayName: profile.personalInfo.displayName || null,
        email: user.email,
        phone: profile.personalInfo.phoneNumber || null,
        avatar: profile.personalInfo?.avatar?.url || null,
      };
    } catch (error) {
      this.logger.error(
        `Error getting basic user info for user ID ${userId}, cuid ${cuid}:`,
        error
      );
      return null;
    }
  }
}

export default ProfileDAO;
