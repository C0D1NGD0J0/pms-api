import { Document, Types } from 'mongoose';

import { CURRENCIES } from './utils.interface';

export const PropertyUnitTypeEnum = {
  STUDIO: 'studio',
  ONE_BR: '1BR',
  TWO_BR: '2BR',
  THREE_BR: '3BR',
  FOUR_BR_PLUS: '4BR+',
  PENTHOUSE: 'penthouse',
  LOFT: 'loft',
  COMMERCIAL: 'commercial',
  OTHER: 'other',
} as const;

export const PropertyUnitStatusEnum = {
  AVAILABLE: 'available',
  OCCUPIED: 'occupied',
  RESERVED: 'reserved',
  MAINTENANCE: 'maintenance',
  INACTIVE: 'inactive',
} as const;

export const DocumentTypeEnum = {
  LEASE: 'lease',
  INSPECTION: 'inspection',
  OTHER: 'other',
} as const;

export const DocumentStatusEnum = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;

export const InspectionStatusEnum = {
  PASSED: 'passed',
  FAILED: 'failed',
  NEEDS_REPAIR: 'needs_repair',
  SCHEDULED: 'scheduled',
} as const;

export interface IPropertyUnitDocument extends IPropertyUnit, Document {
  calculateRentAdjustment: (percentage: number) => {
    oldAmount: number;
    newAmount: number;
    difference: number;
    percentageApplied: number;
  };
  notes?: Array<{
    title: string;
    content: string;
    createdAt: Date;
    createdBy: string;
  }>;
  applyRentAdjustment: (percentage: number, userId: string) => Promise<IPropertyUnitDocument>;
  prepareForMaintenance: (reason: string, userId: string) => Promise<IPropertyUnitDocument>;
  markUnitAsOccupied: (leaseId: string, userId: string) => Promise<IPropertyUnitDocument>;
  addInspection: (inspectionData: any, userId: string) => Promise<IPropertyUnitDocument>;
  makeUnitAvailable: (userId: string) => Promise<IPropertyUnitDocument>;
  markUnitAsVacant: (userId: string) => Promise<IPropertyUnitDocument>;

  // Methods
  softDelete: (userId: string) => Promise<IPropertyUnitDocument>;
  lastInspectionDate?: Date;

  // Document fields
  _id: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  id: string;
}

export interface IPropertyUnit {
  amenities: {
    airConditioning: boolean;
    washerDryer: boolean;
    dishwasher: boolean;
    parking: boolean;
    cableTV: boolean;
    internet: boolean;
    storage: boolean;
  };
  utilities: {
    water: boolean;
    centralAC: boolean;
    heating: boolean;
    gas: boolean;
    trash: boolean;
  };
  specifications: {
    totalArea: number;
    bedrooms?: number;
    bathrooms?: number;
    maxOccupants?: number;
  };
  fees: {
    currency: CURRENCIES;
    rentAmount: number;
    securityDeposit?: number;
  };
  media?: {
    photos: PropertyUnitPhoto[];
  };
  inspections?: PropertyUnitInspection[];
  documents?: PropertyUnitDocument[];
  lastModifiedBy?: Types.ObjectId;
  currentLease?: Types.ObjectId;
  propertyId: Types.ObjectId;
  status: PropertyUnitStatus;
  unitType: PropertyUnitType;
  createdBy: Types.ObjectId;
  description?: string;
  unitNumber: string;
  isActive: boolean;
  floor?: number;
  puid: string;
  cid: string;
}

export interface IPropertyUnitFilterQuery {
  filters: {
    propertyId?: string | Types.ObjectId;
    status?: PropertyUnitStatus;
    type?: PropertyUnitType;
    priceRange?: {
      min?: number;
      max?: number;
    };
    areaRange?: {
      min?: number;
      max?: number;
    };
    bedrooms?: number | 'any';
    bathrooms?: number | 'any';
    floor?: number | 'any';
    amenities?: string[];
    utilities?: string[];
    isActive?: boolean;
    searchTerm?: string;
    dateRange?: {
      field: 'createdAt' | 'updatedAt' | 'lastInspectionDate';
      start?: Date | string;
      end?: Date | string;
    };
  };
  pagination: {
    page: number;
    limit: number;
    sort?: {
      [key: string]: 1 | -1;
    };
  };
}

export interface PropertyUnitDocument {
  uploadedBy?: Types.ObjectId;
  documentType: DocumentType;
  status: DocumentStatus;
  documentName?: string;
  externalUrl?: string;
  description?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

export interface PropertyUnitInspection {
  inspector: {
    name: string;
    contact: string;
    company?: string;
  };
  attachments?: PropertyUnitInspectionAttachment[];
  status: InspectionStatus;
  inspectionDate: Date;
  notes?: string;
}

export interface PropertyUnitPhoto {
  uploadedBy?: Types.ObjectId;
  isPrimary: boolean;
  filename?: string;
  caption?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

export interface PropertyUnitInspectionAttachment {
  filename: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

export type PropertyUnitStatus =
  (typeof PropertyUnitStatusEnum)[keyof typeof PropertyUnitStatusEnum];

export type InspectionStatus = (typeof InspectionStatusEnum)[keyof typeof InspectionStatusEnum];

// Type definitions using the enums
export type PropertyUnitType = (typeof PropertyUnitTypeEnum)[keyof typeof PropertyUnitTypeEnum];

export type DocumentStatus = (typeof DocumentStatusEnum)[keyof typeof DocumentStatusEnum];

export type DocumentType = (typeof DocumentTypeEnum)[keyof typeof DocumentTypeEnum];
