import { Job } from 'bull';
import Logger from 'bunyan';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { SSEService } from '@services/index';
import { CsvJobData } from '@interfaces/index';
import { IInvalidCsvProperty } from '@interfaces/csv.interface';
import { ROLE_GROUPS } from '@shared/constants/roles.constants';
import { InvitationCsvProcessor, IInvitationCsvData } from '@services/csv';
import { InvitationService } from '@services/invitation/invitation.service';
import { SubscriptionService } from '@services/subscription/subscription.service';

interface IConstructor {
  invitationCsvProcessor: InvitationCsvProcessor;
  subscriptionService: SubscriptionService;
  invitationService: InvitationService;
  sseService: SSEService;
}

export class InvitationWorker {
  log: Logger;
  private readonly sseService: SSEService;
  private readonly invitationCsvProcessor: InvitationCsvProcessor;
  private readonly invitationService: InvitationService;
  private readonly subscriptionService: SubscriptionService;

  constructor({
    sseService,
    invitationCsvProcessor,
    invitationService,
    subscriptionService,
  }: IConstructor) {
    this.sseService = sseService;
    this.invitationCsvProcessor = invitationCsvProcessor;
    this.invitationService = invitationService;
    this.subscriptionService = subscriptionService;
    this.log = createLogger('InvitationWorker');
  }

  processCsvValidation = async (job: Job<CsvJobData>) => {
    job.progress(10);
    const { csvFilePath, clientInfo, userId, columnMapping } = job.data;
    const jobId = job.id.toString();
    this.log.info(
      `Processing invitation CSV validation job ${job.id} for client ${clientInfo.cuid}`
    );

    try {
      job.progress(30);
      const result = await this.invitationCsvProcessor.validateCsv(csvFilePath, {
        userId,
        cuid: clientInfo.cuid,
        columnMapping,
      });
      job.progress(100);

      const validCount = result.validInvitations.length;
      const errors = result.errors ?? [];
      await this.notifyJob(userId, clientInfo.cuid, {
        jobId,
        jobType: 'csv_invitation_validation',
        stage: validCount === 0 ? 'failed' : 'completed',
        progress: 100,
        totalRows: result.totalRows,
        validCount,
        errorCount: errors.length,
        errors,
        message:
          validCount === 0
            ? t('invitation.csv.noValidRows')
            : t('invitation.csv.validationCompleted', {
                valid: validCount,
                total: result.totalRows,
              }),
      });

      return {
        processId: job.id,
        success: true,
        validCount,
        errorCount: errors.length,
        errors,
        totalRows: result.totalRows,
        finishedAt: result.finishedAt,
      };
    } catch (error) {
      this.log.error(`Error processing invitation CSV validation job ${job.id}:`, error);
      // Header problems (e.g. missing required columns) land here — tell the user.
      await this.notifyJob(userId, clientInfo.cuid, {
        jobId,
        jobType: 'csv_invitation_validation',
        stage: 'failed',
        progress: 0,
        message: t('invitation.csv.validationFailed', { error: this.errorMessage(error) }),
        error: this.errorMessage(error),
      });
      throw error;
    }
  };

