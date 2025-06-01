import { Document, Types } from 'mongoose';

import { CURRENCIES } from './utils.interface';

export const PropertyUnitTypeEnum = {
  RESIDENTIAL: 'residential',
  COMMERCIAL: 'commercial',
  STORAGE: 'storage',
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

export type PropertyUnitType = (typeof PropertyUnitTypeEnum)[keyof typeof PropertyUnitTypeEnum];

export type DocumentStatus = (typeof DocumentStatusEnum)[keyof typeof DocumentStatusEnum];

export type DocumentType = (typeof DocumentTypeEnum)[keyof typeof DocumentTypeEnum];

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

export type UnitStatus = (typeof UnitStatusEnum)[keyof typeof UnitStatusEnum];

// Type definitions using the enums
export type UnitType = (typeof UnitTypeEnum)[keyof typeof UnitTypeEnum];
