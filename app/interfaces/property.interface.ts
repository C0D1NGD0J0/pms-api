import { Document, Types } from 'mongoose';

import { IClientInfo } from './client.interface';
import { IUserRole } from '../shared/constants/roles.constants';
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

export enum OwnershipType {
  EXTERNAL_OWNER = 'external_owner',
  COMPANY_OWNED = 'company_owned',
  SELF_OWNED = 'self_owned',
}

/**
 * Main Property Interface
 */
export interface IProperty {
  fees: {
    currency: CURRENCIES;
    managementFees: number | string;
    rentalAmount: number | string;
    taxAmount: number;
  };
  description?: {
    html?: string;
    text?: string;
  };
  approvalDetails?: PropertyApprovalEntry[];
  approvalStatus?: PropertyApprovalStatus;
  communityAmenities?: CommunityAmenities;
  pendingChanges?: IPendingChanges | null;
  specifications: PropertySpecifications;
  authorization?: IPropertyAuthorization;
  interiorAmenities?: InteriorAmenities;
  computedLocation?: ComputedLocation;
  financialDetails?: FinancialDetails;
  occupancyStatus: OccupancyStatus;
  documents?: MediaDocumentItem[];
  images?: PropertyImageItem[];
  utilities: PropertyUtilities;
  managedBy?: Types.ObjectId;
  propertyType: PropertyType;
  createdBy: Types.ObjectId;
  maxAllowedUnits?: number;
  address: AddressDetails;
  status: PropertyStatus;
  owner: IPropertyOwner;
  yearBuilt?: number;
  cuid: string;
  name: string;
}

/**
 * Property Filter Query Interface
 */
export interface IPropertyFilterQuery {
  filters: {
    approvalStatus?: PropertyApprovalStatus;
    areaRange?: {
      max?: number;
      min?: number;
    };
    dateRange?: {
      end?: Date | string;
      field: 'createdAt' | 'updatedAt' | 'financialDetails.purchaseDate';
      start?: Date | string;
    };
    includeUnapproved?: boolean;
    location?: {
      city?: string;
      postCode?: string;
      state?: string;
    };
    managedBy?: string;
    occupancyStatus?: OccupancyStatus;
    priceRange?: {
      max?: number;
      min?: number;
    };
    propertyType?: PropertyType;
    searchTerm?: string;
    status?: PropertyStatus;
    yearBuilt?: {
      max?: number;
      min?: number;
    };
  } | null;
  pagination: IPaginationQuery;
  currentUser?: any;
}

/**
 * Property Type Rule Interface
 */
export interface PropertyTypeRule {
  validationRules?: {
    allowBathrooms?: boolean;
    allowBedrooms?: boolean;
    maxTotalArea?: number;
    maxUnits?: number;
    minTotalArea?: number;
    requiresElevator?: boolean;
  };
  visibleFields: {
    amenities: string[];
    core: string[];
    documents: string[];
    financial: string[];
    specifications: string[];
    unit: string[];
  };
  helpText: Record<string, string>;
  requiredFields: string[];
  validateBedBath: boolean;
  defaultUnits: number;
  isMultiUnit: boolean;
  minUnits: number;
}

/**
 * Media Document Item Type
 */