  processCsvImport = async (job: Job<CsvJobData>) => {
    const { csvFilePath, clientInfo, userId, columnMapping } = job.data;
    const jobId = job.id.toString();

    job.progress(10);
    this.log.info(`Processing invitation CSV import job ${job.id} for client ${clientInfo.cuid}`);

    try {
      const csvResult = await this.invitationCsvProcessor.validateCsv(csvFilePath, {
        userId,
        cuid: clientInfo.cuid,
        columnMapping,
      });
      job.progress(30);

      const rowErrors: IInvalidCsvProperty[] = [...(csvResult.errors ?? [])];

      if (!csvResult.validInvitations.length) {
        await this.notifyJob(userId, clientInfo.cuid, {
          jobId,
          jobType: 'csv_invitation_import',
          stage: 'failed',
          progress: 100,
          totalRows: csvResult.totalRows,
          createdCount: 0,
          errorCount: rowErrors.length,
          errors: rowErrors,
          message: t('invitation.csv.noValidRows'),
        });
        return { success: false, processId: job.id, createdCount: 0, errors: rowErrors };
      }

      let invitations: IInvitationCsvData[];
      try {
        invitations = await this.trimToAvailableSeats(
          clientInfo.cuid,
          csvResult.validInvitations,
          rowErrors
        );
      } catch (error) {
        this.log.error(
          { error, cuid: clientInfo.cuid },
          'Error checking seat availability in invitation CSV import — aborting job'
        );
        await this.notifyJob(userId, clientInfo.cuid, {
          jobId,
          jobType: 'csv_invitation_import',
          stage: 'failed',
          progress: 0,
          message: t('invitation.csv.seatCheckFailed'),
        });
        return { success: false, processId: job.id, createdCount: 0, errors: rowErrors };
      }

      let createdCount = 0;
      for (const [index, invitation] of invitations.entries()) {
        const { csvRowNumber, ...invitationData } = invitation;
        try {
          // Same rules and bookkeeping as a single invite (seat event, branded email, status)
          await this.invitationService.dispatchInvitation(userId, clientInfo.cuid, invitationData);
          createdCount++;
        } catch (error) {
          this.log.error(`Error inviting ${invitation.inviteeEmail} from CSV:`, error);
          rowErrors.push({
            rowNumber: csvRowNumber ?? 0,
            errors: [{ field: 'inviteeEmail', error: this.errorMessage(error) }],
          });
        }
        job.progress(30 + Math.floor(((index + 1) / invitations.length) * 70));
      }

      rowErrors.sort((a, b) => a.rowNumber - b.rowNumber);
      await this.notifyJob(userId, clientInfo.cuid, {
        jobId,
        jobType: 'csv_invitation_import',
        stage: createdCount === 0 ? 'failed' : 'completed',
        progress: 100,
        totalRows: csvResult.totalRows,
        createdCount,
        errorCount: rowErrors.length,
        errors: rowErrors,
        message: t('invitation.csv.importCompleted', { created: createdCount }),
      });

      this.log.info(
        `Done processing invitation CSV import job ${job.id} for client ${clientInfo.cuid}. Created: ${createdCount}, errors: ${rowErrors.length}`
      );
      return { success: true, processId: job.id, createdCount, errors: rowErrors };
    } catch (error) {
      this.log.error(`Error processing invitation CSV import job ${job.id}:`, error);
      await this.notifyJob(userId, clientInfo.cuid, {
        jobId,
        jobType: 'csv_invitation_import',
        stage: 'failed',
        progress: 0,
        message: t('invitation.csv.importFailed', { error: this.errorMessage(error) }),
        error: this.errorMessage(error),
      });
      throw error;
    }
  };

  /**
   * Drops employee rows beyond the plan's free seats, recording a row error for each.
   * Tenants and vendors don't use seats and always pass through.
   */
  private async trimToAvailableSeats(
    cuid: string,
    invitations: IInvitationCsvData[],
    rowErrors: IInvalidCsvProperty[]
  ): Promise<IInvitationCsvData[]> {
    const isEmployee = (inv: IInvitationCsvData) =>
      (ROLE_GROUPS.EMPLOYEE_ROLES as readonly string[]).includes(inv.role);
    const employeeCount = invitations.filter(isEmployee).length;
    if (employeeCount === 0) return invitations;

    const seatInfo = await this.subscriptionService.getAvailableSeats(cuid);
    if (seatInfo.availableSeats >= employeeCount) return invitations;

    let remainingSeats = Math.max(0, seatInfo.availableSeats);
    this.log.warn(
      { cuid, requested: employeeCount, allowed: remainingSeats },
      'Invitation CSV import trimmed to available seat count'
    );
    return invitations.filter((inv) => {
      if (!isEmployee(inv)) return true;
      if (remainingSeats > 0) {
        remainingSeats--;
        return true;
      }
      rowErrors.push({
        rowNumber: inv.csvRowNumber ?? 0,
        errors: [
          {
            field: 'role',
            error: t('invitation.errors.seatLimitReached', { total: seatInfo.totalAllowed }),
          },
        ],
      });
      return false;
    });
  }

  private async notifyJob(userId: string, cuid: string, payload: Record<string, unknown>) {
    await this.sseService.sendToUser(userId, cuid, payload, 'job-notification');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
