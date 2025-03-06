import { Types, FilterQuery } from 'mongoose';
import { ISignupData, IInviteUserSignup } from '@interfaces/index';
import { IUserRoleType, IUserDocument } from '@interfaces/user.interface';

import { IBaseDAO, dynamic } from './baseDAO.interface';

/**
 * The UserDAO interface defines data access methods for user operations in a property management system.
 */
export interface IUserDAO extends IBaseDAO<IUserDocument> {
  /**
   * Get users associated with a specific client.
   *
   * @param clientId - The ID of the client.
   * @param filter - Additional filter criteria.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to an array of user documents.
   */
  getUsersByClientId(
    clientId: string,
    filter?: FilterQuery<IUserDocument>,
    opts?: dynamic
  ): Promise<IUserDocument[]>;

  /**
   * Associate a user with a client (multi-tenant functionality).
   *
   * @param userId - The ID of the user.
   * @param clientId - The ID of the client to associate with.
   * @param role - The role of the user for this client.
   * @returns A promise that resolves to true if the association was created successfully.
   */
  associateUserWithClient(
    userId: string | Types.ObjectId,
    clientId: string,
    role: IUserRoleType
  ): Promise<boolean>;

  /**
   * Update a user's information.
   *
   * @param userId - The ID of the user to update.
   * @param updates - The fields to update and their new values.
   * @returns A promise that resolves to the updated user document or null if no user is found.
   */
  updateUser(
    userId: string | Types.ObjectId,
    updates: Partial<IUserDocument>
  ): Promise<IUserDocument | null>;

  /**
   * Remove a client association from a user.
   *
   * @param userId - The ID of the user.
   * @param clientId - The ID of the client to remove association with.
   * @returns A promise that resolves to true if the association was removed successfully.
   */
  removeClientAssociation(userId: string | Types.ObjectId, clientId: string): Promise<boolean>;

  /**
   * Get a user by ID.
   *
   * @param id - The ID of the user.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to the found user document or null if no user is found.
   */
  getUserById(id: Types.ObjectId | string, opts?: dynamic): Promise<IUserDocument | null>;

  /**
   * Verify user credentials for authentication.
   *
   * @param email - The user's email address.
   * @param password - The user's password.
   * @returns A promise that resolves to the user document if credentials are valid, or null otherwise.
   */
  verifyCredentials(email: string, password: string): Promise<IUserDocument | null>;

  /**
   * List users with optional filtering and projection.
   *
   * @param query - Filter criteria for the query.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to an array of user documents.
   */
  listUsers(query: Record<string, any>, opts?: dynamic): Promise<IUserDocument[]>;

  /**
   * Get all client associations for a user.
   *
   * @param userId - The ID of the user.
   * @returns A promise that resolves to an array of client associations.
   */
  getUserClientAssociations(userId: string | Types.ObjectId): Promise<unknown[]>;

  /**
   * Get a user by email address.
   *
   * @param email - The email address of the user.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to the found user document or null if no user is found.
   */
  getUserByEmail(email: string, opts?: dynamic): Promise<IUserDocument | null>;

  /**
   * Get a user by UID.
   *
   * @param uid - The UID of the user.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to the found user document or null if no user is found.
   */
  getUserByUId(uid: string, opts?: dynamic): Promise<IUserDocument | null>;

  /**
   * Generate and save an activation token for a user.
   *
   * @param userId - The ID of the user to generate a token for.
   * @returns A promise that resolves to the generated token.
   */
  createActivationToken(userId: string | Types.ObjectId): Promise<string>;

  /**
   * Search for users by name, email, or other criteria.
   *
   * @param query - The search query string.
   * @param clientId - The ID of the client context to search within.
   * @returns A promise that resolves to an array of matching user documents.
   */
  searchUsers(query: string, clientId: string): Promise<IUserDocument[]>;

  /**
   * Reset a user's password using a token.
   *
   * @param token - The password reset token.
   * @param newPassword - The new password.
   * @returns A promise that resolves to true if the password was reset successfully, false otherwise.
   */
  resetPassword(token: string, newPassword: string): Promise<boolean>;

  /**
   * Generate and save a password reset token for a user.
   *
   * @param email - The email address of the user requesting a password reset.
   * @returns A promise that resolves to the generated token or null if user not found.
   */
  createPasswordResetToken(email: string): Promise<string | null>;

  /**
   * Create a new user account.
   *
   * @param userData - The user data for creating a new account.
   * @returns A promise that resolves to the created user document.
   */
  createUser(userData: ISignupData): Promise<IUserDocument>;

  /**
   * Get the currently authenticated user by their ID with complete profile information.
   *
   * @param userId - The ID of the currently authenticated user.
   * @returns A promise that resolves to the found user document or null if no user is found.
   */
  // getCurrentUser(userId: string): Promise<unknown | null>;

  /**
   * Activate a user account using a token.
   *
   * @param token - The activation token.
   * @returns A promise that resolves to true if activation was successful, false otherwise.
   */
  activateAccount(token: string): Promise<boolean>;

  /**
   * Check if an email address is already in use.
   *
   * @param email - The email address to check.
   * @returns A promise that resolves to true if the email is unique, false otherwise.
   */
  isEmailUnique(email: string): Promise<boolean>;
}
