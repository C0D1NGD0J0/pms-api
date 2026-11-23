import { getCountryCodeFromLocation } from './helpers';

/**
 * Rules that depend on where a property is, keyed by ISO-2 country code. A country with no
 * entry gets the defaults (monthly rent only). Shaped so more per-market settings — e.g. the
 * payment provider once Paystack is added — can sit alongside.
 *
 * Decisions (2026-11), kept here so they aren't re-litigated:
 * - Keyed by the PROPERTY's country, not the account's or the currency. One account can hold
 *   properties in several countries, and currency is not a market signal: Ghana and Kenya fall
 *   back to USD (see currency.utils.ts), the same as US properties.
 * - Unknown country → defaults (monthly). Failing safe means a property we can't place never
 *   gets yearly rent by accident; the worst case is a Nigerian property whose address names no
 *   country, which then simply isn't offered yearly rent.
 * - Only enforced when rent is switched TO yearly (assertAnnualRentAvailable). Leases already
 *   paid yearly keep working and renewing wherever the property is.
 */
interface MarketRules {
  /** Rent may be billed once a year (common in Nigeria, not in North America). */
  annualRent?: boolean;
}

/**
 * Nigeria only for now: yearly rent in advance is standard there, and Lagos law caps the
 * advance at one year. Deliberately not added yet:
 * - Ghana — its Rent Act caps advance rent at six months, so a yearly charge may not be lawful.
 * - Kenya, South Africa — rent is mostly monthly.
 * Add a country only once its local practice and law have been confirmed.
 */
export const MARKET_RULES: Record<string, MarketRules> = {
  NG: { annualRent: true },
};

type AddressInput =
  | string
  | { country?: string | null; fullAddress?: string | null }
  | null
  | undefined;

/**
 * The ISO-2 country of a property address — the property's address record, or (as a last
 * resort) the address text a lease keeps (`lease.property.address`).
 *
 * Lookup order, and why:
 * 1. `address.country` as a 2-letter code ("NG") — used as-is.
 * 2. `address.country` as a name ("Nigeria") — the usual case: Google Places autocomplete and
 *    CSV geocoding both fill it.
 * 3. `fullAddress` — for older records and lease address text, which have no country field.
 *    Places-formatted addresses end with the country, so this resolves them; a bare
 *    "123 Victoria Island, Lagos" does not, and falls through to null (see marketRules.test.ts).
 *
 * Which address is checked: creating a lease uses the property it has already loaded. Editing
 * and renewing use getLeaseMarketAddress (leaseHelpers.ts), which reads the PROPERTY's address
 * record too — its separate country field is the reliable source, whereas the lease's own copy
 * is plain text that may not name the country ("123 Victoria Island, Lagos"). The lease text is
 * only the fallback when the property can't be found. Using the lease text alone was tried and
 * rejected for that reason.
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

/** Whether rent can be billed yearly for a property at this address. Unknown → false. */
export const allowsAnnualRent = (address?: AddressInput): boolean => {
  const code = getPropertyCountryCode(address);
  return !!code && MARKET_RULES[code]?.annualRent === true;
};
