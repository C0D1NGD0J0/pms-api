import { QUEUE_NAMES } from '@utils/index';
import { SMSMessageType } from '@interfaces/sms.interface';

import { BaseQueue } from './base.queue';

export interface ISmsJobData {
  messageType?: SMSMessageType;
  passId?: string;
  body: string;
  cuid: string;
  to: string;
}

export class SmsQueue extends BaseQueue {
  constructor() {
    super({ queueName: QUEUE_NAMES.SMS_QUEUE });
  }

  addToSmsQueue(jobName: string, data: ISmsJobData): void {
    this.addJobToQueue(jobName, data);
  }
}
