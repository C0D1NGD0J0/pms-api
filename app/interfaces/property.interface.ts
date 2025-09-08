import { Document, Types } from 'mongoose';

import { IClientInfo } from './client.interface';
import { IPaginationQuery, CURRENCIES } from './utils.interface';

/**
 * Property Enums
 */
export enum PropertyApprovalStatusEnum {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PENDING = 'pending',
  DRAFT = 'draft',
}

/**
 * Main Property Interface
 */
export interface IProperty {
  fees: {
    taxAmount: number;
    currency: CURRENCIES;
    rentalAmount: number | string;
    managementFees: number | string;
  };
  description?: {
    html?: string;
    text?: string;
  };
  approvalDetails?: PropertyApprovalDetails;
  communityAmenities?: CommunityAmenities;
  approvalStatus?: PropertyApprovalStatus;
  pendingChanges?: IPendingChanges | null;
  specifications: PropertySpecifications;
  interiorAmenities?: InteriorAmenities;
  computedLocation?: ComputedLocation;
  financialDetails?: FinancialDetails;
  documents?: PropertyDocumentItem[];
  occupancyStatus: OccupancyStatus;
  utilities: PropertyUtilities;
  propertyType: PropertyType;
  managedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  maxAllowedUnits?: number;
  address: AddressDetails;
  status: PropertyStatus;
  yearBuilt?: number;
  name: string;
  cuid: string;
}

/**
 * Property Filter Query Interface
 */
export interface IPropertyFilterQuery {
  filters: {
    propertyType?: PropertyType;
    status?: PropertyStatus;
    occupancyStatus?: OccupancyStatus;
    priceRange?: {
      min?: number;
      max?: number;
    };
    areaRange?: {
      min?: number;
      max?: number;
    };
    location?: {
      city?: string;
      state?: string;
      postCode?: string;
    };
    yearBuilt?: {
      min?: number;
      max?: number;
    };
    searchTerm?: string;
    managedBy?: string;
    dateRange?: {
      field: 'createdAt' | 'updatedAt' | 'financialDetails.purchaseDate';
      start?: Date | string;
      end?: Date | string;
    };
    includeUnapproved?: boolean;
    approvalStatus?: PropertyApprovalStatus;
  } | null;
  pagination: IPaginationQuery;
  currentUser?: any;
}

/**
 * Property Type Rule Interface
 */
export interface PropertyTypeRule {
  validationRules?: {
    maxTotalArea?: number;
    minTotalArea?: number;
    maxUnits?: number;
    allowBedrooms?: boolean;
    allowBathrooms?: boolean;
    requiresElevator?: boolean;
  };
  visibleFields: {
    core: string[];
    specifications: string[];
    financial: string[];
    amenities: string[];
    documents: string[];
    unit: string[];
  };
  helpText: Record<string, string>;
  validateBedBath: boolean;
  requiredFields: string[];
  isMultiUnit: boolean;
  defaultUnits: number;
  minUnits: number;
}

/**
 * Property Document Item Type
 */
