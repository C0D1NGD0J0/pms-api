import { Document, Types } from 'mongoose';

import { IProfileDocument, GDPRSettings } from './profile.interface';
import { IClientUserConnections, ICompanyProfile } from './client.interface';

export enum IUserRelationshipsEnum {
  parents = 'parents',
  sibling = 'sibling',
  spouse = 'spouse',
  child = 'child',
  other = 'other',
}

export enum IUserRole {
  MANAGER = 'manager',
  VENDOR = 'vendor',
  TENANT = 'tenant',
  STAFF = 'staff',
  ADMIN = 'admin',
}

export interface IUserDocument extends Document, IUser {
  validatePassword: (pwd1: string) => Promise<boolean>;
  cuids: IClientUserConnections[];
  profile?: IProfileDocument; //virtual property
  deletedAt: Date | null;
  _id: Types.ObjectId;
  activecuid: string; // active cuid
  isActive: boolean;
  fullname?: string; //virtual property
  createdAt: Date;
  updatedAt: Date;
  uid: string;
  id: string;
}

export interface ICurrentUser {
  preferences: {
    theme?: 'light' | 'dark';
    lang?: string;
    timezone?: string;
  };
  client: { cuid: string; displayname: string; role: IUserRoleType };
  clients: IClientUserConnections[];
  fullname: string | null;
  permissions: string[];
  displayName: string;
  gdpr?: GDPRSettings;
  avatarUrl: string;
  isActive: boolean;
  email: string;
  sub: string;
}

export interface IInviteUserSignup {
  emergencyContact?: {
    name: string;
    email?: string;
    phoneNumber: string;
    relationship: IUserRelationshipsEnum;
  };
  userType: IUserRoleType;
  userId?: Types.ObjectId;
  phoneNumber?: string;
  firstName: string;
  location?: string;
  password: string;
  lastName: string;
  email: string;
  cuid: string;
}

// TENANT INTERFACE
export interface ITenant extends IUser {
  activationCode: string | undefined;
  maintenanceRequests?: string[]; // refactor once models have been added
  activeLeaseAgreement?: string;
  leaseAgreements?: string[];
  managedBy: Types.ObjectId;
  paymentRecords?: string[];
  rentalHistory?: string[];
  user: Types.ObjectId;
  activatedAt: Date;
  cuid: string;
}
export type IdentificationType = {
  idType: 'passport' | 'national-id' | 'drivers-license' | 'corporation-license';
  idNumber: string;
  authority: string;
  issueDate: Date | string; // or Date if you prefer Date objects
  expiryDate: Date | string; // or Date if you prefer Date objects
  issuingState: string;
};

export type ISignupData = {
  email: string;
  location: string;
  password: string;
  phoneNumber: string;
  displayName: string;
  firstName: string;
  lastName: string;
  lang: string;
  timeZone?: string;
  companyProfile?: ICompanyProfile;
  accountType: IAccountType;
};

// USER INTERFACE
export interface IUser {
  passwordResetTokenExpiresAt: Date | number | null;
  activationTokenExpiresAt: Date | number | null;
  passwordResetToken?: string;
  activationToken?: string;
  password: string;
  email: string;
}

export interface ITenantDocument extends Document, ITenant {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type IContactInfoType = {
  email: string;
  phoneNumber?: string;
  contactPerson: string;
};

// REFRESH-TOKEN
export interface IRefreshTokenDocument extends Document {
  user: Types.ObjectId;
  token: string;
}

// USER
export interface IAccountType {
  isCorporate: boolean;
  planName: string;
  planId: string;
}

export type IUserRoleType = 'admin' | 'tenant' | 'manager' | 'staff' | 'landlord' | 'vendor';

export type IRefreshToken = IRefreshTokenDocument;
