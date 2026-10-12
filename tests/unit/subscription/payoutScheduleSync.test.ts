import { Types } from 'mongoose';
import { ISubscriptionStatus } from '@interfaces/subscription.interface';
import { SubscriptionWebhookService } from '@services/subscription/subscriptionWebhook.service';

// Pausing payouts while a subscription lapses must resume the landlord's own weekday, and must
// never touch a vendor's payout account that happens to share the client's cuid.
describe('SubscriptionWebhookService - payout schedule sync', () => {
  const CUID = 'CLIENT-1';

  const makeService = (processor: Record<string, any> | null) => {
    const paymentProcessorDAO = {
      findFirst: jest.fn().mockResolvedValue(processor),
      update: jest.fn().mockResolvedValue({}),
    };
    const paymentGatewayService = {
      updatePayoutSchedule: jest.fn().mockResolvedValue({ success: true, data: null }),
    };
    const service = new SubscriptionWebhookService({
      paymentProcessorDAO: paymentProcessorDAO as any,
      paymentGatewayService: paymentGatewayService as any,
      subscriptionPlanConfig: {} as any,
      subscriptionCache: {} as any,
      subscriptionDAO: {} as any,
      stripeService: {} as any,
      sseService: {} as any,
      emailQueue: {} as any,
      clientDAO: {} as any,
      authCache: {} as any,
      userDAO: {} as any,
    });
    const sync = (status: ISubscriptionStatus) =>
      (service as any).syncPayoutSchedule(CUID, status) as Promise<void>;
    return { sync, paymentProcessorDAO, paymentGatewayService };
  };

  it('looks up only the client-owned payout account', async () => {
    const { sync, paymentProcessorDAO } = makeService(null);

    await sync(ISubscriptionStatus.INACTIVE);

    expect(paymentProcessorDAO.findFirst).toHaveBeenCalledWith({ cuid: CUID, ownerType: 'client' });
  });

  it('pauses payouts by switching to a manual schedule', async () => {
    const processorId = new Types.ObjectId();
    const { sync, paymentProcessorDAO, paymentGatewayService } = makeService({
      _id: processorId,
      accountId: 'acct_pm',
      payoutsPaused: false,
    });

    await sync(ISubscriptionStatus.PAST_DUE);

    expect(paymentGatewayService.updatePayoutSchedule).toHaveBeenCalledWith(
      'stripe',
      'acct_pm',
      'manual'
    );
    expect(paymentProcessorDAO.update).toHaveBeenCalledWith(
      { _id: processorId },
      expect.objectContaining({ $set: expect.objectContaining({ payoutsPaused: true }) })
    );
  });

  it("resumes weekly payouts on the landlord's saved weekday", async () => {
    const { sync, paymentGatewayService } = makeService({
      _id: new Types.ObjectId(),
      accountId: 'acct_pm',
      payoutsPaused: true,
      payoutWeeklyAnchor: 'thursday',
    });

    await sync(ISubscriptionStatus.ACTIVE);

    expect(paymentGatewayService.updatePayoutSchedule).toHaveBeenCalledWith(
      'stripe',
      'acct_pm',
      'weekly',
      'thursday'
    );
  });

  it('falls back to Monday when no weekday was saved', async () => {
    const { sync, paymentGatewayService } = makeService({
      _id: new Types.ObjectId(),
      accountId: 'acct_pm',
      payoutsPaused: true,
    });

    await sync(ISubscriptionStatus.ACTIVE);

    expect(paymentGatewayService.updatePayoutSchedule).toHaveBeenCalledWith(
      'stripe',
      'acct_pm',
      'weekly',
      'monday'
    );
  });
});
