import { Document, Types } from 'mongoose';

/**
 * Main Vendor Interface
 */
export interface IVendor {
  servicesOffered?: VendorServicesOffered;
  primaryAccountHolder: Types.ObjectId; // References the user who owns this vendor account
  insuranceInfo?: VendorInsuranceInfo;
  contactPerson?: VendorContactPerson;
  serviceAreas?: VendorServiceAreas;
  registrationNumber?: string;
  yearsInBusiness?: number;
  address?: VendorAddress;
  businessType?: string;
  companyName?: string;
  taxId?: string;
}

/**
 * Services offered by vendor
 */
export interface VendorServicesOffered {
  applianceRepair?: boolean;
  landscaping?: boolean;
  maintenance?: boolean;
  pestControl?: boolean;
  electrical?: boolean;
  carpentry?: boolean;
  cleaning?: boolean;
  painting?: boolean;
  plumbing?: boolean;
  security?: boolean;
  roofing?: boolean;
  other?: boolean;
  hvac?: boolean;
}

/**
 * Vendor address information
 */
export interface VendorAddress {
  computedLocation: {
    coordinates: [number, number]; // [longitude, latitude]
    type: 'Point';
  };
  streetNumber?: string;
  fullAddress: string;
  unitNumber?: string;
  postCode?: string;
  country?: string;
  street?: string;
  state?: string;
  city?: string;
}

/**
 * Vendor Document Interface (extends Mongoose Document)
 */
export interface IVendorDocument extends Document, IVendor {
  _id: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  vuid: string; // vendor UID
  id: string;
}

/**
 * Vendor service areas
 */
export interface VendorServiceAreas {
  baseLocation?: {
    address: string;
    coordinates: [number, number]; // [longitude, latitude]
  };
  maxDistance: 10 | 15 | 25 | 50; // km
}

/**
 * Vendor insurance information
 */
export interface VendorInsuranceInfo {
  coverageAmount?: number;
  expirationDate?: Date;
  policyNumber?: string;
  provider?: string;
}

/**
 * Vendor contact person information
 */
export interface VendorContactPerson {
  department?: string;
  jobTitle: string;
  email?: string;
  phone?: string;
  name: string;
}

/**
 * New Vendor Type (for creation)
 */
export type NewVendor = Omit<IVendor, 'vid'>;
