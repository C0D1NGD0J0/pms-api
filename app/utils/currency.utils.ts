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

/**
 * Roughly how many units of each currency make one US dollar. Only used to scale sanity limits
 * (e.g. the highest believable monthly rent) so they mean the same in every currency — never
 * for converting amounts. Currencies near parity with USD are left at 1.
 */
const UNITS_PER_USD: Record<string, number> = {
  CAD: 1.4,
  AUD: 1.5,
  SGD: 1.4,
  AED: 3.7,
  BRL: 5.5,
  CNY: 7.2,
  ZAR: 18,
  MXN: 20,
  INR: 85,
  JPY: 150,
  NGN: 1600,
};

/** A limit set in US dollars, expressed in the given currency. */
export function scaleUsdLimit(usdLimit: number, currency?: string): number {
  return Math.round(usdLimit * (UNITS_PER_USD[currency?.toUpperCase() ?? ''] ?? 1));
}

/**
 * Currencies supported for subscription billing via Stripe.
 * NGN is not supported for recurring subscriptions — Nigeria falls back to USD.
 */
const SUPPORTED_SUBSCRIPTION_CURRENCIES = ['usd', 'cad', 'eur'];

export function getSubscriptionCurrency(countryCode: string): string {
  const currency = getCurrencyForCountry(countryCode).toLowerCase();
  return SUPPORTED_SUBSCRIPTION_CURRENCIES.includes(currency) ? currency : 'usd';
}

export { SUPPORTED_SUBSCRIPTION_CURRENCIES, COUNTRY_TO_CURRENCY };
