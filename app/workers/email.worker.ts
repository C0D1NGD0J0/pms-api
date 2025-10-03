import Logger from 'bunyan';
import { DoneCallback, Job } from 'bull';
import { MailService } from '@mailer/index';
import { createLogger } from '@utils/index';
import { ProfileService } from '@services/index';
import { EventEmitterService } from '@services/eventEmitter';
import { IEmailOptions, MailType } from '@interfaces/utils.interface';
import { EmailFailedPayload, EmailSentPayload, EventTypes } from '@interfaces/events.interface';

export class EmailWorker {
  mailer: MailService;
  log: Logger;
  emitterService: EventEmitterService;
  profileService: ProfileService;

  constructor({
    mailerService,
    emitterService,
    profileService,
  }: {
    mailerService: MailService;
    emitterService: EventEmitterService;
    profileService: ProfileService;
  }) {
    this.log = createLogger('emailWorker');
    this.mailer = mailerService;
    this.emitterService = emitterService;
    this.profileService = profileService;
  }

  sendMail = async (job: Job, done: DoneCallback) => {
    try {
      const data = job.data as IEmailOptions<any>;

      // Check user email preferences for non-critical emails
      const shouldSend = await this.checkEmailPreferences(data);

      if (!shouldSend) {
        this.log.info('Email skipped due to user preferences', {
          to: data.to,
          emailType: data.emailType,
          cuid: data.client?.cuid,
        });

        // Mark job as completed but skipped
        done(null, {
          success: true,
          skipped: true,
          reason: 'User email preferences',
          skippedAt: new Date().toISOString(),
        });
        return;
      }

      await this.mailer.sendMail(data, data.emailType as MailType);
      job.progress(100);

      const payload: EmailSentPayload = {
        emailType: data.emailType as MailType,
        sentAt: new Date(),
        jobData: data,
      };

      this.emitterService.emit(EventTypes.EMAIL_SENT, payload);
      this.log.info(`Emitted EMAIL_SENT event for email to ${data.to}`);
      done(null, {
        success: true,
        sentAt: new Date().toISOString(),
      });
    } catch (error) {
      this.log.error(`Failed to send email for job ${job.id}:`, error);

      const data = job.data as IEmailOptions<any>;
      const payload: EmailFailedPayload = {
        to: data.to,
        subject: data.subject || '',
        emailType: data.emailType as MailType,
        error: {
          message: (error as Error).message || 'Unknown error',
          code: (error as any).code,
        },
        jobData: data, // Contains all original job data (invitationId, userId, etc.)
      };
      this.emitterService.emit(EventTypes.EMAIL_FAILED, payload);
      done(error);
    }
  };

  /**
   * Check if user preferences allow sending this email
   * Critical system emails (invitations, password reset, etc.) are always sent
   */
  private async checkEmailPreferences(emailData: IEmailOptions<any>): Promise<boolean> {
    try {
      const criticalEmailTypes = [
        'INVITATION',
        'ACCOUNT_ACTIVATION',
        'FORGOT_PASSWORD',
        'PASSWORD_RESET',
      ];

      if (criticalEmailTypes.includes(emailData.emailType)) {
        this.log.debug('Allowing critical system email', {
          emailType: emailData.emailType,
          to: emailData.to,
        });
        return true;
      }

      if (!emailData.client?.cuid) {
        this.log.warn('No client context for email preference check, allowing by default', {
          emailType: emailData.emailType,
          to: emailData.to,
        });
        return true;
      }

      this.log.debug(
        'Email preference check not fully implemented for this email type, allowing by default',
        {
          emailType: emailData.emailType,
          to: emailData.to,
          cuid: emailData.client.cuid,
        }
      );

      return true;
    } catch (error) {
      this.log.error('Error checking email preferences, allowing by default', {
        error: error instanceof Error ? error.message : 'Unknown error',
        emailType: emailData.emailType,
        to: emailData.to,
      });
      return true;
    }
  }
}
