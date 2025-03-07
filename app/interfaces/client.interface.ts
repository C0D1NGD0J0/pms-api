import { Types, Document } from 'mongoose';

import { CURRENCIES } from './utils.interface';
import {
  IUserRoleType,
  IUserDocument,
  IdentificationType,
  ContactInfoType,
} from './user.interface';

// CLIENT
export interface IClientDocument extends Document {
  accountType: {
    identification?: IdentificationType;
    isEnterpriseAccount: boolean;
  };
  subscription: Types.ObjectId | null;
  companyInfo?: ICompanyInfo;
  settings: ClientSettings;
  admin: Types.ObjectId;
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  cid: string;
  id: string;
}

export interface IClientUpdateData {
  identification?: IdentificationType;
  businessRegistrationNumber: string;
  contactInfo?: ContactInfoType;
  legalEntityName: string;
  subscription?: string;
  companyName: string;
  userId?: string;
  admin?: string;
}

export interface ICompanyInfo {
  contactInfo?: ContactInfoType;
  registrationNumber: string;
  yearEstablished: number;
  legalEntityName: string;
  businessType: string;
  tradingName: string;
  industry: string;
  website: string;
}

export interface ClientSettings {
  notificationPreferences: {
    email: boolean;
    sms: boolean;
    inApp: boolean;
  };
  currency: CURRENCIES;
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
