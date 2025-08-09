import { FilterQuery, Types } from 'mongoose';
import { ListResultWithPagination } from '@interfaces/index';
import { IUserRoleType, IUserDocument } from '@interfaces/user.interface';

import { IFindOptions, IBaseDAO, dynamic } from './baseDAO.interface';

/**
 * The UserDAO interface defines data access methods for user operations in a property management system.
 */
export interface IUserDAO extends IBaseDAO<IUserDocument> {
  /**
   * Add an existing user to a client with the specified role.
   *
   * @param userId - The ID of the user
   * @param clientId - The client ID to add user to
   * @param role - The role to assign
   * @param displayName - The display name for this client association
   * @param session - Optional MongoDB session for transactions
   * @param linkedVendorId - Optional ID of vendor to link this user to (for vendor employees)
   * @returns A promise that resolves to the updated user
   */
  addUserToClient(
    userId: string,
    role: IUserRoleType,
    client: { cuid: string; displayName?: string; id: string },
    linkedVendorId?: string,
    session?: any
  ): Promise<IUserDocument | null>;

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
    opts?: IFindOptions
  ): ListResultWithPagination<IUserDocument[]>;

  /**
   * Create a new user from an invitation acceptance.
   *
   * @param invitationData - The invitation data
   * @param userData - The user signup data
   * @param linkedVendorId - Optional ID of vendor to link this user to (for vendor employees)
   * @param session - Optional MongoDB session for transactions
   * @returns A promise that resolves to the created user
   */
  createUserFromInvitation(
    invitationData: any,
    userData: any,
    linkedVendorId?: string,
    session?: any
  ): Promise<IUserDocument>;

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
   * Generate and save an activation token for a user.
   *
   * @param userId - The ID of the user to generate a token for.
   * @returns A promise that resolves to the generated token.
   */
  createActivationToken(
    userId?: string | Types.ObjectId,
    email?: string
  ): Promise<IUserDocument | null>;

  /**
   * List users with optional filtering and projection.
   *
   * @param query - Filter criteria for the query.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to an array of user documents.
   */
  listUsers(
    query: Record<string, any>,
    opts?: IFindOptions
  ): ListResultWithPagination<IUserDocument[]>;

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
  getUserById(id: Types.ObjectId | string, opts?: IFindOptions): Promise<IUserDocument | null>;

  /**
   * Check if a user already exists with the given email and has access to the client.
   *
   * @param email - The email to check
   * @param clientId - The client ID to check access for
   * @returns A promise that resolves to the user if they exist and have access, null otherwise
   */
  getUserWithClientAccess(email: string, clientId: string): Promise<IUserDocument | null>;

  /**
   * Get a user by email address.
   *
   * @param email - The email address of the user.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to the found user document or null if no user is found.
   */
  getActiveUserByEmail(email: string, opts?: dynamic): Promise<IUserDocument | null>;

  /**
   * Verify user credentials for authentication.
   *
   * @param email - The user's email address.
   * @param password - The user's password.
   * @returns A promise that resolves to the user document if credentials are valid, or null otherwise.
   */
  verifyCredentials(email: string, password: string): Promise<IUserDocument | null>;

  /**
   * Reset a user's password using a token.
   *
   * @param token - The password reset token.
   * @param newPassword - The new password.
   * @returns A promise that resolves to true if the password was reset successfully, false otherwise.
   */
  resetPassword(token: string, newPassword: string): Promise<IUserDocument | null>;

  getUserWithProfileByEmailOrId(emailOrId: string): Promise<IUserDocument | null>;

  /**
   * Get the currently authenticated user by their ID with complete profile information.
   *
   * @param userId - The ID of the currently authenticated user.
   * @returns A promise that resolves to the found user document or null if no user is found.
   */
  // getCurrentUser(userId: string): Promise<unknown | null>;

  /**
   * Get all client associations for a user.
   *
   * @param userId - The ID of the user.
   * @returns A promise that resolves to an array of client associations.
   */
  getUserClientAssociations(userId: string | Types.ObjectId): Promise<unknown[]>;

  /**
   * Get a user by UID.
   *
   * @param uid - The UID of the user.
   * @param opts - Additional options for the query.
   * @returns A promise that resolves to the found user document or null if no user is found.
   */
  getUserByUId(uid: string, opts?: dynamic): Promise<IUserDocument | null>;

  /**
   * Search for users by name, email, or other criteria.
   *
   * @param query - The search query string.
   * @param clientId - The ID of the client context to search within.
   * @returns A promise that resolves to an array of matching user documents.
   */
  searchUsers(query: string, clientId: string): Promise<IUserDocument[]>;

  /**
   * Generate and save a password reset token for a user.
   *
   * @param email - The email address of the user requesting a password reset.
   * @returns A promise that resolves to the generated token or null if user not found.
   */
  createPasswordResetToken(email: string): Promise<IUserDocument | null>;

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
