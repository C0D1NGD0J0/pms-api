/**
 * Seed Configuration
 * Define which regions and how many records to create
 */

export interface SeedConfig {
  counts: {
    adminsPerClient: number;
    staffPerClient: number;
    staffInOperations: number; // Out of total staff
    vendorsPerClient: number;
    vendorEmployeesPerVendor: number;
    propertiesPerClient: number;
    multiTenantProperties: number; // Out of total properties
    unitsPerMultiTenant: number;
  };
  regions: RegionConfig[];
}

export interface RegionConfig {
  coordinates: {
    lat: { min: number; max: number };
    lng: { min: number; max: number };
  };
  planTier: 'basic' | 'pro' | 'enterprise';
  phoneFormat: string;
  timezone: string;
  currency: string;
  country: string;
  state: string;
  name: string;
  city: string;
  lang: string;
}

// Predefined region configs
export const REGIONS: Record<string, RegionConfig> = {
  canada: {
    name: 'Canada',
    country: 'Canada',
    city: 'Toronto',
    state: 'ON',
    timezone: 'America/Toronto',
    currency: 'CAD',
    lang: 'en',
    phoneFormat: '+1-416-###-####',
    planTier: 'basic',
    coordinates: {
      lat: { min: 43.6, max: 43.8 },
      lng: { min: -79.5, max: -79.3 },
    },
  },
  uk: {
    name: 'UK',
    country: 'United Kingdom',
    city: 'London',
    state: 'Greater London',
    timezone: 'Europe/London',
    currency: 'GBP',
    lang: 'en-GB',
    phoneFormat: '+44-20-####-####',
    planTier: 'pro',
    coordinates: {
      lat: { min: 51.4, max: 51.6 },
      lng: { min: -0.3, max: -0.1 },
    },
  },
  nigeria: {
    name: 'Nigeria',
    country: 'Nigeria',
    city: 'Lagos',
    state: 'Lagos',
    timezone: 'Africa/Lagos',
    currency: 'NGN',
    lang: 'en',
    phoneFormat: '+234-###-###-####',
    planTier: 'enterprise',
    coordinates: {
      lat: { min: 6.4, max: 6.6 },
      lng: { min: 3.3, max: 3.6 },
    },
  },
};

// Default configuration
export const DEFAULT_CONFIG: SeedConfig = {
  regions: [REGIONS.canada, REGIONS.uk, REGIONS.nigeria],
  counts: {
    adminsPerClient: 2,
    staffPerClient: 5,
    staffInOperations: 3,
    vendorsPerClient: 3,
    vendorEmployeesPerVendor: 5,
    propertiesPerClient: 6,
    multiTenantProperties: 3, // 3 out of 6 will be multi-tenant
    unitsPerMultiTenant: 7, // Will create 3-7 units per property with varied floors
  },
};

// Preset configurations for different scenarios
export const PRESETS = {
  // Minimal - for quick testing
  minimal: {
    regions: [REGIONS.canada],
    counts: {
      adminsPerClient: 1,
      staffPerClient: 2,
      staffInOperations: 1,
      vendorsPerClient: 1,
      vendorEmployeesPerVendor: 2,
      propertiesPerClient: 2,
      multiTenantProperties: 1,
      unitsPerMultiTenant: 5, // Will create 3-5 units with varied floors
    },
  },

  // Full - complete dataset
  full: DEFAULT_CONFIG,

  // Single region - all tiers in one region
  singleRegion: {
    regions: [REGIONS.canada],
    counts: DEFAULT_CONFIG.counts,
  },

  // Large - stress test
  large: {
    regions: [REGIONS.canada, REGIONS.uk, REGIONS.nigeria],
    counts: {
      adminsPerClient: 5,
      staffPerClient: 20,
      staffInOperations: 10,
      vendorsPerClient: 10,
      vendorEmployeesPerVendor: 10,
      propertiesPerClient: 20,
      multiTenantProperties: 10,
      unitsPerMultiTenant: 30,
    },
  },
};
