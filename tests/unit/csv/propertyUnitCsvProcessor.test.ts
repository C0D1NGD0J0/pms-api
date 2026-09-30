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
});
