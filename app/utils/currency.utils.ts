/**
 * ISO 3166-1 alpha-2 country code → ISO 4217 currency code.
 * Only maps to currencies present in the CURRENCIES enum.
 * Countries without a supported native currency fall back to USD.
 * Extend as new currencies are added to the CURRENCIES enum.
 */
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  // North America
  US: 'USD',
  CA: 'CAD',
  MX: 'MXN',

  // Europe
  GB: 'GBP',
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  IE: 'EUR',
  PT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
  CH: 'CHF',
  SE: 'EUR', // SEK not in CURRENCIES enum — fallback to EUR
  NO: 'EUR', // NOK not in CURRENCIES enum — fallback to EUR
  DK: 'EUR', // DKK not in CURRENCIES enum — fallback to EUR
  PL: 'EUR', // PLN not in CURRENCIES enum — fallback to EUR

  // Africa
  NG: 'NGN',
  KE: 'USD', // KES not in CURRENCIES enum — fallback to USD
  ZA: 'ZAR',
  GH: 'USD', // GHS not in CURRENCIES enum — fallback to USD
  EG: 'USD', // EGP not in CURRENCIES enum — fallback to USD

  // Asia-Pacific
  AU: 'AUD',
  NZ: 'AUD', // NZD not in CURRENCIES enum — fallback to AUD
  JP: 'JPY',
  IN: 'INR',
  SG: 'SGD',
  HK: 'USD', // HKD not in CURRENCIES enum — fallback to USD
  MY: 'USD', // MYR not in CURRENCIES enum — fallback to USD

  // South America
  BR: 'BRL',

  // Middle East
  AE: 'AED',
};

export function getCurrencyForCountry(countryCode: string): string {
  return COUNTRY_TO_CURRENCY[countryCode.toUpperCase()] ?? 'USD';
}

export { COUNTRY_TO_CURRENCY };
