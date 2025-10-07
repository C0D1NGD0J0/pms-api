import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import { IdentificationType } from './user.interface';

export enum EmployeeDepartment {
  MAINTENANCE = 'maintenance', // Maintenance and repairs
  OPERATIONS = 'operations', // Day-to-day property operations
  ACCOUNTING = 'accounting', // Financial operations and rent collection
  MANAGEMENT = 'management', // Executive and general management
}

export enum BackgroundCheckStatus {
  NOT_REQUIRED = 'not_required',
  APPROVED = 'approved',
  PENDING = 'pending',
  FAILED = 'failed',
}

enum DataRetentionPolicy {
  STANDARD = 'standard',
  EXTENDED = 'extended',
  MINIMAL = 'minimal',
}

/**
 * Tenant information structure
 * - employerInfo, activeLeases, backgroundChecks are client-specific (filtered by cuid)
 * - rentalReferences, pets, emergencyContact are shared across all clients
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

  backgroundChecks?: {
    cuid: string; // Track which client performed the background check
    status: BackgroundCheckStatus;
    checkedDate: Date;
    expiryDate?: Date;
    notes?: string;
  }[];

  activeLeases?: {
    cuid: string; // Track which client the lease is associated with
    leaseId: string | Types.ObjectId; // Reference to Lease entity - all details fetched from there
  }[];

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

  settings: {
    gdprSettings: GDPRSettings;
    loginType: 'otp' | 'password';
    notifications: NotificationSettings;
    theme: 'light' | 'dark';
  };

  employeeInfo?: EmployeeInfo;
  tenantInfo?: TenantInfo;
  vendorInfo?: VendorInfo;

  user: Types.ObjectId;
  timeZone: string;
  lang: string;
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
  permissions?: string[];
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

export interface ClientVendorInfo {
  linkedVendorUid?: Types.ObjectId;
}
