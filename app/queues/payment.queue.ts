import { PaymentWorker } from '@workers/payment.worker';
import { QUEUE_NAMES, JOB_NAME } from '@utils/constants';
import { PaymentRecordType, IPaymentPeriod } from '@interfaces/payments.interface';

import { BaseQueue } from './base.queue';

export interface ICreateRentInvoiceJobData {
  metadata?: Record<string, string>;
  paymentType: PaymentRecordType;
  period: IPaymentPeriod;
  description?: string;
  tenantId: string; // User._id
  leaseId: string;
  dueDate: Date;
  cuid: string;
}

export interface ICancelPaymentJobData {
  reason?: string;
  pytuid: string;
  cuid: string;
}

interface IConstructor {
  paymentWorker: PaymentWorker;
}

export class PaymentQueue extends BaseQueue {
  private readonly paymentWorker: PaymentWorker;

  constructor({ paymentWorker }: IConstructor) {
    super({ queueName: QUEUE_NAMES.PAYMENT_QUEUE });
    this.paymentWorker = paymentWorker;

    // Use wildcard processor to avoid Bull's unreliable multi-named-processor routing
    // (multiple queue.process() calls on one queue share a single bclient and can stall).
    this.processAllQueueJobs(3, async (job) => {
      switch (job.name) {
        case JOB_NAME.RETRY_FAILED_INVOICE_JOB:
        case JOB_NAME.CREATE_RENT_INVOICE_JOB:
          return this.paymentWorker.handleCreateRentInvoice(job);
        case JOB_NAME.CANCEL_PAYMENT_JOB:
          return this.paymentWorker.handleCancelPayment(job);
        default:
          throw new Error(`Unknown payment job: ${job.name}`);
      }
    });
  }

  /**
   * Queue a rent invoice creation job (with exponential backoff retries)
   */
  async addCreateRentInvoiceJob(data: ICreateRentInvoiceJobData): Promise<void> {
    await this.addJobToQueue(JOB_NAME.CREATE_RENT_INVOICE_JOB, data, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10000 },
    });
  }

  /**
   * Queue a retry for a previously failed invoice
   */
  async addRetryFailedInvoiceJob(data: ICreateRentInvoiceJobData): Promise<void> {
    await this.addJobToQueue(JOB_NAME.RETRY_FAILED_INVOICE_JOB, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60000 }, // longer delay for retries
    });
  }

  /**
   * Queue a payment cancellation job
   */
  async addCancelPaymentJob(data: ICancelPaymentJobData): Promise<void> {
    await this.addJobToQueue(JOB_NAME.CANCEL_PAYMENT_JOB, data);
  }
}
