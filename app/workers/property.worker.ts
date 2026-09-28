import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { PropertyCsvProcessor } from '@services/csv';
import { SSEService } from '@services/sse/sse.service';
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
  sseService: SSEService;
  clientDAO: ClientDAO;
}

export class PropertyWorker {
  log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly emitterService: EventEmitterService;
  private readonly propertyCsvProcessor: PropertyCsvProcessor;
  private readonly sseService: SSEService;

  constructor({
    propertyDAO,
    clientDAO,
    subscriptionDAO,
    emitterService,
    propertyCsvProcessor,
    sseService,
  }: IConstructor) {
    this.clientDAO = clientDAO;
    this.propertyDAO = propertyDAO;
    this.subscriptionDAO = subscriptionDAO;
    this.emitterService = emitterService;
    this.log = createLogger('PropertyWorker');
    this.propertyCsvProcessor = propertyCsvProcessor;
    this.sseService = sseService;
  }

  processCsvValidation = async (job: Job<CsvJobData>) => {
    job.progress(10);
    const {
      csvFilePath,
      clientInfo: { cuid },
      userId,
      columnMapping,
    } = job.data;
    this.log.info(`Processing CSV validation job ${job.id} for client ${cuid}`);

    try {
      job.progress(30);
      const result = await this.propertyCsvProcessor.validateCsv(csvFilePath, {
        cuid,
        userId,
        columnMapping,
      });
      job.progress(100);
      this.log.info(`Done processing CSV validation job ${job.id} for client ${cuid}`);

      const errorCount = result.errors ? result.errors.length : 0;
      await this.sseService.sendToUser(
        userId,
        cuid,
        {
          jobId: job.id.toString(),
          jobType: 'csv_property_validation',
          stage: result.validProperties.length === 0 ? 'failed' : 'completed',
          progress: 100,
          totalItems: result.totalRows,
          validCount: result.validProperties.length,
          errorCount,
          errors: result.errors,
          message:
            result.validProperties.length === 0
              ? 'No valid properties found in CSV file provided.'
              : `Validated ${result.validProperties.length} propert${result.validProperties.length === 1 ? 'y' : 'ies'} successfully${errorCount > 0 ? `, ${errorCount} errors found` : ''}`,
        },
        'job-notification'
      );

      return {
        processId: job.id,
        validCount: result.validProperties.length,
        errorCount,
        errors: result.errors,
        success: true,
      };
    } catch (error) {
      this.log.error(`Error processing CSV validation job ${job.id}:`, error);
      await this.sseService.sendToUser(
        userId,
        cuid,
        {
          jobId: job.id.toString(),
          jobType: 'csv_property_validation',
          stage: 'failed',
          progress: 0,
          message: 'CSV file validation encountered a fatal error',
          error: error instanceof Error ? error.message : String(error),
        },
        'job-notification'
      );
      throw error;
    }
  };

  processCsvImport = async (job: Job<CsvJobData>) => {
    const {
      csvFilePath,
      clientInfo: { cuid },
      userId,
      columnMapping,
    } = job.data;

    job.progress(10);
    this.log.info(`Processing CSV import job ${job.id} for client ${cuid}`);

    try {
      const csvResult = await this.propertyCsvProcessor.validateCsv(csvFilePath, {
        cuid,
        userId,
        columnMapping,
      });
      job.progress(50);

      if (!csvResult.validProperties.length) {
        this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
        await this.sseService.sendToUser(
          userId,
          cuid,
          {
            jobId: job.id.toString(),
            jobType: 'csv_property_import',
            stage: 'failed',
            progress: 0,
            message: 'No valid properties found in CSV file provided.',
            errors: csvResult.errors,
            totalRows: csvResult.totalRows,
          },
          'job-notification'
        );
        return {
          success: false,
          processId: job.id,
          data: null,
          finishedAt: new Date(),
          errors: csvResult.errors,
          message: 'No valid properties found in CSV',
        };
      }

      // Row errors accumulated after validation (e.g. rows skipped for quota),
      // reported alongside csvResult.errors rather than dropped silently.
      const postValidationErrors: NonNullable<CsvProcessReturnData['errors']> = [];

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
            const message = `Property limit reached (${maxProperties}). Upgrade your plan to add more properties.`;
            await this.sseService.sendToUser(
              userId,
              cuid,
              {
                jobId: job.id.toString(),
                jobType: 'csv_property_import',
                stage: 'failed',
                progress: 0,
                message,
              },
              'job-notification'
            );
            return {
              success: false,
              processId: job.id,
              data: null,
              finishedAt: new Date(),
              errors: null,
              message,
            };
          }
          if (csvResult.validProperties.length > remaining) {
            const trimmed = csvResult.validProperties.slice(remaining);
            this.log.warn(
              { cuid, requested: csvResult.validProperties.length, remaining },
              'CSV import trimmed to subscription property limit'
            );
            trimmed.forEach((property) => {
              postValidationErrors.push({
                rowNumber: 0,
                errors: [
                  {
                    field: 'quota',
                    error: `Skipped "${property.name || property.address?.fullAddress || 'property'}" — plan limit of ${maxProperties} properties reached.`,
                  },
                ],
              });
            });
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

      const combinedErrors: CsvProcessReturnData['errors'] = [
        ...(csvResult.errors || []),
        ...postValidationErrors,
      ];

      const returnResult = {
        data: [],
        errors: combinedErrors.length ? combinedErrors : null,
        message: combinedErrors.length
          ? 'Properties imported with some errors'
          : 'All properties imported successfully',
      } as CsvProcessReturnData & { message: string };

      // Sync subscription.resourceTracker.propertyCount so the atomic gate in addProperty() stays accurate
      if (propertiesResult.totalInserted > 0 && subscription) {
        await this.subscriptionDAO.updateResourceCount(
          'property',
          subscription.client,
          propertiesResult.totalInserted
        );
      }

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
      job.progress(100);

      await this.sseService.sendToUser(
        userId,
        cuid,
        {
          jobId: job.id.toString(),
          jobType: 'csv_property_import',
          stage: 'completed',
          progress: 100,
          totalItems: csvResult.totalRows,
          createdCount: propertiesResult.totalInserted,
          errorCount: combinedErrors.length,
          errors: returnResult.errors,
          message: returnResult.message,
        },
        'job-notification'
      );

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
      await this.sseService.sendToUser(
        userId,
        cuid,
        {
          jobId: job.id.toString(),
          jobType: 'csv_property_import',
          stage: 'failed',
          progress: 0,
          message: 'CSV file processing encountered a fatal error',
          error: error instanceof Error ? error.message : String(error),
        },
        'job-notification'
      );
      throw error;
    }
  };
}
