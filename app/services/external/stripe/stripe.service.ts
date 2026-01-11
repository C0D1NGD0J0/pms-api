import Stripe from 'stripe';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';

export class StripeService {
  private readonly log: Logger;
  private readonly stripe: Stripe;

  constructor() {
    this.log = createLogger('StripeService');

    if (!envVariables.STRIPE.SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not defined in environment variables');
    }
    this.stripe = new Stripe(envVariables.STRIPE.SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    });

    this.log.info('StripeService initialized');
  }

  async getProducts(): Promise<Stripe.Product[]> {
    try {
      const products = await this.stripe.products.list({
        active: true,
        expand: ['data.default_price'],
      });
      return products.data;
    } catch (error) {
      this.log.error({ error }, 'Error fetching Stripe products');
      throw error;
    }
  }

  /**
   * Get products with price mappings (name -> price ID and amount)
   * This is the single source of truth for pricing
   */
  async getProductsWithPrices(): Promise<
    Map<string, { priceId: string; amount: number; lookUpKey: string }>
  > {
    try {
      const products = await this.stripe.products.list({
        active: true,
        expand: ['data.default_price'],
      });

      const priceMap = new Map<string, { priceId: string; amount: number; lookUpKey: string }>();

      products.data.forEach((product) => {
        const price = product.default_price as Stripe.Price;
        if (price && typeof price !== 'string' && price.unit_amount) {
          priceMap.set(product.name.toLowerCase(), {
            priceId: price.id,
            lookUpKey: price.lookup_key || '',
            amount: price.unit_amount, //in cents
          });
        }
      });

      return priceMap;
    } catch (error) {
      this.log.error({ error }, 'Error fetching Stripe products with prices');
      throw error;
    }
  }

  async getPrice(priceId: string): Promise<Stripe.Price> {
    try {
      const price = await this.stripe.prices.retrieve(priceId);
      return price;
    } catch (error) {
      this.log.error({ error, priceId }, 'Error fetching Stripe price');
      throw error;
    }
  }

  async createCheckoutSession(
    lookUpKey: string,
    clientId: string,
    customerEmail: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<Stripe.Checkout.Session> {
    try {
      const prices = await this.stripe.prices.list({
        lookup_keys: [lookUpKey],
        expand: ['data.product'],
      });
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [
          {
            price: prices.data[0].id,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: customerEmail,
        customer_creation: 'always', // Ensures customer is always created
        metadata: {
          clientId,
        },
        subscription_data: {
          metadata: {
            clientId,
          },
        },
      });

      this.log.info({ sessionId: session.id, clientId }, 'Created checkout session');
      return session;
    } catch (error) {
      this.log.error({ error, lookUpKey, clientId }, 'Error creating checkout session');
      throw error;
    }
  }

  async createBillingPortalSession(
    customerId: string,
    returnUrl: string
  ): Promise<Stripe.BillingPortal.Session> {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      this.log.info({ sessionId: session.id, customerId }, 'Created billing portal session');
      return session;
    } catch (error) {
      this.log.error({ error, customerId }, 'Error creating billing portal session');
      throw error;
    }
  }

  async getSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      return subscription;
    } catch (error) {
      this.log.error({ error, subscriptionId }, 'Error fetching Stripe subscription');
      throw error;
    }
  }

  async getCustomer(customerId: string): Promise<Stripe.Customer> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      return customer as Stripe.Customer;
    } catch (error) {
      this.log.error({ error, customerId }, 'Error fetching Stripe customer');
      throw error;
    }
  }

  async createCustomer(
    email: string,
    name: string,
    metadata?: Record<string, string>
  ): Promise<Stripe.Customer> {
    try {
      const customer = await this.stripe.customers.create({
        email,
        name,
        metadata,
      });

      this.log.info({ customerId: customer.id, email }, 'Created Stripe customer');
      return customer;
    } catch (error) {
      this.log.error({ error, email }, 'Error creating Stripe customer');
      throw error;
    }
  }
}
