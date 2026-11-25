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
    getPayoutAccountDetails: jest.fn().mockResolvedValue({ success: true, data: null }),
    listPayoutBanks: jest.fn().mockResolvedValue({ success: true, data: [] }),
    resolvePayoutBankAccount: jest.fn().mockResolvedValue({ success: true, data: {} }),
    createPaystackPayoutAccount: jest.fn().mockResolvedValue({ success: true, data: {} }),
    updatePaystackPayoutBankAccount: jest.fn().mockResolvedValue({ success: true, data: {} }),
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

describe('PaymentController — payout bank account', () => {
  const bankBody = { bankCode: '058', accountNumber: '0123456789' };

  it('returns the payout account details for the settings page', async () => {
    const { controller, paymentService } = makeController();
    const res = makeRes();

    await controller.getPayoutAccount({ params: { cuid: 'C1' } } as any, res);

    expect(paymentService.getPayoutAccountDetails).toHaveBeenCalledWith('C1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('lists banks and checks an account with only the bank code and number', async () => {
    const { controller, paymentService } = makeController();

    await controller.listPayoutBanks({ params: { cuid: 'C1' } } as any, makeRes());
    await controller.resolvePayoutBankAccount(
      { params: { cuid: 'C1' }, body: { ...bankBody, extra: 'ignored' } } as any,
      makeRes()
    );

    expect(paymentService.listPayoutBanks).toHaveBeenCalledWith('C1');
    expect(paymentService.resolvePayoutBankAccount).toHaveBeenCalledWith('C1', bankBody);
  });

  it('adds the bank account and answers 201', async () => {
    const { controller, paymentService } = makeController();
    const res = makeRes();

    await controller.createPaystackPayoutAccount(
      { params: { cuid: 'C1' }, body: bankBody } as any,
      res
    );

    expect(paymentService.createPaystackPayoutAccount).toHaveBeenCalledWith('C1', bankBody);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('changes the bank account as the signed-in user, so the alert names who did it', async () => {
    const { controller, paymentService } = makeController();
    const res = makeRes();

    await controller.updatePaystackPayoutBankAccount(
      {
        params: { cuid: 'C1' },
        body: bankBody,
        context: { currentuser: { sub: 'user-1' } },
      } as any,
      res
    );

    expect(paymentService.updatePaystackPayoutBankAccount).toHaveBeenCalledWith(
      'C1',
      'user-1',
      bankBody
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
