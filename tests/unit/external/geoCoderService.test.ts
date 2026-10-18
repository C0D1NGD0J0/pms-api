import { GeoCoderService } from '@services/external/geoCoder.service';

const mockGeocode = jest.fn();
jest.mock('node-geocoder', () => jest.fn(() => ({ geocode: mockGeocode })));

const googleEntry = {
  formattedAddress: '88 Kensington Ave, Toronto, ON M5T 2K2, Canada',
  latitude: 43.65,
  longitude: -79.4,
  city: 'Toronto',
  country: 'Canada',
  zipcode: 'M5T 2K2',
  streetName: 'Kensington Avenue',
  streetNumber: '88',
  administrativeLevels: { level1short: 'ON' },
};

describe('GeoCoderService.parseLocation', () => {
  let service: GeoCoderService;

  beforeEach(() => {
    mockGeocode.mockReset();
    service = new GeoCoderService();
  });

  it('returns the formatted address on success', async () => {
    mockGeocode.mockResolvedValue([googleEntry]);

    const result = await service.parseLocation('88 Kensington Avenue, Toronto');

    expect(result.success).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.data).toBeTruthy();
  });

  it('reports not_found when the provider returns no results', async () => {
    mockGeocode.mockResolvedValue([]);

    const result = await service.parseLocation('99999 Nowhere Lane, Atlantis');

    expect(result).toEqual(
      expect.objectContaining({ success: false, reason: 'not_found', data: null })
    );
  });

  it.each(['ZERO_RESULTS', 'INVALID_REQUEST'])('treats %s as not_found', async (status) => {
    mockGeocode.mockRejectedValue(new Error(`Status is ${status}.`));

    const result = await service.parseLocation('somewhere');

    expect(result.reason).toBe('not_found');
  });

  it.each([
    'Status is REQUEST_DENIED. API keys with referer restrictions cannot be used with this API.',
    'Status is OVER_QUERY_LIMIT.',
    'Status is OVER_DAILY_LIMIT.',
    'getaddrinfo ENOTFOUND maps.googleapis.com',
  ])('treats a provider failure as unavailable, without leaking it: %s', async (cause) => {
    mockGeocode.mockRejectedValue(new Error(cause));

    const result = await service.parseLocation('88 Kensington Avenue, Toronto');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('unavailable');
    expect(result.message).toBe('Address lookup is temporarily unavailable');
    expect(result.message).not.toContain(cause);
  });

  it('does not trip the circuit breaker for addresses that simply do not resolve', async () => {
    mockGeocode.mockRejectedValue(new Error('Status is ZERO_RESULTS.'));
    for (let i = 0; i < 5; i++) await service.parseLocation(`nowhere ${i}`);

    mockGeocode.mockResolvedValue([googleEntry]);
    const result = await service.parseLocation('88 Kensington Avenue, Toronto');

    expect(result.success).toBe(true);
  });

  it('fails fast as unavailable once repeated provider failures open the breaker', async () => {
    mockGeocode.mockRejectedValue(new Error('Status is REQUEST_DENIED.'));
    for (let i = 0; i < 3; i++) await service.parseLocation('a');
    mockGeocode.mockClear();

    const result = await service.parseLocation('88 Kensington Avenue, Toronto');

    expect(result.reason).toBe('unavailable');
    expect(mockGeocode).not.toHaveBeenCalled();
  });
});
