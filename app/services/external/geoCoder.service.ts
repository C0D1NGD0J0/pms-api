import { envVariables } from '@shared/config';
import NodeGeocoder, { Entry } from 'node-geocoder';
/**
 * A service for geocoding addresses and reverse geocoding coordinates
 */
export class GeoCoderService {
  private geocoder: NodeGeocoder.Geocoder;

  /**
   * Create a new GeoCoder instance
   * @param options - Custom geocoder options (for testing/DI)
   */
  constructor() {
    const opts = {
      provider: 'google' as const,
      apiKey: envVariables.GEOCODER.PROVIDER_KEY,
    };

    if (!opts.apiKey) {
      console.warn('Geocoder initialized without API key - functionality may be limited');
    }

    this.geocoder = NodeGeocoder(opts);
  }

  /**
   * Convert a location string to geographic coordinates
   * @param location - Address or location string to geocode
   * @returns Promise resolving to geocoding results
   * @throws Error if geocoding fails
   */
  public async parseLocation(location: string): Promise<{
    street: string;
    city: string;
    state: string;
    country: string;
    postCode: string;
    latAndlon: string;
    streetNumber: string;
    formattedAddress: string;
    coordinates: [number, number];
  } | null> {
    if (!location || typeof location !== 'string') {
      throw new Error('Invalid location: Location must be a non-empty string');
    }

    try {
      const results = await this.geocoder.geocode(location);

      if (!results || results.length === 0) {
        throw new Error(`No results found for location: ${location}`);
      }
      return this.formatAddress(results[0]);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Geocoding failed: ${error.message}`);
      }
      throw new Error('Geocoding failed with unknown error');
    }
  }

  /**
   * Convert coordinates to address information (reverse geocoding)
   * @param lat - Latitude
   * @param lon - Longitude
   * @returns Promise resolving to reverse geocoding results
   * @throws Error if reverse geocoding fails
   */
  public async reverseGeocode(lat: number, lon: number): Promise<Entry[]> {
    if (
      typeof lat !== 'number' ||
      typeof lon !== 'number' ||
      isNaN(lat) ||
      isNaN(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      throw new Error(
        'Invalid coordinates: Latitude must be between -90 and 90, longitude between -180 and 180'
      );
    }

    try {
      const results = await this.geocoder.reverse({ lat, lon });

      if (!results || results.length === 0) {
        throw new Error(`No results found for coordinates: ${lat}, ${lon}`);
      }

      return results;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Reverse geocoding failed: ${error.message}`);
      }
      throw new Error('Reverse geocoding failed with unknown error');
    }
  }

  /**
   * Format a geocoding result into a standardized address object
   * @param result - Geocoding result entry
   * @returns Formatted address object
   */
  public formatAddress(result: Entry): {
    street: string;
    city: string;
    state: string;
    country: string;
    postCode: string;
    latAndlon: string;
    streetNumber: string;
    formattedAddress: string;
    coordinates: [number, number];
  } | null {
    if (!result) {
      return null;
    }

    return {
      city: result.city || '',
      country: result.country || '',
      postCode: result.zipcode || '',
      street: result.streetName || '',
      streetNumber: result.streetNumber || '',
      formattedAddress: result.formattedAddress || '',
      coordinates: [result.longitude || 0, result.latitude || 0],
      latAndlon: `${result.latitude || 0}, ${result.longitude || 0}`,
      state: result.administrativeLevels?.level1long || result.state || '',
    };
  }
}
