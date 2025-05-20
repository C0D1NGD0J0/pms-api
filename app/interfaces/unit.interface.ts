import { Document, Types } from 'mongoose';

import { CURRENCIES } from './utils.interface';

export const UnitTypeEnum = {
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

export const UnitStatusEnum = {
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

export interface IUnitDocument extends Document, IUnit {
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
  applyRentAdjustment: (percentage: number, userId: string) => Promise<IUnitDocument>;
  prepareForMaintenance: (reason: string, userId: string) => Promise<IUnitDocument>;
  markUnitAsOccupied: (leaseId: string, userId: string) => Promise<IUnitDocument>;
  addInspection: (inspectionData: any, userId: string) => Promise<IUnitDocument>;
  makeUnitAvailable: (userId: string) => Promise<IUnitDocument>;

  markUnitAsVacant: (userId: string) => Promise<IUnitDocument>;
  softDelete: (userId: string) => Promise<IUnitDocument>;
  propertyId: Types.ObjectId;
  lastInspectionDate?: Date;
  description?: string;
  _id: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  uid: string;
  cid: string;
  id: string;
}
export interface IUnit {
  amenities: {
    airConditioning: boolean;
    washerDryer: boolean;
    dishwasher: boolean;
    parking: boolean;
    storage: boolean;
    cableTV: boolean;
    internet: boolean;
  };
  utilities: {
    gas: boolean;
    trash: boolean;
    water: boolean;
    heating: boolean;
    centralAC: boolean;
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
    photos: UnitPhoto[];
  };
  lastModifiedBy?: Types.ObjectId;
  inspections?: UnitInspection[];
  currentLease?: Types.ObjectId;
  documents?: UnitDocument[];
  createdBy: Types.ObjectId;
  unitNumber: string;
  status: UnitStatus;
  isActive: boolean;
  floor?: number;
  type: UnitType;
}
export interface IUnitFilterQuery {
  filters: {
    propertyId?: string | Types.ObjectId;
    status?: UnitStatus;
    type?: UnitType;
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
export interface UnitDocument {
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
export interface UnitInspection {
  inspector: {
    name: string;
    contact: string;
    company?: string;
  };
  attachments?: UnitInspectionAttachment[];
  status: InspectionStatus;
  inspectionDate: Date;
  notes?: string;
}

export interface UnitPhoto {
  uploadedBy?: Types.ObjectId;
  isPrimary: boolean;
  filename?: string;
  caption?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

export interface UnitInspectionAttachment {
  filename: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

export type InspectionStatus = (typeof InspectionStatusEnum)[keyof typeof InspectionStatusEnum];

export type DocumentStatus = (typeof DocumentStatusEnum)[keyof typeof DocumentStatusEnum];

export type DocumentType = (typeof DocumentTypeEnum)[keyof typeof DocumentTypeEnum];

export type UnitStatus = (typeof UnitStatusEnum)[keyof typeof UnitStatusEnum];

// Type definitions using the enums
export type UnitType = (typeof UnitTypeEnum)[keyof typeof UnitTypeEnum];