export interface PropertyDocumentItem {
  documentType?: 'deed' | 'tax' | 'insurance' | 'inspection' | 'other' | 'lease' | 'unknown';
  status: 'pending' | 'processing' | 'active' | 'inactive' | 'deleted';
  uploadedBy: Types.ObjectId;
  description?: string;
  documentName: string;
  externalUrl: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

/**
 * Assignable User Interface (for property assignment)
 */
export interface IAssignableUser {
  employeeInfo?: {
    jobTitle?: string;
    employeeId?: string;
    department?: string;
  };
  role: 'admin' | 'staff' | 'manager';
  displayName: string;
  department?: string;
  email: string;
  id: string;
}

/**
 * Community Amenities Type
 */
export interface CommunityAmenities {
  laundryFacility: boolean;
  securitySystem: boolean;
  fitnessCenter: boolean;
  swimmingPool: boolean;
  petFriendly: boolean;
  elevator: boolean;
  parking: boolean;
  doorman: boolean;
}

/**
 * Unit Information Type
 */
export interface UnitInfo {
  suggestedNextUnitNumber?: string;
  availableSpaces: number;
  lastUnitNumber?: string;
  maxAllowedUnits: number;
  unitStats: UnitStats;
  currentUnits: number;
  canAddUnit: boolean;
}

/**
 * Property Document Interface (extends Mongoose Document)
 */
export interface IPropertyDocument extends IProperty, Document {
  lastModifiedBy?: Types.ObjectId;
  _id: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  pid: string;
  id: string;
}

/**
 * CSV Job Data Type
 */
export interface CsvJobData {
  bulkCreateOptions?: {
    sendNotifications?: boolean;
    passwordLength?: number;
  };
  clientInfo: IClientInfo;
  csvFilePath: string;
  userId: string;
  jobId?: string;
}

/**
 * Address Details Type
 */
export interface AddressDetails {
  streetNumber?: string;
  fullAddress?: string;
  latAndlon?: string;
  postCode?: string;
  country?: string;
  street?: string;
  state?: string;
  city?: string;
}

/**
 * Interior Amenities Type
 */
export interface InteriorAmenities {
  airConditioning: boolean;
  storageSpace: boolean;
  washerDryer: boolean;
  dishwasher: boolean;
  furnished: boolean;
  heating: boolean;
  fridge: boolean;
}

/**
 * Property Specifications Type
 */
export interface PropertySpecifications {
  garageSpaces?: number;
  maxOccupants?: number;
  bathrooms?: number;
  totalArea: number;
  bedrooms?: number;
  lotSize?: number;
  floors?: number;
}

/**
 * Property Approval Details
 */
export interface PropertyApprovalDetails {
  requestedBy?: Types.ObjectId;
  rejectionReason?: string[];
  actor?: Types.ObjectId;
  updatedAt?: Date;
  notes?: string[];
}

/**
 * Assignable Users Filter Interface
 */
export interface IAssignableUsersFilter {
  role?: 'admin' | 'staff' | 'manager' | 'all';
  department?: string;
  search?: string;
  limit?: number;
  page?: number;
}

/**
 * Financial Details Type
 */
export interface FinancialDetails {
  lastAssessmentDate?: Date;
  purchasePrice?: number;
  marketValue?: number;
  propertyTax?: number;
  purchaseDate?: Date;
}

/**
 * Property Utilities Type
 */
export interface PropertyUtilities {
  electricity: boolean;
  internet: boolean;
  cableTV: boolean;
  water: boolean;
  trash: boolean;
  gas: boolean;
}

/**
 * Unit Statistics Type
 */
export interface UnitStats {
  maintenance: number;
  available: number;
  occupied: number;
  reserved: number;
  inactive: number;
  vacant: number;
}

/**
 * Pending Changes Type - using Omit to exclude specific fields
 */
export type IPendingChanges = Partial<Omit<IProperty, 'cuid' | 'pid' | 'id' | '_id'>> & {
  updatedBy: Types.ObjectId;
  updatedAt: Date;
};

/**
 * Property Type Classifications
 */
export type PropertyType =
  | 'apartment'
  | 'house'
  | 'condominium'
  | 'townhouse'
  | 'commercial'
  | 'industrial';

/**
 * Property with Unit Info Interface - using intersection type
 */
export type IPropertyWithUnitInfo = Partial<{ property: IPropertyDocument }> & {
  unitInfo: UnitInfo;
};

/**
 * Property Status Types
 */
export type PropertyStatus = 'available' | 'occupied' | 'maintenance' | 'construction' | 'inactive';

/**
 * Property Approval Status Types
 */
export type PropertyApprovalStatus = 'pending' | 'approved' | 'rejected' | 'draft';

/**
 * New Property Type (for creation) - using Omit to exclude pid
 */
export type NewProperty = {
  fullAddress: string;
} & Omit<IProperty, 'pid'>;

/**
 * Occupancy Status Types
 */
export type OccupancyStatus = 'vacant' | 'occupied' | 'partially_occupied';

/**
 * Property Type Rules Collection
 * Using Record with string to allow dynamic access
 */
export type PropertyTypeRules = Record<string, PropertyTypeRule>;

/**
 * Computed Location Type
 */
export interface ComputedLocation {
  coordinates: number[];
}

/**
 * Export commonly used types for backward compatibility
 * These are being kept to avoid breaking existing code
 */
export type IPropertyDocumentItem = PropertyDocumentItem;
export type ISpecifications = PropertySpecifications;
export type ICommunityAmenities = CommunityAmenities;
export type IInteriorAmenities = InteriorAmenities;
export type IFinancialDetails = FinancialDetails;
export type IComputedLocation = ComputedLocation;
export type IAddressDetails = AddressDetails;
export type IUtilities = PropertyUtilities;
export type NewPropertyType = NewProperty;
export type IUnitStats = UnitStats;
export type IUnitInfo = UnitInfo;
