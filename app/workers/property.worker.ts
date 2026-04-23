import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { PropertyCsvProcessor } from '@services/csv';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { SubscriptionDAO, PropertyDAO, ClientDAO } from '@dao/index';
import { CsvProcessReturnData, CsvJobData } from '@interfaces/index';
import { subscriptionPlanConfig } from '@services/subscription/subscription_plans.config';

interface IConstructor {
  propertyCsvProcessor: PropertyCsvProcessor;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  propertyDAO: PropertyDAO;
  clientDAO: ClientDAO;
}

export class PropertyWorker {
  log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly emitterService: EventEmitterService;
  private readonly propertyCsvProcessor: PropertyCsvProcessor;

  constructor({
    propertyDAO,
    clientDAO,
    subscriptionDAO,
    emitterService,
    propertyCsvProcessor,
  }: IConstructor) {
    this.clientDAO = clientDAO;
    this.propertyDAO = propertyDAO;
    this.subscriptionDAO = subscriptionDAO;
    this.emitterService = emitterService;
    this.log = createLogger('PropertyWorker');
    this.propertyCsvProcessor = propertyCsvProcessor;
  }

  processCsvValidation = async (job: Job<CsvJobData>) => {
    job.progress(10);
    const {
      csvFilePath,
      clientInfo: { cuid },
      userId,
    } = job.data;
    this.log.info(`Processing CSV validation job ${job.id} for client ${cuid}`);

    try {
      job.progress(30);
      const result = await this.propertyCsvProcessor.validateCsv(csvFilePath, {
        cuid,
        userId,
      });
      job.progress(100);
      this.log.info(`Done processing CSV validation job ${job.id} for client ${cuid}`);

      return {
        processId: job.id,
        validCount: result.validProperties.length,
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
    const {
      csvFilePath,
      clientInfo: { cuid },
      userId,
    } = job.data;

    job.progress(10);
    this.log.info(`Processing CSV import job ${job.id} for client ${cuid}`);

    try {
      const csvResult = await this.propertyCsvProcessor.validateCsv(csvFilePath, {
        cuid,
        userId,
      });
      job.progress(50);

      if (!csvResult.validProperties.length) {
        this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
        return {
          success: false,
          processId: job.id,
          data: null,
          finishedAt: new Date(),
          errors: csvResult.errors,
          message: 'No valid properties found in CSV',
        };
      }

      // Enforce subscription property limit before batch insert
      const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
      if (subscription) {
        const config = subscriptionPlanConfig.getConfig(subscription.planName);
        const maxProperties = config.limits.maxProperties;
        if (maxProperties !== -1) {
          const currentCount = await this.propertyDAO.countDocuments({ cuid, deletedAt: null });
          const remaining = maxProperties - currentCount;
          if (remaining <= 0) {
            this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
            return {
              success: false,
              processId: job.id,
              data: null,
              finishedAt: new Date(),
              errors: null,
              message: `Property limit reached (${maxProperties}). Upgrade your plan to add more properties.`,
            };
          }
          if (csvResult.validProperties.length > remaining) {
            this.log.warn(
              { cuid, requested: csvResult.validProperties.length, remaining },
              'CSV import trimmed to subscription property limit'
            );
            csvResult.validProperties = csvResult.validProperties.slice(0, remaining);
          }
        }
      }

      let totalInserted = 0;
      const session = await this.propertyDAO.startSession();
      const propertiesResult = await this.propertyDAO.withTransaction(session, async (session) => {
        const batchSize = 50;

        for (let i = 0; i < csvResult.validProperties.length; i += batchSize) {
          const batch = csvResult.validProperties.slice(i, i + batchSize);
          const batchProperties = await this.propertyDAO.insertMany(batch, session);
          totalInserted += batchProperties.length;
          const progress = 50 + Math.floor((i / csvResult.validProperties.length) * 40);
          job.progress(progress);
          if (global.gc) {
            global.gc();
          }
        }

        return { totalInserted };
      });

      const returnResult = {
        data: [],
        errors: null,
        message: csvResult.errors?.length
          ? 'Properties imported with some errors'
          : 'All properties imported successfully',
      } as CsvProcessReturnData & { message: string };

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
      job.progress(100);

      return {
        success: true,
        processId: job.id,
        data: {
          totalInserted: propertiesResult.totalInserted,
          validRecord: csvResult.validProperties.length,
        },
        finishedAt: new Date(),
        message: returnResult.message,
        ...(returnResult.errors ? { errors: returnResult.errors } : null),
      };
    } catch (error) {
      this.log.error(`Error processing CSV import job ${job.id}:`, error);
      throw error;
    }
  };
}
