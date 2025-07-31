import { Document, Types } from 'mongoose';

import { IdentificationType } from './user.interface';

enum DataRetentionPolicy {
  STANDARD = 'standard',
  EXTENDED = 'extended',
  MINIMAL = 'minimal',
}

export interface Profile {
  // Common vendor data (stored once)
  vendorInfo?: {
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
    insuranceInfo?: {
      coverageAmount?: number;
      expirationDate?: Date;
      policyNumber?: string;
      provider?: string;
    };
    registrationNumber?: string;
    yearsInBusiness?: number;
    businessType?: string;
    companyName?: string;
    taxId?: string;
  };
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

  // Common employee data (stored once)
  employeeInfo?: {
    department?: string;
    jobTitle?: string;
    specializations?: string[];
  };

  identification?: IdentificationType;

  // Client-specific relationship data
  clientRoleInfo?: ClientRoleInfo[];
  user: Types.ObjectId;
  timeZone: string;
  lang: string;
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

// Client-specific vendor information (varies by client)
export interface ClientVendorInfo {
  serviceAreas?: {
    baseLocation?: {
      address: string;
      coordinates: [number, number]; // [longitude, latitude]
    };
    maxDistance: 10 | 15 | 25 | 50; // km
  };
  contactPerson?: {
    department?: string;
    email?: string;
    jobTitle: string;
    name: string;
    phone?: string;
  };
  clientSpecificRates?: any;
  preferredStatus?: boolean;
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

export interface ClientRoleInfo {
  role: 'vendor' | 'employee' | 'manager' | 'admin' | 'tenant' | 'staff' | 'landlord';
  employeeInfo?: ClientEmployeeInfo;
  vendorInfo?: ClientVendorInfo;
  cuid: string;
}

export interface GDPRSettings {
  dataRetentionPolicy: DataRetentionPolicy;
  dataProcessingConsent: boolean;
  processingConsentDate: Date;
  retentionExpiryDate: Date;
}

// Keep original interfaces for backward compatibility during migration
export interface EmployeeInfo {
  permissions?: string[];
  department?: string;
  employeeId?: string;
  reportsTo?: string;
  jobTitle?: string;
  startDate?: Date;
}

// Client-specific employee information (varies by client)
export interface ClientEmployeeInfo {
  clientSpecificSettings?: any;
  permissions?: string[];
  employeeId?: string;
  reportsTo?: string;
  startDate?: Date;
}

export interface NotificationSettings {
  announcements: boolean;
  comments: boolean;
  messages: boolean;
}
