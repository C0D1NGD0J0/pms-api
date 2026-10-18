import os from 'os';
import fs from 'fs';
import path from 'path';
import { Types } from 'mongoose';
import { PropertyUnitCsvProcessor } from '@services/csv/propertyUnitCsvProcessor';

describe('PropertyUnitCsvProcessor', () => {
  let processor: PropertyUnitCsvProcessor;
  const context = {
    userId: new Types.ObjectId().toString(),
    cuid: 'test-client-cuid',
    pid: new Types.ObjectId().toString(),
  };

  beforeEach(() => {
    processor = new PropertyUnitCsvProcessor();
  });

  describe('transformUnitRow — boolean fields', () => {
    const transform = (row: any) => (processor as any).transformUnitRow(row, context);

    it('parses the literal string "false" as boolean false, not truthy', async () => {
      const result = await transform({
        unitNumber: '101',
        amenities_washerDryer: 'false',
        amenities_dishwasher: 'false',
        utilities_water: 'false',
      });

      expect(result.amenities.washerDryer).toBe(false);
      expect(result.amenities.dishwasher).toBe(false);
      expect(result.utilities.water).toBe(false);
    });

    it('parses "true"/"1"/"yes" as boolean true', async () => {
      const result = await transform({
        unitNumber: '101',
        amenities_parking: 'true',
        amenities_cableTV: '1',
        amenities_internet: 'yes',
      });

      expect(result.amenities.parking).toBe(true);
      expect(result.amenities.cableTV).toBe(true);
      expect(result.amenities.internet).toBe(true);
    });

    it('defaults to false when a boolean column is absent', async () => {
      const result = await transform({ unitNumber: '101' });

      expect(result.amenities.washerDryer).toBe(false);
      expect(result.amenities.storage).toBe(false);
      expect(result.utilities.centralAC).toBe(false);
      expect(result.utilities.heating).toBe(false);
      expect(result.utilities.gas).toBe(false);
      expect(result.utilities.trash).toBe(false);
    });
  });

  describe('validateCsv — ready-to-lease columns', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-csv-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const validateFile = (lines: string[], columnMapping?: Record<string, string>) => {
      const csvPath = path.join(tmpDir, 'units.csv');
      fs.writeFileSync(csvPath, lines.join('\n'));
      return processor.validateCsv(csvPath, { ...context, columnMapping });
    };

    const header =
      'unitNumber,unitType,floor,status,specifications_totalArea,specifications_bedrooms,specifications_bathrooms,fees_rentAmount,fees_securityDeposit';

    it('accepts its own downloadable template as is', async () => {
      const result = await validateFile(processor.generateTemplateCsv().trim().split('\n'));

      expect(result.errors).toBeNull();
      expect(result.validUnits).toHaveLength(2);
      const studio = result.validUnits[1] as any;
      expect(studio.specifications.bedrooms).toBe(0);
      expect(studio.fees).toEqual({ rentAmount: 1400, securityDeposit: 1400 });
    });

    it('rejects a file missing a required column', async () => {
      await expect(
        validateFile([
          'unitNumber,unitType,specifications_totalArea,fees_rentAmount',
          '101,residential,750,1200',
        ])
      ).rejects.toThrow(
        'Invalid CSV format. Missing required columns: floor, status, fees_securityDeposit.'
      );
    });

    it('reports blank required cells instead of saving defaults or 0', async () => {
      const result = await validateFile([header, '101,residential,,,750,2,1,1200,']);

      expect(result.validUnits).toHaveLength(0);
      expect(result.errors?.[0].errors.map((rowError) => rowError.field)).toEqual([
        'floor',
        'status',
        'fees_securityDeposit',
      ]);
    });

    it('requires bedrooms and bathrooms on a residential unit', async () => {
      const result = await validateFile([header, '101,residential,1,available,750,,,1200,1200']);

      expect(result.errors?.[0].errors.map((rowError) => rowError.field)).toEqual([
        'specifications_bedrooms',
        'specifications_bathrooms',
      ]);
    });

    it('does not ask for rooms on a commercial unit', async () => {
      const result = await validateFile([header, '101,commercial,1,available,1200,,,3500,3500']);

      expect(result.errors).toBeNull();
    });

    it('reads columns the user mapped from their own headers', async () => {
      const result = await validateFile(
        [
          'Unit,Type,Level,Status,Sq Ft,Beds,Baths,Rent,Deposit',
          '101,residential,1,available,850,2,1,1800,1800',
        ],
        {
          Unit: 'unitNumber',
          Type: 'unitType',
          Level: 'floor',
          Status: 'status',
          'Sq Ft': 'specifications_totalArea',
          Beds: 'specifications_bedrooms',
          Baths: 'specifications_bathrooms',
          Rent: 'fees_rentAmount',
          Deposit: 'fees_securityDeposit',
        }
      );

      expect(result.errors).toBeNull();
      expect((result.validUnits[0] as any).specifications.bedrooms).toBe(2);
    });
  });
});
