import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import { IClientUserConnections, ICompanyProfile } from './client.interface';
import {
  EmployeeDepartment,
  IProfileDocument,
  GDPRSettings,
  EmployeeInfo,
  VendorInfo,
  TenantInfo,
} from './profile.interface';

/**
 * ============================================================================
 * BASE TYPE DEFINITIONS (Single Source of Truth)
 * ============================================================================
 */

export enum IUserRelationshipsEnum {
  parents = 'parents',
  sibling = 'sibling',
  spouse = 'spouse',
  child = 'child',
  other = 'other',
}

/**
 * Current User Interface
 * Authenticated user session data with all role-specific info
 */
export interface ICurrentUser {
  client: {
    clientSettings?: any;
    cuid: string;
    displayname: string;
    linkedVendorUid?: string;
    role: IUserRoleType;
  };
  vendorInfo?: {
    vendorId?: string;
    linkedVendorUid?: string;
    isPrimaryVendor?: boolean;
    isLinkedAccount?: boolean;
  };
  tenantInfo?: {
    hasActiveLease?: boolean;
    backgroundCheckStatus?: string;
    activeLease?: Record<string, any> | null;
  };
  employeeInfo?: {
    department?: EmployeeDepartment;
    jobTitle?: string;
    employeeId?: string;
    startDate?: Date;
  };
  preferences: {
    lang?: string;
    theme?: ThemePreference;
    timezone?: string;
  };
  clients: IClientUserConnections[];
  fullname: string | null;
  permissions: string[];
  displayName: string;
  gdpr?: GDPRSettings;
  avatarUrl: string;
  isActive: boolean;
  email: string;
  sub: string;
  uid: string;
}

/**
 * Vendor Detail Information
 * Complete vendor profile and metrics
 */
