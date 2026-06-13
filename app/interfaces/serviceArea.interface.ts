import { IProfileDocument } from '@interfaces/profile.interface';

export interface ServiceAreaLocation {
  coordinates: [number, number]; // [longitude, latitude]
  address: string;
}

export interface GeospatialQueryResult {
  profile: IProfileDocument;
  distance: number;
  _id: string;
}

export interface ServiceAreaConfig {
  maxDistance: 10 | 15 | 25 | 50; // km
}
