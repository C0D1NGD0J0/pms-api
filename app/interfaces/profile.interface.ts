import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import { IdentificationType } from './user.interface';

export enum EmployeeDepartment {
  MAINTENANCE = 'maintenance', // Maintenance and repairs
  OPERATIONS = 'operations', // Day-to-day property operations
  ACCOUNTING = 'accounting', // Financial operations and rent collection
  MANAGEMENT = 'management', // Executive and general management
}

enum DataRetentionPolicy {
  STANDARD = 'standard',
  EXTENDED = 'extended',
  MINIMAL = 'minimal',
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

  identification?: IdentificationType;
  employeeInfo?: EmployeeInfo;
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
  identification?: Partial<IdentificationType>;
  userInfo?: {
    email?: string;
  };
  employeeInfo?: Partial<EmployeeInfo>;
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
  leases: boolean;
  users: boolean;
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
