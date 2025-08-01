import { Document, Types } from 'mongoose';

import { IdentificationType, IUserRoleType } from './user.interface';

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

export interface VendorInfo {
  servicesOffered?: {
    applianceRepair?: boolean;
    carpentry?: boolean;
    cleaning?: boolean;
    electrical?: boolean;
    hvac?: boolean;
    landscaping?: boolean;
    maintenance?: boolean;
    other?: boolean;
    painting?: boolean;
    pestControl?: boolean;
    plumbing?: boolean;
    roofing?: boolean;
    security?: boolean;
  };
  address?: {
    city?: string;
    computedLocation: {
      coordinates: [number, number]; // [longitude, latitude]
      type: 'Point';
    };
    country?: string;
    fullAddress: string;
    postCode?: string;
    state?: string;
    street?: string;
    streetNumber?: string;
    unitNumber?: string;
  };
  serviceAreas?: {
    baseLocation?: {
      address: string;
      coordinates: [number, number]; // [longitude, latitude]
    };
    maxDistance: 10 | 15 | 25 | 50; // km
  };
  insuranceInfo?: {
    coverageAmount?: number;
    expirationDate?: Date;
    policyNumber?: string;
    provider?: string;
  };
  contactPerson?: {
    department?: string;
    email?: string;
    jobTitle: string;
    name: string;
    phone?: string;
  };
  registrationNumber?: string;
  yearsInBusiness?: number;
  businessType?: string;
  companyName?: string;
  taxId?: string;
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
  settings: {
    gdprSettings: GDPRSettings;
    loginType: 'otp' | 'password';
    notifications: NotificationSettings;
    theme: 'light' | 'dark';
  };

  identification?: IdentificationType;
  clientRoleInfo?: ClientRoleInfo[];

  employeeInfo?: EmployeeInfo;
  vendorInfo?: VendorInfo;
  user: Types.ObjectId;
  timeZone: string;
  lang: string;
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

export interface ClientRoleInfo {
  linkedVendorId?: string;
  isConnected: boolean;
  role: IUserRoleType;
  cuid: string;
}

export interface NotificationSettings {
  announcements: boolean;
  comments: boolean;
  messages: boolean;
}
export interface ClientVendorInfo {
  linkedVendorId?: Types.ObjectId;
}
