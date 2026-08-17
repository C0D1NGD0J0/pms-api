import { Document, Types } from 'mongoose';

import { CURRENCIES } from './utils.interface';

export enum PropertyUnitStatusEnum {
  MAINTENANCE = 'maintenance',
  AVAILABLE = 'available',
  INACTIVE = 'inactive',
  OCCUPIED = 'occupied',
  RESERVED = 'reserved',
}

export enum PropertyUnitInspectionStatusEnum {
  NEEDS_REPAIR = 'needs_repair',
  SCHEDULED = 'scheduled',
  FAILED = 'failed',
  PASSED = 'passed',
}

export enum PropertyUnitTypeEnum {
  RESIDENTIAL = 'residential',
  COMMERCIAL = 'commercial',
  STORAGE = 'storage',
  OTHER = 'other',
}

export enum DocumentTypeEnum {
  INSPECTION = 'inspection',
  LEASE = 'lease',
  OTHER = 'other',
}

export enum DocumentStatusEnum {
  INACTIVE = 'inactive',
  ACTIVE = 'active',
}

export interface IPropertyUnitDocument extends IPropertyUnit, Document {
  // Instance methods
  calculateRentAdjustment: (percentage: number) => {
    oldAmount: number;
    newAmount: number;
    difference: number;
    percentageApplied: number;
  };
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
  isManagementAuthorized(): boolean;

  // Virtual and computed properties
  lastInspectionDate?: Date;
  _id: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  id: string;
}

export interface IPropertyUnit {
  approvalDetails?: IPropertyUnitApprovalDetail[];
  pendingChanges?: IPropertyUnitPendingChanges;
  specifications: IPropertyUnitSpecifications;
  inspections?: PropertyUnitInspection[];
  unitAuthorization?: IUnitAuthorization;
  documents?: PropertyUnitDocument[];
  amenities: IPropertyUnitAmenities;
  utilities: IPropertyUnitUtilities;
  approvalStatus?: ApprovalStatus;
  lastModifiedBy?: Types.ObjectId;
  currentLease?: Types.ObjectId;
  notes?: IPropertyUnitNote[];
  media?: IPropertyUnitMedia;
  propertyId: Types.ObjectId;
  status: PropertyUnitStatus;
  unitType: PropertyUnitType;
  createdBy: Types.ObjectId;
  managedBy: Types.ObjectId;
  fees: IPropertyUnitFees;
  unitOwner?: IUnitOwner;
  description?: string;
  unitNumber: string;
  isActive: boolean;
  floor?: number;
  cuid: string;
  puid: string;
}

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

export type PropertyUnitDocument = {
  uploadedBy?: Types.ObjectId;
  documentType: PropertyUnitDocumentType;
  status: PropertyUnitDocumentStatus;
  documentName?: string;
  externalUrl?: string;
  description?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
};

export type PropertyUnitInspection = {
  inspector: {
    name: string;
    contact: string;
    company?: string;
  };
  attachments?: PropertyUnitInspectionAttachment[];
  status: PropertyUnitInspectionStatus;
  inspectionDate: Date;
  notes?: string;
};

export interface IUnitAuthorization {
  documentUrl?: string; // S3 link to unit-specific management agreement
  isActive: boolean; // Simple on/off switch
  expiresAt?: Date; // When authorization expires (optional)
  notes?: string; // Internal notes
}

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

export interface IPropertyUnitAmenities {
  airConditioning: boolean;
  washerDryer: boolean;
  dishwasher: boolean;
  internet: boolean;
  parking: boolean;
  cableTV: boolean;
  storage: boolean;
}

export type PropertyUnitPhoto = {
  uploadedBy?: Types.ObjectId;
  isPrimary: boolean;
  filename?: string;
  caption?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
};

export interface IPropertyUnitPendingChanges {
  updatedBy: Types.ObjectId;
  displayName: string;
  [key: string]: any;
  updatedAt: Date;
}

export interface IPropertyUnitNote {
  createdBy: Types.ObjectId;
  content: string;
  createdAt: Date;
  html?: string;
  title: string;
}

export interface IPropertyUnitUtilities {
  centralAC: boolean;
  heating: boolean;
  water: boolean;
  trash: boolean;
  gas: boolean;
}

export interface IPropertyUnitSpecifications {
  maxOccupants?: number;
  bathrooms?: number;
  totalArea: number;
  bedrooms?: number;
}

export interface IPropertyUnitApprovalDetail {
  action: ApprovalAction;
  actor: Types.ObjectId;
  timestamp: Date;
  notes?: string;
}

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

export type PropertyUnitInspectionAttachment = {
  filename: string;
  uploadedAt: Date;
  key?: string;
  url: string;
};

export interface IPropertyUnitFees {
  securityDeposit?: number;
  currency: CURRENCIES;
  rentAmount: number;
}

export interface IUnitOwner {
  email?: string;
  phone?: string;
  notes?: string;
  name?: string;
}

export type PropertyUnitStatus = 'available' | 'occupied' | 'reserved' | 'maintenance' | 'inactive';

export type PropertyUnitInspectionStatus = 'passed' | 'failed' | 'needs_repair' | 'scheduled';

export type ApprovalAction = 'created' | 'approved' | 'rejected' | 'updated' | 'overridden';

export type PropertyUnitType = 'residential' | 'commercial' | 'storage' | 'other';

export type PropertyUnitDocumentType = 'lease' | 'inspection' | 'other';

export interface IPropertyUnitMedia {
  photos: PropertyUnitPhoto[];
}

/**
 * @deprecated Use PropertyUnitDocumentType instead
 */
export type PropertyUnitDocumentTypeAlias = PropertyUnitDocumentType;

export type UnitTypeRules = {
  [unitType: string]: UnitTypeRule;
};

export type ApprovalStatus = 'approved' | 'pending' | 'rejected';

export type PropertyUnitDocumentStatus = 'active' | 'inactive';

/**
 * @deprecated Use PropertyUnitDocumentStatus instead
 */
export type DocumentStatus = PropertyUnitDocumentStatus;

/**
 * @deprecated Use PropertyUnitStatus instead
 */
export type UnitStatus = PropertyUnitStatus;
