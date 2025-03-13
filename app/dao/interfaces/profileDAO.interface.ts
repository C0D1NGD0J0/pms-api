import { Types, ClientSession } from 'mongoose';
import { IProfileDocument } from '@interfaces/profile.interface';

import { IBaseDAO } from './baseDAO.interface';

export interface IProfileDAO extends IBaseDAO<IProfileDocument> {
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
      name?: string;
    }
  ): Promise<IProfileDocument | null>;

  /**
   * Updates notification preferences for a profile.
   *
   * @param profileId - The ID of the profile to update
   * @param preferences - Object containing notification preferences
   * @returns A promise that resolves to the updated profile or null if profile not found
   */
  updateNotificationPreferences(
    profileId: string,
    preferences: { messages?: boolean; comments?: boolean; announcements?: boolean }
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
   * Updates or creates a profile avatar.
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
   * Finds profiles matching the search criteria.
   *
   * @param searchTerm - Term to search for in bio, headline, etc.
   * @param limit - Maximum number of profiles to return
   * @returns A promise that resolves to an array of matching profiles
   */
  searchProfiles(searchTerm: string, limit?: number): Promise<IProfileDocument[]>;
}
