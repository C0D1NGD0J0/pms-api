import { Document, Types } from 'mongoose';

import { IClientInfo } from './client.interface';
import { IUserRole } from '../shared/constants/roles.constants';
import { IPaginationQuery, CURRENCIES } from './utils.interface';

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

export interface IProperty {
  fees: {
    currency: CURRENCIES;
    managementFees: number | string;
    rentAmount: number | string;
  };
  description?: {
    html?: string;
    text?: string;
  };
  ownershipHistory?: IOwnershipHistoryEntry[];
  approvalDetails?: PropertyApprovalEntry[];
  approvalStatus?: PropertyApprovalStatus;
  communityAmenities?: CommunityAmenities;
  pendingChanges?: IPendingChanges | null;
  specifications: PropertySpecifications;
  authorization?: IPropertyAuthorization;
  interiorAmenities?: InteriorAmenities;
  computedLocation?: ComputedLocation;
  financialDetails?: FinancialDetails;
  operationalStatus: PropertyStatus;
  occupancyStatus: OccupancyStatus;
  assignedStaff?: Types.ObjectId[];
  documents?: MediaDocumentItem[];
  images?: PropertyImageItem[];
  utilities: PropertyUtilities;
  managedBy?: Types.ObjectId;
  propertyType: PropertyType;
  createdBy: Types.ObjectId;
  maxAllowedUnits?: number;
  address: AddressDetails;
  notes?: IPropertyNote[];
  owner: IPropertyOwner;
  yearBuilt?: number;
  cuid: string;
  name: string;
}

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
    operationalStatus?: PropertyStatus;
    yearBuilt?: {
      max?: number;
      min?: number;
    };
  } | null;
  pagination: IPaginationQuery;
}

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

export interface IPropertyAuthorization {
  authorizedBy?: Types.ObjectId; // User who authorized
  documentUrl?: string; // S3 link to management agreement
  authorizedAt?: Date; // When authorization was given
  isActive: boolean; // Simple on/off switch
  expiresAt?: Date; // When authorization expires (optional)
  notes?: string; // Internal notes
}

export type IPropertyWithUnitInfo = {
  unitInfo?: UnitInfo;
  hasLeaseHistory?: boolean;
  metrics?: {
    rentAmount: number;
    annualRevenue: number;
    occupancyRate: number;
    monthlyNetIncome: number;
  };
  paymentHistory?: any[];
  maintenanceHistory?: any[];
} & Partial<{ property: IPropertyDocument }>;

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

export interface MediaDocumentItem {
  documentType?: PropertyDocumentType;
  status: MediaDocumentStatus;
  uploadedBy: Types.ObjectId;
  _id?: Types.ObjectId;
  description?: string;
  documentName: string;
  externalUrl: string;
  uploadedAt: Date;
  key?: string;
  url: string;
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

export interface PropertyApprovalEntry {
  action: 'created' | 'approved' | 'rejected' | 'updated' | 'submitted';
  rejectionReason?: string; // Only for rejected actions
  actor: Types.ObjectId;
  timestamp: Date;
  notes?: string;
  metadata?: any;
}

export interface UnitInfo {
  suggestedNextUnitNumber?: string;
  availableSpaces?: number;
  maxAllowedUnits?: number;
  lastUnitNumber?: string;
  currentUnits?: number;
  unitStats?: UnitStats;
  canAddUnit?: boolean;
  totalUnits: number;
}

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

export interface PropertyImageItem {
  status: MediaDocumentStatus;
  uploadedBy: Types.ObjectId;
  _id?: Types.ObjectId;
  description?: string;
  filename?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

export interface IAssignableUsersFilter {
  role?: IUserRole.ADMIN | IUserRole.STAFF | IUserRole.MANAGER | 'all';
  department?: string;
  searchTerm?: string;
  search?: string;
  limit?: number;
  page?: number;
}

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

export interface InteriorAmenities {
  airConditioning: boolean;
  storageSpace: boolean;
  washerDryer: boolean;
  dishwasher: boolean;
  furnished: boolean;
  heating: boolean;
  fridge: boolean;
}

export interface IOwnershipHistoryEntry {
  recordedBy?: Types.ObjectId;
  owner: IPropertyOwner;
  transferNote?: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
  recordedAt?: Date;
}

export interface IPropertyNote {
  author: {
    uid: string;
    name: string;
  };
  _id?: Types.ObjectId;
  updatedAt?: Date;
  createdAt: Date;
  html?: string;
  text: string;
}

export type IPendingChanges = {
  updatedAt: Date;
  updatedBy: Types.ObjectId;
  displayName: string;
} & Partial<Omit<IProperty, 'cuid' | 'pid' | 'id' | '_id'>>;

export interface PropertyUtilities {
  electricity: boolean;
  internet: boolean;
  cableTV: boolean;
  trash: boolean;
  water: boolean;
  gas: boolean;
}

export interface UnitStats {
  maintenance: number;
  available: number;
  inactive: number;
  occupied: number;
  reserved: number;
  vacant: number;
}

export type PropertyDocumentType =
  | 'deed'
  | 'tax'
  | 'insurance'
  | 'inspection'
  | 'other'
  | 'lease'
  | 'unknown'
  | 'legal';

export type PropertyType =
  | 'apartment'
  | 'house'
  | 'condominium'
  | 'townhouse'
  | 'commercial'
  | 'industrial';

export type MediaDocumentStatus = 'pending' | 'processing' | 'active' | 'inactive' | 'deleted';

export type PropertyStatus = 'available' | 'maintenance' | 'construction' | 'inactive';

export type PropertyApprovalStatus = 'pending' | 'approved' | 'rejected' | 'draft';

export interface ComputedLocation {
  coordinates: number[];
  type?: 'Point';
}

export type NewProperty = {
  fullAddress: string;
} & Omit<IProperty, 'pid'>;

export type OccupancyStatus = 'vacant' | 'occupied' | 'partially_occupied';

export type PropertyTypeRules = Record<string, PropertyTypeRule>;

// Type aliases kept for backward compatibility
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
