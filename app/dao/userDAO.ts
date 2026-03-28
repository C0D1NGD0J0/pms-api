import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Lease } from '@models/index';
import { IUserDocument } from '@interfaces/user.interface';
import { PipelineStage, FilterQuery, Types, Model } from 'mongoose';
import { hashGenerator, createLogger, escapeRegExp } from '@utils/index';
import { ListResultWithPagination, IInvitationDocument } from '@interfaces/index';
import { resolveHighestRole, IUserRoleType, ROLES } from '@shared/constants/roles.constants';

import { BaseDAO } from './baseDAO';
import { IFindOptions, dynamic } from './interfaces/baseDAO.interface';
import { IUserFilterOptions, IUserDAO } from './interfaces/userDAO.interface';

export class UserDAO extends BaseDAO<IUserDocument> implements IUserDAO {
  protected logger: Logger;

  constructor({ userModel }: { userModel: Model<IUserDocument> }) {
    super(userModel);
    this.logger = createLogger('UserDAO');
  }

  private static readonly PROFILE_LOOKUP_STAGES: PipelineStage[] = [
    { $lookup: { from: 'profiles', localField: '_id', foreignField: 'user', as: 'profile' } },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
  ];

  private static readonly SENSITIVE_FIELD_EXCLUSIONS: PipelineStage = {
    $project: {
      password: 0,
      activationToken: 0,
      passwordResetToken: 0,
      activationTokenExpiresAt: 0,
      passwordResetTokenExpiresAt: 0,
      'profile.__v': 0,
    },
  };

  private async paginateAggregation(
    pipeline: PipelineStage[],
    opts?: IFindOptions
  ): Promise<{ items: any[]; pagination: any }> {
    const limit = opts?.limit || 10;
    const skip = opts?.skip || 0;
    const sortDir = opts?.sort === 'asc' ? 1 : -1;
    const sortBy = opts?.sortBy || 'createdAt';

    const countPipeline = [...pipeline, { $count: 'total' }];
    pipeline.push({ $sort: { [sortBy]: sortDir } }, { $skip: skip }, { $limit: limit });

    const [items, countResult] = await Promise.all([
      this.aggregate(pipeline),
      this.aggregate(countPipeline),
    ]);

    const total = (countResult[0] as any)?.total ?? 0;
    const totalPages = Math.ceil(total / limit);
    return {
      items,
      pagination: {
        total,
        totalPages,
        page: Math.floor(skip / limit) + 1,
        limit,
        hasNext: skip + limit < total,
        hasPrev: skip > 0,
      },
    };
  }

