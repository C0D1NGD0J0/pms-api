/* eslint-disable @typescript-eslint/no-unused-vars */
import fs from 'fs';
import csvParser from 'csv-parser';
import { createLogger } from '@utils/helpers';
import { ICsvProcessorOptions, ICsvProcessingError } from '@interfaces/csv.interface';

/**
 * generic CSV processor that can be used for any type of CSV file
 */
export class BaseCSVProcessorService {
  private static readonly log = createLogger('CsvProcessorService');

  static async processCsvFile<T, C>(
    filePath: string,
    options: ICsvProcessorOptions<T, C>
  ): Promise<{
    validItems: T[];
    errors: null | ICsvProcessingError[];
  }> {
    const results: T[] = [];
    const invalidItems: ICsvProcessingError[] = [];
    let rowNumber = 1;

    if (!filePath) {
      throw new Error('CSV file path missing');
    }

    const headerTransformer =
      options.headerTransformer ||
      (({ header }) => header.trim().toLowerCase().replace(/\./g, '_'));

    let expectedColumnCount = 0;
    const headers: string[] = [];
    const stream = fs.createReadStream(filePath).pipe(
      csvParser({
        mapHeaders: ({ header, index }: { header: string; index: number }) => {
          expectedColumnCount++;
          const transformedHeader = headerTransformer({ header });
          headers.push(transformedHeader);
          return transformedHeader;
        },
        skipLines: 0,
        strict: false, // manually handle empty field so we can add null value
      })
    );

    try {
      for await (const row of stream) {
        const rowColumnCount = Object.keys(row).length;
        if (rowColumnCount !== expectedColumnCount) {
          this.log.warn(
            `Row ${rowNumber} has ${rowColumnCount} columns but ${expectedColumnCount} were expected`
          );

          // add null value to ensure all fields exist
          headers.forEach((header) => {
            if (row[header] === undefined) {
              row[header] = null;
            }
          });
        }
        try {
          if (options.validateRow) {
            const { isValid, errors } = await options.validateRow(row, options.context, rowNumber);
            if (!isValid) {
              invalidItems.push({ rowNumber, errors });
              rowNumber++;
              continue;
            }
          }

          let transformedRow = row as unknown as T;
          if (options.transformRow) {
            transformedRow = await options.transformRow(row, options.context, rowNumber);
          }

          results.push(transformedRow);
        } catch (processingError: any) {
          this.log.error(`Error processing row ${rowNumber}:`, processingError);
          invalidItems.push({
            rowNumber,
            errors: [
              {
                field: 'unknown',
                error: `Error processing row: ${processingError?.message || 'Unknown error'}`,
              },
            ],
          });
        }
        rowNumber++;
      }

      if (options.postProcess && results.length > 0) {
        const postProcessResult = await options.postProcess(results, options.context);

        this.log.info(`Successfully processed ${postProcessResult.validItems.length} valid items.`);
        if (invalidItems.length > 0) {
          this.log.info(
            `${invalidItems.length} items were not processed due to validation errors.`
          );
        }
        if (postProcessResult.invalidItems && postProcessResult.invalidItems.length > 0) {
          this.log.info(`${postProcessResult.invalidItems.length} items failed post-processing.`);
        }

        return {
          validItems: postProcessResult.validItems,
          errors: invalidItems.length ? invalidItems : null,
        };
      }

      this.log.info(`Successfully processed ${results.length} valid items.`);
      if (invalidItems.length > 0) {
        this.log.info(`${invalidItems.length} items were not processed due to errors.`);
      }

      return {
        validItems: results,
        errors: invalidItems.length ? invalidItems : null,
      };
    } catch (streamError: any) {
      this.log.error('Error reading or parsing CSV stream:', streamError);
      throw streamError;
    }
  }

  static parseBoolean(value: any): boolean {
    if (value === undefined || value === null || '') return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;

    const strValue = String(value).toLowerCase().trim();
    return ['true', 'yes', 'y', '1'].includes(strValue);
  }

  static parseNumber(value: any, defaultValue: number = 0): number {
    if (value === undefined || value === null || value === '') return defaultValue;
    const parsed = Number(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }
}
