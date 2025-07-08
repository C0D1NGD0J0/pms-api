import Logger from 'bunyan';
import { DoneCallback, Job } from 'bull';
import { createLogger } from '@utils/index';
import { CsvJobData } from '@interfaces/index';
import { InvitationService } from '@services/index';
import { InvitationCsvProcessor } from '@services/csv';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';

interface IConstructor {
  invitationCsvProcessor: InvitationCsvProcessor;
  invitationService: InvitationService;
  emitterService: EventEmitterService;
}

export class InvitationWorker {
  log: Logger;
  private readonly invitationService: InvitationService;
  private readonly emitterService: EventEmitterService;
  private readonly invitationCsvProcessor: InvitationCsvProcessor;

  constructor({ invitationService, emitterService, invitationCsvProcessor }: IConstructor) {
    this.invitationService = invitationService;
    this.emitterService = emitterService;
    this.invitationCsvProcessor = invitationCsvProcessor;
    this.log = createLogger('InvitationWorker');
  }

  processCsvValidation = async (job: Job<CsvJobData>, done: DoneCallback) => {
    job.progress(10);
    const { csvFilePath, cid, userId } = job.data;
    this.log.info(`Processing invitation CSV validation job ${job.id} for client ${cid}`);

    try {
      job.progress(30);
      const result = await this.invitationCsvProcessor.validateCsv(csvFilePath, {
        cid,
        userId,
      });
      job.progress(100);

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);

      done(null, {
        processId: job.id,
        validCount: result.validInvitations.length,
        errorCount: result.errors ? result.errors.length : 0,
        errors: result.errors,
        success: true,
        totalRows: result.totalRows,
        finishedAt: result.finishedAt,
      });
      this.log.info(`Done processing invitation CSV validation job ${job.id} for client ${cid}`);
    } catch (error) {
      this.log.error(`Error processing invitation CSV validation job ${job.id}:`, error);
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
      done(error, null);
    }
  };

  processCsvImport = async (job: Job<CsvJobData>, done: DoneCallback) => {
    const { csvFilePath, cid, userId } = job.data;

    job.progress(10);
    this.log.info(`Processing invitation CSV import job ${job.id} for client ${cid}`);

    try {
      const csvResult = await this.invitationCsvProcessor.validateCsv(csvFilePath, {
        cid,
        userId,
      });
      job.progress(30);

      if (!csvResult.validInvitations.length) {
        this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
        done(null, {
          success: false,
          processId: job.id,
          data: null,
          finishedAt: new Date(),
          errors: csvResult.errors,
          message: 'No valid invitations found in CSV',
        });
        return;
      }

      const results = [];
      let processed = 0;

      for (const invitationData of csvResult.validInvitations) {
        try {
          const result = await this.invitationService.sendInvitation(userId, cid, invitationData);
          results.push({
            email: invitationData.inviteeEmail,
            success: true,
            invitationId: result.data.invitation.iuid,
          });
        } catch (error) {
          this.log.error(`Error sending invitation to ${invitationData.inviteeEmail}:`, error);
          results.push({
            email: invitationData.inviteeEmail,
            success: false,
            error: error.message,
          });
        }

        processed++;
        const progress = 30 + Math.floor((processed / csvResult.validInvitations.length) * 60);
        job.progress(progress);
      }

      job.progress(100);

      const successCount = results.filter((r) => r.success).length;
      const failedCount = results.filter((r) => !r.success).length;

      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);

      done(null, {
        success: true,
        processId: job.id,
        data: {
          totalProcessed: results.length,
          successCount,
          failedCount,
          results,
        },
        finishedAt: new Date(),
        message: `Processed ${successCount} invitations successfully, ${failedCount} failed`,
      });

      this.log.info(
        `Done processing invitation CSV import job ${job.id} for client ${cid}. Success: ${successCount}, Failed: ${failedCount}`
      );
    } catch (error) {
      this.log.error(`Error processing invitation CSV import job ${job.id}:`, error);
      this.emitterService.emit(EventTypes.DELETE_LOCAL_ASSET, [csvFilePath]);
      done(error, null);
    }
  };
}
