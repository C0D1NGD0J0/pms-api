import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import { IClientUserConnections, ICompanyProfile } from './client.interface';
import {
  IProfileDocument,
  GDPRSettings,
  EmployeeInfo,
  VendorInfo,
  TenantInfo,
} from './profile.interface';

export enum IUserRelationshipsEnum {
  parents = 'parents',
  sibling = 'sibling',
  spouse = 'spouse',
  child = 'child',
  other = 'other',
}

export interface IVendorDetailInfo {
  stats: {
    activeJobs: number;
    completedJobs: number;
    onTimeRate: string;
    rating: string;
    responseTime: string;
  };
  insuranceInfo: {
    coverageAmount: number;
    expirationDate: Date | null;
    policyNumber: string;
    provider: string;
  };
  contactPerson: {
    email: string;
    jobTitle: string;
    name: string;
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
    activeTasks: number;
    onTimeRate: string;
    propertiesManaged: number;
    rating: string;
    tasksCompleted: number;
    unitsManaged: number;
  };
  performance: {
    avgOccupancyRate: string;
    avgResponseTime: string;
    taskCompletionRate: string;
    tenantSatisfaction: string;
  };
  emergencyContact: {
    name: string;
    phone: string;
    relationship: string;
  };
  officeInfo: {
    address: string;
    city: string;
    workHours: string;
  };
  hireDate: Date | string;
  employmentType: string;
  directManager: string;
  department: string;
  employeeId: string;
  position: string;
  skills: string[];
  tags: string[];
  tenure: string;
}

export interface ICurrentUser {
  client: {
    clientSettings?: any;
    cuid: string;
    displayname: string;
    linkedVendorUid?: string;
    role: IUserRoleType;
  };
  preferences: {
    lang?: string;
    theme?: 'light' | 'dark';
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
  uid: string;
}

/**
 * Structured response for getClientUserInfo
 */
export interface IUserDetailResponse {
  profile: {
    about: string;
    avatar: string;
    contact: {
      email: string;
      phone: string;
    };
    email: string;
    firstName: string;
    fullName: string;
    id: string;
    lastName: string;
    phoneNumber: string;
    roles: string[];
    userType: 'employee' | 'vendor' | 'tenant';
  };
  employeeInfo?: IEmployeeDetailInfo;
  tenantInfo?: ITenantDetailInfo;
  vendorInfo?: IVendorDetailInfo;
  status: 'Active' | 'Inactive';
}

export interface FilteredUser
  extends Pick<IUserDocument, 'uid' | 'email' | 'isActive' | 'createdAt'> {
  userType?: 'employee' | 'vendor' | 'tenant';
  vendorInfo?: FilteredVendorInfo;
  employeeInfo?: EmployeeInfo;
  tenantInfo?: TenantInfo;
  roles: IUserRoleType[];
  isConnected: boolean;
  phoneNumber?: string;
  displayName: string;
  firstName?: string;
  fullName?: string;
  lastName?: string;
  avatar?: string;
}

export interface IUserDocument extends Document, IUser {
  validatePassword: (pwd1: string) => Promise<boolean>;
  cuids: IClientUserConnections[];
  profile?: IProfileDocument; //virtual property
  deletedAt: Date | null;
  _id: Types.ObjectId;
  activecuid: string; // active cuid
  fullname?: string; //virtual property
  isActive: boolean;
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
  completedJobs?: number;
  contactPerson?: string;
  reviewCount?: number;
  serviceType?: string;
  rating?: number;
  vuid?: string;
}

/**
 * Tenant detail information for getClientUserInfo response
 */
export interface ITenantDetailInfo {
  leaseInfo: {
    endDate: Date | null;
    monthlyRent: number;
    startDate: Date;
    status: string;
  };
  unit: {
    address: string;
    propertyName: string;
    unitNumber: string;
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
  tenantInfo?: FilteredUserTenantInfo;
  vendorInfo?: FilteredUserVendorInfo;
  isConnected: boolean;
  phoneNumber?: string;
  displayName: string;
  fullName?: string;
  isActive: boolean;
  uid: string;
}

export type ISignupData = {
  accountType: IAccountType;
  companyProfile?: ICompanyProfile;
  displayName: string;
  email: string;
  firstName: string;
  lang: string;
  lastName: string;
  location: string;
  password: string;
  phoneNumber: string;
  termsAccepted: boolean;
  timeZone?: string;
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
  joinedDate: Date;
  lastName: string;
  email: string;
  role: string;
  uid: string;
}

export type IdentificationType = {
  authority: string;
  expiryDate: Date | string;
  idNumber: string;
  idType: 'passport' | 'national-id' | 'drivers-license' | 'corporation-license';
  issueDate: Date | string;
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
    currentPage: number;
    hasMoreResource: boolean;
    perPage: number;
    total: number;
    totalPages: number;
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
  since: string;
  units: number;
  name: string;
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
  rentStatus?: string;
  unitNumber?: string;
}

export type IContactInfoType = {
  contactPerson: string;
  email: string;
  phoneNumber?: string;
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

export type IUserPopulatedDocument = {
  profile: IProfileDocument;
} & IUserDocument;

export type IRefreshToken = IRefreshTokenDocument;
