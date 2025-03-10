import { EmailWorker } from '@workers/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/constants';
import { IEmailOptions } from '@interfaces/utils.interface';

import { BaseQueue } from './base.queue';
import { BullBoardService } from './bullboard';

interface IConstructor {
  bullBoardService: BullBoardService;
  emailWorker: EmailWorker;
}

export class EmailQueue extends BaseQueue {
  private readonly emailWorker: EmailWorker;

  constructor({ emailWorker, bullBoardService }: IConstructor) {
    super(QUEUE_NAMES.EMAIL_QUEUE, { bullBoardService });
    this.emailWorker = emailWorker;
    this.processQueueJobs(JOB_NAME.ACCOUNT_ACTIVATION_JOB, 15, this.emailWorker.sendMail);
  }

  addToEmailQueue(qname: string, data: IEmailOptions<unknown>): void {
    this.addJobToQueue(qname, data);
  }
}
