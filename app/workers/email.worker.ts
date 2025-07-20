import Logger from 'bunyan';
import { DoneCallback, Job } from 'bull';
import { MailService } from '@mailer/index';
import { createLogger } from '@utils/index';
import { EventEmitterService } from '@services/eventEmitter';
import { IEmailOptions, MailType } from '@interfaces/utils.interface';
import { EmailFailedPayload, EmailSentPayload, EventTypes } from '@interfaces/events.interface';

export class EmailWorker {
  mailer: MailService;
  log: Logger;
  emitterService: EventEmitterService;

  constructor({
    mailerService,
    emitterService,
  }: {
    mailerService: MailService;
    emitterService: EventEmitterService;
  }) {
    this.log = createLogger('emailWorker');
    this.mailer = mailerService;
    this.emitterService = emitterService;
  }

  sendMail = async (job: Job, done: DoneCallback) => {
    try {
      const data = job.data as IEmailOptions<any>;

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
}
