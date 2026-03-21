import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { PaymentService } from '@services/payments/payments.service';
import { ICreateRentInvoiceJobData, ICancelPaymentJobData } from '@queues/payment.queue';

interface IConstructor {
  paymentService: PaymentService;
}

export class PaymentWorker {
  private log: Logger;
  private paymentService: PaymentService;

  constructor({ paymentService }: IConstructor) {
    this.log = createLogger('PaymentWorker');
    this.paymentService = paymentService;
  }

  /**
   * Handle rent invoice creation
   * Arrow function to preserve `this` binding when passed as callback to processQueueJobs
   */
  handleCreateRentInvoice = async (job: Job<ICreateRentInvoiceJobData>) => {
    const { cuid, leaseId, tenantId, period, dueDate, paymentType, description } = job.data;
    const startTime = Date.now();

    this.log.info(
      { jobId: job.id, cuid, leaseId, period, attempt: job.attemptsMade + 1 },
      'PaymentWorker: processing rent invoice job'
    );

    try {
      await job.progress(10);

      const result = await this.paymentService.createRentPayment(cuid, {
        paymentType,
        leaseId,
        tenantId,
        dueDate: new Date(dueDate),
        period,
        description,
      });

      await job.progress(100);

      const duration = Date.now() - startTime;
      this.log.info(
        { jobId: job.id, pytuid: result.data?.pytuid, duration },
        'PaymentWorker: rent invoice created successfully'
      );

      return { success: true, pytuid: result.data?.pytuid, duration };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.log.error(
        {
          jobId: job.id,
          cuid,
          leaseId,
          period,
          attempt: job.attemptsMade + 1,
          duration,
          error: error.message,
        },
        'PaymentWorker: rent invoice job failed'
      );

      // On final attempt, log a hard alert for ops visibility
      const maxAttempts = job.opts?.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        this.log.error(
          { jobId: job.id, jobData: job.data },
          'PaymentWorker: ⚠️ ALERT — invoice creation exhausted all retries'
        );
      }

      throw error;
    }
  };

  /**
   * Handle payment cancellation
   * Arrow function to preserve `this` binding
   */
  handleCancelPayment = async (job: Job<ICancelPaymentJobData>) => {
    const { cuid, pytuid, reason } = job.data;
    const startTime = Date.now();

    this.log.info(
      { jobId: job.id, cuid, pytuid },
      'PaymentWorker: processing payment cancellation job'
    );

    try {
      await job.progress(10);

      await this.paymentService.cancelPayment(cuid, pytuid, reason);

      await job.progress(100);

      const duration = Date.now() - startTime;
      this.log.info(
        { jobId: job.id, pytuid, duration },
        'PaymentWorker: payment cancelled successfully'
      );

      return { success: true, pytuid, duration };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.log.error(
        { jobId: job.id, cuid, pytuid, duration, error: error.message },
        'PaymentWorker: payment cancellation job failed'
      );

      throw error;
    }
  };
}
