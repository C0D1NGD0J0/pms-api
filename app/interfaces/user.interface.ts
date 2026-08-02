import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import { PaymentProcessorAccountType } from './paymentProcessor.interface';
import { IClientUserConnections, ICompanyProfile } from './client.interface';
import { ISubscriptionEntitlements, ISubscriptionStatus, PlanName } from './subscription.interface';
import {
  EmployeeDepartment,
  IProfileDocument,
  IEmployeeInfo,
  IGDPRSettings,
  IVendorInfo,
  ITenantInfo,
} from './profile.interface';

export enum IUserRelationshipsEnum {
  parents = 'parents',
  sibling = 'sibling',
  spouse = 'spouse',
  child = 'child',
  other = 'other',
}

export interface ICurrentUser {
  /**
   * Subscription details — only populated for PM roles (super-admin, admin, manager, staff).
   * Contains plan info, raw entitlements, and paymentFlow (billing state).
   *
   * Note: `entitlements` here are the raw plan flags. For feature gating, use
   * `clientEntitlements` instead — it's available to all roles.
   */
  subscription?: {
    plan: {
      name: PlanName;
      status: ISubscriptionStatus;
      billingInterval: 'monthly' | 'annual';
    };
    /** Raw plan feature flags — see `clientEntitlements` for the resolved version */
    entitlements: ISubscriptionEntitlements['entitlements'];
    /**
     * Computed billing state (not stored in DB — derived by aggregation pipeline).
     * Drives the frontend's onboarding/payment redirect logic.
     * - `requiresPayment: true` + `reason: 'expired'` → endDate has passed
     * - `requiresPayment: true` + `reason: 'pending_signup'` → no Stripe subscription yet
     * - `requiresPayment: true` + `reason: 'grace_period'` → pending downgrade
     */
    paymentFlow: {
      requiresPayment: boolean;
      reason: 'pending_signup' | 'expired' | 'grace_period' | null;
      gracePeriodEndsAt: Date | null;
      daysUntilDowngrade: number | null;
    };
  };

  /** Active client context — always present */
  client: {
    clientSettings?: any;
    tenantFeatures?: import('@interfaces/client.interface').ITenantFeatureSettings;
    suspension?: import('@interfaces/client.interface').IClientSuspension;
    cuid: string;
    displayname: string;
    linkedVendorUid?: string;
    role: IUserRoleType;
    isVerified: boolean;
    /** True when the user hasn't completed initial setup (consent, profile, etc.) */
    requiresOnboarding?: boolean;
    vendorPayoutMode?: 'express' | 'platform_hold';
    isFormerTenant?: boolean;
  };

  /** Vendor-specific info — only populated for vendor role */
  vendorInfo?: {
    vendorId?: string;
    vuid?: string;
    linkedVendorUid?: string;
    isPrimaryVendor?: boolean;
    isLinkedAccount?: boolean;
    payoutAccount?: {
      isSetup: boolean;
      payoutsEnabled: boolean;
      chargesEnabled: boolean;
    };
  };

  /** Stripe Connect account status — only populated for super-admin with a payment processor */
  paymentProcessor?: {
    isSetup: boolean;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    needsOnboarding: boolean;
    accountId: string | null;
    accountType: PaymentProcessorAccountType | null;
    onboardedAt: Date | null;
  };

  /** Tenant-specific info — only populated for tenant role */
  tenantInfo?: {
    hasActiveLease?: boolean;
    backgroundCheckStatus?: string;
    activeLease?: Record<string, any> | null;
    employerInfo?: Array<Record<string, any>>;
  };

  /** Employee info — only populated for admin/manager/staff roles */
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

  /**
   * Resolved feature flags from the client's subscription — available to ALL roles.
   *
   * This is the primary field for feature gating on the frontend. Tenants and vendors
   * use this instead of `subscription.entitlements` (which is PM-only and contains
   * billing details they shouldn't see).
   *
   * Populated from `subscription.entitlements` with safe defaults (false) when no
   * subscription exists.
   */
  clientEntitlements: ISubscriptionEntitlements['entitlements'];

  /** All client connections for this user (for account switching) */
  clients: IClientUserConnections[];
  fullname: string | null;
  /** Resolved permissions array — stripped from /me response, used internally by middleware */
  permissions: string[];
  gdpr?: IGDPRSettings;
  displayName: string;
  avatarUrl: string;
  isActive: boolean;
  email: string;
  /** User MongoDB _id */
  sub: string;
  /** User unique ID (UIDXXXXX format) */
  uid: string;
}

export interface IVendorDetailInfo {
  address?: {
    fullAddress: string;
    street: string;
    city: string;
    state: string;
    country: string;
    postCode: string;
  };
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
  payoutAccount?: {
    isSetup: boolean;
    payoutsEnabled: boolean;
    chargesEnabled: boolean;
  };
  serviceAreas: {
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
  vuid: string;
}

export interface IClientTenantDetails {
  profile: Pick<
    IBaseUserProfile,
    | 'firstName'
    | 'lastName'
    | 'fullName'
    | 'displayName'
    | 'avatar'
    | 'phoneNumber'
    | 'email'
    | 'roles'
    | 'uid'
    | 'id'
    | 'isActive'
  > & {
    userType: 'tenant';
    location?: string;
    dob?: Date | string | null;
    headline?: string;
    bio?: string;
    settings?: Record<string, any>;
    policies?: Record<string, any>;
  };
  tenantMetrics?: {
    onTimePaymentRate: number;
    averagePaymentDelay: number;
    totalMaintenanceRequests: number;
    currentRentStatus: RentStatus;
    daysCurrentLease: number;
    totalRentPaid: number;
  };
  tenantInfo: ITenantInfo;
  isFormerTenant: boolean;
  status: UserStatus;
  userType: 'tenant';
  joinedDate: Date;
  roles: string[];
}

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
  supervisorUid: string;
  department: string;
  employeeId: string;
  position: string;
  skills: string[];
  tags: string[];
  tenure: string;
}

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

