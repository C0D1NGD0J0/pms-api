import { PaymentController } from '@controllers/PaymentController';

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeController = () =>
  new PaymentController({
    paymentService: {} as any,
    invoiceService: {} as any,
    mediaUploadService: {} as any,
    invoiceAIService: {} as any,
    cronService: {} as any,
  } as any);

describe('PaymentController.triggerCronJob (dev only)', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it.each([
    ['weekly-invoices', 'queueWeeklyRentInvoices'],
    ['daily-safety-net', 'queueDailySafetyNetInvoices'],
  ])('runs %s on the payment cron service', async (jobName, methodName) => {
    process.env.NODE_ENV = 'development';
    const cronJob = jest.fn().mockResolvedValue(undefined);
    const resolve = jest.fn().mockReturnValue({ [methodName]: cronJob });
    const res = makeRes();

    await makeController().triggerCronJob(
      { params: { jobName }, container: { resolve } } as any,
      res
    );

    expect(resolve).toHaveBeenCalledWith('paymentCronService');
    expect(cronJob).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('is not available in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes();

    await makeController().triggerCronJob({ params: { jobName: 'weekly-invoices' } } as any, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
