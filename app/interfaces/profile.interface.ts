import { Data } from 'ejs';
import { Types, Document } from 'mongoose';

import { IdentificationType } from './user.interface';

enum DataRetentionPolicy {
  STANDARD = 'standard',
  EXTENDED = 'extended',
  MINIMAL = 'minimal',
}

export interface Profile {
  personalInfo: {
    phoneNumber?: string;
    displayName: string;
    firstName: string;
    location: string;
    lastName: string;
    avatar?: {
      url: string;
      filename: string;
      key: string;
    };
    bio?: string;
    dob?: Date;
    headline?: string;
  };
  settings: {
    loginType: 'otp' | 'password';
    theme: 'light' | 'dark';
    notifications: NotificationSettings;
    gdprSettings: GDPRSettings;
  };
  identification?: IdentificationType;
  user: Types.ObjectId;
  timeZone: string;
  lang: string;
}

export type IProfileDocument = {
  id: string;
  puid: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  fullname?: string;
  getGravatarUrl: () => string;
  _id: Types.ObjectId;
} & Document &
  Profile;

export interface GDPRSettings {
  dataRetentionPolicy: DataRetentionPolicy;
  dataProcessingConsent: boolean;
  processingConsentDate: Date;
  retentionExpiryDate: Date;
}

export interface NotificationSettings {
  announcements: boolean;
  messages: boolean;
  comments: boolean;
}
