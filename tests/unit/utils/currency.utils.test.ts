import { getCurrencyForCountry, COUNTRY_TO_CURRENCY, scaleUsdLimit } from '@utils/currency.utils';

describe('getCurrencyForCountry', () => {
  it('returns USD for US', () => {
    expect(getCurrencyForCountry('US')).toBe('USD');
  });

  it('returns NGN for Nigeria', () => {
    expect(getCurrencyForCountry('NG')).toBe('NGN');
  });

  it('returns CAD for Canada', () => {
    expect(getCurrencyForCountry('CA')).toBe('CAD');
  });

  it('returns EUR for Eurozone countries', () => {
    expect(getCurrencyForCountry('DE')).toBe('EUR');
    expect(getCurrencyForCountry('FR')).toBe('EUR');
    expect(getCurrencyForCountry('IT')).toBe('EUR');
    expect(getCurrencyForCountry('ES')).toBe('EUR');
  });

  it('returns GBP for UK', () => {
    expect(getCurrencyForCountry('GB')).toBe('GBP');
  });

  it('returns AUD for Australia', () => {
    expect(getCurrencyForCountry('AU')).toBe('AUD');
  });

  it('handles case insensitivity', () => {
    expect(getCurrencyForCountry('ng')).toBe('NGN');
    expect(getCurrencyForCountry('Us')).toBe('USD');
    expect(getCurrencyForCountry('ca')).toBe('CAD');
  });

  it('falls back to USD for unknown countries', () => {
    expect(getCurrencyForCountry('XX')).toBe('USD');
    expect(getCurrencyForCountry('ZZ')).toBe('USD');
    expect(getCurrencyForCountry('')).toBe('USD');
  });

  it('exports COUNTRY_TO_CURRENCY map', () => {
    expect(COUNTRY_TO_CURRENCY).toBeDefined();
    expect(Object.keys(COUNTRY_TO_CURRENCY).length).toBeGreaterThan(10);
  });
});

describe('scaleUsdLimit', () => {
  it('keeps the limit for US dollars and currencies near parity', () => {
    expect(scaleUsdLimit(100000, 'USD')).toBe(100000);
    expect(scaleUsdLimit(100000, 'EUR')).toBe(100000);
  });

  it('scales the limit for currencies worth far less than a dollar', () => {
    expect(scaleUsdLimit(100000, 'NGN')).toBe(160000000);
    expect(scaleUsdLimit(100000, 'jpy')).toBe(15000000);
  });

  it('falls back to the dollar limit when the currency is missing or unknown', () => {
    expect(scaleUsdLimit(100000)).toBe(100000);
    expect(scaleUsdLimit(100000, 'XYZ')).toBe(100000);
  });
});
