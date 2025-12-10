import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import { IdentificationType } from './user.interface';

export enum EmployeeDepartment {
  MAINTENANCE = 'maintenance', // Maintenance and repairs
  OPERATIONS = 'operations', // Day-to-day property operations
  ACCOUNTING = 'accounting', // Financial operations and rent collection
  MANAGEMENT = 'management', // Executive and general management
  OTHER = 'other', // Any other department not listed
}

export enum BackgroundCheckStatus {
  NOT_REQUIRED = 'not_required',
  APPROVED = 'approved',
  PENDING = 'pending',
  FAILED = 'failed',
}

export enum DataRetentionPolicy {
  STANDARD = 'standard',
  EXTENDED = 'extended',
  MINIMAL = 'minimal',
}

/**
 * Tenant information structure
 * - employerInfo, activeLeases, backgroundChecks are client-specific (filtered by cuid)
 * - rentalReferences, pets, emergencyContact are shared across all clients
 * - Historical/relationship data (leaseHistory, paymentHistory, etc.) specific to tenant management
 */
export interface TenantInfo {
  employerInfo?: {
    cuid: string; // Track which client the employer info is associated with
    companyName: string;
    position: string;
    monthlyIncome: number;
    contactPerson: string;
    companyAddress: string;
    contactEmail: string;
  }[];

  activeLeases?: {
    cuid: string; // Track which client the lease is associated with
    confirmedDate: Date;
    confirmed: boolean;
    leaseId: string | Types.ObjectId; // Reference to Lease entity - all details fetched from there
  }[];

  maintenanceRequests?: Array<{
    requestId: string;
    date: Date;
    type: string;
    status: 'pending' | 'in_progress' | 'completed';
    description: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
  }>;

  backgroundChecks?: {
    cuid: string; // Track which client performed the background check
    status: BackgroundCheckStatus;
    checkedDate: Date;
    expiryDate?: Date;
    notes?: string;
  }[];

  // Historical/relationship data for property management view
  leaseHistory?: Array<{
    propertyName: string;
    unitNumber: string;
    leaseStart: Date;
    leaseEnd: Date;
    rentAmount: number;
    status: 'completed' | 'active' | 'terminated';
  }>;

  paymentHistory?: Array<{
    date: Date;
    amount: number;
    type: 'rent' | 'fee' | 'deposit';
    status: 'paid' | 'late' | 'pending';
    dueDate: Date;
  }>;

  notes?: Array<{
    date: Date;
    author: string;
    note: string;
    type: 'general' | 'payment' | 'maintenance' | 'lease';
  }>;

  rentalReferences?: Array<{
    landlordName: string;
    propertyAddress: string;
    [key: string]: any;
  }>;

  pets?: Array<{
    type: string;
    breed: string;
    isServiceAnimal: boolean;
    [key: string]: any;
  }>;

  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
    email: string;
  };
}

export interface Profile {
  personalInfo: {
    avatar?: {
      filename: string;
      key: string;
      url: string;
    };
    bio?: string;
    displayName: string;
    dob?: Date;
    firstName: string;
    headline?: string;
    lastName: string;
    location: string;
    phoneNumber?: string;
    identification?: IdentificationType;
  };
  settings: {
    lang: string;
    timeZone?: string;
    gdprSettings?: GDPRSettings;
    loginType?: 'otp' | 'password';
    notifications?: NotificationSettings;
    theme?: 'light' | 'dark';
  };
  policies: {
    tos: {
      acceptedOn: Date | null;
      accepted: boolean;
    };
    marketing: {
      acceptedOn: Date | null;
      accepted: boolean;
    };
  };
  employeeInfo?: EmployeeInfo;
  tenantInfo?: TenantInfo;
  vendorInfo?: VendorInfo;
  user: Types.ObjectId;
}

/**
 * Data structure for updateUserProfile input
 * Used when updating profile data
 */
export interface IProfileUpdateData {
  settings?: Partial<
    {
      timeZone?: string;
      lang?: string;
    } & Profile['settings']
  >;
  profileMeta?: {
    timeZone?: string;
    lang?: string;
  };
  personalInfo?: Partial<Profile['personalInfo']>;
  userInfo?: {
    email?: string;
  };
  employeeInfo?: Partial<EmployeeInfo>;
  tenantInfo?: Partial<TenantInfo>;
  vendorInfo?: Partial<VendorInfo>;
}

/**
 * Data structure for getUserProfileForEdit response
 * Used when fetching profile data for editing/display
 */
export interface IProfileEditData {
  personalInfo: {
    uid: string;
    email: string;
    isActive: boolean;
  } & Profile['personalInfo'];
  settings: {
    timeZone: string;
    lang: string;
  } & Profile['settings'];
  userType: 'employee' | 'vendor' | 'tenant' | 'primary_account_holder';
  identification?: IdentificationType;
  roles: IUserRoleType[];
}

export interface NotificationSettings {
  emailFrequency: 'immediate' | 'daily';
  emailNotifications: boolean;
  inAppNotifications: boolean;
  propertyUpdates: boolean;
  announcements: boolean;
  maintenance: boolean;
  comments: boolean;
  messages: boolean;
  payments: boolean;
  system: boolean;
}

/**
 * Populated user data structure
 */
export interface IPopulatedUser {
  cuids?: Array<{
    cuid: string;
    role: IUserRoleType;
    addedAt: Date;
  }>;
  deletedAt?: Date | null;
  _id: Types.ObjectId;
  activecuid: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  email: string;
  uid: string;
}

export interface VendorInfo {
  vendorId?: Types.ObjectId; // Reference to the vendor collection
  isLinkedAccount: boolean;
  linkedVendorUid?: string; // Reference to primary vendor (stays as string to match user model)
}

export type IProfileDocument = {
  _id: Types.ObjectId;
  createdAt: Date;
  deletedAt?: Date;
  fullname?: string;
  getGravatarUrl: () => string;
  id: string;
  puid: string;
  updatedAt: Date;
} & Document &
  Profile;

export interface EmployeeInfo {
  department?: EmployeeDepartment;
  clientSpecificSettings?: any;
  employeeId?: string;
  reportsTo?: string;
  jobTitle?: string;
  startDate?: Date;
}

export interface GDPRSettings {
  dataRetentionPolicy: DataRetentionPolicy;
  dataProcessingConsent: boolean;
  processingConsentDate: Date;
  retentionExpiryDate: Date;
}

/**
 * Profile with populated user information
 * Used when you need both profile and user data together
 */
export interface IProfileWithUser extends Omit<IProfileDocument, 'user'> {
  user: IPopulatedUser;
}

export interface ClientVendorInfo {
  linkedVendorUid?: Types.ObjectId;
}

/**
 * Type guard to check if profile has populated user
 */
export function isProfileWithPopulatedUser(
  profile: IProfileDocument | null
): profile is { user: IPopulatedUser } & IProfileDocument {
  if (!profile) return false;
  const user = profile.user;
  return (
    user !== null &&
    typeof user === 'object' &&
    !(user instanceof Types.ObjectId) &&
    'uid' in user &&
    'email' in user
  );
}
