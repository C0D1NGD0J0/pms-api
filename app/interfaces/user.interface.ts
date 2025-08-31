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

export interface IVendorDetailInfo {
  stats: {
    completedJobs: number;
    activeJobs: number;
    rating: string;
    responseTime: string;
    onTimeRate: string;
  };
  insuranceInfo: {
    provider: string;
    policyNumber: string;
    expirationDate: Date | null;
    coverageAmount: number;
  };
  contactPerson: {
    name: string;
    jobTitle: string;
    email: string;
    phone: string;
  };
  serviceAreas: {
    baseLocation: string;
    maxDistance: number;
  };
  servicesOffered: Record<string, any>;
  linkedUsers?: ILinkedVendorUser[];
  linkedVendorUid: string | null;
  registrationNumber: string;
  isLinkedAccount: boolean;
  isPrimaryVendor: boolean;
  yearsInBusiness: number;
  businessType: string;
  companyName: string;
  tags: string[];
  taxId: string;
}

/**
 * Employee detail information for getClientUserInfo response
 */
export interface IEmployeeDetailInfo {
  stats: {
    propertiesManaged: number;
    unitsManaged: number;
    tasksCompleted: number;
    onTimeRate: string;
    rating: string;
    activeTasks: number;
  };
  performance: {
    taskCompletionRate: string;
    tenantSatisfaction: string;
    avgOccupancyRate: string;
    avgResponseTime: string;
  };
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
  };
  officeInfo: {
    address: string;
    city: string;
    workHours: string;
  };
  hireDate: Date | string;
  employmentType: string;
  directManager: string;
  employeeId: string;
  department: string;
  position: string;
  skills: string[];
  tenure: string;
  tags: string[];
}

export interface ICurrentUser {
  client: {
    cuid: string;
    displayname: string;
    role: IUserRoleType;
    linkedVendorUid?: string;
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
  uid: string;
  sub: string;
}

export interface FilteredUser
  extends Pick<IUserDocument, 'uid' | 'email' | 'isActive' | 'createdAt'> {
  userType?: 'employee' | 'vendor' | 'tenant';
  vendorInfo?: FilteredVendorInfo;
  // Type-specific information (conditional based on userType)
  employeeInfo?: EmployeeInfo;
  tenantInfo?: TenantInfo;
  roles: IUserRoleType[];
  isConnected: boolean;
  phoneNumber?: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  avatar?: string;
}

/**
 * Structured response for getClientUserInfo
 */
export interface IUserDetailResponse {
  profile: {
    firstName: string;
    lastName: string;
    fullName: string;
    avatar: string;
    phoneNumber: string;
    email: string;
    about: string;
    contact: {
      phone: string;
      email: string;
    };
    roles: string[];
    userType: 'employee' | 'vendor' | 'tenant';
  };
  employeeInfo?: IEmployeeDetailInfo;
  vendorInfo?: IVendorDetailInfo;
  status: 'Active' | 'Inactive';
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

/**
 * Minimal vendor info for table display
 * Using Pick to select specific fields from IVendorDetailInfo
 */
export interface FilteredUserVendorInfo
  extends Pick<IVendorDetailInfo, 'companyName' | 'businessType'> {
  averageResponseTime?: string;
  averageServiceCost?: number;
  isLinkedAccount?: boolean;
  isPrimaryVendor?: boolean;
  linkedVendorUid?: string;
  contactPerson?: string;
  completedJobs?: number;
  serviceType?: string;
  reviewCount?: number;
  rating?: number;
  vuid?: string;
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

/**
 * Tenant detail information for getClientUserInfo response
 */
export interface ITenantDetailInfo {
  leaseInfo: {
    status: string;
    startDate: Date | string;
    endDate: Date | string | null;
    monthlyRent: number;
  };
  unit: {
    propertyName: string;
    unitNumber: string;
    address: string;
  };
  maintenanceRequests: any[];
  paymentHistory: any[];
  rentStatus: string;
  documents: any[];
}

/**
 * Lightweight user data for table display only
 * Using Pick and optional fields to reduce duplication
 */
export interface FilteredUserTableData extends Pick<IUser, 'email'> {
  employeeInfo?: FilteredUserEmployeeInfo;
  vendorInfo?: FilteredUserVendorInfo;
  tenantInfo?: FilteredUserTenantInfo;
  phoneNumber?: string;
  isConnected: boolean;
  displayName: string;
  fullName?: string;
  isActive: boolean;
  uid: string;
}

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

/**
 * Vendor team member response
 */
export interface IVendorTeamMember {
  lastLogin: Date | null;
  isTeamMember: boolean;
  displayName: string;
  phoneNumber: string;
  firstName: string;
  isActive: boolean;
  lastName: string;
  joinedDate: Date;
  email: string;
  role: string;
  uid: string;
}

export type IdentificationType = {
  idType: 'passport' | 'national-id' | 'drivers-license' | 'corporation-license';
  idNumber: string;
  authority: string;
  issueDate: Date | string;
  expiryDate: Date | string;
  issuingState: string;
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
 * Vendor team members response with pagination
 */
export interface IVendorTeamMembersResponse {
  pagination: {
    total: number;
    perPage: number;
    totalPages: number;
    currentPage: number;
    hasMoreResource: boolean;
  };
  items: IVendorTeamMember[];
}

/**
 * User statistics for filtered users response
 */
export interface IUserStats {
  departmentDistribution: StatsDistribution[];
  roleDistribution: StatsDistribution[];
  totalFilteredUsers: number;
}

/**
 * Extended vendor info that includes additional fields from getUsersByRole
 */
export interface FilteredVendorInfo extends VendorInfo {
  isPrimaryVendor?: boolean;
  isLinkedAccount: boolean;
  linkedVendorUid?: string;
}

/**
 * Linked vendor user info
 */
export interface ILinkedVendorUser {
  phoneNumber?: string;
  displayName: string;
  isActive: boolean;
  email: string;
  uid: string;
}

/**
 * Property info for user (minimal)
 */
export interface IUserProperty {
  occupancy: string;
  location: string;
  units: number;
  since: string;
  name: string;
}

export interface ITenantDocument extends Document, ITenant {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Minimal employee info for table display
 */
export interface FilteredUserEmployeeInfo {
  startDate?: Date | string;
  department?: string;
  jobTitle?: string;
}

/**
 * Minimal tenant info for table display
 */
export interface FilteredUserTenantInfo {
  leaseStatus?: string;
  unitNumber?: string;
  rentStatus?: string;
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

/**
 * Stats distribution interface for charts
 */
export interface StatsDistribution {
  percentage: number;
  value: number;
  name: string;
}

export type IUserRoleType = 'admin' | 'tenant' | 'manager' | 'staff' | 'landlord' | 'vendor';

export type IUserPopulatedDocument = {
  profile: IProfileDocument;
} & IUserDocument;

/**
 * Tenant information placeholder
 * TODO: Define based on tenant model when available
 */
export interface TenantInfo {
  [key: string]: any;
}

export type IRefreshToken = IRefreshTokenDocument;