export interface IVendorDetailInfo {
  insuranceInfo: {
    coverageAmount: number;
    expirationDate: Date | null;
    policyNumber: string;
    provider: string;
  };
  contactPerson: {
    jobTitle: string;
    phone: string;
  } & Pick<IBaseContactInfo, 'name' | 'email'>;
  stats: {
    responseTime: string;
    completedJobs: number;
    activeJobs: number;
  } & IBaseStats;
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
 * Employee Detail Information
 * Complete employee profile and metrics
 */
export interface IEmployeeDetailInfo {
  performance: {
    avgOccupancyRate: string;
    avgResponseTime: string;
    taskCompletionRate: string;
    tenantSatisfaction: string;
  };
  stats: {
    propertiesManaged: number;
    tasksCompleted: number;
    unitsManaged: number;
    activeTasks: number;
  } & IBaseStats;
  emergencyContact: {
    relationship: string;
    phone: string;
  } & Pick<IBaseContactInfo, 'name'>;
  officeInfo: {
    workHours: string;
    address: string;
    city: string;
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

/**
 * Client Tenant Details Interface
 * Comprehensive tenant details for property management view
 * Used by getTenantManagementDetails endpoint
 */
export interface IClientTenantDetails {
  profile: Pick<
    IBaseUserProfile,
    | 'firstName'
    | 'lastName'
    | 'fullName'
    | 'avatar'
    | 'phoneNumber'
    | 'email'
    | 'roles'
    | 'uid'
    | 'id'
    | 'isActive'
  > & {
    userType: 'tenant';
  };
  tenantMetrics?: {
    onTimePaymentRate: number;
    averagePaymentDelay: number;
    totalMaintenanceRequests: number;
    currentRentStatus: RentStatus;
    daysCurrentLease: number;
    totalRentPaid: number;
  };
  tenantInfo: TenantInfo;
  status: UserStatus;
  userType: 'tenant';
  joinedDate: Date;
  roles: string[];
}

/**
 * Tenant Statistics Interface
 * Comprehensive tenant metrics and distribution
 */
export interface ITenantStats {
  backgroundCheckDistribution: {
    notRequired: number;
    approved: number;
    pending: number;
    failed: number;
  };
  distributionByProperty: Array<{
    propertyId: string;
    propertyName: string;
    tenantCount: number;
  }>;
  rentStatus: {
    overdue: number;
    current: number;
    late: number;
  };
  expiredLeases: number;
  pendingLeases: number;
  occupancyRate: number;
  activeLeases: number;
  averageRent: number;
  total: number;
}

/**
 * User Detail Response Interface
 * Structured response for getClientUserInfo endpoint
 */
export interface IUserDetailResponse {
  profile: Pick<
    IBaseUserProfile,
    'firstName' | 'lastName' | 'fullName' | 'avatar' | 'email' | 'phoneNumber' | 'roles' | 'id'
  > & {
    contact: Pick<IBaseContactInfo, 'email'> & { phone: string };
    userType: UserType;
    about: string;
  };
  employeeInfo?: IEmployeeDetailInfo;
  tenantInfo?: ITenantDetailInfo;
  vendorInfo?: IVendorDetailInfo;
  status: UserStatus;
}

/**
 * ============================================================================
 * ENUMS
 * ============================================================================
 */

/**
 * User Document Interface
 * Extends IUser with MongoDB document properties and methods
 */
export interface IUserDocument extends Document, IUser {
  validatePassword: (pwd1: string) => Promise<boolean>;
  cuids: IClientUserConnections[];
  profile?: IProfileDocument; // virtual property
  deletedAt: Date | null;
  _id: Types.ObjectId;
  activecuid: string; // active cuid
  fullname?: string; // virtual property
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  uid: string;
  id: string;
}

/**
 * ============================================================================
 * CORE INTERFACES (Single Source of Truth)
 * ============================================================================
 */

/**
 * Filtered User Interface
 * User data for listing/table views
 */
export interface FilteredUser
  extends Pick<IUserDocument, 'uid' | 'email' | 'isActive' | 'createdAt'> {
  vendorInfo?: FilteredVendorInfo;
  employeeInfo?: EmployeeInfo;
  tenantInfo?: TenantInfo;
  roles: IUserRoleType[];
  isConnected: boolean;
  phoneNumber?: string;
  userType?: UserType;
  displayName: string;
  firstName?: string;
  fullName?: string;
  lastName?: string;
  avatar?: string;
}

/**
 * Filtered User Vendor Info
 * Minimal vendor info for table display
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
 * Filtered User Table Data
 * Lightweight user data for table display only
 */
export interface FilteredUserTableData extends Pick<IUser, 'email'> {
  employeeInfo?: FilteredUserEmployeeInfo;
  tenantInfo?: FilteredUserTenantInfo;
  vendorInfo?: FilteredUserVendorInfo;
  phoneNumber?: string;
  isConnected: boolean;
  displayName: string;
  fullName?: string;
  isActive: boolean;
  uid: string;
}

/**
 * Signup Data Type
 * User registration form data
 */
export type ISignupData = {
  companyProfile?: ICompanyProfile;
  accountType: IAccountType;
  termsAccepted: boolean;
  phoneNumber: string;
  displayName: string;
  firstName: string;
  lastName: string;
  location: string;
  password: string;
  timeZone?: string;
  email: string;
  lang: string;
};

/**
 * Tenant Filter Options
 * Extended filter options specific to tenant queries
 */
export interface ITenantFilterOptions extends IUserFilterOptions {
  backgroundCheckStatus?: BackgroundCheckStatus;
  moveInDateRange?: { start: Date; end: Date };
  leaseStatus?: LeaseStatusType;
  rentStatus?: RentStatus;
  propertyId?: string;
  unitType?: string;
}

/**
 * Vendor Team Member Response Interface
 */
export interface IVendorTeamMember
  extends Pick<
    IBaseUserProfile,
    'displayName' | 'phoneNumber' | 'firstName' | 'isActive' | 'lastName' | 'email' | 'uid'
  > {
  lastLogin: Date | null;
  isTeamMember: boolean;
  joinedDate: Date;
  role: string;
}

/**
 * Base User Profile Interface
 * Core user profile fields used across different contexts
 */
export interface IBaseUserProfile {
  phoneNumber: string;
  displayName: string;
  firstName: string;
  isActive: boolean;
  lastName: string;
  fullName: string;
  roles: string[];
  avatar: string;
  email: string;
  uid: string;
  id: string;
}

/**
 * Main User Interface
 * Core authentication and account data
 */
export interface IUser {
  passwordResetTokenExpiresAt: Date | number | null;
  activationTokenExpiresAt: Date | number | null;
  passwordResetToken?: string;
  activationToken?: string;
  password: string;
  email: string;
}

/**
 * Identification Type Interface
 * User identification documents
 */
export interface IIdentificationType {
  idType: IdentificationDocumentType;
  expiryDate: Date | string;
  issueDate: Date | string;
  issuingState: string;
  authority: string;
  idNumber: string;
}

/**
 * ============================================================================
 * DOCUMENT INTERFACES (Mongoose Extensions)
 * ============================================================================
 */

/**
 * Account Type Interface
 * Subscription/plan information
 */
export interface IAccountType {
  billingInterval: 'monthly' | 'yearly';
  isEnterpriseAccount: boolean;
  totalMonthlyPrice?: number;
  planLookUpKey: string;
  planName: string;
  planId: string;
}

/**
 * Base User Filter Options
 * Common filtering options for user queries
 */
export interface IUserFilterOptions {
  role?: IUserRoleType | IUserRoleType[];
  status?: 'active' | 'inactive';
  department?: string;
  search?: string;
}

/**
 * Extended Pagination Interface
 * Alternative pagination structure with hasNext/hasPrev
 */
export interface IExtendedPagination {
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  total: number;
  limit: number;
  page: number;
}

/**
 * ============================================================================
 * CURRENT USER & SESSION INTERFACES
 * ============================================================================
 */

/**
 * User Statistics Interface
 * User statistics for filtered users response
 */
export interface IUserStats {
  departmentDistribution: StatsDistribution[];
  roleDistribution: StatsDistribution[];
  totalFilteredUsers: number;
}

/**
 * ============================================================================
 * DETAIL INFO INTERFACES (Role-Specific)
 * ============================================================================
 */

/**
 * Base Pagination Interface
 * Standard pagination structure
 */
export interface IBasePagination {
  hasMoreResource: boolean;
  currentPage: number;
  totalPages: number;
  perPage: number;
  total: number;
}

/**
 * Extended Vendor Info Interface
 * Includes additional fields from getUsersByRole
 */
export interface FilteredVendorInfo extends VendorInfo {
  isPrimaryVendor?: boolean;
  isLinkedAccount: boolean;
  linkedVendorUid?: string;
}

/**
 * Linked Vendor User Info
 */
export interface ILinkedVendorUser
  extends Pick<IBaseUserProfile, 'displayName' | 'isActive' | 'email' | 'uid'> {
  phoneNumber?: string;
}

/**
 * ============================================================================
 * RESPONSE INTERFACES
 * ============================================================================
 */

/**
 * User Property Interface
 * Minimal property info for user context
 */
export interface IUserProperty {
  occupancy: string;
  location: string;
  since: string;
  units: number;
  name: string;
}

/**
 * ID Type Union
 * Supported identification document types
 */
export type IdentificationDocumentType =
  | 'passport'
  | 'national-id'
  | 'drivers-license'
  | 'corporation-license';

/**
 * Filtered User Employee Info
 * Minimal employee info for table display
 */
export interface FilteredUserEmployeeInfo {
  startDate?: Date | string;
  department?: string;
  jobTitle?: string;
}

/**
 * Filtered User Tenant Info
 * Minimal tenant info for table display
 */
export interface FilteredUserTenantInfo {
  leaseStatus?: string;
  rentStatus?: string;
  unitNumber?: string;
}

/**
 * ============================================================================
 * FILTERED/LIGHTWEIGHT INTERFACES
 * ============================================================================
 */

/**
 * Vendor Team Members Response with Pagination
 */
export interface IVendorTeamMembersResponse {
  pagination: IBasePagination;
  items: IVendorTeamMember[];
}

/**
 * Contact Info Type Interface
 * Generic contact information
 */
export interface IContactInfoType {
  contactPerson: string;
  phoneNumber?: string;
  email: string;
}

/**
 * Refresh Token Document Interface
 */
export interface IRefreshTokenDocument extends Document {
  user: Types.ObjectId;
  token: string;
}

/**
 * Base Contact Info Interface
 * Standard contact information structure
 */
export interface IBaseContactInfo {
  phoneNumber: string;
  email: string;
  name: string;
}

/**
 * Stats Distribution Interface
 * Generic distribution data for charts
 */
export interface StatsDistribution {
  percentage: number;
  value: number;
  name: string;
}

/**
 * Paginated Result Interface
 * Generic paginated response wrapper
 */
export interface IPaginatedResult<T> {
  pagination: IExtendedPagination;
  items: T;
}

/**
 * Background Check Status Type
 * Used for tenant screening
 */
export type BackgroundCheckStatus = 'pending' | 'approved' | 'failed' | 'not_required';

/**
 * ============================================================================
 * FORM DATA INTERFACES
 * ============================================================================
 */

/**
 * User Populated Document Type
 * User document with populated profile
 */
export type IUserPopulatedDocument = {
  profile: IProfileDocument;
} & IUserDocument;

/**
 * ============================================================================
 * QUERY & FILTER INTERFACES
 * ============================================================================
 */

/**
 * Lease Status Type
 * Current lease state for tenants
 */
export type LeaseStatusType = 'active' | 'expired' | 'pending' | 'terminated';

/**
 * Base Stats Interface
 * Common stats pattern for employees and vendors
 */
export interface IBaseStats {
  onTimeRate: string;
  rating: string;
}

/**
 * ============================================================================
 * STATISTICS INTERFACES
 * ============================================================================
 */

/**
 * Rent Status Type
 * Current payment status for tenants
 */
export type RentStatus = 'current' | 'late' | 'overdue' | 'no_lease';

/**
 * Tenant Detail Information
 * Extends TenantInfo from profile interface
 */
export interface ITenantDetailInfo extends TenantInfo {}

/**
 * User Type Union
 * The three primary user types in the system
 */
export type UserType = 'employee' | 'vendor' | 'tenant';

/**
 * ============================================================================
 * PAGINATION INTERFACES
 * ============================================================================
 */

/**
 * @deprecated Use IIdentificationType instead
 */
export type IdentificationType = IIdentificationType;

/**
 * ============================================================================
 * UTILITY INTERFACES
 * ============================================================================
 */

export type IRefreshToken = IRefreshTokenDocument;

/**
 * ============================================================================
 * POPULATED/ENRICHED INTERFACES
 * ============================================================================
 */

/**
 * User Status Type
 * Active/Inactive status for users
 */
export type UserStatus = 'Active' | 'Inactive';

/**
 * ============================================================================
 * DEPRECATED/LEGACY TYPE ALIASES
 * ============================================================================
 */

/**
 * Theme Preference Type
 */
export type ThemePreference = 'light' | 'dark';
