import LeaseModel from '@models/lease/lease.model';
import PaymentModel from '@models/payments/payments.model';
import { PlanName } from '@interfaces/subscription.interface';
import SubscriptionModel from '@models/subscription/subscription.model';
import { ILeaseESignatureStatusEnum } from '@interfaces/lease.interface';

// Guards against interface/schema enum drift: updates run with runValidators,
// so any value the services write but the schema doesn't list fails at runtime.
describe('Schema enum alignment with interfaces', () => {
  it.each(Object.values(ILeaseESignatureStatusEnum))(
    'lease eSignature.status accepts "%s"',
    async (status) => {
      await expect(
        LeaseModel.validate({ eSignature: { status } }, ['eSignature.status'])
      ).resolves.not.toThrow();
    }
  );

  it.each<PlanName>(['essential', 'growth', 'portfolio', 'enterprise'])(
    'subscription planName accepts "%s"',
    async (planName) => {
      await expect(SubscriptionModel.validate({ planName }, ['planName'])).resolves.not.toThrow();
    }
  );

  it.each(['open', 'needs_response', 'won', 'lost'])(
    'payment dispute.status accepts "%s"',
    async (status) => {
      await expect(
        PaymentModel.validate({ dispute: { status } }, ['dispute.status'])
      ).resolves.not.toThrow();
    }
  );

  it('subscription entitlements keep expenseTracking and whiteLabelling', () => {
    const subscription = new SubscriptionModel({
      entitlements: { expenseTracking: true, whiteLabelling: true },
    });

    expect(subscription.entitlements.expenseTracking).toBe(true);
    expect(subscription.entitlements.whiteLabelling).toBe(true);
  });
});
