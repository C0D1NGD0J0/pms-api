import { EmailWorker } from '@workers/index';
import { QUEUE_NAMES } from '@utils/constants';
import { IEmailOptions } from '@interfaces/utils.interface';

import { BaseQueue } from './base.queue';

interface IConstructor {
  emailWorker: EmailWorker;
}

export class EmailQueue extends BaseQueue {
  private readonly emailWorker: EmailWorker;

  constructor({ emailWorker }: IConstructor) {
    super({ queueName: QUEUE_NAMES.EMAIL_QUEUE });
    this.emailWorker = emailWorker;
    // Single wildcard processor handles all email job types (accountActivationJob,
    // invitationJob, leaseEndingSoonJob, etc.). Jobs are still added with specific
    // names for tracking. Using one processor avoids BRPOPLPUSH contention that
    // occurs when multiple named processors share one blocking Redis connection.
    this.processQueueJobs('*', 3, this.emailWorker.sendMail);
  }

  addToEmailQueue(queuename: string, data: IEmailOptions<unknown>): void {
    this.addJobToQueue(queuename, data);
  }
}
