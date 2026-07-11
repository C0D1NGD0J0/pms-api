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
    const recipientHint = typeof to === 'string' ? `***${to.slice(-4)}` : undefined;

    this.log.info(
      { jobId: job.id, jobName: job.name, recipientHint, cuid },
      `Processing SMS job ${job.id} (${job.name})`
    );

    try {
      // Idempotency guard: if this is a retry and SMS was already sent, skip re-sending
      if (passId) {
        const pass = await this.guestPassDAO.findFirst({ _id: passId });
        if (pass?.deliveryStatus?.sms === DeliveryStatusEnum.SENT) {
          this.log.info({ jobId: job.id, passId }, 'SMS already delivered — skipping retry');
          return { success: true, alreadySent: true };
        }
      }

      const result = await this.smsService.sendSMS({
        to,
        body,
        cuid,
        messageType: job.data.messageType || SMSMessageType.GUEST_PASS,
      });

      if (!result.success) {
        this.log.warn(
          { jobId: job.id, recipientHint, error: result.error },
          'SMS send returned unsuccessful'
        );

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
        { jobId: job.id, recipientHint, twilioSid: result.twilioSid },
        'SMS delivered successfully'
      );

      return { success: true, sentAt: new Date().toISOString() };
    } catch (err) {
      this.log.error({ err, jobId: job.id, recipientHint, cuid }, 'SMS delivery failed');

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
