import { Document, Types } from 'mongoose';

import { IClientInfo } from './client.interface';
import { IUserRole } from '../shared/constants/roles.constants';
import { IPaginationQuery, CURRENCIES } from './utils.interface';

/**
 * ============================================================================
 * BASE TYPE DEFINITIONS (Single Source of Truth)
 * ============================================================================
 */

/**
 * Property Approval Status Enum
 */
export enum PropertyApprovalStatusEnum {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PENDING = 'pending',
  DRAFT = 'draft',
}

/**
 * Ownership Type Enum
 */
export enum OwnershipType {
  EXTERNAL_OWNER = 'external_owner',
  COMPANY_OWNED = 'company_owned',
  SELF_OWNED = 'self_owned',
}

/**
 * Main Property Interface
 * Core property data structure
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
 * Property Document Interface
 * Extends IProperty with Mongoose Document properties and methods
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
 * ============================================================================
 * ENUMS
 * ============================================================================
 */

/**
 * Property Authorization Interface
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
 * Financial Details Interface
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

/**
 * ============================================================================
 * CORE INTERFACES (Single Source of Truth)
 * ============================================================================
 */

/**
 * Property Owner Interface
 */
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
 * Unit Info Interface
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
 * Property Specifications Interface
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
 * Media Document Item Interface
 */
export interface MediaDocumentItem {
  documentType?: PropertyDocumentType;
  status: MediaDocumentStatus;
  uploadedBy: Types.ObjectId;
  description?: string;
  documentName: string;
  externalUrl: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

/**
 * Property Approval Entry Interface
 * Individual property approval tracking
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
 * Community Amenities Interface
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
 * CSV Job Data Interface
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
 * Address Details Interface
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
 * Interior Amenities Interface
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
 * Property Image Item Interface
 */
export interface PropertyImageItem {
  status: MediaDocumentStatus;
  uploadedBy: Types.ObjectId;
  description?: string;
  filename?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

/**
 * Pending Changes Interface
 * Using Omit to exclude specific fields from changes
 */
export type IPendingChanges = {
  updatedAt: Date;
  updatedBy: Types.ObjectId;
  displayName: string;
} & Partial<Omit<IProperty, 'cuid' | 'pid' | 'id' | '_id'>>;

/**
 * Property Utilities Interface
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
 * ============================================================================
 * MAIN PROPERTY INTERFACE
 * ============================================================================
 */

/**
 * Unit Statistics Interface
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
 * ============================================================================
 * FORM DATA INTERFACES
 * ============================================================================
 */

/**
 * Document Type Classifications
 */
export type PropertyDocumentType =
  | 'deed'
  | 'tax'
  | 'insurance'
  | 'inspection'
  | 'other'
  | 'lease'
  | 'unknown'
  | 'legal';

/**
 * ============================================================================
 * DOCUMENT INTERFACES (Mongoose Extensions)
 * ============================================================================
 */

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
 * ============================================================================
 * POPULATED/ENRICHED INTERFACES
 * ============================================================================
 */

/**
 * Property with Unit Info Interface
 * Using intersection type for property with unit statistics
 */
export type IPropertyWithUnitInfo = Partial<{ property: IPropertyDocument }> & {
  unitInfo: UnitInfo;
};

/**
 * Property Status Types
 */
export type PropertyStatus = 'available' | 'occupied' | 'maintenance' | 'construction' | 'inactive';

/**
 * ============================================================================
 * QUERY & FILTER INTERFACES
 * ============================================================================
 */

/**
 * Media Document Status Types
 */
export type MediaDocumentStatus = 'pending' | 'processing' | 'active' | 'inactive' | 'deleted';

/**
 * Property Approval Status Types
 */
export type PropertyApprovalStatus = 'pending' | 'approved' | 'rejected' | 'draft';

/**
 * ============================================================================
 * USER & ASSIGNMENT INTERFACES
 * ============================================================================
 */

/**
 * New Property Type (for creation)
 * Using Omit to exclude pid
 */
export type NewProperty = {
  fullAddress: string;
} & Omit<IProperty, 'pid'>;

/**
 * ============================================================================
 * PROPERTY TYPE RULES & VALIDATION
 * ============================================================================
 */

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
 * ============================================================================
 * CSV & BULK OPERATIONS
 * ============================================================================
 */

/**
 * Computed Location Interface
 */
export interface ComputedLocation {
  coordinates: number[];
}

/**
 * ============================================================================
 * TYPE ALIASES (Backward Compatibility)
 * ============================================================================
 * These are being kept to avoid breaking existing code
 */
export type IPropertyDocumentItem = MediaDocumentItem;
export type ICommunityAmenities = CommunityAmenities;
export type ISpecifications = PropertySpecifications;
export type IInteriorAmenities = InteriorAmenities;
export type IComputedLocation = ComputedLocation;
export type IFinancialDetails = FinancialDetails;
export type IAddressDetails = AddressDetails;
export type IUtilities = PropertyUtilities;
export type NewPropertyType = NewProperty;
export type IUnitStats = UnitStats;
export type IUnitInfo = UnitInfo;
