import { Types } from 'mongoose';
import { envVariables } from '@shared/config';
import { PaymentValidations } from '@shared/validations';
import { PaymentController } from '@controllers/PaymentController';

const USER_ID = new Types.ObjectId().toString();

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (params: Record<string, string>, body: Record<string, any> = {}) =>
  ({
    params,
    body,
    context: { currentuser: { sub: USER_ID, client: { role: 'manager' } } },
  }) as any;

const makeController = () => {
  const paymentService = {
    refundPayment: jest.fn().mockResolvedValue({ success: true, data: {} }),
    cancelPayment: jest.fn().mockResolvedValue({ success: true, data: {} }),
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

describe('PaymentController — refund and cancel', () => {
  it('passes reverseVendorTransfer through to the refund', async () => {
    const { controller, paymentService } = makeController();

    await controller.refundPayment(
      makeReq(
        { cuid: 'C1', pytuid: 'P1' },
        { amount: 500, reason: 'r', reverseVendorTransfer: true }
      ),
      makeRes()
    );

    expect(paymentService.refundPayment).toHaveBeenCalledWith('C1', 'P1', USER_ID, {
      amount: 500,
      reason: 'r',
      reverseVendorTransfer: true,
    });
  });

  it('passes the caller role and id so a manager can void a manual entry', async () => {
    const { controller, paymentService } = makeController();

    await controller.cancelPayment(
      makeReq({ cuid: 'C1', pytuid: 'P1' }, { reason: 'dup' }),
      makeRes()
    );

    expect(paymentService.cancelPayment).toHaveBeenCalledWith('C1', 'P1', 'dup', {
      role: 'manager',
      userId: USER_ID,
    });
  });
});

describe('PaymentValidations', () => {
  describe('cardCheckoutBody', () => {
    let originalFrontendUrl: string;
    beforeAll(() => {
      originalFrontendUrl = envVariables.FRONTEND.URL;
      envVariables.FRONTEND.URL = 'https://app.example.com';
    });
    afterAll(() => {
      envVariables.FRONTEND.URL = originalFrontendUrl;
    });

    it.each([
      '/tenants/C1/u1/payments/P1?payment_success=true',
      'https://app.example.com/tenants/C1/u1/payments',
    ])('accepts in-app return URL %s', (url) => {
      expect(PaymentValidations.cardCheckoutBody.safeParse({ successUrl: url }).success).toBe(true);
    });

    it.each([
      'https://evil.example.com/tenants/C1/',
      '//evil.example.com/x',
      '/\\evil.example.com',
      'javascript:alert(1)',
      'https://app.example.com.evil.com/x',
    ])('rejects external return URL %s', (url) => {
      expect(PaymentValidations.cardCheckoutBody.safeParse({ cancelUrl: url }).success).toBe(false);
    });
  });

  describe('recordManualPayment', () => {
    const valid = {
      paymentType: 'rent',
      paymentMethod: 'cash',
      baseAmount: '150000',
      paidAt: '2026-09-02',
      tenantId: USER_ID,
      leaseId: 'L1',
    };

    it('accepts a paid cash entry with an optional charge to settle', () => {
      const result = PaymentValidations.recordManualPayment.safeParse({
        ...valid,
        status: 'paid',
        pytuid: 'PYT1',
      });
      expect(result.success).toBe(true);
    });

    it.each([
      [{ status: 'pending' }],
      [{ status: 'overdue' }],
      [{ paymentMethod: 'online' }],
      [{ paidAt: '2099-01-01' }],
    ])('rejects %j', (overrides) => {
      expect(
        PaymentValidations.recordManualPayment.safeParse({ ...valid, ...overrides }).success
      ).toBe(false);
    });
  });
});
