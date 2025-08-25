import { Document, Types } from 'mongoose';

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

export interface VendorInfo {
  vendorId?: Types.ObjectId; // Reference to the vendor collection
  isLinkedAccount: boolean;
  linkedVendorId?: string; // Reference to primary vendor (stays as string to match user model)
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

// ClientRoleInfo interface removed as it's now part of the User model's cuids array

export interface NotificationSettings {
  announcements: boolean;
  comments: boolean;
  messages: boolean;
}
export interface ClientVendorInfo {
  linkedVendorId?: Types.ObjectId;
}
