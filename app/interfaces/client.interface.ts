import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import {
  IdentificationType,
  IContactInfoType,
  IUserDocument,
  IAccountType,
} from './user.interface';

/**
 * Main Client Interface
 */
export interface IClient {
  accountAdmin: Types.ObjectId | PopulatedAccountAdmin;
  identification?: IdentificationType;
  subscription: Types.ObjectId | null;
  companyProfile?: ICompanyProfile;
  lastModifiedBy: Types.ObjectId;
  settings: IClientSettings;
  accountType: IAccountType;
  displayName: string;
}

/**
 * Company Profile Interface
 */
export interface ICompanyProfile {
  contactInfo?: IContactInfoType;
  registrationNumber?: string;
  legalEntityName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  tradingName?: string;
  industry?: string;
  website?: string;
}

/**
 * Client Document Interface (extends Mongoose Document)
 */
export interface IClientDocument extends Document, IClient {
  verifiedBy: string | Types.ObjectId;
  isVerified: boolean;
  _id: Types.ObjectId;
  deletedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  cuid: string;
  id: string;
}

/**
 * Client User Connections Interface
 * Represents the connection between a user and a client
 */
export interface IClientUserConnections {
  clientDisplayName: string;
  linkedVendorUid?: string;
  roles: IUserRoleType[];
  isConnected: boolean;
  cuid: string;
}

/**
 * Client Settings Interface
 */
export interface IClientSettings {
  notificationPreferences: {
    email: boolean;
    sms: boolean;
    inApp: boolean;
  };
  timeZone: string;
  lang: string;
}

/**
 * Populated Account Admin Type
 */
export type PopulatedAccountAdmin = {
  _id: Types.ObjectId;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
};

/**
 * Populated Client Document Type
 * Using Omit to replace admin field type
 */
export type IPopulatedClientDocument = {
  accountAdmin: IUserDocument | Types.ObjectId;
} & Omit<IClientDocument, 'accountAdmin'>;

/**
 * Simplified client info for passing around client context
 * Using Pick to select only needed fields
 */
export type IClientInfo = {
  clientDisplayName: string;
  id?: string;
} & Pick<IClientDocument, 'cuid'>;

/**
 * Type for active account info (used in auth responses)
 * Already using Pick efficiently
 */
export type IActiveAccountInfo = Pick<IClientUserConnections, 'cuid' | 'clientDisplayName'>;

/**
 * Client Statistics Interface
 */
export interface IClientStats {
  totalProperties: number;
  totalUsers: number;
}
