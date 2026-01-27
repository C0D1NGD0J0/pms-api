import Stripe from 'stripe';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';
import {
  ICreateCheckoutInput,
  ICreateCustomerInput,
  IPaymentProvider,
  IPaymentCustomer,
  ICheckoutSession,
} from '@interfaces/paymentGateway.interface';

export class StripeService implements IPaymentProvider {
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
   * Get products with all price mappings (monthly and annual)
   */
  async getProductsWithPrices(): Promise<
    Map<
      string,
      {
        monthly: { priceId: string; amount: number; lookUpKey: string | null };
        annual: { priceId: string; amount: number; lookUpKey: string | null };
      }
    >
  > {
    try {
      const products = await this.stripe.products.list({
        active: true,
      });

      const priceMap = new Map<
        string,
        {
          monthly: { priceId: string; amount: number; lookUpKey: string | null };
          annual: { priceId: string; amount: number; lookUpKey: string | null };
        }
      >();

      // Fetch all prices for each product
      for (const product of products.data) {
        const prices = await this.stripe.prices.list({
          product: product.id,
          active: true,
        });

        const monthlyPrice = prices.data.find(
          (p) =>
            p.recurring?.interval === 'month' &&
            p.unit_amount !== null &&
            (p.lookup_key?.includes('_monthly') || p.lookup_key?.includes('monthly_price'))
        );

        const annualPrice = prices.data.find(
          (p) =>
            p.recurring?.interval === 'year' &&
            p.unit_amount !== null &&
            (p.lookup_key?.includes('_annual') || p.lookup_key?.includes('annual_price'))
        );

        // Only add if we have both monthly and annual prices
        if (monthlyPrice && annualPrice) {
          priceMap.set(product.name.toLowerCase(), {
            monthly: {
              priceId: monthlyPrice.id,
              amount: monthlyPrice.unit_amount || 0,
              lookUpKey: monthlyPrice.lookup_key || null,
            },
            annual: {
              priceId: annualPrice.id,
              amount: annualPrice.unit_amount || 0,
              lookUpKey: annualPrice.lookup_key || null,
            },
          });
        }
      }

      return priceMap;
    } catch (error) {
      this.log.error({ error }, 'Error fetching Stripe products with prices');
      throw error;
    }
  }

  async getProductPrice(priceId: string): Promise<Stripe.Price> {
    try {
      const price = await this.stripe.prices.retrieve(priceId);
      return price;
    } catch (error) {
      this.log.error({ error, priceId }, 'Error fetching Stripe price');
      throw error;
    }
  }

  async createCheckoutSession(data: ICreateCheckoutInput): Promise<ICheckoutSession> {
    try {
      const { customerId, priceId, successUrl, cancelUrl, metadata } = data;

      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
        subscription_data: {
          metadata,
        },
      });

      this.log.info({ sessionId: session.id, customerId }, 'Created checkout session');

      return {
        sessionId: session.id,
        redirectUrl: session.url || '',
        customerId,
        provider: IPaymentGatewayProvider.STRIPE,
        metadata,
      };
    } catch (error) {
      this.log.error({ error, data }, 'Error creating checkout session');
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

  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    try {
      const result = await this.stripe.subscriptions.cancel(subscriptionId);
      this.log.info({ subscriptionId }, 'Canceled Stripe subscription');
      return result;
    } catch (error) {
      this.log.error({ error, subscriptionId }, 'Error canceling Stripe subscription');
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

  async createCustomer(data: ICreateCustomerInput): Promise<IPaymentCustomer> {
    try {
      const { email, metadata, name } = data;

      const customer = await this.stripe.customers.create({
        email,
        name,
        metadata,
      });

      this.log.info({ customerId: customer.id, email, name }, 'Created Stripe customer');

      return {
        customerId: customer.id,
        email: customer.email || email,
        provider: IPaymentGatewayProvider.STRIPE,
        metadata,
        createdAt: new Date(customer.created * 1000),
      };
    } catch (error) {
      this.log.error({ error, email: data.email }, 'Error creating Stripe customer');
      throw error;
    }
  }

  async verifyWebhookSignature(payload: string | Buffer, signature: string): Promise<any> {
    try {
      const webhookSecret = envVariables.STRIPE.WEBHOOK_SECRET;

      if (!webhookSecret) {
        throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
      }

      const event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      this.log.info({ eventType: event.type, eventId: event.id }, 'Webhook verified');

      return event;
    } catch (error) {
      this.log.error({ error }, 'Error verifying webhook signature');
      throw error;
    }
  }
}
