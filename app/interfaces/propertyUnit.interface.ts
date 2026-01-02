import { Document, Types } from 'mongoose';

import { CURRENCIES } from './utils.interface';

/**
 * ============================================================================
 * BASE TYPE DEFINITIONS (Single Source of Truth)
 * ============================================================================
 */

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
 * Property Unit Document Interface (extends Mongoose Document)
 */
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

/**
 * Core Property Unit Interface
 */
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
 * Property Unit Document Type
 */
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

/**
 * Unit Authorization Interface
 * Same structure as property authorization
 */
export interface IUnitAuthorization {
  documentUrl?: string; // S3 link to unit-specific management agreement
  isActive: boolean; // Simple on/off switch
  expiresAt?: Date; // When authorization expires (optional)
  notes?: string; // Internal notes
}

/**
 * ============================================================================
 * ENUMS
 * ============================================================================
 */

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
 * Property Unit Amenities Interface
 */
export interface IPropertyUnitAmenities {
  airConditioning: boolean;
  washerDryer: boolean;
  dishwasher: boolean;
  internet: boolean;
  parking: boolean;
  cableTV: boolean;
  storage: boolean;
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
 * Property Unit Pending Changes Interface
 */
export interface IPropertyUnitPendingChanges {
  updatedBy: Types.ObjectId;
  displayName: string;
  [key: string]: any;
  updatedAt: Date;
}

/**
 * ============================================================================
 * CORE INTERFACES (Single Source of Truth)
 * ============================================================================
 */

/**
 * Property Unit Utilities Interface
 */
export interface IPropertyUnitUtilities {
  centralAC: boolean;
  heating: boolean;
  water: boolean;
  trash: boolean;
  gas: boolean;
}

/**
 * Property Unit Specifications Interface
 */
export interface IPropertyUnitSpecifications {
  maxOccupants?: number;
  bathrooms?: number;
  totalArea: number;
  bedrooms?: number;
}

/**
 * Property Unit Approval Detail Interface
 */
export interface IPropertyUnitApprovalDetail {
  action: ApprovalAction;
  actor: Types.ObjectId;
  timestamp: Date;
  notes?: string;
}

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
 * Property Unit Note Interface
 */
export interface IPropertyUnitNote {
  createdBy: Types.ObjectId;
  content: string;
  createdAt: Date;
  title: string;
}

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
 * Property Unit Fees Interface
 */
export interface IPropertyUnitFees {
  securityDeposit?: number;
  currency: CURRENCIES;
  rentAmount: number;
}

/**
 * Unit Owner Interface
 * Simpler than property owner, just contact info
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
 * Approval Action Types
 */
export type ApprovalAction = 'created' | 'approved' | 'rejected' | 'updated' | 'overridden';

/**
 * Property Unit Type Classifications
 */
export type PropertyUnitType = 'residential' | 'commercial' | 'storage' | 'other';

/**
 * Inspection Status Types
 */
export type InspectionStatus = 'passed' | 'failed' | 'needs_repair' | 'scheduled';

/**
 * Property Unit Document Type Classifications
 */
export type PropertyUnitDocumentType = 'lease' | 'inspection' | 'other';

/**
 * Property Unit Media Interface
 */
export interface IPropertyUnitMedia {
  photos: PropertyUnitPhoto[];
}

/**
 * ============================================================================
 * DOCUMENT INTERFACES (Mongoose Extensions)
 * ============================================================================
 */

/**
 * Unit Type Rules Collection
 */
export type UnitTypeRules = {
  [unitType: string]: UnitTypeRule;
};

/**
 * ============================================================================
 * QUERY & FILTER INTERFACES
 * ============================================================================
 */

/**
 * Approval Status Types
 */
export type ApprovalStatus = 'approved' | 'pending' | 'rejected';

/**
 * ============================================================================
 * CONFIGURATION INTERFACES
 * ============================================================================
 */

/**
 * Property Unit Document Status Types
 */
export type PropertyUnitDocumentStatus = 'active' | 'inactive';

/**
 * @deprecated Use PropertyUnitDocumentStatus instead
 */
export type DocumentStatus = PropertyUnitDocumentStatus;

/**
 * @deprecated Use PropertyUnitDocumentType instead
 */
export type DocumentType = PropertyUnitDocumentType;

/**
 * ============================================================================
 * LEGACY TYPES (Backward Compatibility)
 * ============================================================================
 */

/**
 * Legacy alias for backward compatibility
 * @deprecated Use PropertyUnitStatus instead
 */
export type UnitStatus = PropertyUnitStatus;
