import { Job } from 'bull';
import Logger from 'bunyan';
import { MailService } from '@mailer/index';
import { createLogger } from '@utils/index';
import { MailType, IEmailOptions } from '@interfaces/utils.interface';

export class EmailWorker {
  mailer: MailService;
  log: Logger;

  constructor({ mailerService }: { mailerService: MailService }) {
    this.log = createLogger('emailWorker');
    this.mailer = mailerService;
  }

  sendMail = (job: Job): Promise<void> => {
    try {
      const data = job.data as IEmailOptions<any>;
      Promise.resolve(this.mailer.sendMail(data, data.emailType as MailType));
      job.progress(100);
      this.log.info(`Email job with ID<${job.id}> was successful.`);
      return Promise.resolve({
        ...job.data,
        sentAt: new Date().toISOString(),
      });
    } catch (error) {
      this.log.error(`Failed to send email for job ${job.id}`);
      return Promise.reject(new Error((error as Error).message));
    }
  };
}
