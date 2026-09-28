import fs from 'fs';
import os from 'os';
import path from 'path';
import { BaseCSVProcessorService } from '@services/csv/base';

describe('BaseCSVProcessorService', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-csv-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const writeCsv = (rows: string[]) => {
    const csvPath = path.join(tmpDir, 'data.csv');
    fs.writeFileSync(csvPath, rows.join('\n'));
    return csvPath;
  };

  it('surfaces invalidItems produced by postProcess, with their row numbers, in the final result', async () => {
    const csvPath = writeCsv(['name', 'good', 'bad']);

    const result = await BaseCSVProcessorService.processCsvFile<any, any>(csvPath, {
      context: {},
      transformRow: async (row) => row,
      // Simulate a postProcess step (e.g. geocoding) that rejects one row after
      // transform — this is the same shape processGeocodingForProperties returns.
      postProcess: async (items) => {
        const validItems = items.filter((item: any) => item.name !== 'bad');
        const invalidItems = items
          .filter((item: any) => item.name === 'bad')
          .map((item: any, idx: number) => ({
            rowNumber: idx + 1,
            errors: [{ field: 'name', error: `Rejected: ${item.name}` }],
          }));
        return { validItems, invalidItems };
      },
    });

    expect(result.validItems).toHaveLength(1);
    expect(result.validItems[0].name).toBe('good');
    expect(result.errors).toEqual([
      expect.objectContaining({
        errors: [expect.objectContaining({ error: 'Rejected: bad' })],
      }),
    ]);
  });

  it('does not skip or duplicate rows when postProcess drops items mid-array', async () => {
    const csvPath = writeCsv(['name', 'row1', 'row2', 'row3', 'row4']);

    const result = await BaseCSVProcessorService.processCsvFile<any, any>(csvPath, {
      context: {},
      transformRow: async (row) => row,
      // Drop the second row only — the surviving rows must all be preserved,
      // in order, regardless of how postProcess mutates array length.
      postProcess: async (items) => {
        const validItems = items.filter((item: any) => item.name !== 'row2');
        return { validItems, invalidItems: [] };
      },
    });

    expect(result.validItems.map((item: any) => item.name)).toEqual(['row1', 'row3', 'row4']);
  });

  it('returns null errors when there are no invalid rows', async () => {
    const csvPath = writeCsv(['name', 'only-row']);

    const result = await BaseCSVProcessorService.processCsvFile<any, any>(csvPath, {
      context: {},
      transformRow: async (row) => row,
    });

    expect(result.errors).toBeNull();
    expect(result.validItems).toHaveLength(1);
  });
});