  async getUserById(id: string, opts?: IFindOptions): Promise<IUserDocument | null> {
    try {
      if (!id) {
        throw new Error('UserID missing.');
      }

      const query = { _id: new Types.ObjectId(id) };
      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async getUserByUId(uid: string, opts?: dynamic): Promise<IUserDocument | null> {
    try {
      const query = { uid };
      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async listUsers(
    query: Record<string, any>,
    opts?: IFindOptions
  ): ListResultWithPagination<IUserDocument[]> {
    try {
      return await this.list(query, opts);
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async getActiveUserByEmail(email: string, opts?: dynamic): Promise<IUserDocument | null> {
    try {
      const query = { email, deletedAt: null, isActive: true };
      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async verifyCredentials(email: string, password: string): Promise<IUserDocument | null> {
    try {
      const user = await this.getActiveUserByEmail(email);
      if (!user) return null;

      const isValid = await user.validatePassword(password);
      return isValid ? user : null;
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async createActivationToken(userId?: string, email?: string): Promise<IUserDocument | null> {
    try {
      if (!userId && !email) {
        throw new Error('User ID or email is required to create activation token.');
      }
      const token = hashGenerator({});
      const filter: FilterQuery<IUserDocument> = { deletedAt: null, isActive: false };
      if (userId && email) {
        filter.$or = [{ _id: userId }, { email }];
      } else if (userId) {
        filter._id = userId as any;
      } else {
        filter.email = email;
      }

      const user = await this.update(filter, {
        activationToken: token,
        activationTokenExpiresAt: dayjs().add(2, 'hour').toDate(),
      } as Partial<IUserDocument>);

      return user;
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async activateAccount(
    token: string,
    consentData: { acceptedBy: string }
  ): Promise<string | null> {
    try {
      const query = {
        activationToken: token,
        activationTokenExpiresAt: { $gt: new Date() },
        isActive: false,
      };

      const result = await this.findFirst(query);
      if (!result) return null;
      result.isActive = true;
      result.activationToken = '';
      result.activationTokenExpiresAt = null;
      result.consent = {
        acceptedOn: new Date(),
        acceptedBy: consentData.acceptedBy,
      };
      await result.save();
      return result._id.toString();
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async associateUserWithClient(
    userId: string,
    clientId: string,
    role: IUserRoleType
  ): Promise<boolean> {
    try {
      const user = await this.getUserById(userId);
      if (!user) return false;

      const existingAssociation = user.cuids.find((c) => c.cuid === clientId);
      if (existingAssociation) {
        if (existingAssociation.roles.includes(role) || !existingAssociation.isConnected) {
          await this.update(
            { _id: userId, 'cuids.cuid': clientId },
            {
              $set: {
                'cuids.$.isConnected': true,
              },
              $addToSet: {
                'cuids.$.roles': role,
              },
            }
          );
        }
        return true; // Association already exists with same role
      }

      // create new association
      const result = await this.updateById(userId, {
        $push: {
          cuids: {
            cuid: clientId,
            isConnected: true,
          },
        },
        $addToSet: {
          roles: role,
        },
      });

      return !!result;
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async getUsersByClientId(
    clientId: string,
    filter: FilterQuery<IUserDocument> = {},
    opts?: IFindOptions
  ): ListResultWithPagination<IUserDocument[]> {
    try {
      const query = {
        ...filter,
        'cuids.cuid': clientId,
        'cuids.isConnected': true,
        deletedAt: null,
      };

      return await this.list(query, opts);
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async getUsersByClientIdAndRole(
    cuid: string,
    role: IUserRoleType,
    opts?: IFindOptions
  ): ListResultWithPagination<IUserDocument[]> {
    try {
      const query = {
        'cuids.cuid': cuid,
        'cuids.roles': role,
        'cuids.isConnected': true,
        deletedAt: null,
        isActive: true,
      };

      const options = {
        ...opts,
        populate: [{ path: 'profile', select: 'personalInfo vendorInfo' }],
      };

      return await this.list(query, options);
    } catch (error) {
      this.logger.error(`Error getting users by role ${role} for client ${cuid}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  async getUsersByFilteredType(
    cuid: string,
    filterOptions: IUserFilterOptions,
    paginationOpts?: IFindOptions
  ): Promise<ListResultWithPagination<IUserDocument[]>> {
    try {
      const { role, department, status, search } = filterOptions;

      const query: FilterQuery<IUserDocument> = {
        'cuids.cuid': cuid,
        'cuids.isConnected': true,
        deletedAt: null,
      };

      if (status) {
        query.isActive = status === 'active';
      }

      if (role) {
        // const roles = Array.isArray(role) ? role : [role];
        query['cuids.roles'] = Array.isArray(role) ? { $in: role } : role;
      }

      if (search && search.trim()) {
        const searchRegex = new RegExp(escapeRegExp(search.trim()), 'i');
        query.$or = [
          { firstName: { $regex: searchRegex } },
          { lastName: { $regex: searchRegex } },
          { email: { $regex: searchRegex } },
          { phoneNumber: { $regex: searchRegex } },
        ];
      }

      const pipeline: PipelineStage[] = [{ $match: query }, ...UserDAO.PROFILE_LOOKUP_STAGES];

      if (department) {
        pipeline.push({
          $match: {
            'profile.employeeInfo.department': department,
          },
        });
      }

      pipeline.push(UserDAO.SENSITIVE_FIELD_EXCLUSIONS);

      return await this.paginateAggregation(pipeline, paginationOpts);
    } catch (error) {
      this.logger.error(`Error getting filtered users for client ${cuid}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  async searchUsers(query: string, clientId: string): Promise<IUserDocument[]> {
    try {
      const searchRegex = new RegExp(escapeRegExp(query.trim()), 'i');
      const pipeline: PipelineStage[] = [
        {
          $match: {
            'cuids.cuid': clientId,
            'cuids.isConnected': true,
            deletedAt: null,
            $or: [
              { firstName: searchRegex },
              { lastName: searchRegex },
              { email: searchRegex },
              { phoneNumber: searchRegex },
            ],
          },
        },
        {
          $project: {
            password: 0,
            activationToken: 0,
            passwordResetToken: 0,
            activationTokenExpiresAt: 0,
            passwordResetTokenExpiresAt: 0,
          },
        },
      ];

      return await this.aggregate(pipeline);
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async isEmailUnique(email: string): Promise<boolean> {
    try {
      const user = await this.getActiveUserByEmail(email);
      return !user;
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async removeClientAssociation(userId: string, clientId: string): Promise<boolean> {
    try {
      const result = await this.update(
        { _id: new Types.ObjectId(userId) },
        { $pull: { cuids: { cuid: clientId } } }
      );

      return !!result;
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async getUserClientAssociations(userId: string): Promise<any[]> {
    try {
      const user = await this.getUserById(userId, { projection: { cuids: 1 } });

      if (!user || !user.cuids) {
        return [];
      }

      return user.cuids;
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async resetPassword(token: string, password: string): Promise<IUserDocument | null> {
    try {
      const user = await this.findFirst({
        passwordResetToken: token,
        passwordResetTokenExpiresAt: { $gt: new Date() },
      });

      if (!user) {
        return null;
      }

      user.password = password;
      user.passwordResetToken = '';
      user.passwordResetTokenExpiresAt = null;
      await user.save();
      return user;
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async createPasswordResetToken(email: string): Promise<IUserDocument | null> {
    try {
      let user = await this.getActiveUserByEmail(email);

      if (!user) {
        return null;
      }

      const token = hashGenerator({});
      const expiresAt = dayjs().add(2, 'hour').toDate();

      user = await this.updateById(user._id.toString(), {
        $set: {
          passwordResetToken: token,
          passwordResetTokenExpiresAt: expiresAt,
        },
      });

      return user;
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  async getUserWithProfileByEmailOrId(email: string): Promise<IUserDocument | null> {
    try {
      const query = { email, deletedAt: null };
      return await this.findFirst(query, { populate: 'profile' });
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Create a new user from an invitation acceptance
   */
  async createUserFromInvitation(
    client: { cuid: string; displayName?: string },
    invitationData: IInvitationDocument,
    userData: any,
    linkedVendorUid?: string,
    session?: any
  ): Promise<IUserDocument> {
    try {
      const userId = new Types.ObjectId();

      const cuidEntry: any = {
        cuid: client.cuid,
        isConnected: true,
        roles: [invitationData.role],
        primaryRole: invitationData.role,
        clientDisplayName: client.displayName,
        linkedVendorUid: invitationData.role === ROLES.VENDOR ? linkedVendorUid : null,
      };

      const user = await this.insert(
        {
          _id: userId,
          isActive: true,
          cuids: [cuidEntry],
          uid: hashGenerator({}),
          activecuid: client.cuid,
          password: userData.password,
          email: invitationData.inviteeEmail,
        },
        session
      );

      return user;
    } catch (error) {
      this.logger.error('Error creating user from invitation:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Add an existing user to a client with the specified role
   */
  async addUserToClient(
    userId: string,
    role: IUserRoleType,
    client: { cuid: string; clientDisplayName?: string; id: string },
    linkedVendorUid?: string,
    session?: any
  ): Promise<IUserDocument | null> {
    try {
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const existingConnection = user.cuids.find((c) => c.cuid === client.cuid);

      if (existingConnection) {
        const allRoles = existingConnection.roles.includes(role)
          ? existingConnection.roles
          : [...existingConnection.roles, role];
        const newPrimaryRole = resolveHighestRole(allRoles as IUserRoleType[]);

        const updateObj: any = {
          'cuids.$.isConnected': true,
          'cuids.$.clientDisplayName': client.clientDisplayName,
          'cuids.$.linkedVendorUid': role === ROLES.VENDOR ? linkedVendorUid : null,
          'cuids.$.primaryRole': newPrimaryRole,
        };

        const updateOperation = existingConnection.roles.includes(role)
          ? { $set: updateObj }
          : { $set: updateObj, $addToSet: { 'cuids.$.roles': role } };

        return await this.update(
          { _id: new Types.ObjectId(userId), 'cuids.cuid': client.cuid },
          updateOperation,
          {},
          session
        );
      } else {
        // new cuid entry
        const cuidEntry: any = {
          cuid: client.cuid,
          isConnected: true,
          roles: [role],
          primaryRole: role,
          clientDisplayName: client.clientDisplayName || '',
          linkedVendorUid: role === ROLES.VENDOR ? linkedVendorUid : null,
        };

        return await this.updateById(
          userId,
          {
            $push: {
              cuids: cuidEntry,
            },
          },
          { session }
        );
      }
    } catch (error) {
      this.logger.error('Error adding user to client:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Check if a user already exists with the given email and has access to the client
   */
  async getUserWithClientAccess(email: string, cuid: string): Promise<IUserDocument | null> {
    try {
      return await this.findFirst({
        email: email.toLowerCase(),
        deletedAt: null,
        'cuids.cuid': cuid,
        'cuids.isConnected': true,
      });
    } catch (error) {
      this.logger.error('Error checking user client access:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Create a new user with default password for bulk user creation
   */
  async createBulkUserWithDefaults(
    client: { cuid: string; clientDisplayName?: string; id: string },
    userData: {
      email: string;
      firstName: string;
      lastName: string;
      phoneNumber?: string;
      role: IUserRoleType;
      defaultPassword: string;
    },
    linkedVendorUid?: string,
    session?: any
  ): Promise<IUserDocument> {
    try {
      const userId = new Types.ObjectId();

      const cuidEntry: any = {
        cuid: client.cuid,
        isConnected: true,
        roles: [userData.role],
        primaryRole: userData.role,
        clientDisplayName: client.clientDisplayName || '',
        linkedVendorUid: userData.role === ROLES.VENDOR && linkedVendorUid ? linkedVendorUid : null,
        requiresOnboarding: true,
      };

      const user = await this.insert(
        {
          _id: userId,
          isActive: true,
          cuids: [cuidEntry],
          uid: hashGenerator({}),
          activecuid: client.cuid,
          password: userData.defaultPassword,
          email: userData.email.toLowerCase(),
        },
        session
      );

      return user;
    } catch (error) {
      this.logger.error('Error creating bulk user:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async getLinkedVendorUsers(
    vendorUid: string,
    cuid: string,
    opts?: IFindOptions
  ): Promise<ListResultWithPagination<IUserDocument[]>> {
    try {
      const query: FilterQuery<IUserDocument> = {
        'cuids.cuid': cuid,
        'cuids.linkedVendorUid': vendorUid,
        'cuids.isConnected': true,
        deletedAt: null,
      };

      return await this.list(query, opts);
    } catch (error) {
      this.logger.error(`Error getting linked vendor users for vendor ${vendorUid}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  async rebuildMissingProfiles(
    cuid?: string,
    profileDAO?: any
  ): Promise<{
    totalUsers: number;
    totalProfiles: number;
    missingProfiles: number;
    fixedProfiles: number;
    failedProfiles: number;
    errors: Array<{ userId: string; email: string; error: string }>;
  }> {
    try {
      // Get all users (optionally filtered by client)
      const userQuery: FilterQuery<IUserDocument> = { deletedAt: null };
      if (cuid) {
        userQuery['cuids.cuid'] = cuid;
      }

      const users = await this.list(userQuery, { limit: 10000 });
      const userIds = users.items.map((u: IUserDocument) => u._id);

      // Get all profiles for these users
      const profiles = await profileDAO.list({ user: { $in: userIds } }, { limit: 10000 });
      const profileUserIds = new Set(profiles.items.map((p: any) => p.user.toString()));

      // Find users without profiles
      const usersWithoutProfiles = users.items.filter(
        (u: IUserDocument) => !profileUserIds.has(u._id.toString())
      );

      const stats = {
        totalUsers: users.items.length,
        totalProfiles: profiles.items.length,
        missingProfiles: usersWithoutProfiles.length,
        fixedProfiles: 0,
        failedProfiles: 0,
        errors: [] as Array<{ userId: string; email: string; error: string }>,
      };

      // Create missing profiles
      for (const user of usersWithoutProfiles) {
        try {
          // Determine if this is a linked vendor account
          const primaryCuid = user.cuids.find((c: any) => c.cuid === user.activecuid);
          const isLinkedVendor =
            primaryCuid?.linkedVendorUid && primaryCuid.roles.includes(ROLES.VENDOR as any);

          const profileData: any = {
            user: user._id,
            puid: user.uid,
            personalInfo: {
              firstName: 'Unknown',
              lastName: 'User',
              displayName: user.email.split('@')[0],
              phoneNumber: '',
              location: 'Unknown',
            },
            lang: 'en',
            timeZone: 'UTC',
            policies: {
              tos: {
                accepted: false,
                acceptedOn: null,
              },
              marketing: {
                accepted: false,
                acceptedOn: null,
              },
            },
          };

          // Add vendor info for vendor users
          if (primaryCuid?.roles.includes(ROLES.VENDOR as any)) {
            if (isLinkedVendor) {
              // Linked vendor - minimal info
              profileData.vendorInfo = {
                isLinkedAccount: true,
                companyName: null,
                businessType: null,
                taxId: null,
                registrationNumber: null,
                yearsInBusiness: 0,
                servicesOffered: {},
                contactPerson: {
                  name: user.email.split('@')[0],
                  jobTitle: 'Associate',
                  email: user.email,
                  phone: '',
                },
              };
            } else {
              // Primary vendor - needs full info (placeholder)
              profileData.vendorInfo = {
                isLinkedAccount: false,
                companyName: 'Unknown Company',
                businessType: 'Unknown',
                taxId: null,
                registrationNumber: null,
                yearsInBusiness: 0,
                servicesOffered: {},
                contactPerson: {
                  name: user.email.split('@')[0],
                  jobTitle: 'Manager',
                  email: user.email,
                  phone: '',
                },
              };
            }
          }

          await profileDAO.createUserProfile(user._id, profileData);
          stats.fixedProfiles++;
          this.logger.info(`Created missing profile for user ${user.email}`);
        } catch (error) {
          stats.failedProfiles++;
          stats.errors.push({
            userId: user._id.toString(),
            email: user.email,
            error: error.message || 'Unknown error',
          });
          this.logger.error(`Failed to create profile for user ${user.email}:`, error);
        }
      }

      this.logger.info('Profile rebuild complete:', stats);
      return stats;
    } catch (error) {
      this.logger.error('Error in rebuildMissingProfiles:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async getTenantsByClient(
    cuid: string,
    filters?: import('@interfaces/user.interface').ITenantFilterOptions,
    pagination?: IFindOptions
  ): Promise<import('@interfaces/user.interface').IPaginatedResult<IUserDocument[]>> {
    try {
      const tenantMatch: Record<string, any> = {
        'cuids.cuid': cuid,
        'cuids.roles': 'tenant',
        deletedAt: null,
      };

      if (filters?.search && filters.search.trim()) {
        const searchRegex = new RegExp(escapeRegExp(filters.search.trim()), 'i');
        tenantMatch.$or = [
          { firstName: { $regex: searchRegex } },
          { lastName: { $regex: searchRegex } },
          { email: { $regex: searchRegex } },
          { phoneNumber: { $regex: searchRegex } },
        ];
      }

      const pipeline: PipelineStage[] = [{ $match: tenantMatch }, ...UserDAO.PROFILE_LOOKUP_STAGES];

      if (filters) {
        const matchConditions: any = {};

        // Filter by connection status
        if (filters.connectionStatus !== undefined) {
          if (filters.connectionStatus === 'connected') {
            matchConditions['cuids'] = {
              $elemMatch: { cuid, isConnected: true },
            };
          } else if (filters.connectionStatus === 'disconnected') {
            matchConditions['cuids'] = {
              $elemMatch: { cuid, isConnected: false },
            };
          }
          // If 'all', don't add connection filter
        }

        if (filters.status) {
          matchConditions.isActive = filters.status === 'active';
        }

        if (filters.leaseStatus) {
          matchConditions['profile.tenantInfo.activeLease'] = {
            $exists: filters.leaseStatus !== 'pending',
          };
        }

        if (filters.backgroundCheckStatus) {
          matchConditions['profile.tenantInfo.backgroundCheckStatus'] =
            filters.backgroundCheckStatus;
        }

        if (filters.propertyId) {
          matchConditions['profile.tenantInfo.activeLease.propertyId'] = filters.propertyId;
        }

        if (filters.moveInDateRange) {
          matchConditions['profile.tenantInfo.activeLease.paymentDueDate'] = {
            $gte: filters.moveInDateRange.start,
            $lte: filters.moveInDateRange.end,
          };
        }

        if (Object.keys(matchConditions).length > 0) {
          pipeline.push({ $match: matchConditions });
        }
      }

      pipeline.push(UserDAO.SENSITIVE_FIELD_EXCLUSIONS);

      return await this.paginateAggregation(pipeline, pagination);
    } catch (error) {
      this.logger.error(`Error getting tenants for client ${cuid}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  async getTenantStats(
    cuid: string,
    filters?: import('@interfaces/user.interface').ITenantFilterOptions
  ): Promise<import('@interfaces/user.interface').ITenantStats> {
    try {
      const pipeline: PipelineStage[] = [
        {
          $match: {
            'cuids.cuid': cuid,
            'cuids.roles': 'tenant',
            'cuids.isConnected': true,
            deletedAt: null,
          },
        },
        ...UserDAO.PROFILE_LOOKUP_STAGES,
        // Join active leases directly from the leases collection
        {
          $lookup: {
            from: 'leases',
            let: { userId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$tenantId', '$$userId'] },
                  status: 'active',
                },
              },
              { $project: { 'fees.monthlyRent': 1, 'property.id': 1 } },
            ],
            as: 'activeLeasesDocs',
          },
        },
        // Join prior (terminated/expired) leases for expiredLeases count
        {
          $lookup: {
            from: 'leases',
            let: { userId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$tenantId', '$$userId'] },
                  status: { $in: ['terminated', 'expired'] },
                },
              },
              { $project: { _id: 1 } },
            ],
            as: 'priorLeasesDocs',
          },
        },
      ];

      // Apply filters if provided
      if (filters) {
        const matchConditions: any = {};

        if (filters.status) {
          matchConditions.isActive = filters.status === 'active';
        }

        if (filters.propertyId) {
          matchConditions['activeLeasesDocs.property.id'] = filters.propertyId;
        }

        if (Object.keys(matchConditions).length > 0) {
          pipeline.push({ $match: matchConditions });
        }
      }

      // Add aggregation stages for statistics
      pipeline.push(
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            activeCount: {
              $sum: {
                $cond: [{ $gt: [{ $size: '$activeLeasesDocs' }, 0] }, 1, 0],
              },
            },
            expiredCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: [{ $size: '$activeLeasesDocs' }, 0] },
                      { $gt: [{ $size: '$priorLeasesDocs' }, 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            totalRent: {
              $sum: { $sum: '$activeLeasesDocs.fees.monthlyRent' },
            },
            backgroundCheckDistribution: {
              $push: '$profile.tenantInfo.backgroundCheckStatus',
            },
            propertyDistribution: {
              $push: { $arrayElemAt: ['$activeLeasesDocs.property.id', 0] },
            },
          },
        },
        {
          $project: {
            _id: 0,
            total: 1,
            activeLeases: '$activeCount',
            expiredLeases: '$expiredCount',
            pendingLeases: { $literal: 0 },
            rentStatus: {
              current: '$activeCount',
              late: { $literal: 0 },
              overdue: { $literal: 0 },
            },
            averageRent: {
              $cond: [{ $gt: ['$activeCount', 0] }, { $divide: ['$totalRent', '$activeCount'] }, 0],
            },
            occupancyRate: {
              $cond: [
                { $gt: ['$total', 0] },
                { $multiply: [{ $divide: ['$activeCount', '$total'] }, 100] },
                0,
              ],
            },
            backgroundCheckDistribution: {
              $reduce: {
                input: '$backgroundCheckDistribution',
                initialValue: { pending: 0, approved: 0, failed: 0, notRequired: 0 },
                in: {
                  pending: {
                    $cond: [
                      { $eq: ['$$this', 'pending'] },
                      { $add: ['$$value.pending', 1] },
                      '$$value.pending',
                    ],
                  },
                  approved: {
                    $cond: [
                      { $eq: ['$$this', 'approved'] },
                      { $add: ['$$value.approved', 1] },
                      '$$value.approved',
                    ],
                  },
                  failed: {
                    $cond: [
                      { $eq: ['$$this', 'failed'] },
                      { $add: ['$$value.failed', 1] },
                      '$$value.failed',
                    ],
                  },
                  notRequired: {
                    $cond: [
                      { $eq: ['$$this', 'not_required'] },
                      { $add: ['$$value.notRequired', 1] },
                      '$$value.notRequired',
                    ],
                  },
                },
              },
            },
            distributionByProperty: '$propertyDistribution',
          },
        }
      );

      const result = await this.aggregate(pipeline);

      if (!result.length) {
        return {
          total: 0,
          activeLeases: 0,
          expiredLeases: 0,
          pendingLeases: 0,
          rentStatus: {
            current: 0,
            late: 0,
            overdue: 0,
          },
          averageRent: 0,
          occupancyRate: 0,
          distributionByProperty: [],
          backgroundCheckDistribution: {
            pending: 0,
            approved: 0,
            failed: 0,
            notRequired: 0,
          },
        };
      }

      const stats: any = result[0];

      // Process property distribution — array of property ObjectIds (null entries filtered out)
      const propertyMap = new Map<string, number>();

      for (const propId of stats.distributionByProperty || []) {
        if (propId) {
          const key = propId.toString();
          propertyMap.set(key, (propertyMap.get(key) || 0) + 1);
        }
      }

      stats.distributionByProperty = Array.from(propertyMap.entries()).map(([id, count]) => ({
        propertyId: id,
        propertyName: `Property ${id}`,
        tenantCount: count,
      }));

      return stats as import('@interfaces/user.interface').ITenantStats;
    } catch (error) {
      this.logger.error(`Error getting tenant stats for client ${cuid}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  async getClientTenantDetails(
    cuid: string,
    tenantUid: string,
    include?: string[]
  ): Promise<import('@interfaces/user.interface').IClientTenantDetails | null> {
    try {
      const includeAll = !include || include.includes('all');
      const includeLeaseHistory = includeAll || include.includes('lease');
      const includePaymentHistory = includeAll || include.includes('payments');
      const includeMaintenanceRequests = includeAll || include.includes('maintenance');
      const includeNotes = includeAll || include.includes('notes');

      const pipeline: PipelineStage[] = [
        {
          $match: {
            uid: tenantUid,
            'cuids.cuid': cuid,
            'cuids.roles': 'tenant',
            deletedAt: null,
          },
        },
        ...UserDAO.PROFILE_LOOKUP_STAGES,
        {
          $project: {
            _id: 1,
            uid: 1,
            email: 1,
            isActive: 1,
            createdAt: 1,
            isConnected: {
              $let: {
                vars: {
                  conn: {
                    $first: {
                      $filter: {
                        input: { $ifNull: ['$cuids', []] },
                        as: 'c',
                        cond: { $eq: ['$$c.cuid', cuid] },
                      },
                    },
                  },
                },
                in: { $ifNull: ['$$conn.isConnected', false] },
              },
            },
            firstName: { $ifNull: ['$profile.personalInfo.firstName', ''] },
            lastName: { $ifNull: ['$profile.personalInfo.lastName', ''] },
            fullName: {
              $concat: [
                { $ifNull: ['$profile.personalInfo.firstName', ''] },
                ' ',
                { $ifNull: ['$profile.personalInfo.lastName', ''] },
              ],
            },
            displayName: {
              $ifNull: [
                '$profile.personalInfo.displayName',
                {
                  $concat: [
                    { $ifNull: ['$profile.personalInfo.firstName', ''] },
                    ' ',
                    { $ifNull: ['$profile.personalInfo.lastName', ''] },
                  ],
                },
              ],
            },
            phoneNumber: '$profile.personalInfo.phoneNumber',
            avatar: '$profile.personalInfo.avatar',
            joinedDate: '$createdAt',
            tenantInfo: {
              employerInfo: {
                $filter: {
                  input: { $ifNull: ['$profile.tenantInfo.employerInfo', []] },
                  as: 'employer',
                  cond: { $eq: ['$$employer.cuid', cuid] },
                },
              },
              activeLeases: {
                $filter: {
                  input: { $ifNull: ['$profile.tenantInfo.activeLeases', []] },
                  as: 'lease',
                  cond: { $eq: ['$$lease.cuid', cuid] },
                },
              },
              backgroundChecks: {
                $filter: {
                  input: { $ifNull: ['$profile.tenantInfo.backgroundChecks', []] },
                  as: 'check',
                  cond: { $eq: ['$$check.cuid', cuid] },
                },
              },
              rentalReferences: '$profile.tenantInfo.rentalReferences',
              pets: '$profile.tenantInfo.pets',
              emergencyContact: '$profile.tenantInfo.emergencyContact',
              ...(includeLeaseHistory && { leaseHistory: [] }),
              ...(includePaymentHistory && { paymentHistory: [] }),
              ...(includeMaintenanceRequests && { maintenanceRequests: [] }),
              ...(includeNotes && { notes: [] }),
            },
            tenantMetrics: {
              onTimePaymentRate: 100,
              averagePaymentDelay: { $literal: 0 },
              totalMaintenanceRequests: { $literal: 0 },
              currentRentStatus: {
                $cond: [
                  {
                    $gt: [{ $size: { $ifNull: ['$profile.tenantInfo.activeLeases', []] } }, 0],
                  },
                  'current',
                  'no_lease',
                ],
              },
              daysCurrentLease: { $literal: 0 },
              totalRentPaid: { $literal: 0 },
            },
          },
        },
      ];

      const result = await this.aggregate(pipeline);

      if (!result.length) {
        return null;
      }

      const tenant = result[0] as any;

      const tenantId = typeof tenant._id === 'string' ? new Types.ObjectId(tenant._id) : tenant._id;

      // Note: Payment metrics and history are now populated in the service layer
      // This allows proper separation of concerns - UserDAO handles user data only

      if (includeLeaseHistory) {
        const leases = await Lease.find({
          cuid,
          tenantId,
        })
          .sort({ createdAt: -1 })
          .limit(10)
          .lean();

        tenant.tenantInfo.leaseHistory = leases.map((lease: any) => ({
          id: lease._id.toString(),
          luid: lease.luid,
          leaseNumber: lease.leaseNumber,
          status: lease.status,
          propertyName: lease.property?.address || 'Unknown Property',
          unitNumber: lease.unit?.unitNumber || '',
          monthlyRent: lease.fees?.monthlyRent || 0,
          leaseStart: lease.duration?.startDate || lease.startDate,
          leaseEnd: lease.duration?.endDate || lease.endDate,
        }));
      }

      return tenant as import('@interfaces/user.interface').IClientTenantDetails;
    } catch (error) {
      this.logger.error(
        `Error getting tenant details for client ${cuid}, tenant ${tenantUid}:`,
        error
      );
      throw this.throwErrorHandler(error);
    }
  }

  async clearOnboardingFlag(userId: string, cuid: string): Promise<void> {
    try {
      await this.update(
        { _id: userId, 'cuids.cuid': cuid },
        { $set: { 'cuids.$.requiresOnboarding': false } }
      );
    } catch (error) {
      this.logger.error('Error clearing onboarding flag:', error);
      throw this.throwErrorHandler(error);
    }
  }
}
