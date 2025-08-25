import { Document, Types } from 'mongoose';

import { IClientInfo } from './client.interface';
import { IPaginationQuery, CURRENCIES } from './utils.interface';

export enum PropertyApprovalStatusEnum {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PENDING = 'pending',
  DRAFT = 'draft',
}
/**
 * Property Filter Query Interface
 */
export interface IPropertyFilterQuery {
  filters: {
    propertyType?: string;
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
    includeUnapproved?: boolean; // For admin/managers to see pending properties
    approvalStatus?: PropertyApprovalStatus; // Filter by specific approval status
  } | null;
  pagination: IPaginationQuery;
  currentUser?: any; // Optional current user context for permission checking
}

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
export type PropertyDocumentItem = {
  documentType?: 'deed' | 'tax' | 'insurance' | 'inspection' | 'other' | 'lease' | 'unknown';
  status: 'pending' | 'processing' | 'active' | 'inactive' | 'deleted';
  uploadedBy: Types.ObjectId;
  description?: string;
  documentName: string;
  externalUrl: string;
  uploadedAt: Date;
  key?: string;
  url: string;
};

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
export type CommunityAmenities = {
  laundryFacility: boolean;
  securitySystem: boolean;
  fitnessCenter: boolean;
  swimmingPool: boolean;
  petFriendly: boolean;
  elevator: boolean;
  parking: boolean;
  doorman: boolean;
};

/**
 * Unit Information Type
 */
export type UnitInfo = {
  suggestedNextUnitNumber?: string;
  availableSpaces: number;
  lastUnitNumber?: string;
  unitStats: UnitStats;
  currentUnits: number;
  canAddUnit: boolean;
  maxAllowedUnits: number;
};

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
 * Address Details Type
 */
export type AddressDetails = {
  streetNumber?: string;
  fullAddress?: string;
  latAndlon?: string;
  postCode?: string;
  country?: string;
  street?: string;
  state?: string;
  city?: string;
};

/**
 * Interior Amenities Type
 */
export type InteriorAmenities = {
  airConditioning: boolean;
  storageSpace: boolean;
  washerDryer: boolean;
  dishwasher: boolean;
  furnished: boolean;
  heating: boolean;
  fridge: boolean;
};

/**
 * CSV Job Data Type
 */
export type CsvJobData = {
  csvFilePath: string;
  userId: string;
  jobId?: string;
  clientInfo: IClientInfo;
  bulkCreateOptions?: { sendNotifications?: boolean; passwordLength?: number };
};

/**
 * Property Specifications Type
 */
export type PropertySpecifications = {
  garageSpaces?: number;
  maxOccupants?: number;
  bathrooms?: number;
  totalArea: number;
  bedrooms?: number;
  lotSize?: number;
  floors?: number;
};

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
export type FinancialDetails = {
  lastAssessmentDate?: Date;
  purchasePrice?: number;
  marketValue?: number;
  propertyTax?: number;
  purchaseDate?: Date;
};

/**
 * Property Utilities Type
 */
export type PropertyUtilities = {
  electricity: boolean;
  internet: boolean;
  cableTV: boolean;
  water: boolean;
  trash: boolean;
  gas: boolean;
};

/**
 * Unit Statistics Type
 */
export type UnitStats = {
  maintenance: number;
  available: number;
  occupied: number;
  reserved: number;
  inactive: number;
  vacant: number;
};

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
 * Property Status Types
 */
export type PropertyStatus = 'available' | 'occupied' | 'maintenance' | 'construction' | 'inactive';

/**
 * Property with Unit Info Interface
 */
export interface IPropertyWithUnitInfo extends Partial<IPropertyDocument> {
  unitInfo: UnitInfo;
}

/**
 * Property Approval Status Types
 */
export type PropertyApprovalStatus = 'pending' | 'approved' | 'rejected' | 'draft';

/**
 * New Property Type (for creation)
 */
export type NewProperty = {
  fullAddress: string;
} & Omit<IProperty, 'pid'>;

/**
 * Occupancy Status Types
 */
export type OccupancyStatus = 'vacant' | 'occupied' | 'partially_occupied';

export interface IPropertyDocumentItem extends PropertyDocumentItem {}
export interface ISpecifications extends PropertySpecifications {}
export interface ICommunityAmenities extends CommunityAmenities {}
/**
 * Property Type Rules Collection
 */
export type PropertyTypeRules = Record<string, PropertyTypeRule>;
export interface IInteriorAmenities extends InteriorAmenities {}
export interface IFinancialDetails extends FinancialDetails {}
export interface IComputedLocation extends ComputedLocation {}
/**
 * Computed Location Type
 */
export type ComputedLocation = {
  coordinates: number[];
};
/**
 * Legacy Interfaces (for backward compatibility)
 * @deprecated Use the new naming convention instead
 */
export interface IAddressDetails extends AddressDetails {}
export interface IUtilities extends PropertyUtilities {}
export interface IUnitStats extends UnitStats {}

export interface IUnitInfo extends UnitInfo {}

export type NewPropertyType = NewProperty;
