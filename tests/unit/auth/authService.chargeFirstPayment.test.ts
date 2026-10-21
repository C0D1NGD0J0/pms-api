// Break the circular import chain: auth.service → @shared/middlewares → @di/index → registerResources → auth.service (undefined)
jest.mock('@shared/middlewares', () => ({ preventTenantConflict: jest.fn() }));
jest.mock('@di/index', () => ({ container: {} }));
jest.mock('@shared/languages', () => ({ t: jest.fn((k: string) => k) }));

import { Types } from 'mongoose';
import { AuthService } from '@services/auth/auth.service';
import { ICurrentUser } from '@interfaces/user.interface';
import { PaymentRecordType } from '@interfaces/payments.interface';

const CUID = 'MMQHHVX09JJT';
const TENANT_SUB = new Types.ObjectId().toString();
const LUID = 'LEASE0000001';

const tenant = {
  sub: TENANT_SUB,
  email: 'tenant@example.com',
  client: { cuid: CUID, role: 'tenant' },
} as ICurrentUser;

const lease = {
  _id: new Types.ObjectId(),
  luid: LUID,
  duration: { startDate: '2026-11-01' },
  fees: { currency: 'cad' },
};

const makeService = (existingPayments: unknown[]) => {
  const paymentService = {
    listPayments: jest.fn().mockResolvedValue({ data: { items: existingPayments } }),
    createRentPayment: jest
      .fn()
      .mockResolvedValue({ data: { pytuid: 'PYT0000001', baseAmount: 100000 } }),
  };
  const service = new AuthService({
    leaseDAO: { getActiveLeaseByTenant: jest.fn().mockResolvedValue(lease) },
    paymentService,
    profileDAO: {},
    paymentProcessorDAO: {},
    paymentGatewayService: {},
    userDAO: {},
    clientDAO: {},
    queueFactory: { getQueue: jest.fn() },
    tokenService: {},
    authCache: {},
    userCache: { invalidateUserDetail: jest.fn() },
    vendorService: {},
    subscriptionService: {},
    emitterService: { emit: jest.fn(), on: jest.fn() },
    twilioService: {},
    featureFlagService: { isEnabled: jest.fn().mockReturnValue(false) },
    webAuthnService: {},
  } as any);
  return { service, paymentService };
};

describe('AuthService.chargeFirstPayment — double-charge guard', () => {
  it("checks for existing payments by the lease's luid", async () => {
    const { service, paymentService } = makeService([]);

    await service.chargeFirstPayment(CUID, tenant);

    expect(paymentService.listPayments).toHaveBeenCalledWith(CUID, { luid: LUID, limit: 1 });
  });

  it('skips the charge when the lease already has a payment', async () => {
    const { service, paymentService } = makeService([{ pytuid: 'PYT0000000' }]);

    const result = await service.chargeFirstPayment(CUID, tenant);

    expect(result.data).toEqual({ skipped: true, reason: 'already_charged' });
    expect(paymentService.createRentPayment).not.toHaveBeenCalled();
  });

  it('charges the first rent payment when the lease has none', async () => {
    const { service, paymentService } = makeService([]);

    const result = await service.chargeFirstPayment(CUID, tenant);

    expect(paymentService.createRentPayment).toHaveBeenCalledWith(
      CUID,
      expect.objectContaining({ paymentType: PaymentRecordType.RENT, tenantId: TENANT_SUB })
    );
    expect(result.data).toMatchObject({ skipped: false, pytuid: 'PYT0000001', currency: 'cad' });
  });
});
