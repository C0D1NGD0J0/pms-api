import { Types, Document } from 'mongoose';

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
  enterpriseProfile?: IEnterpriseInfo;
  passwordResetToken?: string;
  activationToken?: string;
  phoneNumber?: string;
  firstName: string;
  location?: string;
  password: string;
  lastName: string;
  email: string;
  uid: string;
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
// CLIENT
export interface IClientDocument extends Document {
  accountType: {
    planId: string;
    name: string;
    isEnterpriseAccount: boolean;
  };
  subscription: Types.ObjectId | null;
  enterpriseProfile?: IEnterpriseInfo;
  admin: Types.ObjectId;
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  cid: string;
  id: string;
}

export interface IUserDocument extends Document, IUser {
  validatePassword: (pwd1: string) => Promise<boolean>;
  cids: IClientUserConnections[];
  deletedAt: Date | null;
  _id: Types.ObjectId;
  isActive: boolean;
  fullname?: string;
  createdAt: Date;
  updatedAt: Date;
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

export interface ICurrentUser {
  role: IClientUserConnections['role'];
  isSubscriptionActive?: boolean;
  fullname: string | null;
  linkedAccounts: any[];
  isActive: boolean;
  email: string;
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
  Pick<IClientDocument, 'accountType' | 'enterpriseProfile'>;

export interface ITenantDocument extends Document, ITenant {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type IPopulatedClientDocument = {
  admin: IUserDocument | Types.ObjectId;
} & Omit<IClientDocument, 'admin'>;

export type IUserRoleType = 'admin' | 'tenant' | 'manager' | 'employee';
export type IRefreshToken = IRefreshTokenDocument;

type IdentificationType = {
  idType: 'passport' | 'national-id' | 'drivers-license' | 'corporation-license';
  idNumber: string;
  authority: string;
  issueDate: Date | string; // or Date if you prefer Date objects
  expiryDate: Date | string; // or Date if you prefer Date objects
  issuingState: string;
};

interface IEnterpriseInfo {
  identification?: IdentificationType;
  businessRegistrationNumber: string;
  contactInfo?: ContactInfoType;
  legalEntityName: string;
  companyName: string;
}

interface IClientUserConnections {
  role: 'admin' | 'tenant' | 'landlord';
  isConnected: boolean;
  cid: string;
}

type ContactInfoType = {
  email: string;
  address: string;
  phoneNumber: string;
  contactPerson: string;
};

// REFRESH-TOKEN
interface IRefreshTokenDocument extends Document {
  user: Types.ObjectId;
  token: string;
}
