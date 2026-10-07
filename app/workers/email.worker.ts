import { Job } from 'bull';
import Logger from 'bunyan';
import { UserDAO } from '@dao/index';
import { MailService } from '@mailer/index';
import { createLogger } from '@utils/index';
import { ProfileService } from '@services/index';
import { EventEmitterService } from '@services/eventEmitter';
import { IEmailOptions, MailType } from '@interfaces/utils.interface';
import { getMailPolicy, shouldDeliver } from '@services/notification/notificationPolicy';
import { EmailFailedPayload, EmailSentPayload, EventTypes } from '@interfaces/events.interface';

export class EmailWorker {
  mailer: MailService;
  log: Logger;
  emitterService: EventEmitterService;
  profileService: ProfileService;
  userDAO: UserDAO;

  constructor({
    mailerService,
    emitterService,
    profileService,
    userDAO,
  }: {
    mailerService: MailService;
    emitterService: EventEmitterService;
    profileService: ProfileService;
    userDAO: UserDAO;
  }) {
    this.log = createLogger('emailWorker');
    this.mailer = mailerService;
    this.emitterService = emitterService;
    this.profileService = profileService;
    this.userDAO = userDAO;
  }

  sendMail = async (job: Job) => {
    const data = job.data as IEmailOptions<any>;
    const log = data.requestId ? this.log.child({ requestId: data.requestId }) : this.log;

    log.info({ jobId: job.id, jobName: job.name }, `Processing email job ${job.id} (${job.name})`);

    try {
      const shouldSend = await this.checkEmailPreferences(data, log);

      if (!shouldSend) {
        log.info('Email skipped due to user preferences', {
          to: data.to,
          emailType: data.emailType,
          cuid: data.client?.cuid,
        });

        return {
          success: true,
          skipped: true,
          reason: 'User email preferences',
          skippedAt: new Date().toISOString(),
        };
      }

      await this.mailer.sendMail(data, data.emailType as MailType);
      job.progress(100);

      const payload: EmailSentPayload = {
        emailType: data.emailType as MailType,
        sentAt: new Date(),
        jobData: data,
      };

      this.emitterService.emit(EventTypes.EMAIL_SENT, payload);
      log.info(`Email sent successfully to ${data.to}`);

      return {
        success: true,
        sentAt: new Date().toISOString(),
      };
    } catch (error) {
      log.error(`Failed to send email for job ${job.id}:`, error);

      try {
        const payload: EmailFailedPayload = {
          to: data.to,
          subject: data.subject || '',
          emailType: data.emailType as MailType,
          error: {
            message: (error as Error).message || 'Unknown error',
            code: (error as any).code,
          },
          jobData: data,
        };
        this.emitterService.emit(EventTypes.EMAIL_FAILED, payload);
      } catch (emitError) {
        log.error(`Failed to emit EMAIL_FAILED event for job ${job.id}:`, emitError);
      }

      throw error;
    }
  };

  /**
   * Whether the recipient's preferences allow this email. Required emails (account,
   * security, money owed, legal notices — see notificationPolicy) always send, as do
   * emails to people who aren't users (e.g. a visitor's guest pass).
   */
  private async checkEmailPreferences(
    emailData: IEmailOptions<any>,
    log: Logger
  ): Promise<boolean> {
    const policy = getMailPolicy(emailData.emailType);
    if (policy.required || typeof emailData.to !== 'string') return true;

    try {
      const recipient = await this.userDAO.getActiveUserByEmail(emailData.to.toLowerCase());
      if (!recipient) return true;

      const prefs = await this.profileService.getUserNotificationPreferences(
        recipient._id.toString(),
        emailData.client?.cuid ?? ''
      );
      return shouldDeliver({
        prefs: prefs.success ? prefs.data : null,
        channel: 'email',
        category: policy.category,
      });
    } catch (error) {
      log.error('Error checking email preferences, allowing by default', {
        error: error instanceof Error ? error.message : 'Unknown error',
        emailType: emailData.emailType,
        to: emailData.to,
      });
      return true;
    }
  }
}