export interface MediaDocumentItem {
  documentType?:
    | 'deed'
    | 'tax'
    | 'insurance'
    | 'inspection'
    | 'other'
    | 'lease'
    | 'unknown'
    | 'legal';
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
 * Property Document Interface (extends Mongoose Document)
 */
export interface IPropertyDocument extends IProperty, Document {
  getAuthorizationStatus(): {
    isAuthorized: boolean;
    reason?: string;
    daysUntilExpiry?: number;
  };
  isManagementAuthorized(): boolean;
  lastModifiedBy?: Types.ObjectId;
  _id: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  pid: string;
  id: string;
}

/**
 * Simple authorization tracking for external properties
 */
export interface IPropertyAuthorization {
  authorizedBy?: Types.ObjectId; // User who authorized
  documentUrl?: string; // S3 link to management agreement
  authorizedAt?: Date; // When authorization was given
  isActive: boolean; // Simple on/off switch
  expiresAt?: Date; // When authorization expires (optional)
  notes?: string; // Internal notes
}

/**
 * Financial Details Type
 */
export interface FinancialDetails {
  lastAssessmentDate?: Date;
  maintenanceCost?: number;
  insuranceCost?: number;
  monthlyIncome?: number;
  purchasePrice?: number;
  currentValue?: number;
  downPayment?: number;
  marketValue?: number;
  propertyTax?: number;
  purchaseDate?: Date;
}

export interface IPropertyOwner {
  bankDetails?: {
    accountName?: string;
    accountNumber?: string;
    routingNumber?: string;
    bankName?: string;
  };
  type: OwnershipType;
  email?: string;
  phone?: string;
  taxId?: string;
  notes?: string;
  name?: string;
}

/**
 * Assignable User Interface (for property assignment)
 */
export interface IAssignableUser {
  employeeInfo?: {
    department?: string;
    employeeId?: string;
    jobTitle?: string;
  };
  role: IUserRole.ADMIN | IUserRole.STAFF | IUserRole.MANAGER;
  department?: string;
  displayName: string;
  email: string;
  id: string;
}

/**
 * Unit Info Type
 */
export interface UnitInfo {
  suggestedNextUnitNumber?: string;
  availableSpaces?: number;
  maxAllowedUnits?: number;
  lastUnitNumber?: string;
  currentUnits?: number;
  statistics: UnitStats;
  unitStats?: UnitStats;
  canAddUnit?: boolean;
  totalUnits: number;
}

/**
 * Property Specifications Type
 */
export interface PropertySpecifications {
  parkingSpaces?: number;
  garageSpaces?: number;
  maxOccupants?: number;
  totalFloors?: number;
  bathrooms?: number;
  totalArea?: number;
  bedrooms?: number;
  unitType?: string;
  lotSize?: number;
  floors?: number;
}

/**
 * Individual Property Approval Entry Type
 */
export interface PropertyApprovalEntry {
  action: 'created' | 'approved' | 'rejected' | 'updated' | 'submitted';
  rejectionReason?: string; // Only for rejected actions
  actor: Types.ObjectId;
  timestamp: Date;
  notes?: string;
  metadata?: any;
}

/**
 * Property Image Item Type
 */
export interface PropertyImageItem {
  status: 'pending' | 'processing' | 'active' | 'inactive' | 'deleted';
  uploadedBy: Types.ObjectId;
  description?: string;
  filename?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
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
  doorman: boolean;
  parking: boolean;
}

/**
 * Assignable Users Filter Interface
 */
export interface IAssignableUsersFilter {
  role?: IUserRole.ADMIN | IUserRole.STAFF | IUserRole.MANAGER | 'all';
  department?: string;
  searchTerm?: string;
  search?: string;
  limit?: number;
  page?: number;
}

/**
 * CSV Job Data Type
 */
export interface CsvJobData {
  bulkCreateOptions?: {
    passwordLength?: number;
    sendNotifications?: boolean;
  };
  clientInfo: IClientInfo;
  csvFilePath: string;
  jobId?: string;
  userId: string;
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
 * Pending Changes Type - using Omit to exclude specific fields
 */
export type IPendingChanges = {
  updatedAt: Date;
  updatedBy: Types.ObjectId;
  displayName: string;
} & Partial<Omit<IProperty, 'cuid' | 'pid' | 'id' | '_id'>>;

/**
 * Property Utilities Type
 */
export interface PropertyUtilities {
  electricity: boolean;
  internet: boolean;
  cableTV: boolean;
  trash: boolean;
  water: boolean;
  gas: boolean;
}

/**
 * Unit Statistics Type
 */
export interface UnitStats {
  maintenance: number;
  available: number;
  inactive: number;
  occupied: number;
  reserved: number;
  vacant: number;
}

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

export type IPropertyDocumentItem = MediaDocumentItem;
export type ICommunityAmenities = CommunityAmenities;
export type ISpecifications = PropertySpecifications;
export type IInteriorAmenities = InteriorAmenities;
export type IComputedLocation = ComputedLocation;
export type IFinancialDetails = FinancialDetails;
/**
 * Export commonly used types for backward compatibility
 * These are being kept to avoid breaking existing code
 */
export type IAddressDetails = AddressDetails;
export type IUtilities = PropertyUtilities;
export type NewPropertyType = NewProperty;
export type IUnitStats = UnitStats;
export type IUnitInfo = UnitInfo;
