import { Types, Document } from 'mongoose';

import { IdentificationType } from './user.interface';

export interface Profile {
  avatar?: {
    url: string;
    filename: string;
    key: string;
  };
  notifications: NotificationSettings;
  identification?: IdentificationType;
  user: Types.ObjectId;
  headline?: string;
  timeZone: string;
  lang: string;
  bio?: string;
  dob?: Date;
}

export type IProfileDocument = {
  id: string;
  puid: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  _id: Types.ObjectId;
} & Document &
  Profile;

export interface NotificationSettings {
  announcements: boolean;
  messages: boolean;
  comments: boolean;
}
