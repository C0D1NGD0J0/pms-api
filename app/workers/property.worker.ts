import { Job } from 'bull';
import Logger from 'bunyan';
import { ClientDAO } from '@dao/index';
import { createLogger } from '@utils/index';
import { CsvJobData } from '@interfaces/index';
import { PropertyCsvProcessor } from '@services/csv';
import { PropertyService } from '@services/property';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';

interface IConstructor {
  propertyCsvProcessor: PropertyCsvProcessor;
  emitterService: EventEmitterService;
  propertyService: PropertyService;
  clientDAO: ClientDAO;
}

export class PropertyWorker {
  log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly propertyService: PropertyService;
  private readonly emitterService: EventEmitterService;

  constructor({ propertyService, clientDAO, emitterService }: IConstructor) {
    this.clientDAO = clientDAO;
    this.propertyService = propertyService;
    this.emitterService = emitterService;
    this.log = createLogger('PropertyWorker');
  }

  processCsvValidation = async (job: Job<CsvJobData>) => {
    const { csvFilePath, cid, userId } = job.data;
    this.log.info(`Processing CSV validation job ${job.id} for client ${cid}`);
    job.progress(10);

    try {
      job.progress(30);
      const result = await this.propertyService.processCsv(cid, csvFilePath, userId);

      job.progress(100);

      return {
        validCount: result.data.length,
        errorCount: result.errors ? result.errors.length : 0,
        errors: result.errors,
        success: true,
      };
    } catch (error) {
      this.log.error(`Error processing CSV validation job ${job.id}:`, error);
      throw error;
    }
  };

  processCsvImport = async (job: Job<CsvJobData>) => {
    const { csvFilePath, cid, userId } = job.data;

    job.progress(10);
    this.log.info(`Processing CSV import job ${job.id} for client ${cid}`);

    try {
      const csvResult = await this.propertyService.processCsv(cid, csvFilePath, userId);
      job.progress(50);

      if (!csvResult.data.length) {
        // instead of returning, sending notification to user. 'CREATE NOTIFICATION SYSTEM' later
        this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
        return {
          success: false,
          errors: csvResult.errors,
          message: 'No valid properties found in CSV',
        };
      }
      const insertResponse = await this.propertyService.createProperties(csvResult, csvFilePath);
      job.progress(100);

      return {
        success: true,
        count: insertResponse.data.length,
        errors: csvResult.errors,
        message: csvResult.errors?.length
          ? 'Properties imported with some errors'
          : 'All properties imported successfully',
      };
    } catch (error) {
      this.log.error(`Error processing CSV import job ${job.id}:`, error);
      throw error;
    }
  };
}
