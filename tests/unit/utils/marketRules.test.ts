import {
  paymentProviderForCountry,
  getPropertyCountryCode,
  allowsAnnualRent,
} from '@utils/marketRules';

describe('marketRules', () => {
  it('reads the country from the free-text country field', () => {
    expect(getPropertyCountryCode({ country: 'Nigeria' })).toBe('NG');
    expect(getPropertyCountryCode({ country: 'Canada' })).toBe('CA');
    expect(getPropertyCountryCode({ country: 'ng' })).toBe('NG');
  });

  it('falls back to the full address when the country field is empty', () => {
    expect(
      getPropertyCountryCode({
        country: '',
        fullAddress: '38 Bourdillon Rd, Ikoyi, Lagos, Nigeria',
      })
    ).toBe('NG');
  });

  it('allows rent paid yearly in Nigeria only', () => {
    expect(allowsAnnualRent({ country: 'Nigeria' })).toBe(true);
    expect(allowsAnnualRent({ country: 'Canada' })).toBe(false);
    expect(allowsAnnualRent({ country: 'Ghana' })).toBe(false);
  });

  it('defaults to monthly when the country is unknown', () => {
    expect(allowsAnnualRent(null)).toBe(false);
    expect(allowsAnnualRent({ country: 'Atlantis' })).toBe(false);
  });

  it('reads the address text a lease keeps', () => {
    expect(allowsAnnualRent('12 Admiralty Way, Lekki, Lagos, Nigeria')).toBe(true);
    expect(allowsAnnualRent('100 King St W, Toronto, ON, Canada')).toBe(false);
  });

  it('reads a Nigerian address that ends with the country, as autocomplete gives it', () => {
    expect(allowsAnnualRent({ fullAddress: 'Victoria Island, Lagos, Nigeria' })).toBe(true);
    expect(allowsAnnualRent({ fullAddress: '15 Admiralty Way, Lekki, Lagos, NG' })).toBe(true);
  });

  it('fails safe to monthly when an address names no country it can resolve', () => {
    // Properties get the country from address autocomplete or CSV geocoding, so this is rare;
    // when it happens yearly rent is simply not offered
    expect(allowsAnnualRent({ fullAddress: '123 Victoria Island, Lagos' })).toBe(false);
  });
});

describe('paymentProviderForCountry', () => {
  it('names Paystack for Nigeria, in any letter case', () => {
    expect(paymentProviderForCountry('NG')).toBe('paystack');
    expect(paymentProviderForCountry('ng')).toBe('paystack');
  });

  it('returns null for Stripe countries and unknown or missing codes', () => {
    expect(paymentProviderForCountry('CA')).toBeNull();
    expect(paymentProviderForCountry('US')).toBeNull();
    expect(paymentProviderForCountry(undefined)).toBeNull();
    expect(paymentProviderForCountry(null)).toBeNull();
  });
});
