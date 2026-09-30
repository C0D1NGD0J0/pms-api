import fs from 'fs';
import os from 'os';
import path from 'path';
import { Types } from 'mongoose';
import { PropertyCsvProcessor } from '@services/csv/propertyCsvProcessor';

describe('PropertyCsvProcessor', () => {
  let processor: PropertyCsvProcessor;
  let mockGeoCoderService: any;
  let mockPropertyDAO: any;
  let mockClientDAO: any;
  let mockUserDAO: any;
  const cuid = 'test-client-cuid';
  const userId = new Types.ObjectId().toString();

  const geocodeResultFor = (fullAddress: string, overrides: Record<string, any> = {}) => ({
    success: true,
    data: {
      city: 'Toronto',
      state: 'ON',
      street: 'Kensington Avenue',
      country: 'Canada',
      postCode: 'M5T 2K2',
      latAndlon: '43.6547,-79.4013',
      fullAddress,
      streetNumber: '88',
      coordinates: [-79.4013, 43.6547],
      ...overrides,
    },
  });

  beforeEach(() => {
    mockGeoCoderService = {
      parseLocation: jest
        .fn()
        .mockReturnValue(
          Promise.resolve(geocodeResultFor('88 Kensington Avenue, Toronto, ON M5T 2K2'))
        ),
    };
    mockPropertyDAO = {
      findPropertyByAddress: jest.fn().mockReturnValue(Promise.resolve(null)),
    };
    mockClientDAO = {
      getClientByCuid: jest.fn().mockReturnValue(Promise.resolve({ cuid })),
    };
    mockUserDAO = {
      getActiveUserByEmail: jest.fn(),
    };

    processor = new PropertyCsvProcessor({
      geoCoderService: mockGeoCoderService,
      propertyDAO: mockPropertyDAO,
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
    });
  });

  describe('transformPropertyRow', () => {
    const transform = (row: any, rowNumber = 1) =>
      (processor as any).transformPropertyRow(row, { cuid, userId }, rowNumber);

    it('reads specifications from the specifications_* columns, not bare bedrooms/bathrooms/floors', async () => {
      const result = await transform({
        name: 'Test Property',
        propertyType: 'apartment',
        fullAddress: '88 Kensington Ave',
        specifications_bedrooms: '3',
        specifications_bathrooms: '2',
        specifications_floors: '1',
      });

      expect(result.specifications.bedrooms).toBe(3);
      expect(result.specifications.bathrooms).toBe(2);
      expect(result.specifications.floors).toBe(1);
    });

    it('maps the status column to operationalStatus', async () => {
      const result = await transform({
        name: 'Test Property',
        propertyType: 'apartment',
        fullAddress: '88 Kensington Ave',
        status: 'available',
      });

      expect(result.operationalStatus).toBe('available');
    });

    it('reads fees from the camelCased fee columns including securityDeposit', async () => {
      const result = await transform({
        name: 'Test Property',
        propertyType: 'apartment',
        fullAddress: '88 Kensington Ave',
        fees_rentalAmount: '2500',
        fees_managementFees: '100',
        fees_securityDeposit: '2500',
      });

      expect(result.fees.rentAmount).toBe(2500);
      expect(result.fees.managementFees).toBe(100);
      expect(result.fees.securityDeposit).toBe(2500);
    });

    it('joins split address columns into the geocoder query when fullAddress is absent', async () => {
      const result = await transform({
        name: 'Test Property',
        propertyType: 'apartment',
        address_street: '88 Kensington Avenue',
        address_city: 'Toronto',
        address_state: 'ON',
        address_postCode: 'M5T 2K2',
        address_country: 'Canada',
      });

      expect(result.fullAddress).toBe('88 Kensington Avenue, Toronto, ON, M5T 2K2, Canada');
    });

    it('carries the row number and address_unitNumber as transient fields for postProcess', async () => {
      const result = await transform(
        {
          name: 'Test',
          propertyType: 'apartment',
          fullAddress: '88 Kensington Ave',
          address_unitNumber: '4B',
        },
        7
      );

      expect(result._csvRowNumber).toBe(7);
      expect(result._addressUnitNumber).toBe('4B');
    });
  });

  describe('interior/community amenity and owner detection', () => {
    it('detects interior amenities using the canonical camelCase keys', () => {
      const hasAny = (processor as any).hasAnyInteriorAmenity({
        interiorAmenities_airConditioning: 'true',
      });
      expect(hasAny).toBe(true);
    });

    it('detects community amenities using the canonical camelCase keys', () => {
      const hasAny = (processor as any).hasAnyCommunityAmenity({
        communityAmenities_swimmingPool: 'true',
      });
      expect(hasAny).toBe(true);
    });

    it('detects owner fields using the canonical camelCase keys, including taxId and bank details', () => {
      expect((processor as any).hasAnyOwnerField({ owner_taxId: '123' })).toBe(true);
      expect((processor as any).hasAnyBankDetails({ owner_bankDetails_accountName: 'Acme' })).toBe(
        true
      );
    });

    it('does not falsely detect amenities/owner fields when none are present', () => {
      expect((processor as any).hasAnyInteriorAmenity({})).toBe(false);
      expect((processor as any).hasAnyCommunityAmenity({})).toBe(false);
      expect((processor as any).hasAnyOwnerField({})).toBe(false);
    });
  });

  describe('postProcessProperties — geocoding, unitNumber, and duplicates', () => {
    const buildRow = (overrides: Record<string, any> = {}) => ({
      _csvRowNumber: 1,
      name: 'Test Property',
      fullAddress: '88 Kensington Ave',
      propertyType: 'apartment',
      address: {},
      fees: { rentAmount: 0, managementFees: 0, currency: 'USD' },
      specifications: {},
      ...overrides,
    });

    it('replaces fullAddress with the geocoder normalized result, not the raw input', async () => {
      const { validItems } = await (processor as any).postProcessProperties([buildRow()], {
        cuid,
        userId,
      });

      expect(validItems).toHaveLength(1);
      expect(validItems[0].address.fullAddress).toBe('88 Kensington Avenue, Toronto, ON M5T 2K2');
    });

    it('applies address_unitNumber onto the address after the geocoder result is assigned', async () => {
      const { validItems } = await (processor as any).postProcessProperties(
        [buildRow({ _addressUnitNumber: '4B' })],
        { cuid, userId }
      );

      expect(validItems[0].address.unitNumber).toBe('4B');
    });

    it('strips transient fields before returning the valid property', async () => {
      const { validItems } = await (processor as any).postProcessProperties(
        [buildRow({ _addressUnitNumber: '4B' })],
        { cuid, userId }
      );

      expect(validItems[0]._csvRowNumber).toBeUndefined();
      expect(validItems[0]._addressUnitNumber).toBeUndefined();
    });

    it('reports a row error with the row number when geocoding fails', async () => {
      mockGeoCoderService.parseLocation.mockReturnValue(
        Promise.resolve({ success: false, data: null })
      );

      const { validItems, invalidItems } = await (processor as any).postProcessProperties(
        [buildRow({ _csvRowNumber: 3 })],
        { cuid, userId }
      );

      expect(validItems).toHaveLength(0);
      expect(invalidItems).toEqual([
        expect.objectContaining({
          rowNumber: 3,
          errors: [expect.objectContaining({ field: 'address' })],
        }),
      ]);
    });

    it('skips a row whose geocoded address already exists in the database', async () => {
      mockPropertyDAO.findPropertyByAddress.mockReturnValue(
        Promise.resolve({ id: 'existing-property' })
      );

      const { validItems, invalidItems } = await (processor as any).postProcessProperties(
        [buildRow()],
        { cuid, userId }
      );

      expect(validItems).toHaveLength(0);
      expect(invalidItems[0].errors[0].error).toMatch(/already exists/);
    });

    it('skips a row whose geocoded address is repeated earlier in the same file', async () => {
      // Two different raw inputs that the geocoder normalizes to the same address.
      mockGeoCoderService.parseLocation
        .mockReturnValueOnce(
          Promise.resolve(geocodeResultFor('88 Kensington Avenue, Toronto, ON M5T 2K2'))
        )
        .mockReturnValueOnce(
          Promise.resolve(geocodeResultFor('88 Kensington Avenue, Toronto, ON M5T 2K2'))
        );

      const { validItems, invalidItems } = await (processor as any).postProcessProperties(
        [
          buildRow({ _csvRowNumber: 1, fullAddress: '88 Kensington Ave' }),
          buildRow({ _csvRowNumber: 2, fullAddress: '88 Kensington Avenue' }),
        ],
        { cuid, userId }
      );

      expect(validItems).toHaveLength(1);
      expect(invalidItems).toEqual([
        expect.objectContaining({
          rowNumber: 2,
          errors: [
            expect.objectContaining({ error: expect.stringMatching(/already exists in the file/) }),
          ],
        }),
      ]);
    });
  });

  describe('validateRequiredHeaders', () => {
    const validate = (headers: string[]) => (processor as any).validateRequiredHeaders(headers);

    it('accepts fullAddress alone', () => {
      expect(validate(['name', 'propertyType', 'fullAddress']).isValid).toBe(true);
    });

    it('accepts address_street + address_city without fullAddress', () => {
      expect(validate(['name', 'propertyType', 'address_street', 'address_city']).isValid).toBe(
        true
      );
    });

    it('rejects a file missing both fullAddress and the split address columns', () => {
      const result = validate(['name', 'propertyType']);
      expect(result.isValid).toBe(false);
      expect(result.missingHeaders.join(' ')).toMatch(/fullAddress/);
    });
  });

  describe('createPropertyHeaderTransformer — columnMapping', () => {
    const transformHeader = (header: string, columnMapping?: Record<string, string>) =>
      (processor as any).createPropertyHeaderTransformer(columnMapping)({ header });

    it('maps a file header to its field key when a user-confirmed mapping is provided', () => {
      const result = transformHeader('Property Name', { 'Property Name': 'name' });
      expect(result).toBe('name');
    });

    it('rejects a mapping that points at an unknown field key, falling back to normal matching', () => {
      const result = transformHeader('name', { name: 'not_a_real_field' });
      expect(result).toBe('name');
    });

    it('falls back to exact-match when no mapping is provided for a header', () => {
      const result = transformHeader('fullAddress', { 'Property Name': 'name' });
      expect(result).toBe('fullAddress');
    });

    it('ignores an unrecognized header with no mapping and no exact match', () => {
      const result = transformHeader('Some Random Column');
      expect(result).toBeNull();
    });
  });

  describe('getTemplateHeaders / generateTemplateCsv', () => {
    it('limits the template to the columns every row must have', () => {
      expect(processor.getTemplateHeaders()).toEqual(['name', 'propertyType', 'fullAddress']);
    });

    it('still accepts every optional column on import', () => {
      const accepted = processor.getAcceptedHeaders();
      expect(accepted).toEqual(expect.arrayContaining(processor.getTemplateHeaders()));
      expect(accepted).toContain('fees_securityDeposit');
      expect(accepted).toContain('owner_type');
      expect(accepted).not.toContain('fees_taxamount');
    });

    it('generates a header row and one quoted example row', () => {
      const csv = processor.generateTemplateCsv();
      const [headerLine, exampleLine] = csv.trim().split('\n');

      expect(headerLine).toBe('name,propertyType,fullAddress');
      expect(exampleLine).toBe(
        'Kensington Terrace,apartment,"88 Kensington Avenue, Toronto, ON M5T 2K2, Canada"'
      );
    });

    it('passes its own header validation', () => {
      const result = (processor as any).validateRequiredHeaders(processor.getTemplateHeaders());
      expect(result.isValid).toBe(true);
    });
  });

  describe('end-to-end validateCsv against a real file', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'property-csv-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('parses a real CSV file end to end and returns a geocoded valid property', async () => {
      const csvPath = path.join(tmpDir, 'properties.csv');
      const csvContent = [
        'name,propertyType,address_street,address_city,address_state,address_postCode,address_country',
        'Kensington Terrace,apartment,88 Kensington Avenue,Toronto,ON,M5T 2K2,Canada',
      ].join('\n');
      fs.writeFileSync(csvPath, csvContent);

      const result = await processor.validateCsv(csvPath, { cuid, userId });

      expect(result.validProperties).toHaveLength(1);
      expect(result.validProperties[0].address.fullAddress).toBe(
        '88 Kensington Avenue, Toronto, ON M5T 2K2'
      );
      expect(result.errors).toBeNull();
    });
  });
});
