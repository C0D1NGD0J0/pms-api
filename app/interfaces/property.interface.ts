import { Document, Types } from 'mongoose';

export interface IPropertyDocument extends Document {
  communityAmenities: ICommunityAmenities;
  interiorAmenities: IInteriorAmenities;
  exteriorAmenities: IExteriorAmenities;
  financialDetails?: IFinancialDetails;
  computedLocation: IComputedLocation;
  documents?: IPropertyDocumentItem[];
  occupancyStatus: OccupancyStatus;
  specifications: ISpecifications;
  lastModifiedBy?: Types.ObjectId;
  maintenanceRequests?: any[]; // update with IMaintenanceRequest[] when ready
  propertyType: PropertyType;
  managedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;
  status: PropertyStatus;
  utilities: IUtilities;
  occupancyRate: number;
  description?: string;
  cid: Types.ObjectId;
  yearBuilt?: number;
  deletedAt?: Date;
  address: string;
  createdAt: Date;
  updatedAt: Date;
  leases?: any[]; // update with ILease[] when ready

  // Virtual fields
  units?: any[]; // update with IUnit[] when ready
  name: string;
  pid: string;
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

export interface IPropertyDocumentItem {
  documentType?: 'deed' | 'tax' | 'insurance' | 'inspection' | 'other';
  uploadedBy: Types.ObjectId;
  photos: IDocumentPhoto[];
  description?: string;
  uploadedAt: Date;
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

export interface IDocumentPhoto {
  uploadedBy: Types.ObjectId;
  isPrimary: boolean;
  filename?: string;
  caption?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
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
