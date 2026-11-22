import { getCountryCodeFromLocation } from './helpers';

/**
 * Rules that depend on where a property is, keyed by ISO-2 country code. A country with no
 * entry gets the defaults (monthly rent only). Shaped so more per-market settings — e.g. the
 * payment provider — can be added alongside.
 */
interface MarketRules {
  /** Rent may be billed once a year (common in Nigeria, not in North America). */
  annualRent?: boolean;
}

export const MARKET_RULES: Record<string, MarketRules> = {
  NG: { annualRent: true },
};

type AddressInput =
  | string
  | { country?: string | null; fullAddress?: string | null }
  | null
  | undefined;

/**
 * The ISO-2 country of a property address — the property's address record, or the address
 * text a lease keeps. `country` is free text from the address form ("Nigeria", sometimes a
 * code), so the full address is the fallback.
 */
export const getPropertyCountryCode = (input?: AddressInput): string | null => {
  const address = typeof input === 'string' ? { fullAddress: input } : input;
  const country = address?.country?.trim();
  if (country && /^[A-Za-z]{2}$/.test(country)) return country.toUpperCase();
  if (country) {
    const code = getCountryCodeFromLocation(country);
    if (code) return code;
  }
  return address?.fullAddress ? getCountryCodeFromLocation(address.fullAddress) : null;
};

export const allowsAnnualRent = (address?: AddressInput): boolean => {
  const code = getPropertyCountryCode(address);
  return !!code && MARKET_RULES[code]?.annualRent === true;
};
