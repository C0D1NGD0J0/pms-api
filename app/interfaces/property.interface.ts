import { Document, Types } from 'mongoose';

import { IPaginationQuery, CURRENCIES } from './utils.interface';

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
  communityAmenities?: ICommunityAmenities;
  interiorAmenities?: IInteriorAmenities;
  computedLocation?: IComputedLocation;
  financialDetails?: IFinancialDetails;
  documents?: IPropertyDocumentItem[];
  occupancyStatus: OccupancyStatus;
  address: IAddressDetails | null;
  specifications: ISpecifications;
  propertyType: PropertyType;
  managedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  status: PropertyStatus;
  utilities: IUtilities;
  totalUnits?: number;
  yearBuilt?: number;
  name: string;
  cid: string;
}

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
  } | null;
  pagination: IPaginationQuery;
}

export interface IPropertyDocumentItem {
  status: {
    type: string;
    enum: ['pending', 'active', 'inactive', 'deleted'];
    default: 'pending';
  };
  documentType?: 'deed' | 'tax' | 'insurance' | 'inspection' | 'other' | 'lease';
  uploadedBy: Types.ObjectId;
  description?: string;
  documentName: string;
  externalUrl: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

export interface ICommunityAmenities {
  laundryFacility: boolean;
  securitySystem: boolean;
  fitnessCenter: boolean;
  swimmingPool: boolean;
  petFriendly: boolean;
  elevator: boolean;
  parking: boolean;
  doorman: boolean;
}

export interface IPropertyDocument extends IProperty, Document {
  lastModifiedBy?: Types.ObjectId;
  _id: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  pid: string;
  id: string;
}

export interface IAddressDetails {
  formattedAddress?: string;
  streetNumber?: string;
  latAndlon?: string;
  postCode?: string;
  country?: string;
  street?: string;
  state?: string;
  city?: string;
}

export interface IInteriorAmenities {
  airConditioning: boolean;
  storageSpace: boolean;
  washerDryer: boolean;
  dishwasher: boolean;
  furnished: boolean;
  heating: boolean;
  fridge: boolean;
}

export interface ISpecifications {
  garageSpaces?: number;
  maxOccupants?: number;
  bathrooms?: number;
  totalArea: number;
  bedrooms?: number;
  lotSize?: number;
  floors?: number;
}

export interface IFinancialDetails {
  lastAssessmentDate?: Date;
  purchasePrice?: number;
  marketValue?: number;
  propertyTax?: number;
  purchaseDate?: Date;
}

export interface IUtilities {
  electricity: boolean;
  internet: boolean;
  cableTV: boolean;
  water: boolean;
  trash: boolean;
  gas: boolean;
}

export type PropertyType =
  | 'apartment'
  | 'house'
  | 'condominium'
  | 'townhouse'
  | 'commercial'
  | 'industrial';
export interface CsvJobData {
  csvFilePath: string;
  userId: string;
  jobId?: string;
  cid: string;
}
export type PropertyStatus = 'available' | 'occupied' | 'maintenance' | 'construction' | 'inactive';

export type NewPropertyType = {
  fullAddress: string;
} & Omit<IProperty, 'pid'>;

export type OccupancyStatus = 'vacant' | 'occupied' | 'partially_occupied';

export interface IComputedLocation {
  coordinates: number[];
}
