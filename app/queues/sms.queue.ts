import { QUEUE_NAMES } from '@utils/index';
import { SmsWorker } from '@workers/sms.worker';
import { SMSMessageType } from '@interfaces/sms.interface';

import { BaseQueue } from './base.queue';

export interface ISmsJobData {
  messageType?: SMSMessageType;
  requestId?: string;
  passId?: string;
  body: string;
  cuid: string;
  to: string;
}

export class SmsQueue extends BaseQueue {
  constructor({ smsWorker }: { smsWorker: SmsWorker }) {
    super({ queueName: QUEUE_NAMES.SMS_QUEUE });
    // Every SMS job is sent the same way; the job name only labels the message kind.
    this.processAllQueueJobs(2, smsWorker.sendSms);
  }

  addToSmsQueue(jobName: string, data: ISmsJobData): void {
    this.addJobToQueue(jobName, data);
  }
}
