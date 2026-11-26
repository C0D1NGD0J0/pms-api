import { Types } from 'mongoose';

jest.mock('@di/index', () => ({ container: {} }));

import { InvitationService } from '@services/invitation/invitation.service';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';

const makeService = (provider: IPaymentGatewayProvider) => {
  const paymentGatewayService = {
    getProviderForClient: jest.fn().mockResolvedValue(provider),
    createCustomer: jest.fn().mockResolvedValue({ success: true, data: { customerId: 'cus_1' } }),
  };
  const profileDAO = {
    findFirst: jest.fn().mockResolvedValue({ tenantInfo: null }),
    update: jest.fn().mockResolvedValue({}),
  };
  const service = new InvitationService({
    queueFactory: { getQueue: jest.fn().mockReturnValue({}) },
    emitterService: { on: jest.fn(), emit: jest.fn() },
    paymentGatewayService,
    profileDAO,
  } as any);
  return { service: service as any, paymentGatewayService };
};

describe('InvitationService — tenant payment customer on invite acceptance', () => {
  const user = { _id: new Types.ObjectId(), email: 'tenant@example.com' };

  it('creates no Stripe customer for a Paystack account (the card is saved on first payment)', async () => {
    const { service, paymentGatewayService } = makeService(IPaymentGatewayProvider.PAYSTACK);

    await service.createTenantPaymentCustomer(user, 'CLIENT_NG');

    expect(paymentGatewayService.createCustomer).not.toHaveBeenCalled();
  });

  it('still creates the Stripe customer for a Stripe account', async () => {
    const { service, paymentGatewayService } = makeService(IPaymentGatewayProvider.STRIPE);

    await service.createTenantPaymentCustomer(user, 'CLIENT_CA');

    expect(paymentGatewayService.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ provider: IPaymentGatewayProvider.STRIPE, email: user.email })
    );
  });
});
