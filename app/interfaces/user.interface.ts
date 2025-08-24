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

/**
 * Vendor detail information for getClientUserInfo response
 */
export interface IVendorDetailInfo {
  servicesOffered: {
    plumbing?: boolean;
    electrical?: boolean;
    hvac?: boolean;
    cleaning?: boolean;
    landscaping?: boolean;
    painting?: boolean;
    carpentry?: boolean;
    roofing?: boolean;
    security?: boolean;
    pestControl?: boolean;
    applianceRepair?: boolean;
    maintenance?: boolean;
    other?: boolean;
  };
  linkedUsers?: Array<{
    uid: string;
    displayName: string;
    email: string;
    isActive: boolean;
    phoneNumber?: string;
  }>;
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
  linkedVendorId: string | null;
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

/**
 * Structured response for getClientUserInfo
 */
export interface IUserDetailResponse {
  profile: {
    firstName: string;
    lastName: string;
    fullName: string;
    avatar: any;
    phoneNumber: string;
    email: string;
    about: string;
    contact: {
      phone: string;
      email: string;
    };
  };
  user: {
    uid: string;
    email: string;
    displayName: string;
    roles: string[];
    isActive: boolean;
    createdAt: Date | string;
    userType: 'employee' | 'vendor' | 'tenant';
  };
  employeeInfo?: IEmployeeDetailInfo;
  vendorInfo?: IVendorDetailInfo;
  tenantInfo?: ITenantDetailInfo;
  properties: any[];
  documents: any[];
  status: string;
  tasks: any[];
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
  uid: string;
  sub: string;
}

export interface FilteredUser {
  userType?: 'employee' | 'vendor' | 'tenant';
  vendorInfo?: FilteredVendorInfo;
  employeeInfo?: EmployeeInfo;
  createdAt: Date | string;
  tenantInfo?: TenantInfo;
  roles: IUserRoleType[];
  isConnected: boolean;

  phoneNumber?: string;
  displayName: string;
  firstName?: string;
  isActive: boolean;
  lastName?: string;

  fullName?: string;

  avatar?: string;
  email: string;
  id: string;
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

/**
 * Minimal vendor info for table display
 */
export interface FilteredUserVendorInfo {
  averageResponseTime?: string;
  averageServiceCost?: number;
  isLinkedAccount?: boolean;
  isPrimaryVendor?: boolean;
  linkedVendorId?: string;
  contactPerson?: string;
  completedJobs?: number;
  businessType?: string;
  companyName?: string;
  reviewCount?: number;
  serviceType?: string;
  rating?: number;
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

export type IdentificationType = {
  idType: 'passport' | 'national-id' | 'drivers-license' | 'corporation-license';
  idNumber: string;
  authority: string;
  issueDate: Date | string; // or Date if you prefer Date objects
  expiryDate: Date | string; // or Date if you prefer Date objects
  issuingState: string;
};

/**
 * Lightweight user data for table display only
 * Contains only the fields needed for table rendering
 */
export interface FilteredUserTableData {
  employeeInfo?: FilteredUserEmployeeInfo;
  vendorInfo?: FilteredUserVendorInfo;
  tenantInfo?: FilteredUserTenantInfo;
  phoneNumber?: string;
  isConnected: boolean;
  displayName: string;
  fullName?: string;
  isActive: boolean;
  email: string;
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
 * Lightweight user data for table display only
 * Contains only the fields needed for table rendering
 */
export interface FilteredUserTableData {
  employeeInfo?: FilteredUserEmployeeInfo;
  vendorInfo?: FilteredUserVendorInfo;
  tenantInfo?: FilteredUserTenantInfo;
  phoneNumber?: string;
  displayName: string;
  fullName?: string;
  isActive: boolean;
  email: string;
  uid: string;
}

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
  isLinkedAccount?: boolean;
  isPrimaryVendor?: boolean;
  linkedVendorId?: string;
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

/**
 * Tenant information placeholder
 * TODO: Define based on tenant model when available
 */
export interface TenantInfo {
  [key: string]: any;
}

export type IRefreshToken = IRefreshTokenDocument;
