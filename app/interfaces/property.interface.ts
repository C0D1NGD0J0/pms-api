import { Document, Types } from 'mongoose';

import { CURRENCIES } from './utils.interface';

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
  exteriorAmenities?: IExteriorAmenities;
  computedLocation?: IComputedLocation;
  financialDetails?: IFinancialDetails;
  documents?: IPropertyDocumentItem[];
  occupancyStatus: OccupancyStatus;
  specifications: ISpecifications;
  propertyType: PropertyType;
  managedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  status: PropertyStatus;
  utilities: IUtilities;
  occupancyLimit: number;
  yearBuilt?: number;
  address: string;
  name: string;
  cid: string;
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

export interface IExteriorAmenities {
  securitySystem: boolean;
  fitnessCenter: boolean;
  swimmingPool: boolean;
  playground: boolean;
  elevator: boolean;
  balcony: boolean;
  parking: boolean;
  garden: boolean;
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

export interface IAddressDetails {
  streetNumber?: string;
  postCode?: string;
  country?: string;
  street?: string;
  state?: string;
  city?: string;
}

export interface ICommunityAmenities {
  laundryFacility: boolean;
  petFriendly: boolean;
  clubhouse: boolean;
  bbqArea: boolean;
  doorman: boolean;
}

export interface IUtilities {
  electricity: boolean;
  internet: boolean;
  cableTV: boolean;
  water: boolean;
  trash: boolean;
  gas: boolean;
}

export interface IComputedLocation {
  address: IAddressDetails;
  coordinates: number[];
  latAndlon: string;
  type: string;
}
export type PropertyType =
  | 'apartment'
  | 'house'
  | 'condominium'
  | 'townhouse'
  | 'commercial'
  | 'industrial';
export type PropertyStatus = 'available' | 'occupied' | 'maintenance' | 'construction' | 'inactive';

export type OccupancyStatus = 'vacant' | 'occupied' | 'partially_occupied';
