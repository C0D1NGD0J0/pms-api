import dayjs from 'dayjs';
import Logger from 'bunyan';
import { v4 as uuid } from 'uuid';
import { ISignupData } from '@interfaces/index';
import { Types, PipelineStage, Model, FilterQuery } from 'mongoose';
import { IUserRoleType, IUserDocument } from '@interfaces/user.interface';
import { hashGenerator, generateShortUID, createLogger } from '@utils/index';

import { BaseDAO } from './baseDAO';
import { dynamic } from './interfaces/baseDAO.interface';
import { IUserDAO } from './interfaces/userDAO.interface';

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
  async getUserById(id: string, opts?: dynamic): Promise<IUserDocument | null> {
    try {
      if (!id) {
        throw new Error('UserID missing.');
      }

      const query = { _id: new Types.ObjectId(id) };
      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error(error);
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
      this.logger.error(error);
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
  async listUsers(query: Record<string, any>, opts?: dynamic): Promise<IUserDocument[]> {
    try {
      return await this.list(query, opts);
    } catch (error) {
      this.logger.error(error);
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
  async getUserByEmail(email: string, opts?: dynamic): Promise<IUserDocument | null> {
    try {
      const query = { email, deletedAt: null };
      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Create a new user account.
   *
   * @param userData - The user data for creating a new account.
   * @returns A promise that resolves to the created user document.
   */
  async createUser(userData: ISignupData): Promise<IUserDocument> {
    try {
      const newUser = {
        ...userData,
        isActive: false,
        uid: generateShortUID(uuid()),
        activationToken: hashGenerator(),
        activationTokenExpiresAt: dayjs().add(2, 'hour').toDate(),
      };

      const user = this.insert(newUser);
      return user;
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update a user's information.
   *
   * @param userId - The ID of the user to update.
   * @param updates - The fields to update and their new values.
   * @returns A promise that resolves to the updated user document or null if no user is found.
   */
  async updateUser(userId: string, updates: Partial<IUserDocument>): Promise<IUserDocument | null> {
    try {
      return await this.updateById(userId, { $set: updates });
    } catch (error) {
      this.logger.error(error);
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
      const user = await this.getUserByEmail(email);
      if (!user) return null;

      // Use the validatePassword method from the user document
      const isValid = await user.validatePassword(password);
      return isValid ? user : null;
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Generate and save an activation token for a user.
   *
   * @param userId - The ID of the user to generate a token for.
   * @returns A promise that resolves to the generated token.
   */
  async createActivationToken(userId: string): Promise<string> {
    try {
      const token = hashGenerator();
      await this.updateUser(userId, {
        activationToken: token,
        activationTokenExpiresAt: dayjs().add(4, 'hour').toDate(),
      } as Partial<IUserDocument>);

      return token;
    } catch (error) {
      this.logger.error(error);
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
      this.logger.error(error);
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

      const existingAssociation = user.cids.find((c) => c.cid === clientId);
      if (existingAssociation) {
        if (existingAssociation.roles.includes(role) || !existingAssociation.isConnected) {
          await this.update(
            { _id: userId, 'cids.cid': clientId },
            {
              $set: {
                'cids.$.isConnected': true,
              },
              $addToSet: {
                'cids.$.roles': role,
              },
            }
          );
        }
        return true; // Association already exists with same role
      }

      // create new association
      const result = await this.updateById(userId, {
        $push: {
          cids: {
            cid: clientId,
            isConnected: true,
          },
        },
        $addToSet: {
          roles: role,
        },
      });

      return !!result;
    } catch (error) {
      this.logger.error(error);
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
    opts?: dynamic
  ): Promise<IUserDocument[]> {
    try {
      const query = {
        ...filter,
        'cids.cid': clientId,
        'cids.isConnected': true,
        deletedAt: null,
      };

      return await this.list(query, opts);
    } catch (error) {
      this.logger.error(error);
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
              { 'cids.cid': clientId },
              { 'cids.isConnected': true },
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
      this.logger.error(error);
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
      const user = await this.getUserByEmail(email);
      return !user;
    } catch (error) {
      this.logger.error(error);
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
        { $pull: { cids: { cid: clientId } } }
      );

      return !!result;
    } catch (error) {
      this.logger.error(error);
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
      const user = await this.getUserById(userId, { projection: { cids: 1 } });

      if (!user || !user.cids) {
        return [];
      }

      return user.cids;
    } catch (error) {
      this.logger.error(error);
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
  async resetPassword(token: string, newPassword: string): Promise<boolean> {
    try {
      const user = await this.findFirst({
        passwordResetToken: token,
        passwordResetTokenExpiresAt: { $gt: new Date() },
      });

      if (!user) {
        return false;
      }

      user.password = newPassword;
      user.passwordResetToken = '';
      user.passwordResetTokenExpiresAt = null;
      await user.save();
      return !!user;
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Create a password reset token for a user.
   *
   * @param email - The email address of the user.
   * @returns A promise that resolves to the reset token or null if the user doesn't exist.
   */
  async createPasswordResetToken(email: string): Promise<string | null> {
    try {
      const user = await this.getUserByEmail(email);

      if (!user) {
        return null;
      }

      const token = hashGenerator();
      const expiresAt = dayjs().add(2, 'hour').toDate();

      await this.updateById(user._id.toString(), {
        $set: {
          passwordResetToken: token,
          passwordResetTokenExpiresAt: expiresAt,
        },
      });

      return token;
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }
}
