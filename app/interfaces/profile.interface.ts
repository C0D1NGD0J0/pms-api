import { Document, Types } from 'mongoose';

import { IdentificationType } from './user.interface';

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
  serviceAreas?: {
    citywide?: boolean;
    commercial?: boolean;
    downtown?: boolean;
    industrial?: boolean;
    national?: boolean;
    regional?: boolean;
    residential?: boolean;
    statewide?: boolean;
    suburbs?: boolean;
    uptown?: boolean;
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

export interface GDPRSettings {
  dataRetentionPolicy: DataRetentionPolicy;
  dataProcessingConsent: boolean;
  processingConsentDate: Date;
  retentionExpiryDate: Date;
}

export interface EmployeeInfo {
  permissions?: string[];
  department?: string;
  employeeId?: string;
  reportsTo?: string;
  jobTitle?: string;
  startDate?: Date;
}

export interface NotificationSettings {
  announcements: boolean;
  comments: boolean;
  messages: boolean;
}

export interface ClientRoleInfo {
  employeeInfo?: EmployeeInfo;
  vendorInfo?: VendorInfo;
  cuid: string;
}
