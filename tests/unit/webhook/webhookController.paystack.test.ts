import { Response, Request } from 'express';
import { UnauthorizedError } from '@shared/customErrors';
import { WebhookController } from '@controllers/WebhookController';

const makeResponse = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const makeController = () => {
  const idempotencyCache = {
    claimWebhookEvent: jest.fn().mockResolvedValue(true),
    markWebhookProcessed: jest.fn().mockResolvedValue(undefined),
    releaseWebhookClaim: jest.fn().mockResolvedValue(undefined),
  };
  const paymentGatewayService = {
    verifyPaystackWebhook: jest.fn().mockReturnValue({
      event: 'charge.success',
      data: { id: 4099260516, reference: 'psk-0a1b2c3d4e5f6a7b8c9d' },
    }),
  };
  const paystackPaymentService = { handleWebhookEvent: jest.fn().mockResolvedValue(undefined) };

  const controller = new WebhookController({
    paymentGatewayService: paymentGatewayService as any,
    paystackPaymentService: paystackPaymentService as any,
    idempotencyCache: idempotencyCache as any,
    paymentWebhookService: {} as any,
    subscriptionService: {} as any,
    maintenanceInvoiceService: {} as any,
    boldSignService: {} as any,
    paymentService: {} as any,
    stripeService: {} as any,
    twilioService: {} as any,
    clientService: {} as any,
    leaseService: {} as any,
    smsService: {} as any,
  });
  return { controller, idempotencyCache, paymentGatewayService, paystackPaymentService };
};

const makeRequest = (signature = 'abc123') =>
  ({
    headers: { 'x-paystack-signature': signature },
    rawBody: Buffer.from('{"event":"charge.success"}'),
  }) as unknown as Request;

describe('WebhookController - Paystack webhooks', () => {
  it('checks the signature on the raw body, handles the event once and answers 200', async () => {
    const { controller, idempotencyCache, paymentGatewayService, paystackPaymentService } =
      makeController();
    const res = makeResponse();

    await controller.handlePaystackWebhook(makeRequest(), res);

    expect(paymentGatewayService.verifyPaystackWebhook).toHaveBeenCalledWith(
      expect.any(Buffer),
      'abc123'
    );
    expect(idempotencyCache.claimWebhookEvent).toHaveBeenCalledWith(
      'paystack:charge.success:4099260516'
    );
    expect(paystackPaymentService.handleWebhookEvent).toHaveBeenCalled();
    expect(idempotencyCache.markWebhookProcessed).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects a bad signature without handling anything', async () => {
    const { controller, paymentGatewayService, paystackPaymentService } = makeController();
    paymentGatewayService.verifyPaystackWebhook.mockImplementation(() => {
      throw new UnauthorizedError({ message: 'Invalid webhook request.' });
    });
    const res = makeResponse();

    await controller.handlePaystackWebhook(makeRequest('forged'), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(paystackPaymentService.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it('handles an event with no id or reference without a shared idempotency key', async () => {
    const { controller, idempotencyCache, paymentGatewayService, paystackPaymentService } =
      makeController();
    paymentGatewayService.verifyPaystackWebhook.mockReturnValue({
      event: 'customeridentification.success',
      data: {},
    });
    const res = makeResponse();

    await controller.handlePaystackWebhook(makeRequest(), res);

    expect(idempotencyCache.claimWebhookEvent).not.toHaveBeenCalled();
    expect(paystackPaymentService.handleWebhookEvent).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('skips an event it has already handled', async () => {
    const { controller, idempotencyCache, paystackPaymentService } = makeController();
    idempotencyCache.claimWebhookEvent.mockResolvedValue(false);
    const res = makeResponse();

    await controller.handlePaystackWebhook(makeRequest(), res);

    expect(paystackPaymentService.handleWebhookEvent).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('releases the claim and answers 500 so Paystack retries when handling fails', async () => {
    const { controller, idempotencyCache, paystackPaymentService } = makeController();
    paystackPaymentService.handleWebhookEvent.mockRejectedValue(new Error('db down'));
    const res = makeResponse();

    await controller.handlePaystackWebhook(makeRequest(), res);

    expect(idempotencyCache.releaseWebhookClaim).toHaveBeenCalledWith(
      'paystack:charge.success:4099260516'
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect((res.json as jest.Mock).mock.calls[0][0].message).not.toContain('db down');
  });

  it('logs the whole error (with its stack), not just the message', async () => {
    const { controller, paystackPaymentService } = makeController();
    const failure = new Error('db down');
    paystackPaymentService.handleWebhookEvent.mockRejectedValue(failure);
    const logError = jest.spyOn((controller as any).log, 'error').mockImplementation(() => {});

    await controller.handlePaystackWebhook(makeRequest(), makeResponse());

    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ error: failure }),
      'Error processing Paystack webhook'
    );
  });
});
