import Logger from 'bunyan';
import { t } from '@shared/languages';
import { DoneCallback, Job } from 'bull';
import { EmailQueue } from '@queues/index';
import { envVariables } from '@shared/config';
import { CsvJobData } from '@interfaces/index';
import { InvitationCsvProcessor } from '@services/csv';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { InvitationDAO, ClientDAO, UserDAO } from '@dao/index';
import { createLogger, MAIL_TYPES, JOB_NAME } from '@utils/index';
import { IInvitationData } from '@interfaces/invitation.interface';

interface IConstructor {
  invitationCsvProcessor: InvitationCsvProcessor;
  emitterService: EventEmitterService;
  invitationDAO: InvitationDAO;
  emailQueue: EmailQueue;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class InvitationWorker {
  log: Logger;
  private readonly emitterService: EventEmitterService;
  private readonly invitationCsvProcessor: InvitationCsvProcessor;
  private readonly invitationDAO: InvitationDAO;
  private readonly userDAO: UserDAO;
  private readonly clientDAO: ClientDAO;
  private readonly emailQueue: EmailQueue;

  constructor({
    emitterService,
    invitationCsvProcessor,
    invitationDAO,
    userDAO,
    clientDAO,
    emailQueue,
  }: IConstructor) {
    this.emitterService = emitterService;
    this.invitationCsvProcessor = invitationCsvProcessor;
    this.invitationDAO = invitationDAO;
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.emailQueue = emailQueue;
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
          const result = await this.sendSingleInvitation(userId, cid, invitationData);
          results.push({
            email: invitationData.inviteeEmail,
            success: true,
            invitationId: result.iuid,
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

  /**
   * Send a single invitation (extracted from InvitationService to avoid cyclic dependency)
   */
  private async sendSingleInvitation(
    inviterUserId: string,
    clientId: string,
    invitationData: IInvitationData
  ) {
    // Check for existing pending invitation
    const existingInvitation = await this.invitationDAO.findPendingInvitation(
      invitationData.inviteeEmail,
      clientId
    );

    if (existingInvitation) {
      throw new Error('A pending invitation already exists for this email');
    }

    // Check if user already has access
    const existingUser = await this.userDAO.getUserWithClientAccess(
      invitationData.inviteeEmail,
      clientId
    );

    if (existingUser) {
      throw new Error('User already has access to this client');
    }

    // Get client info
    const client = await this.clientDAO.getClientByCid(clientId);
    if (!client) {
      throw new Error('Client not found');
    }

    // Create invitation
    const invitation = await this.invitationDAO.createInvitation(
      invitationData,
      inviterUserId,
      clientId
    );

    // Get inviter info
    const inviter = await this.userDAO.getUserById(inviterUserId, {
      populate: 'profile',
    });

    // Prepare email data
    const emailData = {
      to: invitationData.inviteeEmail,
      subject: t('email.invitation.subject', {
        companyName: client.displayName || client.companyProfile?.legalEntityName || 'Company',
      }),
      emailType: MAIL_TYPES.ACCOUNT_ACTIVATION,
      data: {
        inviteeName: `${invitationData.personalInfo.firstName} ${invitationData.personalInfo.lastName}`,
        inviterName: inviter?.profile?.fullname || inviter?.email || 'Team Member',
        companyName: client.displayName || client.companyProfile?.legalEntityName || 'Company',
        role: invitationData.role,
        invitationUrl: `${envVariables.FRONTEND.URL}/${clientId}/invitation?token=${invitation.invitationToken}`,
        expiresAt: invitation.expiresAt,
        customMessage: invitationData.metadata?.inviteMessage,
      },
    };

    // Queue email
    this.emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, emailData);

    return invitation;
  }
}