export interface IUserDetailResponse {
  profile: Pick<
    IBaseUserProfile,
    | 'firstName'
    | 'lastName'
    | 'fullName'
    | 'avatar'
    | 'email'
    | 'phoneNumber'
    | 'roles'
    | 'uid'
    | 'id'
    | 'isActive'
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

export interface FilteredUser
  extends Pick<IUserDocument, 'uid' | 'email' | 'isActive' | 'createdAt'> {
  vendorInfo?: FilteredVendorInfo;
  employeeInfo?: IEmployeeInfo;
  tenantInfo?: ITenantInfo;
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

export interface ITenantFilterOptions extends IUserFilterOptions {
  connectionStatus?: 'connected' | 'disconnected' | 'all'; // Filter by connection status
  backgroundCheckStatus?: BackgroundCheckStatus;
  moveInDateRange?: { start: Date; end: Date };
  leaseStatus?: LeaseStatusType;
  rentStatus?: RentStatus;
  propertyId?: string;
  unitType?: string;
}

export interface IVendorTeamMember
  extends Pick<
    IBaseUserProfile,
    'displayName' | 'phoneNumber' | 'firstName' | 'isActive' | 'lastName' | 'email' | 'uid'
  > {
  lastLogin: Date | null;
  isTeamMember: boolean;
  joinedDate: Date;
  role: string;
  sub: string; // MongoDB _id as hex string — used to filter assignedTechnician.userId
}

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

export type ISignupData = {
  companyProfile?: ICompanyProfile;
  accountType: ISignupAccountType;
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

export interface IIdentificationType {
  identityVerification?: {
    sessionId?: string;
    sessionStatus?: 'requires_input' | 'stripe_verified';
    documentType?: string;
    issuingCountry?: string;
  };
  processingConsentDate?: Date | string;
  dataProcessingConsent: boolean;
}

export interface FilteredUserTenantInfo {
  propertyAddress?: string; // Full address of the property
  leaseStatus?: string; // active, pending_signature, no_active_lease, etc.
  rentAmount?: number; // Monthly rent amount
  rentStatus?: string; // paid, overdue, pending, etc.
}

export interface IUser {
  passwordResetTokenExpiresAt: Date | number | null;
  activationTokenExpiresAt: Date | number | null;
  passwordResetToken?: string;
  activationToken?: string;
  consent?: IUserConsent;
  password: string;
  email: string;
}

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

export interface ISignupAccountType extends IAccountType {
  billingInterval: 'monthly' | 'annual';
  totalMonthlyPrice?: number;
  planLookUpKey?: string;
  planName: string;
  planId: string;
}

export interface IUserProperty {
  propertyId: string;
  occupancy: string;
  location: string;
  since: string;
  units: number;
  name: string;
  pid: string;
}

export interface IUserFilterOptions {
  role?: IUserRoleType | IUserRoleType[];
  status?: 'active' | 'inactive';
  department?: string;
  search?: string;
}

export interface IExtendedPagination {
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  total: number;
  limit: number;
  page: number;
}

export interface IUserStats {
  departmentDistribution: StatsDistribution[];
  roleDistribution: StatsDistribution[];
  totalFilteredUsers: number;
}

export interface IBasePagination {
  hasMoreResource: boolean;
  currentPage: number;
  totalPages: number;
  perPage: number;
  total: number;
}

export interface FilteredVendorInfo extends IVendorInfo {
  isPrimaryVendor?: boolean;
  isLinkedAccount: boolean;
  linkedVendorUid?: string;
}

export interface ILinkedVendorUser
  extends Pick<IBaseUserProfile, 'displayName' | 'isActive' | 'email' | 'uid'> {
  phoneNumber?: string;
}

export interface FilteredUserEmployeeInfo {
  startDate?: Date | string;
  department?: string;
  jobTitle?: string;
}

export interface IVendorTeamMembersResponse {
  pagination: IBasePagination;
  items: IVendorTeamMember[];
}

export interface IAccountType {
  category: 'business' | 'individual';
  isEnterpriseAccount: boolean;
}

export interface IContactInfoType {
  contactPerson: string;
  phoneNumber?: string;
  email: string;
}

export interface IRefreshTokenDocument extends Document {
  user: Types.ObjectId;
  token: string;
}

export interface IBaseContactInfo {
  phoneNumber: string;
  email: string;
  name: string;
}

export interface StatsDistribution {
  percentage: number;
  value: number;
  name: string;
}

export interface IPaginatedResult<T> {
  pagination: IExtendedPagination;
  items: T;
}

export type BackgroundCheckStatus = 'pending' | 'approved' | 'failed' | 'not_required';

export type IUserPopulatedDocument = {
  profile: IProfileDocument;
} & IUserDocument;

export interface IUserConsent {
  acceptedOn: Date | null;
  acceptedBy: string;
}

export type LeaseStatusType = 'active' | 'expired' | 'pending' | 'terminated';

export interface IBaseStats {
  onTimeRate: string;
  rating: string;
}

export type RentStatus = 'current' | 'late' | 'overdue' | 'no_lease';

export interface ITenantDetailInfo extends ITenantInfo {}

export type UserType = 'employee' | 'vendor' | 'tenant';

export type IRefreshToken = IRefreshTokenDocument;

export type UserStatus = 'Active' | 'Inactive';

export type ThemePreference = 'light' | 'dark';
