import { Document, Types } from 'mongoose';

import {
  IdentificationType,
  IContactInfoType,
  IUserRoleType,
  IUserDocument,
  IAccountType,
} from './user.interface';

// CLIENT
export interface IClient {
  identification?: IdentificationType;
  subscription: Types.ObjectId | null;
  companyProfile?: ICompanyProfile;
  lastModifiedBy: Types.ObjectId;
  accountAdmin: Types.ObjectId;
  settings: IClientSettings;
  accountType: IAccountType;
  displayName: string;
}

export interface ICompanyProfile {
  contactInfo?: IContactInfoType;
  registrationNumber?: string;
  legalEntityName?: string;
  companyPhone?: string;
  companyEmail?: string;
  tradingName?: string;
  industry?: string;
  website?: string;
}
export interface IClientDocument extends Document, IClient {
  verifiedBy: string | Types.ObjectId;
  isVerified: boolean;
  _id: Types.ObjectId;
  deletedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  cid: string;
  id: string;
}

export interface IClientSettings {
  notificationPreferences: {
    email: boolean;
    sms: boolean;
    inApp: boolean;
  };
  timeZone: string;
  lang: string;
}

export interface IClientUserConnections {
  roles: IUserRoleType[];
  isConnected: boolean;
  displayName: string;
  cid: string;
}

export type IPopulatedClientDocument = {
  admin: IUserDocument | Types.ObjectId;
} & Omit<IClientDocument, 'admin'>;
