import { Document, Types } from 'mongoose';

import { IClientUserConnections, ICompanyProfile } from './client.interface';
import { IProfileDocument, GDPRSettings, EmployeeInfo, VendorInfo } from './profile.interface';

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

export interface FilteredUser {
  // User type indicator
  userType?: 'employee' | 'vendor' | 'tenant';
  vendorInfo?: FilteredVendorInfo; // Extended version with additional fields
  // Type-specific information (conditional based on userType)
  employeeInfo?: EmployeeInfo;
  createdAt: Date | string;
  tenantInfo?: TenantInfo;
  roles: IUserRoleType[];
  isConnected: boolean;

  phoneNumber?: string;
  displayName: string;
  // Profile information (optional, from populated profile)
  firstName?: string;
  isActive: boolean;
  lastName?: string;

  fullName?: string;

  avatar?: string;
  email: string;
  // Basic user information
  id: string;
}

export interface FilteredUser {
  // User type indicator
  userType?: 'employee' | 'vendor' | 'tenant';
  vendorInfo?: FilteredVendorInfo; // Extended version with additional fields
  employeeInfo?: EmployeeInfo;
  createdAt: Date | string;
  tenantInfo?: TenantInfo;
  roles: IUserRoleType[];
  isConnected: boolean;

  phoneNumber?: string;
  displayName: string;
  // Profile information (optional, from populated profile)
  firstName?: string;
  isActive: boolean;
  lastName?: string;

  fullName?: string;

  avatar?: string;
  email: string;
  // Basic user information
  id: string;
}

export interface ICurrentUser {
  client: {
    cuid: string;
    displayname: string;
    role: IUserRoleType;
    linkedVendorId?: string;
    clientSettings?: any;
  };
  preferences: {
    theme?: 'light' | 'dark';
    lang?: string;
    timezone?: string;
  };
  clients: IClientUserConnections[];
  fullname: string | null;
  permissions: string[];
  displayName: string;
  gdpr?: GDPRSettings;
  employeeInfo?: any;
  avatarUrl: string;
  isActive: boolean;
  vendorInfo?: any;
  email: string;
  sub: string;
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
  termsAccepted: boolean;
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

/**
 * Extended vendor info that includes additional fields from getUsersByRole
 */
export interface FilteredVendorInfo extends VendorInfo {
  isLinkedAccount?: boolean;
  isPrimaryVendor?: boolean;
  linkedVendorId?: string;
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

/**
 * Tenant information placeholder
 * TODO: Define based on tenant model when available
 */
export interface TenantInfo {
  [key: string]: any;
}

export type IRefreshToken = IRefreshTokenDocument;
