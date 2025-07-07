/* eslint-disable @typescript-eslint/no-unused-vars */
import fs from 'fs';
import csvParser from 'csv-parser';
import { createLogger } from '@utils/helpers';
import { ICsvProcessorOptions, ICsvProcessingError } from '@interfaces/csv.interface';

export class BaseCSVProcessorService {
  private static readonly log = createLogger('CsvProcessorService');
  private static readonly BATCH_SIZE = 100; // Reduced from 1000 to 100

  static async processCsvFile<T, C>(
    filePath: string,
    options: ICsvProcessorOptions<T, C>
  ): Promise<{
    validItems: T[];
    finishedAt: Date;
    totalRows: number;
    errors: null | ICsvProcessingError[];
  }> {
    const results: T[] = [];
    const invalidItems: ICsvProcessingError[] = [];
    let rowNumber = 1;
    let batch: T[] = [];
    let totalProcessed = 0;

    if (!filePath) {
      throw new Error('CSV file path missing');
    }

    const headerTransformer =
      options.headerTransformer || (({ header }) => header.trim().replace(/\./g, '_'));

    let expectedColumnCount = 0;
    const headers: string[] = [];

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath).pipe(
        csvParser({
          mapHeaders: ({ header, index }: { header: string; index: number }) => {
            expectedColumnCount++;
            const transformedHeader = headerTransformer({ header });
            headers.push(transformedHeader);
            return transformedHeader;
          },
          skipLines: 0,
          strict: false,
        })
      );

      stream.on('data', async (row) => {
        try {
          // pause stream to handle backpressure
          stream.pause();

          const rowColumnCount = Object.keys(row).length;
          if (rowColumnCount !== expectedColumnCount) {
            this.log.warn(
              `Row ${rowNumber} has ${rowColumnCount} columns but ${expectedColumnCount} were expected`
            );

            headers.forEach((header) => {
              if (row[header] === undefined) {
                row[header] = null;
              }
            });
          }

          if (options.validateRow) {
            const { isValid, errors } = await options.validateRow(row, options.context, rowNumber);
            if (!isValid) {
              invalidItems.push({ rowNumber, errors });
              rowNumber++;
              stream.resume();
              return;
            }
          }

          let transformedRow = row as unknown as T;
          if (options.transformRow) {
            transformedRow = await options.transformRow(row, options.context, rowNumber);
          }

          batch.push(transformedRow);

          // Process batch when it reaches BATCH_SIZE
          if (batch.length >= this.BATCH_SIZE) {
            // Process batch immediately instead of accumulating
            if (options.processBatch) {
              await options.processBatch(batch, options.context);
              totalProcessed += batch.length;
              this.log.info(`Processed batch: ${totalProcessed} total rows`);
            } else {
              results.push(...batch);
            }

            batch = []; // Clear batch

            // Force garbage collection every batch
            if (global.gc) {
              global.gc();
            }
          }

          rowNumber++;
          stream.resume();
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
          stream.resume();
        }
      });

      stream.on('end', async () => {
        try {
          // Process remaining batch
          if (batch.length > 0) {
            if (options.processBatch) {
              await options.processBatch(batch, options.context);
              totalProcessed += batch.length;
              this.log.info(`Processed final batch: ${totalProcessed} total rows`);
            } else {
              results.push(...batch);
            }
          }

          let finalResults = results;

          // Only run postProcess if we accumulated results (no processBatch)
          if (options.postProcess && results.length > 0 && !options.processBatch) {
            const chunkSize = 500; // Reduced from 5000

            for (let i = 0; i < results.length; i += chunkSize) {
              const chunk = results.slice(i, i + chunkSize);
              const processed = await options.postProcess(chunk, options.context);

              // Replace chunk in place to avoid memory growth
              results.splice(i, chunk.length, ...processed.validItems);

              // GC after each chunk
              if (global.gc) {
                global.gc();
              }
            }

            finalResults = results;
          }

          const finalCount = options.processBatch ? totalProcessed : finalResults.length;
          this.log.info(`Successfully processed ${finalCount} valid rows.`);
          if (invalidItems.length > 0) {
            this.log.error(
              `${invalidItems.length} items were not processed due to validation errors.`
            );
          }

          resolve({
            validItems: options.processBatch ? [] : finalResults, // Empty if using streaming
            finishedAt: new Date(),
            totalRows: rowNumber - 1,
            errors: invalidItems.length ? invalidItems : null,
          });
        } catch (error) {
          reject(error);
        }
      });

      stream.on('error', (error) => {
        this.log.error('Error reading CSV stream:', error);
        reject(error);
      });
    });
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
