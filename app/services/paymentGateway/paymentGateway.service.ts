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

  async getInvoices(
    provider: IPaymentGatewayProvider,
    customerId: string,
    limit: number = 12
  ): IPromiseReturnedData<any[]> {
    try {
      this.log.info({ provider, customerId, limit }, 'Fetching customer invoices');

      const providerInstance = this.getProvider(provider);

      if (!('getCustomerInvoices' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement getCustomerInvoices`);
      }

      const invoices = await (providerInstance as any).getCustomerInvoices(customerId, limit);

      this.log.info(
        { provider, customerId, count: invoices.length },
        'Fetched invoices successfully'
      );

      return { success: true, data: invoices };
    } catch (error) {
      this.log.error({ error, provider, customerId }, 'Error fetching invoices');
      return {
        data: [],
        success: false,
        message: error instanceof Error ? error.message : 'Failed to fetch invoices',
      };
    }
  }

  async updateSubscription(
    provider: IPaymentGatewayProvider,
    subscriptionId: string,
    newPriceId: string
  ): IPromiseReturnedData<any> {
    try {
      this.log.info({ provider, subscriptionId, newPriceId }, 'Updating subscription');

      const providerInstance = this.getProvider(provider);

      if (!('updateSubscription' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement updateSubscription`);
      }

      const result = await (providerInstance as any).updateSubscription(subscriptionId, newPriceId);

      this.log.info({ provider, subscriptionId }, 'Subscription updated successfully');

      return { success: true, data: result };
    } catch (error) {
      this.log.error({ error, provider, subscriptionId }, 'Error updating subscription');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to update subscription',
      };
    }
  }

  async getSubscriptionWithItems(
    provider: IPaymentGatewayProvider,
    subscriptionId: string
  ): IPromiseReturnedData<any> {
    try {
      this.log.info({ provider, subscriptionId }, 'Fetching subscription with items');

      const providerInstance = this.getProvider(provider);

      if (!('getSubscriptionWithItems' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement getSubscriptionWithItems`);
      }

      const result = await (providerInstance as any).getSubscriptionWithItems(subscriptionId);

      return { success: true, data: result };
    } catch (error) {
      this.log.error({ error, provider, subscriptionId }, 'Error fetching subscription with items');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to fetch subscription',
      };
    }
  }

  async addSubscriptionItem(
    provider: IPaymentGatewayProvider,
    subscriptionId: string,
    priceLookupKey: string,
    quantity: number
  ): IPromiseReturnedData<any> {
    try {
      this.log.info(
        { provider, subscriptionId, priceLookupKey, quantity },
        'Adding subscription item'
      );

      const providerInstance = this.getProvider(provider);

      if (!('addSubscriptionItem' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement addSubscriptionItem`);
      }

      const result = await (providerInstance as any).addSubscriptionItem(
        subscriptionId,
        priceLookupKey,
        quantity,
        true // prorate = true
      );

      this.log.info({ provider, itemId: result.id }, 'Subscription item added successfully');

      return { success: true, data: result };
    } catch (error) {
      this.log.error({ error, provider, subscriptionId }, 'Error adding subscription item');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to add subscription item',
      };
    }
  }

  async updateSubscriptionItemQuantity(
    provider: IPaymentGatewayProvider,
    itemId: string,
    quantity: number
  ): IPromiseReturnedData<any> {
    try {
      this.log.info({ provider, itemId, quantity }, 'Updating subscription item quantity');

      const providerInstance = this.getProvider(provider);

      if (!('updateSubscriptionItemQuantity' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement updateSubscriptionItemQuantity`);
      }

      const result = await (providerInstance as any).updateSubscriptionItemQuantity(
        itemId,
        quantity,
        true // prorate = true
      );

      this.log.info({ provider, itemId, quantity }, 'Subscription item quantity updated');

      return { success: true, data: result };
    } catch (error) {
      this.log.error({ error, provider, itemId }, 'Error updating subscription item quantity');
      return {
        success: false,
        data: null,
        message:
          error instanceof Error ? error.message : 'Failed to update subscription item quantity',
      };
    }
  }

  async deleteSubscriptionItem(
    provider: IPaymentGatewayProvider,
    itemId: string
  ): IPromiseReturnedData<any> {
    try {
      this.log.info({ provider, itemId }, 'Deleting subscription item');

      const providerInstance = this.getProvider(provider);

      if (!('deleteSubscriptionItem' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement deleteSubscriptionItem`);
      }

      const result = await (providerInstance as any).deleteSubscriptionItem(itemId, true);

      this.log.info({ provider, itemId }, 'Subscription item deleted successfully');

      return { success: true, data: result };
    } catch (error) {
      this.log.error({ error, provider, itemId }, 'Error deleting subscription item');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to delete subscription item',
      };
    }
  }
}
