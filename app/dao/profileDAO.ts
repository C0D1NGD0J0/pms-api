import Logger from 'bunyan';
import { v4 as uuid } from 'uuid';
import { generateShortUID, createLogger } from '@utils/index';
import { IProfileDocument } from '@interfaces/profile.interface';
import { Types, Model, FilterQuery, ClientSession } from 'mongoose';

import { BaseDAO } from './baseDAO';
import { IProfileDAO } from './interfaces/index';

export class ProfileDAO extends BaseDAO<IProfileDocument> implements IProfileDAO {
  protected logger: Logger;

  constructor({ profileModel }: { profileModel: Model<IProfileDocument> }) {
    super(profileModel);
    this.logger = createLogger('ProfileDAO');
  }

  /**
   * @inheritdoc
   */
  async updateAvatar(
    profileId: string,
    avatarData: { url: string; filename?: string; key?: string }
  ): Promise<IProfileDocument | null> {
    try {
      return await this.updateById(profileId, { $set: { avatar: avatarData } });
    } catch (error) {
      this.logger.error(`Error updating avatar for profile ${profileId}:`, error);
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
      name?: string;
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
        updateFields['notifications.messages'] = preferences.messages;
      }

      if (preferences.comments !== undefined) {
        updateFields['notifications.comments'] = preferences.comments;
      }

      if (preferences.announcements !== undefined) {
        updateFields['notifications.announcements'] = preferences.announcements;
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

      const data = {
        ...profileData,
        user: objectId,
        puid: generateShortUID(uuid()),
      };

      return await this.insert(data as Partial<IProfileDocument>, session);
    } catch (error) {
      this.logger.error(`Error creating profile for user ${userId}:`, error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async searchProfiles(searchTerm: string, limit = 10): Promise<IProfileDocument[]> {
    try {
      // Create a text search filter
      const filter: FilterQuery<IProfileDocument> = {
        $or: [
          { bio: { $regex: searchTerm, $options: 'i' } },
          { headline: { $regex: searchTerm, $options: 'i' } },
          { user: { $regex: searchTerm, $options: 'i' } },
        ],
      };

      return await this.list(filter, { limit });
    } catch (error) {
      this.logger.error(`Error searching profiles with term "${searchTerm}":`, error);
      throw this.throwErrorHandler(error);
    }
  }
}

export default ProfileDAO;
