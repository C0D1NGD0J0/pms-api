import { Document, Types } from 'mongoose';

import { CURRENCIES } from './utils.interface';

/**
 * Property Unit Status Enum
 */
export enum PropertyUnitStatusEnum {
  MAINTENANCE = 'maintenance',
  AVAILABLE = 'available',
  INACTIVE = 'inactive',
  OCCUPIED = 'occupied',
  RESERVED = 'reserved',
}

/**
 * Property Unit Type Enum
 */
export enum PropertyUnitTypeEnum {
  RESIDENTIAL = 'residential',
  COMMERCIAL = 'commercial',
  STORAGE = 'storage',
  OTHER = 'other',
}

/**
 * Inspection Status Enum
 */
export enum InspectionStatusEnum {
  NEEDS_REPAIR = 'needs_repair',
  SCHEDULED = 'scheduled',
  FAILED = 'failed',
  PASSED = 'passed',
}

/**
 * Document Type Enum
 */
export enum DocumentTypeEnum {
  INSPECTION = 'inspection',
  LEASE = 'lease',
  OTHER = 'other',
}

/**
 * Document Status Enum
 */
export enum DocumentStatusEnum {
  INACTIVE = 'inactive',
  ACTIVE = 'active',
}

/**
 * Core Property Unit Interface
 */
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
  approvalDetails?: Array<{
    action: 'created' | 'approved' | 'rejected' | 'updated' | 'overridden';
    actor: Types.ObjectId;
    timestamp: Date;
    notes?: string;
  }>;
  pendingChanges?: {
    [key: string]: any;
    updatedBy: Types.ObjectId;
    updatedAt: Date;
    displayName: string;
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
  notes?: Array<{
    title: string;
    content: string;
    createdAt: Date;
    createdBy: Types.ObjectId;
  }>;
  fees: {
    currency: CURRENCIES;
    rentAmount: number;
    securityDeposit?: number;
  };
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  media?: {
    photos: PropertyUnitPhoto[];
  };
  inspections?: PropertyUnitInspection[];
  unitAuthorization?: IUnitAuthorization;
  documents?: PropertyUnitDocument[];
  lastModifiedBy?: Types.ObjectId;
  currentLease?: Types.ObjectId;
  propertyId: Types.ObjectId;
  status: PropertyUnitStatus;
  unitType: PropertyUnitType;
  createdBy: Types.ObjectId;
  unitOwner?: IUnitOwner;
  description?: string;
  unitNumber: string;
  isActive: boolean;
  floor?: number;
  cuid: string;
  puid: string;
}

/**
 * Property Unit Document Interface (extends Mongoose Document)
 */
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
    createdBy: Types.ObjectId;
  }>;
  getAuthorizationStatus(): {
    isAuthorized: boolean;
    reason?: string;
    daysUntilExpiry?: number;
  };
  applyRentAdjustment: (percentage: number, userId: string) => Promise<IPropertyUnitDocument>;
  prepareForMaintenance: (reason: string, userId: string) => Promise<IPropertyUnitDocument>;
  markUnitAsOccupied: (leaseId: string, userId: string) => Promise<IPropertyUnitDocument>;
  addInspection: (inspectionData: any, userId: string) => Promise<IPropertyUnitDocument>;
  makeUnitAvailable: (userId: string) => Promise<IPropertyUnitDocument>;
  markUnitAsVacant: (userId: string) => Promise<IPropertyUnitDocument>;
  softDelete: (userId: string) => Promise<IPropertyUnitDocument>;
  // Authorization methods
  isManagementAuthorized(): boolean;

  lastInspectionDate?: Date;
  _id: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  id: string;
}

/**
 * Property Unit Filter Query Type
 */
export type PropertyUnitFilterQuery = {
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
};

/**
 * Unit Authorization Interface - Same structure as property authorization
 */
export interface IUnitAuthorization {
  documentUrl?: string; // S3 link to unit-specific management agreement
  isActive: boolean; // Simple on/off switch
  expiresAt?: Date; // When authorization expires (optional)
  notes?: string; // Internal notes
}

/**
 * Property Unit Document Type
 */
export type PropertyUnitDocument = {
  uploadedBy?: Types.ObjectId;
  documentType: DocumentType;
  status: DocumentStatus;
  documentName?: string;
  externalUrl?: string;
  description?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
};

/**
 * Property Unit Inspection Type
 */
export type PropertyUnitInspection = {
  inspector: {
    name: string;
    contact: string;
    company?: string;
  };
  attachments?: PropertyUnitInspectionAttachment[];
  status: InspectionStatus;
  inspectionDate: Date;
  notes?: string;
};

/**
 * Unit Type Management Rules Interface
 */
export interface UnitTypeRule {
  visibleFields: {
    amenities: string[];
    fees: string[];
    specifications: string[];
    utilities: string[];
  };
  helpText?: { [fieldName: string]: string };
  requiredFields?: string[];
}

/**
 * Property Unit Photo Type
 */
export type PropertyUnitPhoto = {
  uploadedBy?: Types.ObjectId;
  isPrimary: boolean;
  filename?: string;
  caption?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
};

/**
 * Unit Feature Configuration
 */
export type UnitFeature = {
  category: 'basic' | 'premium' | 'luxury';
  description?: string;
  amenityKey: string;
  label: string;
};

/**
 * Legacy Types (for backward compatibility)
 * @deprecated Use PropertyUnitType and PropertyUnitStatus instead
 */
export type UnitType =
  | 'studio'
  | '1BR'
  | '2BR'
  | '3BR'
  | '4BR+'
  | 'penthouse'
  | 'loft'
  | 'commercial'
  | 'other';

/**
 * Property Unit Inspection Attachment Type
 */
export type PropertyUnitInspectionAttachment = {
  filename: string;
  uploadedAt: Date;
  key?: string;
  url: string;
};

/**
 * Unit Owner Interface - Simpler than property owner, just contact info
 */
export interface IUnitOwner {
  email?: string;
  phone?: string;
  notes?: string;
  name?: string;
}

/**
 * Property Unit Status Types
 */
export type PropertyUnitStatus = 'available' | 'occupied' | 'reserved' | 'maintenance' | 'inactive';

/**
 * Property Unit Type Classifications
 */
export type PropertyUnitType = 'residential' | 'commercial' | 'storage' | 'other';

/**
 * Inspection Status Types
 */
export type InspectionStatus = 'passed' | 'failed' | 'needs_repair' | 'scheduled';

/**
 * Unit Type Rules Collection
 */
export type UnitTypeRules = {
  [unitType: string]: UnitTypeRule;
};

/**
 * Document Type Classifications
 */
export type DocumentType = 'lease' | 'inspection' | 'other';

/**
 * Document Status Types
 */
export type DocumentStatus = 'active' | 'inactive';
export type UnitStatus = PropertyUnitStatus;
