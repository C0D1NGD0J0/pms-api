import Logger from 'bunyan';
import { DoneCallback, Job } from 'bull';
import { createLogger } from '@utils/index';
import { PropertyDAO, ClientDAO } from '@dao/index';
import { PropertyCsvProcessor } from '@services/csv';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { CsvProcessReturnData, CsvJobData } from '@interfaces/index';

interface IConstructor {
  propertyCsvProcessor: PropertyCsvProcessor;
  emitterService: EventEmitterService;
  propertyDAO: PropertyDAO;
  clientDAO: ClientDAO;
}

export class PropertyWorker {
  log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly emitterService: EventEmitterService;
  private readonly propertyCsvProcessor: PropertyCsvProcessor;

  constructor({ propertyDAO, clientDAO, emitterService, propertyCsvProcessor }: IConstructor) {
    this.clientDAO = clientDAO;
    this.propertyDAO = propertyDAO;
    this.emitterService = emitterService;
    this.log = createLogger('PropertyWorker');
    this.propertyCsvProcessor = propertyCsvProcessor;
  }

  processCsvValidation = async (job: Job<CsvJobData>, done: DoneCallback) => {
    job.progress(10);
    const { csvFilePath, cid, userId } = job.data;
    this.log.info(`Processing CSV validation job ${job.id} for client ${cid}`);

    try {
      job.progress(30);
      const result = await this.propertyCsvProcessor.validateCsv(csvFilePath, {
        cid,
        userId,
      });
      job.progress(100);
      done(null, {
        processId: job.id,
        validCount: result.validProperties.length,
        errorCount: result.errors ? result.errors.length : 0,
        errors: result.errors,
        success: true,
      });
      this.log.info(`Done processing CSV validation job ${job.id} for client ${cid}`);
    } catch (error) {
      this.log.error(`Error processing CSV validation job ${job.id}:`, error);
      done(error, null);
    }
  };

  processCsvImport = async (job: Job<CsvJobData>, done: DoneCallback) => {
    const { csvFilePath, cid, userId } = job.data;

    job.progress(10);
    this.log.info(`Processing CSV import job ${job.id} for client ${cid}`);

    try {
      const csvResult = await this.propertyCsvProcessor.validateCsv(csvFilePath, {
        cid,
        userId,
      });
      job.progress(50);

      if (!csvResult.validProperties.length) {
        // instead of returning, sending notification to user. 'CREATE NOTIFICATION SYSTEM' later
        this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
        done(null, {
          success: false,
          processId: job.id,
          data: null,
          finishedAt: new Date(),
          errors: csvResult.errors,
          message: 'No valid properties found in CSV',
        });
      }

      const properties: any[] = [];
      const session = await this.propertyDAO.startSession();
      const propertiesResult = await this.propertyDAO.withTransaction(session, async (session) => {
        const batchSize = 20;
        let batchCounter = 0;

        for (let i = 0; i < csvResult.validProperties.length; i += batchSize) {
          const batch = csvResult.validProperties.slice(i, i + batchSize);
          const batchProperties = await this.propertyDAO.insertMany(batch, session);
          properties.push(...batchProperties);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          batchCounter++;
        }

        return { properties };
      });

      const returnResult = {
        data: propertiesResult.properties,
        errors: null,
        message: csvResult.errors?.length
          ? 'Properties imported with some errors'
          : 'All properties imported successfully',
      } as CsvProcessReturnData & { message: string };

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
      job.progress(100);

      done(null, {
        success: true,
        processId: job.id,
        data: {
          totalInserted: returnResult.data.length,
          validRecord: csvResult.validProperties.length,
        },
        finishedAt: new Date(),
        message: returnResult.message,
        ...(returnResult.errors ? { errors: returnResult.errors } : null),
      });
    } catch (error) {
      this.log.error(`Error processing CSV import job ${job.id}:`, error);
      done(error, null);
    }
  };
}
