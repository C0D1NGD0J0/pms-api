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
    if (!filePath) {
      throw new Error('CSV file path missing');
    }

    const state = this.initializeProcessingState<T>(options);
    return new Promise((resolve, reject) => {
      const completion = this.setupCompletionHandlers(state, options, resolve, reject);
      const stream = this.createCsvStream(filePath, options);

      this.attachStreamHandlers(stream, state, options, completion);
    });
  }

  private static initializeProcessingState<T>(options: any) {
    const headerTransformer =
      options.headerTransformer ||
      (({ header }: { header: string }) => header.trim().replace(/\./g, '_'));

    return {
      results: [] as T[],
      invalidItems: [] as ICsvProcessingError[],
      rowNumber: 1,
      batch: [] as T[],
      totalProcessed: 0,
      pendingOperations: 0,
      streamEnded: false,
      expectedColumnCount: 0,
      headers: [] as string[],
      headerTransformer,
    };
  }

  private static setupCompletionHandlers<T, C>(
    state: any,
    options: ICsvProcessorOptions<T, C>,
    resolve: (value: any) => void,
    reject: (reason?: any) => void
  ) {
    const checkCompletion = () => {
      if (state.streamEnded && state.pendingOperations === 0) {
        this.finalizeResults(state, options, resolve, reject);
      }
    };

    return { checkCompletion };
  }

  private static async finalizeResults<T, C>(
    state: any,
    options: ICsvProcessorOptions<T, C>,
    resolve: (value: any) => void,
    reject: (reason?: any) => void
  ) {
    try {
      await this.processFinalBatch(state, options);
      const finalResults = await this.runPostProcessing(state, options);
      this.logProcessingResults(state, finalResults);

      resolve({
        validItems: options.processBatch ? [] : finalResults,
        finishedAt: new Date(),
        totalRows: state.rowNumber - 1,
        errors: state.invalidItems.length ? state.invalidItems : null,
      });
    } catch (error) {
      reject(error);
    }
  }

  private static async processFinalBatch<T, C>(state: any, options: ICsvProcessorOptions<T, C>) {
    if (state.batch.length > 0) {
      if (options.processBatch) {
        await options.processBatch(state.batch, options.context);
        state.totalProcessed += state.batch.length;
        this.log.info(`Processed final batch: ${state.totalProcessed} total rows`);
      } else {
        state.results.push(...state.batch);
      }
    }
  }

  private static async runPostProcessing<T, C>(state: any, options: ICsvProcessorOptions<T, C>) {
    if (!options.postProcess || state.results.length === 0 || options.processBatch) {
      return state.results;
    }

    const chunkSize = 500;
    for (let i = 0; i < state.results.length; i += chunkSize) {
      const chunk = state.results.slice(i, i + chunkSize);
      const processed = await options.postProcess(chunk, options.context);
      state.results.splice(i, chunk.length, ...processed.validItems);

      if (global.gc) {
        global.gc();
      }
    }

    return state.results;
  }

  private static logProcessingResults(state: any, finalResults: any[]) {
    const finalCount = state.totalProcessed || finalResults.length;
    this.log.info(`Successfully processed ${finalCount} valid rows.`);

    if (state.invalidItems.length > 0) {
      this.log.error(
        `${state.invalidItems.length} items were not processed due to validation errors.`
      );
    }
  }

  private static createCsvStream(filePath: string, options: any) {
    return fs.createReadStream(filePath).pipe(
      csvParser({
        mapHeaders: ({ header, index }: { header: string; index: number }) => {
          const transformedHeader = options.headerTransformer
            ? options.headerTransformer({ header })
            : header.trim().replace(/\./g, '_');
          return transformedHeader;
        },
        skipLines: 0,
        strict: false,
      })
    );
  }

  private static attachStreamHandlers<T, C>(
    stream: any,
    state: any,
    options: ICsvProcessorOptions<T, C>,
    completion: { checkCompletion: () => void }
  ) {
    stream.on('headers', (headers: string[]) => {
      state.headers = headers;
      state.expectedColumnCount = headers.length;
    });

    stream.on('data', async (row: any) => {
      await this.processRow(stream, row, state, options, completion);
    });

    stream.on('end', () => {
      state.streamEnded = true;
      completion.checkCompletion();
    });

    stream.on('error', (error: Error) => {
      this.log.error('Error reading CSV stream:', error);
    });
  }

  private static async processRow<T, C>(
    stream: any,
    row: any,
    state: any,
    options: ICsvProcessorOptions<T, C>,
    completion: { checkCompletion: () => void }
  ) {
    state.pendingOperations++;

    try {
      stream.pause();

      await this.validateRowColumns(row, state);

      if (!(await this.validateRowData(row, state, options, completion))) {
        return;
      }

      const transformedRow = await this.transformRow(row, state, options);
      await this.addToBatch(transformedRow, state, options);

      state.rowNumber++;
      state.pendingOperations--;
      stream.resume();
      completion.checkCompletion();
    } catch (error: any) {
      this.handleRowError(error, state, completion);
      stream.resume();
    }
  }

  private static async validateRowColumns(row: any, state: any) {
    const rowColumnCount = Object.keys(row).length;
    if (rowColumnCount !== state.expectedColumnCount) {
      this.log.warn(
        `Row ${state.rowNumber} has ${rowColumnCount} columns but ${state.expectedColumnCount} were expected`
      );

      state.headers.forEach((header: string) => {
        if (row[header] === undefined) {
          row[header] = null;
        }
      });
    }
  }

  private static async validateRowData<T, C>(
    row: any,
    state: any,
    options: ICsvProcessorOptions<T, C>,
    completion: { checkCompletion: () => void }
  ): Promise<boolean> {
    if (!options.validateRow) return true;

    const { isValid, errors } = await options.validateRow(row, options.context, state.rowNumber);
    if (!isValid) {
      state.invalidItems.push({ rowNumber: state.rowNumber, errors });
      state.rowNumber++;
      state.pendingOperations--;
      completion.checkCompletion();
      return false;
    }
    return true;
  }

  private static async transformRow<T, C>(
    row: any,
    state: any,
    options: ICsvProcessorOptions<T, C>
  ): Promise<T> {
    if (options.transformRow) {
      return await options.transformRow(row, options.context, state.rowNumber);
    }
    return row as unknown as T;
  }

  private static async addToBatch<T, C>(
    transformedRow: T,
    state: any,
    options: ICsvProcessorOptions<T, C>
  ) {
    state.batch.push(transformedRow);

    if (state.batch.length >= this.BATCH_SIZE) {
      if (options.processBatch) {
        await options.processBatch(state.batch, options.context);
        state.totalProcessed += state.batch.length;
        this.log.info(`Processed batch: ${state.totalProcessed} total rows`);
      } else {
        state.results.push(...state.batch);
      }

      state.batch = [];

      if (global.gc) {
        global.gc();
      }
    }
  }

  private static handleRowError(
    error: any,
    state: any,
    completion: { checkCompletion: () => void }
  ) {
    this.log.error(`Error processing row ${state.rowNumber}:`, error);
    state.invalidItems.push({
      rowNumber: state.rowNumber,
      errors: [
        {
          field: 'unknown',
          error: `Error processing row: ${error?.message || 'Unknown error'}`,
        },
      ],
    });
    state.pendingOperations--;
    completion.checkCompletion();
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
