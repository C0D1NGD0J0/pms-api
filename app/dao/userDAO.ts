import dayjs from 'dayjs';
import Logger from 'bunyan';
import { User } from '@models/index';
import { hashGenerator, createLogger } from '@utils/index';
import { PipelineStage, FilterQuery, Types, Model } from 'mongoose';
import { IUserRoleType, IUserDocument } from '@interfaces/user.interface';
import { ListResultWithPagination, IInvitationDocument } from '@interfaces/index';

import { BaseDAO } from './baseDAO';
import { IUserDAO } from './interfaces/userDAO.interface';
import { IFindOptions, dynamic } from './interfaces/baseDAO.interface';

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
    cuid: string,
    invitationData: IInvitationDocument,
    userData: any,
    linkedVendorId?: string,
    session?: any
  ): Promise<IUserDocument> {
    try {
      const userId = new Types.ObjectId();

      const cuidEntry: any = {
        cuid,
        isConnected: true,
        roles: [invitationData.role],
        displayName:
          invitationData.personalInfo.firstName + ' ' + invitationData.personalInfo.lastName,
      };

      if (linkedVendorId) {
        cuidEntry.linkedVendorId = linkedVendorId;
      }

      const user = await this.insert(
        {
          _id: userId,
          uid: hashGenerator({}),
          email: invitationData.inviteeEmail,
          password: userData.password,
          isActive: true,
          activecuid: cuid,
          cuids: [cuidEntry],
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
    clientId: string,
    role: IUserRoleType,
    displayName: string,
    session?: any,
    linkedVendorId?: string
  ): Promise<IUserDocument | null> {
    try {
      // Check if user already has access to this client
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const existingConnection = user.cuids.find((c) => c.cuid === clientId);
      if (existingConnection) {
        const updateObj: any = {
          'cuids.$.isConnected': true,
          'cuids.$.roles': [role],
          'cuids.$.displayName': displayName,
        };

        // Add linkedVendorId if provided
        if (linkedVendorId && role === 'vendor') {
          updateObj['cuids.$.linkedVendorId'] = linkedVendorId;
        }

        return await this.updateById(userId, { $set: updateObj }, { session });
      } else {
        // Create cuid entry
        const cuidEntry: any = {
          cuid: clientId,
          isConnected: true,
          roles: [role],
          displayName,
        };

        // Add linkedVendorId if provided
        if (linkedVendorId && role === 'vendor') {
          cuidEntry.linkedVendorId = linkedVendorId;
        }

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
}
