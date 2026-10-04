import { t } from '@shared/languages';
import { ForbiddenError } from '@shared/customErrors';
import { SubscriptionService } from '@services/subscription/subscription.service';

/**
 * Whether the client's plan includes e-signature. Fails closed: no subscription
 * record (or no entitlements) means not entitled — it's a paid feature.
 *
 * Used outside the request cycle too (PDF handler, renewal cron), where the
 * route-level `requireFeature('eSignature')` middleware never runs.
 */
export const hasESignatureEntitlement = async (
  subscriptionService: SubscriptionService,
  cuid: string
): Promise<boolean> => {
  const result = await subscriptionService.getSubscriptionEntitlements(cuid);
  return !!(result.success && result.data?.entitlements?.eSignature);
};

/** Throws a 403 when the client's plan doesn't include e-signature. */
export const assertESignatureEntitlement = async (
  subscriptionService: SubscriptionService,
  cuid: string
): Promise<void> => {
  if (!(await hasESignatureEntitlement(subscriptionService, cuid))) {
    throw new ForbiddenError({ message: t('auth.errors.featureNotEntitled') });
  }
};
