import { Types, Document } from 'mongoose';

import { IClientUserConnections, IClientDocument } from './client.interface';

export enum IUserRelationshipsEnum {
  parents = 'parents',
  sibling = 'sibling',
  spouse = 'spouse',
  child = 'child',
  other = 'other',
}

export enum IUserRole {
  EMPLOYEE = 'employee',
  MANAGER = 'manager',
  TENANT = 'tenant',
  ADMIN = 'admin',
}

// USER
export enum IAccountType {
  individual = 'individual',
  enterprise = 'enterprise',
}

// USER INTERFACE
export interface IUser {
  emergencyContact?: {
    name: string;
    email?: string;
    phoneNumber: string;
    relationship: IUserRelationshipsEnum;
  };
  passwordResetTokenExpiresAt: Date | number | null;
  activationTokenExpiresAt: Date | number | null;
  passwordResetToken?: string;
  activationToken?: string;
  phoneNumber?: string;
  firstName: string;
  location?: string;
  password: string;
  lastName: string;
  email: string;
}

export interface IUserDocument extends Document, IUser {
  validatePassword: (pwd1: string) => Promise<boolean>;
  cids: IClientUserConnections[]; //
  getGravatar: () => string;
  deletedAt: Date | null;
  _id: Types.ObjectId;
  isActive: boolean;
  fullname?: string;
  createdAt: Date;
  updatedAt: Date;
  cid: string; // active cid
  uid: string;
  id: string;
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
  cid: string;
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
  cid: string;
}

export type IdentificationType = {
  idType: 'passport' | 'national-id' | 'drivers-license' | 'corporation-license';
  idNumber: string;
  authority: string;
  issueDate: Date | string; // or Date if you prefer Date objects
  expiryDate: Date | string; // or Date if you prefer Date objects
  issuingState: string;
};
export interface ICurrentUser {
  isSubscriptionActive?: boolean;
  fullname: string | null;
  linkedAccounts: any[];
  isActive: boolean;
  email: string;
  role: string;
  uid: string;
  cid: string;
  id: string;
}

export type ISignupData = Omit<
  IUser,
  | 'activationToken'
  | 'passwordResetToken'
  | 'activationTokenExpiresAt'
  | 'passwordResetTokenExpiresAt'
> &
  Pick<IClientDocument, 'accountType' | 'companyInfo'>;

export interface ITenantDocument extends Document, ITenant {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type IContactInfoType = {
  email: string;
  address: string;
  phoneNumber: string;
  contactPerson: string;
};

// REFRESH-TOKEN
export interface IRefreshTokenDocument extends Document {
  user: Types.ObjectId;
  token: string;
}

export type IUserRoleType = 'admin' | 'tenant' | 'manager' | 'employee' | 'landlord';

export type IRefreshToken = IRefreshTokenDocument;
