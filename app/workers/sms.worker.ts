import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { GuestPassDAO } from '@dao/guestpassDAO';
import { SMSMessageType } from '@interfaces/sms.interface';
import { SMSService } from '@services/smsService/sms.service';
import { DeliveryStatusEnum } from '@interfaces/guestPass.interface';

export class SmsWorker {
  private readonly log: Logger;
  private readonly smsService: SMSService;
  private readonly guestPassDAO: GuestPassDAO;

  constructor({
    smsService,
    guestPassDAO,
  }: {
    smsService: SMSService;
    guestPassDAO: GuestPassDAO;
  }) {
    this.smsService = smsService;
    this.guestPassDAO = guestPassDAO;
    this.log = createLogger('SmsWorker');
  }

  sendSms = async (job: Job) => {
    const { to, body, cuid, passId } = job.data;

    this.log.info(
      { jobId: job.id, jobName: job.name, to, cuid },
      `Processing SMS job ${job.id} (${job.name})`
    );

    try {
      const result = await this.smsService.sendSMS({
        to,
        body,
        cuid,
        messageType: job.data.messageType || SMSMessageType.GUEST_PASS,
      });

      if (!result.success) {
        this.log.warn({ jobId: job.id, to, error: result.error }, 'SMS send returned unsuccessful');

        if (passId) {
          await this.guestPassDAO.update(
            { _id: passId },
            { $set: { 'deliveryStatus.sms': DeliveryStatusEnum.FAILED } }
          );
        }

        return { success: false, error: result.error };
      }

      job.progress(100);

      if (passId) {
        await this.guestPassDAO.update(
          { _id: passId },
          { $set: { 'deliveryStatus.sms': DeliveryStatusEnum.SENT } }
        );
      }

      this.log.info(
        { jobId: job.id, to, twilioSid: result.twilioSid },
        'SMS delivered successfully'
      );

      return { success: true, sentAt: new Date().toISOString() };
    } catch (err) {
      this.log.error({ err, jobId: job.id, to, cuid }, 'SMS delivery failed');

      if (passId) {
        await this.guestPassDAO.update(
          { _id: passId },
          { $set: { 'deliveryStatus.sms': DeliveryStatusEnum.FAILED } }
        );
      }

      throw err;
    }
  };
}
