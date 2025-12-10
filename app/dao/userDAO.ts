import dayjs from 'dayjs';
import Logger from 'bunyan';
import { User } from '@models/index';
import { IUserDocument } from '@interfaces/user.interface';
import { PipelineStage, FilterQuery, Types, Model } from 'mongoose';
import { IUserRoleType, ROLES } from '@shared/constants/roles.constants';
import { paginateResult, hashGenerator, createLogger } from '@utils/index';
import { ListResultWithPagination, IInvitationDocument } from '@interfaces/index';

import { BaseDAO } from './baseDAO';
import { IFindOptions, dynamic } from './interfaces/baseDAO.interface';
import { IUserFilterOptions, IUserDAO } from './interfaces/userDAO.interface';

export class UserDAO extends BaseDAO<IUserDocument> implements IUserDAO {
  protected logger: Logger;

  constructor({ userModel }: { userModel: Model<IUserDocument> }) {
    super(userModel);
    this.logger = createLogger('UserDAO');
  }

  /**
   * Get a user by ID.
   *
   * @param id - The ID of the user.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to the found user document or null if no user is found.
   */
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

  /**
   * Get a user by UID.
   *
   * @param uid - The UID of the user.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to the found user document or null if no user is found.
   */
  async getUserByUId(uid: string, opts?: dynamic): Promise<IUserDocument | null> {
    try {
      const query = { uid };
      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * List users with optional filtering and projection.
   *
   * @param query - Filter criteria for the query.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to an array of user documents.
   */
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

  /**
   * Get a user by email address.
   *
   * @param email - The email address of the user.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to the found user document or null if no user is found.
   */
  async getActiveUserByEmail(email: string, opts?: dynamic): Promise<IUserDocument | null> {
    try {
      const query = { email, deletedAt: null, isActive: true };
      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Verify user credentials for authentication.
   *
   * @param email - The user's email address.
   * @param password - The user's password.
   * @returns A promise that resolves to the user document if credentials are valid, or null otherwise.
   */
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

  /**
   * Generate and save an activation token for a user.
   *
   * @param userId - The ID of the user to generate a token for.
   * @returns A promise that resolves to the generated token.
   */
  async createActivationToken(userId?: string, email?: string): Promise<IUserDocument | null> {
    try {
      if (!userId && !email) {
        throw new Error('User ID or email is required to create activation token.');
      }
      const token = hashGenerator({});
      const filter: FilterQuery<typeof User> = { deletedAt: null, isActive: false };
      if (userId) {
        filter.$or = [{ _id: userId }];
        if (email) {
          filter.$or.push({ email });
        }
      } else if (email) {
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

  /**
   * Activate a user account using a token.
   *
   * @param token - The activation token.
   * @returns A promise that resolves to true if activation was successful, false otherwise.
   */
  async activateAccount(token: string): Promise<boolean> {
    try {
      const query = {
        activationToken: token,
        activationTokenExpiresAt: { $gt: new Date() },
        isActive: false,
      };

      const result = await this.findFirst(query);
      if (!result) return false;
      result.isActive = true;
      result.activationToken = '';
      result.activationTokenExpiresAt = null;
      await result.save();
      return true;
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Associate a user with a client (multi-tenant functionality).
   *
   * @param userId - The ID of the user.
   * @param clientId - The ID of the client to associate with.
   * @param role - The role of the user for this client.
   * @returns A promise that resolves to true if the association was created successfully.
   */
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

  /**
   * Get users associated with a specific client.
   *
   * @param clientId - The ID of the client.
   * @param filter - Additional filter criteria.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to an array of user documents.
   */
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

  /**
   * Get users with a specific role for a client
   *
   * @param cuid - The client CUID
   * @param role - The role to filter by
   * @param opts - Additional options for the query
   * @returns A promise that resolves to an array of user documents with the specified role
   */
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

  /**
   * Get users filtered by type (employee, tenant, vendor) and other criteria
   *
   * @param cuid - The client CUID
   * @param filterOptions - Options to filter users by (type, role, department, status, search)
   * @param paginationOpts - Pagination and sorting options
   * @returns A promise that resolves to an array of filtered user documents with pagination info
   */
  async getUsersByFilteredType(
    cuid: string,
    filterOptions: IUserFilterOptions,
    paginationOpts?: IFindOptions
  ): Promise<ListResultWithPagination<IUserDocument[]>> {
    try {
      const { role, department, status } = filterOptions;

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

      const pipeline: PipelineStage[] = [
        { $match: query },
        {
          $lookup: {
            from: 'profiles',
            localField: '_id',
            foreignField: 'user',
            as: 'profile',
          },
        },
        { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
      ];

      // Apply strict role filtering in aggregation pipeline
      // if (role) {
      //   const requestedRoles = Array.isArray(role) ? role : [role];
      //   pipeline.push(
      //     // Add a field to check if user's roles are strictly within requested roles
      //     {
      //       $addFields: {
      //         clientConnection: {
      //           $filter: {
      //             input: '$cuids',
      //             as: 'c',
      //             cond: {
      //               $and: [{ $eq: ['$$c.cuid', cuid] }, { $eq: ['$$c.isConnected', true] }],
      //             },
      //           },
      //         },
      //       },
      //     },
      //     {
      //       $match: {
      //         $expr: {
      //           $and: [
      //             // Must have the client connection
      //             { $gt: [{ $size: '$clientConnection' }, 0] },
      //             // All roles must be within requested roles (strict subset)
      //             {
      //               $setIsSubset: [
      //                 { $arrayElemAt: ['$clientConnection.roles', 0] },
      //                 requestedRoles,
      //               ],
      //             },
      //             // Must have at least one of the requested roles
      //             {
      //               $gt: [
      //                 {
      //                   $size: {
      //                     $setIntersection: [
      //                       { $arrayElemAt: ['$clientConnection.roles', 0] },
      //                       requestedRoles,
      //                     ],
      //                   },
      //                 },
      //                 0,
      //               ],
      //             },
      //           ],
      //         },
      //       },
      //     },
      //     // Clean up the temporary field
      //     {
      //       $project: {
      //         clientConnection: 0,
      //       },
      //     }
      //   );
      // }

      if (department) {
        pipeline.push({
          $match: {
            'profile.employeeInfo.department': department,
          },
        });
      }

      pipeline.push({
        $project: {
          password: 0,
          activationToken: 0,
          passwordResetToken: 0,
          activationTokenExpiresAt: 0,
          passwordResetTokenExpiresAt: 0,
          'profile.__v': 0,
        },
      });

      // Handle pagination
      const limit = paginationOpts?.limit || 10;
      const skip = paginationOpts?.skip || 0;
      const sort = paginationOpts?.sort || 'desc';
      const sortBy = paginationOpts?.sortBy || 'createdAt';

      const countPipeline = [...pipeline, { $count: 'total' }];

      pipeline.push(
        { $sort: { [sortBy]: sort === 'desc' ? -1 : 1 } },
        { $skip: skip },
        { $limit: limit }
      );

      const [users, countResult] = await Promise.all([
        this.aggregate(pipeline),
        this.aggregate(countPipeline),
      ]);

      const total = countResult.length > 0 ? (countResult[0] as any).total : 0;
      const pagination = paginateResult(total, skip, limit);

      return {
        items: users,
        pagination,
      };
    } catch (error) {
      this.logger.error(`Error getting filtered users for client ${cuid}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Search for users by name, email, or other criteria.
   *
   * @param query - The search query string.
   * @param clientId - The ID of the client context to search within.
   * @returns A promise that resolves to an array of matching user documents.
   */
  async searchUsers(query: string, clientId: string): Promise<IUserDocument[]> {
    try {
      const searchPipeline: PipelineStage[] = [
        {
          $match: {
            $and: [
              { 'cuids.cuid': clientId },
              { 'cuids.isConnected': true },
              { deletedAt: null },
              {
                $or: [
                  { firstName: { $regex: query, $options: 'i' } },
                  { lastName: { $regex: query, $options: 'i' } },
                  { email: { $regex: query, $options: 'i' } },
                  { phoneNumber: { $regex: query, $options: 'i' } },
                ],
              },
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

      return await this.aggregate(searchPipeline);
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Check if an email address is already in use.
   *
   * @param email - The email address to check.
   * @returns A promise that resolves to true if the email is unique, false otherwise.
   */
  async isEmailUnique(email: string): Promise<boolean> {
    try {
      const user = await this.getActiveUserByEmail(email);
      return !user;
    } catch (error) {
      this.logger.error(error.message || error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Remove a client association from a user.
   *
   * @param userId - The ID of the user.
   * @param clientId - The ID of the client to remove association with.
   * @returns A promise that resolves to true if the association was removed successfully.
   */
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

  /**
   * Get all client associations for a user.
   *
   * @param userId - The ID of the user.
   * @returns A promise that resolves to an array of client associations.
   */
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

  /**
   * Reset a user's password using a token.
   *
   * @param token - The password reset token.
   * @param newPassword - The new password.
   * @returns A promise that resolves to true if the password was reset successfully, false otherwise.
   */
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

  /**
   * Create a password reset token for a user.
   *
   * @param email - The email address of the user.
   * @returns A promise that resolves to the reset token or null if the user doesn't exist.
   */
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
        const updateObj: any = {
          'cuids.$.isConnected': true,
          'cuids.$.clientDisplayName': client.clientDisplayName,
          'cuids.$.linkedVendorUid': role === ROLES.VENDOR ? linkedVendorUid : null,
        };

        const updateOperation = existingConnection.roles.includes(role)
          ? { $set: updateObj }
          : { $set: updateObj, $addToSet: { 'cuids.$.roles': role } }; // Add new role

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
      const user = await this.findFirst({
        email: email.toLowerCase(),
        deletedAt: null,
        'cuids.cuid': cuid,
        'cuids.isConnected': true,
      });

      return user;
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
        clientDisplayName: client.clientDisplayName || '',
        linkedVendorUid: userData.role === ROLES.VENDOR && linkedVendorUid ? linkedVendorUid : null,
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

  /**
   * Get all users linked to a primary vendor
   * @param primaryVendorId - The ID of the primary vendor
   * @param cuid - Client ID
   * @param opts - Query options
   * @returns Promise resolving to linked vendor users
   */
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

      return await this.list(query, {
        ...opts,
      });
    } catch (error) {
      this.logger.error(`Error getting linked vendor users for vendor ${vendorUid}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Rebuild missing profiles for users
   * This method identifies users without profiles and creates minimal profiles for them
   * @param cuid - Optional client ID to limit the rebuild scope
   * @returns Promise resolving to rebuild statistics
   */
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

  /**
   * Get tenants by client with filtering and pagination
   * @param cuid - Client unique identifier
   * @param filters - Optional tenant-specific filters
   * @param pagination - Optional pagination parameters
   * @returns Promise resolving to paginated tenant users with tenant-specific data
   */
  async getTenantsByClient(
    cuid: string,
    filters?: import('@interfaces/user.interface').ITenantFilterOptions,
    pagination?: IFindOptions
  ): Promise<import('@interfaces/user.interface').IPaginatedResult<IUserDocument[]>> {
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
        {
          $lookup: {
            from: 'profiles',
            localField: '_id',
            foreignField: 'user',
            as: 'profile',
          },
        },
        { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
      ];

      if (filters) {
        const matchConditions: any = {};

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

      pipeline.push({
        $project: {
          password: 0,
          activationToken: 0,
          passwordResetToken: 0,
          activationTokenExpiresAt: 0,
          passwordResetTokenExpiresAt: 0,
          'profile.__v': 0,
        },
      });

      const limit = pagination?.limit || 10;
      const skip = pagination?.skip || 0;
      const sort = pagination?.sort || 'desc';
      const sortBy = pagination?.sortBy || 'createdAt';

      const countPipeline = [...pipeline, { $count: 'total' }];

      pipeline.push(
        { $sort: { [sortBy]: sort === 'desc' ? -1 : 1 } },
        { $skip: skip },
        { $limit: limit }
      );

      const [tenants, countResult] = await Promise.all([
        this.aggregate(pipeline),
        this.aggregate(countPipeline),
      ]);

      const total = countResult.length > 0 ? (countResult[0] as any).total : 0;

      return {
        items: tenants,
        pagination: {
          total,
          page: Math.floor(skip / limit) + 1,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNext: skip + limit < total,
          hasPrev: skip > 0,
        },
      };
    } catch (error) {
      this.logger.error(`Error getting tenants for client ${cuid}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get tenant statistics for a client
   * @param cuid - Client unique identifier
   * @param filters - Optional tenant filters
   * @returns Promise resolving to tenant statistics
   */
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
        {
          $lookup: {
            from: 'profiles',
            localField: '_id',
            foreignField: 'user',
            as: 'profile',
          },
        },
        { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
      ];

      // Apply filters if provided
      if (filters) {
        const matchConditions: any = {};

        if (filters.status) {
          matchConditions.isActive = filters.status === 'active';
        }

        if (filters.propertyId) {
          matchConditions['profile.tenantInfo.activeLease.propertyId'] = filters.propertyId;
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
            activeLeases: {
              $sum: {
                $cond: [{ $ne: ['$profile.tenantInfo.activeLease', null] }, 1, 0],
              },
            },
            totalRent: {
              $sum: {
                $ifNull: ['$profile.tenantInfo.activeLease.rentAmount', 0],
              },
            },
            backgroundCheckDistribution: {
              $push: '$profile.tenantInfo.backgroundCheckStatus',
            },
            propertyDistribution: {
              $push: {
                propertyId: '$profile.tenantInfo.activeLease.propertyId',
                rentAmount: '$profile.tenantInfo.activeLease.rentAmount',
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            total: 1,
            activeLeases: 1,
            expiredLeases: { $subtract: ['$total', '$activeLeases'] },
            pendingLeases: { $literal: 0 }, // This would need additional logic based on lease dates
            rentStatus: {
              current: '$activeLeases', // Simplified - would need payment data
              late: { $literal: 0 },
              overdue: { $literal: 0 },
            },
            averageRent: {
              $cond: [
                { $gt: ['$activeLeases', 0] },
                { $divide: ['$totalRent', '$activeLeases'] },
                0,
              ],
            },
            occupancyRate: {
              $cond: [
                { $gt: ['$total', 0] },
                { $multiply: [{ $divide: ['$activeLeases', '$total'] }, 100] },
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

      // Process property distribution
      const propertyMap = new Map<string, { count: number; totalRent: number; name?: string }>();

      for (const prop of stats.distributionByProperty || []) {
        if (prop.propertyId) {
          const existing = propertyMap.get(prop.propertyId) || {
            count: 0,
            totalRent: 0,
            name: `Property ${prop.propertyId}`,
          };
          existing.count++;
          existing.totalRent += prop.rentAmount || 0;
          propertyMap.set(prop.propertyId, existing);
        }
      }

      stats.distributionByProperty = Array.from(propertyMap.entries()).map(([id, data]) => ({
        propertyId: id,
        propertyName: data.name,
        tenantCount: data.count,
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
            'cuids.isConnected': true,
            deletedAt: null,
          },
        },
        {
          $lookup: {
            from: 'profiles',
            localField: '_id',
            foreignField: 'user',
            as: 'profile',
          },
        },
        { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            uid: 1,
            email: 1,
            isActive: 1,
            createdAt: 1,
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

      // TODO: In a real implementation, you would fetch additional data from other collections:
      // - Lease history from a leases collection
      // - Payment history from a payments collection
      // - Maintenance requests from a maintenance collection
      // - Notes from a tenant_notes collection

      return tenant as import('@interfaces/user.interface').IClientTenantDetails;
    } catch (error) {
      this.logger.error(
        `Error getting tenant details for client ${cuid}, tenant ${tenantUid}:`,
        error
      );
      throw this.throwErrorHandler(error);
    }
  }
}
