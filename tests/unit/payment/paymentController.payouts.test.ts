import { PaymentController } from '@controllers/PaymentController';

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeController = () => {
  const paymentService = {
    requestInstantPayout: jest.fn().mockResolvedValue({ success: true, data: {} }),
    updatePayoutSchedule: jest.fn().mockResolvedValue({ success: true, data: null }),
  };
  const controller = new PaymentController({
    paymentService: paymentService as any,
    invoiceService: {} as any,
    mediaUploadService: {} as any,
    invoiceAIService: {} as any,
    cronService: {} as any,
  } as any);
  return { controller, paymentService };
};

describe('PaymentController — landlord payouts', () => {
  it("passes the caller and the request's idempotency key to the instant payout", async () => {
    const { controller, paymentService } = makeController();
    const res = makeRes();

    await controller.requestInstantPayout(
      {
        params: { cuid: 'C1' },
        headers: { 'idempotency-key': 'key-123' },
        body: { amount: 999999 },
        context: { currentuser: { sub: 'user-1' } },
      } as any,
      res
    );

    // The body is ignored — the amount always comes from Stripe's balance
    expect(paymentService.requestInstantPayout).toHaveBeenCalledWith('C1', 'user-1', 'key-123');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('saves the weekly payout day', async () => {
    const { controller, paymentService } = makeController();

    await controller.updatePayoutSchedule(
      {
        params: { cuid: 'C1' },
        body: { interval: 'weekly', weeklyAnchor: 'friday' },
        context: { currentuser: { sub: 'user-1' } },
      } as any,
      makeRes()
    );

    expect(paymentService.updatePayoutSchedule).toHaveBeenCalledWith('C1', 'weekly', 'friday');
  });
});
