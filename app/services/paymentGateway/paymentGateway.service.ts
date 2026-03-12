import { createLogger } from '@utils/index';
import { CustomError } from '@shared/customErrors';
import { IPromiseReturnedData } from '@interfaces/index';
import { StripeService } from '@services/external/stripe/stripe.service';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';
import {
  ICreateConnectAccountInput,
  IFinalizeInvoiceResponse,
  IConnectAccountResponse,
  IOnboardingLinkResponse,
  ICreateInvoiceResponse,
  ICreateCustomerInput,
  ICreateCheckoutInput,
  ICreateInvoiceInput,
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
      const { provider, email, metadata, name } = input;

      this.log.info({ provider, email }, 'Creating customer via payment gateway');

      const providerInstance = this.getProvider(provider);
      const customer = await providerInstance.createCustomer({
        email,
        metadata,
        name,
        provider,
      });

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

  async getProductsWithPrices(provider: IPaymentGatewayProvider): Promise<
    Map<
      string,
      {
        monthly: { priceId: string; amount: number; lookUpKey: string | null };
        annual: { priceId: string; amount: number; lookUpKey: string | null };
      }
    >
  > {
    try {
      this.log.info({ provider }, 'Fetching products with prices');

      const providerInstance = this.getProvider(provider);

      if (!('getProductsWithPrices' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement getProductsWithPrices`);
      }

      const products = await (providerInstance as any).getProductsWithPrices();

      this.log.info({ provider }, 'Fetched products with prices successfully');

      return products;
    } catch (error) {
      this.log.error({ error, provider }, 'Error fetching products with prices');
      throw error;
    }
  }

  async getProductPrice(provider: IPaymentGatewayProvider, priceId: string): Promise<any> {
    try {
      this.log.info({ provider, priceId }, 'Fetching product price');

      const providerInstance = this.getProvider(provider);

      if (!('getProductPrice' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement getProductPrice`);
      }

      const price = await (providerInstance as any).getProductPrice(priceId);

      this.log.info({ provider, priceId }, 'Fetched product price successfully');

      return price;
    } catch (error) {
      this.log.error({ error, provider, priceId }, 'Error fetching product price');
      throw error;
    }
  }

  async getPriceByLookupKey(provider: IPaymentGatewayProvider, lookupKey: string): Promise<any> {
    try {
      this.log.info({ provider, lookupKey }, 'Fetching price by lookup key');

      const providerInstance = this.getProvider(provider);

      if (!('getPriceByLookupKey' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement getPriceByLookupKey`);
      }

      const price = await (providerInstance as any).getPriceByLookupKey(lookupKey);

      this.log.info({ provider, lookupKey }, 'Fetched price by lookup key successfully');

      return price;
    } catch (error) {
      this.log.error({ error, provider, lookupKey }, 'Error fetching price by lookup key');
      throw error;
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
      const providerInstance = this.getProvider(provider);

      if (!('updateSubscriptionItemQuantity' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement updateSubscriptionItemQuantity`);
      }

      const result = await (providerInstance as any).updateSubscriptionItemQuantity(
        itemId,
        quantity,
        true // prorate = true
      );

      return { success: true, data: result };
    } catch (error) {
      this.log.error({ error, provider, itemId }, 'Error updating subscription item quantity');
      return {
        success: false,
        data: null,
        message:
          error instanceof CustomError
            ? error.message
            : 'Failed to update subscription item quantity',
      };
    }
  }

  async deleteSubscriptionItem(
    provider: IPaymentGatewayProvider,
    itemId: string
  ): IPromiseReturnedData<any> {
    try {
      const providerInstance = this.getProvider(provider);

      if (!('deleteSubscriptionItem' in providerInstance)) {
        throw new Error(`Provider ${provider} does not implement deleteSubscriptionItem`);
      }

      const result = await (providerInstance as any).deleteSubscriptionItem(itemId, true);

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

  async createConnectAccount(
    provider: IPaymentGatewayProvider,
    input: ICreateConnectAccountInput
  ): IPromiseReturnedData<IConnectAccountResponse | null> {
    try {
      const providerInstance = this.getProvider(provider);
      if (!('createConnectAccount' in providerInstance)) {
        throw new Error(`Provider ${provider} does not support Connect accounts`);
      }

      const account = await providerInstance.createConnectAccount(input);
      return { success: true, data: account };
    } catch (error) {
      this.log.error({ error, provider }, 'Error creating Connect account');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to create Connect account',
      };
    }
  }

  async createKycOnboardingLink(
    provider: IPaymentGatewayProvider,
    params: { accountId: string; refreshUrl: string; returnUrl: string }
  ): IPromiseReturnedData<IOnboardingLinkResponse | null> {
    try {
      const providerInstance = this.getProvider(provider);
      if (!('createKycOnboardingLink' in providerInstance)) {
        throw new Error(`Provider ${provider} does not support onboarding links`);
      }

      const link = await providerInstance.createKycOnboardingLink(params);
      return { success: true, data: link };
    } catch (error) {
      this.log.error({ error, provider }, 'Error creating onboarding link');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to create onboarding link',
      };
    }
  }

  async createAccountUpdateLink(
    provider: IPaymentGatewayProvider,
    params: { accountId: string; refreshUrl: string; returnUrl: string }
  ): IPromiseReturnedData<IOnboardingLinkResponse | null> {
    try {
      const providerInstance = this.getProvider(provider);
      if (!('createAccountUpdateLink' in providerInstance)) {
        throw new Error(`Provider ${provider} does not support account update links`);
      }

      const link = await providerInstance.createAccountUpdateLink(params);
      return { success: true, data: link };
    } catch (error) {
      this.log.error({ error, provider }, 'Error creating account update link');
      return {
        success: false,
        data: null,
        message:
          error instanceof CustomError
            ? error.message
            : (error as any)?.message || 'Failed to create account update link',
      };
    }
  }

  async createDashboardLoginLink(
    provider: IPaymentGatewayProvider,
    accountId: string
  ): IPromiseReturnedData<IOnboardingLinkResponse | null> {
    try {
      const providerInstance = this.getProvider(provider);
      if (!('createDashboardLoginLink' in providerInstance)) {
        throw new Error(`Provider ${provider} does not support login links`);
      }

      const link = await providerInstance.createDashboardLoginLink(accountId);
      return { success: true, data: link };
    } catch (error) {
      this.log.error({ error, provider }, 'Error creating login link');
      return {
        success: false,
        data: null,
        message:
          error instanceof CustomError
            ? error.message
            : (error as any)?.message || 'Failed to create login link',
      };
    }
  }

  async getConnectAccount(
    provider: IPaymentGatewayProvider,
    accountId: string
  ): IPromiseReturnedData<any> {
    try {
      const providerInstance = this.getProvider(provider);
      if (!('getConnectAccount' in providerInstance)) {
        throw new Error(`Provider ${provider} does not support Connect accounts`);
      }

      const account = await providerInstance.getConnectAccount(accountId);
      return { success: true, data: account };
    } catch (error) {
      this.log.error({ error, provider }, 'Error fetching Connect account');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to fetch Connect account',
      };
    }
  }

  async createInvoice(
    provider: IPaymentGatewayProvider,
    input: ICreateInvoiceInput
  ): IPromiseReturnedData<ICreateInvoiceResponse | null> {
    try {
      const providerInstance = this.getProvider(provider);
      if (!('createInvoice' in providerInstance)) {
        throw new Error(`Provider ${provider} does not support invoices`);
      }

      const result = await providerInstance.createInvoice(input);
      return { success: true, data: result };
    } catch (error) {
      this.log.error({ error, provider }, 'Error creating invoice');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to create invoice',
      };
    }
  }

  async finalizeInvoice(
    provider: IPaymentGatewayProvider,
    invoiceId: string
  ): IPromiseReturnedData<IFinalizeInvoiceResponse | null> {
    try {
      const providerInstance = this.getProvider(provider);
      if (!('finalizeInvoice' in providerInstance)) {
        throw new Error(`Provider ${provider} does not support invoice finalization`);
      }

      const result = await providerInstance.finalizeInvoice!(invoiceId);
      return { success: true, data: result };
    } catch (error) {
      this.log.error({ error, provider }, 'Error finalizing invoice');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to finalize invoice',
      };
    }
  }

  async getCharge(provider: IPaymentGatewayProvider, chargeId: string): IPromiseReturnedData<any> {
    try {
      const providerInstance = this.getProvider(provider);
      const charge = await providerInstance.getCharge(chargeId);
      return { success: true, data: charge };
    } catch (error) {
      this.log.error({ error, provider, chargeId }, 'Error fetching charge');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to fetch charge',
      };
    }
  }

  async createTransferReversal(
    provider: IPaymentGatewayProvider,
    transferId: string,
    amountInCents?: number
  ): IPromiseReturnedData<{ reversalId: string; amount: number } | null> {
    try {
      const providerInstance = this.getProvider(provider);
      const result = await providerInstance.createTransferReversal(transferId, amountInCents);
      return { success: true, data: result };
    } catch (error) {
      this.log.error({ error, provider, transferId }, 'Error creating transfer reversal');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to create transfer reversal',
      };
    }
  }

  async createTransfer(
    provider: IPaymentGatewayProvider,
    params: {
      amountInCents: number;
      currency: string;
      destination: string;
      metadata?: Record<string, string>;
    }
  ): IPromiseReturnedData<{ transferId: string; amount: number } | null> {
    try {
      const providerInstance = this.getProvider(provider);
      const result = await providerInstance.createTransfer(params);
      return { success: true, data: result };
    } catch (error) {
      this.log.error(
        { error, provider, destination: params.destination },
        'Error creating transfer'
      );
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to create transfer',
      };
    }
  }

  async createRefund(
    provider: IPaymentGatewayProvider,
    params: {
      chargeId: string;
      amountInCents?: number;
      reason?: string;
    }
  ): IPromiseReturnedData<{
    refundId: string;
    status: string;
    amount: number;
    currency: string;
  } | null> {
    try {
      const providerInstance = this.getProvider(provider);
      const result = await providerInstance.createRefund(params);
      return { success: true, data: result };
    } catch (error) {
      this.log.error({ error, provider, chargeId: params.chargeId }, 'Error creating refund');
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : 'Failed to create refund',
      };
    }
  }
}
