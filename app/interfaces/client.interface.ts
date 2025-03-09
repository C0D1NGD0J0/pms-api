import { Types, Document } from 'mongoose';

import {
  IUserRoleType,
  IUserDocument,
  IdentificationType,
  IContactInfoType,
} from './user.interface';

// CLIENT
export interface IClientDocument extends Document {
  accountType: {
    planId: string;
    planName: string;
    isEnterpriseAccount: boolean;
  };
  identification?: IdentificationType;
  subscription: Types.ObjectId | null;
  accountAdmin: Types.ObjectId;
  companyInfo?: ICompanyInfo;
  settings: IClientSettings;
  isVerified: boolean;
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  cid: string;
  id: string;
}

export interface IClientUpdateData {
  identification?: IdentificationType;
  businessRegistrationNumber: string;
  contactInfo?: IContactInfoType;
  legalEntityName: string;
  subscription?: string;
  companyName: string;
  userId?: string;
  admin?: string;
}

export interface ICompanyInfo {
  contactInfo?: IContactInfoType;
  registrationNumber: string;
  yearEstablished: number;
  legalEntityName: string;
  businessType: string;
  tradingName: string;
  industry: string;
  website: string;
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

export type IPopulatedClientDocument = {
  admin: IUserDocument | Types.ObjectId;
} & Omit<IClientDocument, 'admin'>;

export interface IClientUserConnections {
  roles: IUserRoleType[];
  isConnected: boolean;
  cid: string;
}
