import { EmailWorker } from '@workers/index';
import { envVariables } from '@shared/config';
import { QUEUE_NAMES } from '@utils/constants';
import { IEmailOptions } from '@interfaces/utils.interface';

import { BaseQueue } from './base.queue';

interface IConstructor {
  emailWorker: EmailWorker;
}

export class EmailQueue extends BaseQueue {
  private readonly emailWorker: EmailWorker;

  constructor({ emailWorker }: IConstructor) {
    // Send at the provider's pace instead of bursting and burning retries on rate-limit errors
    super({
      queueName: QUEUE_NAMES.EMAIL_QUEUE,
      limiter: { max: envVariables.EMAIL.MAX_PER_SECOND, duration: 1000 },
    });
    this.emailWorker = emailWorker;
    // Single wildcard processor handles all email job types (accountActivationJob,
    // invitationJob, leaseEndingSoonJob, etc.). Jobs are still added with specific
    // names for tracking. Using one processor avoids BRPOPLPUSH contention that
    // occurs when multiple named processors share one blocking Redis connection.
    this.processQueueJobs('*', 3, this.emailWorker.sendMail);
  }

  /** Resolves once the email job is in the queue; callers that must know it was queued await it. */
  async addToEmailQueue(queuename: string, data: IEmailOptions<unknown>): Promise<void> {
    await this.addJobToQueue(queuename, data);
  }
}
