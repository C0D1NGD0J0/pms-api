import { PaymentWorker } from '@workers/payment.worker';
import { QUEUE_NAMES, JOB_NAME } from '@utils/constants';
import { PaymentRecordType, IPaymentPeriod } from '@interfaces/payments.interface';

import { BaseQueue } from './base.queue';

export interface ICreateRentInvoiceJobData {
  metadata?: Record<string, string>;
  paymentType: PaymentRecordType;
  period: IPaymentPeriod;
  description?: string;
  tenantId: string; // Profile._id
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

    this.processQueueJobs(
      JOB_NAME.CREATE_RENT_INVOICE_JOB,
      5, // concurrency: process up to 5 invoices simultaneously
      this.paymentWorker.handleCreateRentInvoice
    );

    this.processQueueJobs(
      JOB_NAME.RETRY_FAILED_INVOICE_JOB,
      2,
      this.paymentWorker.handleCreateRentInvoice // same handler, different retry config
    );

    this.processQueueJobs(JOB_NAME.CANCEL_PAYMENT_JOB, 10, this.paymentWorker.handleCancelPayment);
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
