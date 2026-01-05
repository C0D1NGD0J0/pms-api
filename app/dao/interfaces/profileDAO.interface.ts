import { ClientSession, Types } from 'mongoose';
import { IProfileDocument } from '@interfaces/profile.interface';
import { ListResultWithPagination, ICurrentUser } from '@interfaces/index';

import { IFindOptions, IBaseDAO } from './baseDAO.interface';

export interface IProfileDAO extends IBaseDAO<IProfileDocument> {
  /**
   * Updates notification preferences for a profile.
   *
   * @param profileId - The ID of the profile to update
   * @param preferences - Object containing notification preferences
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateNotificationPreferences(
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
  ): Promise<IProfileDocument | null>;

  /**
   * Updates identification documents for a profile.
   *
   * @param profileId - The ID of the profile to update
   * @param identificationData - Object containing identification details
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateIdentification(
    profileId: string,
    identificationData: {
      idType: string;
      issueDate: Date;
      expiryDate: Date;
      idNumber: string;
      authority?: string;
      issuingState: string;
    }
  ): Promise<IProfileDocument | null>;

  /**
   * Updates vendor reference information (vendorId, linkedVendorUid, isLinkedAccount).
   * Note: Vendor business data is now stored in the vendor collection.
   * This method only updates vendor reference fields in the profile.
   *
   * @param profileId - The ID of the profile to update
   * @param vendorReference - Object containing vendor reference fields
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateVendorReference(
    profileId: string,
    vendorReference: { vendorId?: string; linkedVendorUid?: string; isLinkedAccount?: boolean }
  ): Promise<IProfileDocument | null>;

  /**
   * Creates a new profile for a user.
   *
   * @param userId - The ID of the user
   * @param profileData - Initial profile data
   * @param session - Optional MongoDB session for transactions
   * @returns A promise that resolves to the created profile
   */
  createUserProfile(
    userId: string | Types.ObjectId,
    profileData: Partial<IProfileDocument>,
    session?: ClientSession
  ): Promise<IProfileDocument>;

  /**
   * Updates GDPR settings for a profile.
   *
   * @param profileId - The ID of the profile to update
   * @param gdprSettings - Object containing GDPR settings
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateGDPRSettings(
    profileId: string,
    gdprSettings: Partial<IProfileDocument['settings']['gdprSettings']>
  ): Promise<IProfileDocument | null>;

  /**
   * Updates personal information for a profile.
   *
   * @param profileId - The ID of the profile to update
   * @param personalInfo - Object containing personal information fields
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updatePersonalInfo(
    profileId: string,
    personalInfo: Partial<IProfileDocument['personalInfo']>
  ): Promise<IProfileDocument | null>;

  /**
   * Updates avatar for a profile.
   *
   * @param profileId - The ID of the profile to update
   * @param avatarData - Object containing avatar url, filename, and key
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateAvatar(
    profileId: string,
    avatarData: { url: string; filename?: string; key?: string }
  ): Promise<IProfileDocument | null>;

  /**
   * Clears role-specific information for a specific client.
   * Now only removes linkedVendorUid if it exists.
   *
   * @param profileId - The ID of the profile to update
   * @param cuid - The client ID
   * @param roleType - The type of role information to clear ('employee' or 'vendor')
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  clearRoleSpecificInfo(
    profileId: string,
    cuid: string,
    roleType: 'employee' | 'vendor'
  ): Promise<IProfileDocument | null>;

  /**
   * Updates employee information.
   * Now directly updates the top-level employeeInfo field.
   *
   * @param profileId - The ID of the profile to update
   * @param cuid - The client ID (preserved for API compatibility)
   * @param employeeInfo - Object containing employee information fields
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateEmployeeInfo(
    profileId: string,
    cuid: string,
    employeeInfo: Record<string, any>
  ): Promise<IProfileDocument | null>;

  /**
   * Updates locale settings (timezone and language) for a profile.
   *
   * @param profileId - The ID of the profile to update
   * @param settings - Object containing timezone and language settings
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateLocaleSettings(
    profileId: string,
    settings: { timeZone?: string; lang?: string }
  ): Promise<IProfileDocument | null>;

  /**
   * Updates vendor information for a profile and client.
   * For primary vendors (no linkedVendorUid), updates the top-level vendorInfo.
   * For linked vendors, only updates the linkedVendorUid reference.
   *
   * @param profileId - The ID of the profile to update
   * @param cuid - The client ID
   * @param vendorInfo - Object containing vendor information fields
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateVendorInfo(
    profileId: string,
    cuid: string,
    vendorInfo: Record<string, any>
  ): Promise<IProfileDocument | null>;

  /**
   * Updates common employee information that applies across all clients.
   * This information is stored at the profile level.
   *
   * @param profileId - The ID of the profile to update
   * @param employeeInfo - Object containing common employee information fields
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateCommonEmployeeInfo(
    profileId: string,
    employeeInfo: Record<string, any>
  ): Promise<IProfileDocument | null>;

  /**
   * Gets profile information only, without role data.
   * Role data should be fetched and combined at the service layer.
   *
   * @param profileId - The ID of the profile
   * @returns A promise that resolves to an object containing profile info, or null if not found
   */
  getProfileInfo(profileId: string): Promise<{
    vendorInfo?: any;
    employeeInfo?: any;
    userId?: string;
  } | null>;

  /**
   * Finds profiles matching the search criteria.
   *
   * @param searchTerm - Term to search for in displayName, firstName, lastName, etc.
   * @param limit - Maximum number of profiles to return
   * @returns A promise that resolves to an array of matching profiles
   */
  searchProfiles(
    searchTerm: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IProfileDocument[]>;

  /**
   * Gets notification preferences for a user by their user ID.
   *
   * @param userId - The user ID to get preferences for
   * @returns A promise that resolves to notification preferences or null if not found
   */
  getNotificationPreferences(
    userId: string
  ): Promise<IProfileDocument['settings']['notifications'] | null>;

  /**
   * Updates login type for a profile.
   *
   * @param profileId - The ID of the profile to update
   * @param loginType - The login type preference ('otp' or 'password')
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateLoginType(
    profileId: string,
    loginType: 'otp' | 'password'
  ): Promise<IProfileDocument | null>;

  /**
   * Updates theme settings for a profile.
   *
   * @param profileId - The ID of the profile to update
   * @param theme - The theme preference ('light' or 'dark')
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateTheme(profileId: string, theme: 'light' | 'dark'): Promise<IProfileDocument | null>;

  /**
   * Gets a profile by user ID.
   *
   * @param userId - The ID of the associated user
   * @returns A promise that resolves to the found profile or null if not found
   */
  getProfileByUserId(userId: string | Types.ObjectId): Promise<IProfileDocument | null>;

  /**
   * Retrieves the currently authenticated user along with their profile information.
   * Uses MongoDB aggregation to join user data with their profile data and formats it into a CurrentUser object.
   *
   * @param userId - The unique identifier for the user.
   * @param activecuid - The active client/company ID (optional).
   * @returns A promise that resolves to a ICurrentUser object or null if no user is found.
   */
  generateCurrentUserInfo(userId: string): Promise<ICurrentUser | null>;

  /**
   * Gets the user ID associated with a profile.
   *
   * @param profileId - The ID of the profile
   * @returns A promise that resolves to the user ID or null if profile not found
   */
  getProfileUserId(profileId: string): Promise<string | null>;
}
