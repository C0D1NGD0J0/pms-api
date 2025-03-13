import { EmailWorker } from '@workers/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/constants';
import { IEmailOptions } from '@interfaces/utils.interface';

import { BaseQueue } from './base.queue';

interface IConstructor {
  emailWorker: EmailWorker;
}

export class EmailQueue extends BaseQueue {
  private readonly emailWorker: EmailWorker;

  constructor({ emailWorker }: IConstructor) {
    super(QUEUE_NAMES.ACCOUNT_ACTIVATION_QUEUE);
    this.emailWorker = emailWorker;
    this.processQueueJobs(JOB_NAME.ACCOUNT_ACTIVATION_JOB, 15, this.emailWorker.sendMail);
  }

  addToEmailQueue(queuename: string, data: IEmailOptions<unknown>): void {
    this.addJobToQueue(queuename, data);
  }
}
