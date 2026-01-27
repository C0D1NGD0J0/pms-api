import { createLogger } from '@utils/index';
import { IPromiseReturnedData } from '@interfaces/index';
import { StripeService } from '@services/external/stripe/stripe.service';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';
import {
  ICreateCustomerInput,
  ICreateCheckoutInput,
  IPaymentProvider,
  IPaymentCustomer,
  ICheckoutSession,
} from '@interfaces/paymentGateway.interface';

interface IConstructor {
  stripeService: StripeService;
}
export class PaymentGatewayService {
  private log = createLogger('PaymentGatewayService');
  private providers: Map<IPaymentGatewayProvider, IPaymentProvider>;

  constructor({ stripeService }: IConstructor) {
    this.providers = new Map();
    this.registerProviders({ stripeService });
  }

  private registerProviders({ stripeService }: IConstructor): void {
    try {
      const stripe = stripeService;
      this.providers.set(IPaymentGatewayProvider.STRIPE, stripe);
    } catch (error) {
      this.log.error({ error }, 'Error registering payment providers');
      throw error;
    }
  }

  /**
   * Get provider instance by name
   */
  private getProvider(provider: IPaymentGatewayProvider): IPaymentProvider {
    const providerInstance = this.providers.get(provider);

    if (!providerInstance) {
      throw new Error(`Payment provider '${provider}' not registered`);
    }

    return providerInstance;
  }

  /**
   * Create or retrieve customer
   * Routes to correct provider based on input
   */
  async createCustomer(input: ICreateCustomerInput): IPromiseReturnedData<IPaymentCustomer | null> {
    try {
      const { provider, email, metadata } = input;

      this.log.info({ provider, email }, 'Creating customer via payment gateway');

      const providerInstance = this.getProvider(provider);
      const customer = await providerInstance.createCustomer({ email, metadata });

      this.log.info({ provider, customerId: customer.customerId }, 'Customer created successfully');

      return { data: customer, success: true };
    } catch (error) {
      this.log.error({ error, input }, 'Error creating customer via payment gateway');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to create customer',
      };
    }
  }

  /**
   * Create checkout session
   * Routes to correct provider based on input
   */
  async createCheckoutSession(
    input: ICreateCheckoutInput
  ): IPromiseReturnedData<ICheckoutSession | null> {
    try {
      const { provider, customerId, priceId, successUrl, cancelUrl, metadata } = input;

      const providerInstance = this.getProvider(provider);
      const session = await providerInstance.createCheckoutSession({
        customerId,
        priceId,
        successUrl,
        cancelUrl,
        metadata,
      });

      return { data: session, success: true };
    } catch (error) {
      this.log.error({ error, input }, 'Error creating checkout session via payment gateway');
      return {
        data: null,
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create checkout session',
      };
    }
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhook(
    provider: IPaymentGatewayProvider,
    payload: string | Buffer,
    signature: string
  ): Promise<any> {
    try {
      this.log.info({ provider }, 'Verifying webhook signature');

      const providerInstance = this.getProvider(provider);
      const event = await providerInstance.verifyWebhookSignature(payload, signature);

      this.log.info({ provider }, 'Webhook verified successfully');

      return event;
    } catch (error) {
      this.log.error({ error, provider }, 'Error verifying webhook');
      throw error;
    }
  }

  /**
   * Cancel subscription
   * TODO: Implement when StripeService.cancelSubscription is added
   */
  async cancelSubscription(
    provider: IPaymentGatewayProvider,
    subscriptionId: string
  ): IPromiseReturnedData<any> {
    try {
      this.log.info({ provider, subscriptionId }, 'Canceling subscription');

      const providerInstance = this.getProvider(provider);

      // Check if provider implements cancelSubscription
      if (!('cancelSubscription' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement cancelSubscription`);
      }

      const result = await providerInstance.cancelSubscription(subscriptionId);

      this.log.info({ provider, subscriptionId }, 'Subscription canceled successfully');

      return { success: true, data: result };
    } catch (error) {
      this.log.error({ error, provider, subscriptionId }, 'Error canceling subscription');
      return {
        data: null,
        success: false,
        message: error instanceof Error ? error.message : 'Failed to cancel subscription',
      };
    }
  }
}
