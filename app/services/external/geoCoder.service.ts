import Logger from 'bunyan';
import { envVariables } from '@shared/config';
import NodeGeocoder, { Entry } from 'node-geocoder';
import { CircuitBreaker, createLogger } from '@utils/index';

/**
 * Why a lookup failed:
 *   not_found   — the provider answered, but the address doesn't resolve (user-fixable)
 *   unavailable — the provider couldn't be used: bad/restricted key, quota, outage,
 *                 network, open circuit. Internal — never surface the cause to users.
 */
export type GeocodeFailureReason = 'not_found' | 'unavailable';

// Google statuses that mean "the address itself is the problem"; anything else is
// treated as the service being unavailable.
const NOT_FOUND_STATUSES = ['ZERO_RESULTS', 'INVALID_REQUEST'];

export class GeoCoderService {
  private geocoder: NodeGeocoder.Geocoder;
  private readonly breaker: CircuitBreaker;
  private readonly log: Logger;

  constructor() {
    const opts = {
      provider: 'google' as const,
      apiKey: envVariables.GEOCODER.PROVIDER_KEY,
    };

    if (!opts.apiKey) {
      console.warn('Geocoder initialized without API key - functionality may be limited');
    }

    this.log = createLogger('GeoCoderService');
    this.geocoder = NodeGeocoder(opts);
    this.breaker = new CircuitBreaker({
      name: 'geocoder',
      failureThreshold: 3,
      cooldownMs: 60_000,
      // An address that doesn't resolve is not a provider failure — don't trip the breaker
      isFailure: (err) => !this.isNotFoundError(err),
      logger: this.log,
    });
  }

  /**
   * Convert a location string to geographic coordinates
   * @param location - Address or location string to geocode
   * @returns Promise resolving to geocoding results
   * @throws Error if geocoding fails
   */
  public async parseLocation(location: string): Promise<{
    message: string;
    success: boolean;
    data: any;
    reason?: GeocodeFailureReason;
  }> {
    if (!location || typeof location !== 'string') {
      throw new Error('Invalid location: Location must be a non-empty string');
    }

    try {
      const results = await this.breaker.exec(() => this.geocoder.geocode(location));

      if (!results || results.length === 0) {
        return this.failure('not_found', 'Address not found');
      }
      return {
        data: this.formatAddress(results[0]),
        message: 'Address parsed successfully',
        success: true,
      };
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return this.failure('not_found', 'Address not found');
      }
      // Provider-side problem (key restrictions, quota, outage) — log the real cause
      // for us, return a generic reason for callers.
      this.log.error(
        { err: error instanceof Error ? error.message : String(error) },
        'Geocoding provider unavailable'
      );
      return this.failure('unavailable', 'Address lookup is temporarily unavailable');
    }
  }

  private failure(reason: GeocodeFailureReason, message: string) {
    return { success: false, data: null, message, reason };
  }

  private isNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return NOT_FOUND_STATUSES.some((status) => message.includes(status));
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
      const results = await this.breaker.exec(() => this.geocoder.reverse({ lat, lon }));

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
    fullAddress: string;
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
      fullAddress: result.formattedAddress || '',
      coordinates: [result.longitude || 0, result.latitude || 0],
      latAndlon: `${result.latitude || 0}|||${result.longitude || 0}`,
      state: result.administrativeLevels?.level1long || result.state || '',
    };
  }
}
