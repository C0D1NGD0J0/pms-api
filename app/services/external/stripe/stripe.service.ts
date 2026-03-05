import dayjs from 'dayjs';
import Stripe from 'stripe';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';
import {
  ICreateConnectAccountInput,
  IFinalizeInvoiceResponse,
  IConnectAccountResponse,
  IOnboardingLinkResponse,
  ICreateInvoiceResponse,
  ICreateCheckoutInput,
  ICreateCustomerInput,
  ICreateInvoiceInput,
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

      for (const product of products.data) {
        const prices = await this.stripe.prices.list({
          product: product.id,
          active: true,
        });

        const monthlyPrice = prices.data.find(
          (p) =>
            p.recurring?.interval === 'month' &&
            p.unit_amount !== null &&
            !p.lookup_key?.includes('seat') &&
            (p.lookup_key?.includes('_monthly') || p.lookup_key?.includes('monthly_price'))
        );

        const annualPrice = prices.data.find(
          (p) =>
            p.recurring?.interval === 'year' &&
            p.unit_amount !== null &&
            !p.lookup_key?.includes('seat') &&
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
      const result = await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
      return result;
    } catch (error) {
      this.log.error({ error, subscriptionId }, 'Error canceling Stripe subscription');
      throw error;
    }
  }

  async updateSubscription(
    subscriptionId: string,
    newPriceId: string
  ): Promise<Stripe.Subscription> {
    try {
      // Get current subscription to find subscription item ID
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      const subscriptionItemId = subscription.items.data[0].id;

      // Update to new price with proration (charges immediately)
      const updated = await this.stripe.subscriptions.update(subscriptionId, {
        items: [
          {
            id: subscriptionItemId,
            price: newPriceId,
          },
        ],
        proration_behavior: 'create_prorations', // Credit unused time
      });

      this.log.info({ subscriptionId, newPriceId }, 'Updated Stripe subscription');
      return updated;
    } catch (error) {
      this.log.error({ error, subscriptionId, newPriceId }, 'Error updating Stripe subscription');
      throw error;
    }
  }

  async getSubscriptionWithItems(subscriptionId: string): Promise<Stripe.Subscription> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['items.data.price'],
      });
      return subscription;
    } catch (error) {
      this.log.error({ error, subscriptionId }, 'Error fetching subscription with items');
      throw error;
    }
  }

  async getPriceByLookupKey(lookupKey: string): Promise<Stripe.Price | null> {
    try {
      const prices = await this.stripe.prices.list({
        lookup_keys: [lookupKey],
        limit: 1,
      });

      if (!prices.data.length) {
        this.log.warn({ lookupKey }, 'Price not found for lookup key');
        return null;
      }

      return prices.data[0];
    } catch (error) {
      this.log.error({ error, lookupKey }, 'Error fetching price by lookup key');
      throw error;
    }
  }

  async addSubscriptionItem(
    subscriptionId: string,
    priceLookupKey: string,
    quantity: number,
    prorate: boolean = true
  ): Promise<Stripe.SubscriptionItem> {
    try {
      // Get price by lookup key
      const price = await this.getPriceByLookupKey(priceLookupKey);
      if (!price) {
        throw new Error(`Price not found for lookup key: ${priceLookupKey}`);
      }

      // Add subscription item with proration
      const item = await this.stripe.subscriptionItems.create({
        subscription: subscriptionId,
        price: price.id,
        quantity: quantity,
        proration_behavior: prorate ? 'always_invoice' : 'none',
      });

      this.log.info(
        { subscriptionId, priceLookupKey, quantity, itemId: item.id },
        'Added subscription item'
      );

      return item;
    } catch (error) {
      this.log.error(
        { error, subscriptionId, priceLookupKey, quantity },
        'Error adding subscription item'
      );
      throw error;
    }
  }

  async updateSubscriptionItemQuantity(
    itemId: string,
    quantity: number,
    prorate: boolean = true
  ): Promise<Stripe.SubscriptionItem> {
    try {
      const updated = await this.stripe.subscriptionItems.update(itemId, {
        quantity: quantity,
        proration_behavior: prorate ? 'always_invoice' : 'none',
      });

      this.log.info({ itemId, quantity }, 'Updated subscription item quantity');

      return updated;
    } catch (error) {
      this.log.error({ error, itemId, quantity }, 'Error updating subscription item quantity');
      throw error;
    }
  }

  async deleteSubscriptionItem(
    itemId: string,
    prorate: boolean = true
  ): Promise<Stripe.DeletedSubscriptionItem> {
    try {
      const deleted = await this.stripe.subscriptionItems.del(itemId, {
        proration_behavior: prorate ? 'always_invoice' : 'none',
      });

      this.log.info({ itemId }, 'Deleted subscription item');

      return deleted;
    } catch (error) {
      this.log.error({ error, itemId }, 'Error deleting subscription item');
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

  async getCharge(chargeId: string): Promise<Stripe.Charge> {
    try {
      return await this.stripe.charges.retrieve(chargeId);
    } catch (error) {
      this.log.error({ error, chargeId }, 'Error fetching Stripe charge');
      throw error;
    }
  }

  async createRefund(params: {
    chargeId: string;
    connectedAccountId: string;
    amountInCents?: number;
    reason?: string;
  }): Promise<{ refundId: string; status: string; amount: number; currency: string }> {
    const { chargeId, connectedAccountId, amountInCents, reason } = params;
    try {
      const refundParams: Stripe.RefundCreateParams = { charge: chargeId };
      if (amountInCents) refundParams.amount = amountInCents;
      if (reason) refundParams.reason = reason as Stripe.RefundCreateParams.Reason;

      const refund = await this.stripe.refunds.create(refundParams, {
        stripeAccount: connectedAccountId,
      });
      this.log.info({ chargeId, refundId: refund.id, amount: refund.amount }, 'Refund created');
      return {
        refundId: refund.id,
        status: refund.status ?? 'unknown',
        amount: refund.amount,
        currency: refund.currency,
      };
    } catch (error) {
      this.log.error({ error, chargeId }, 'Error creating Stripe refund');
      throw error;
    }
  }

  async getCustomerInvoices(customerId: string, limit: number = 12): Promise<Stripe.Invoice[]> {
    try {
      const result = await this.stripe.invoices.list({
        customer: customerId,
        limit,
        status: 'paid',
      });
      this.log.info({ customerId, count: result.data.length }, 'Fetched customer invoices');
      return result.data;
    } catch (error) {
      this.log.error({ error, customerId }, 'Error fetching customer invoices');
      throw error;
    }
  }

  async createCustomer(data: ICreateCustomerInput): Promise<IPaymentCustomer> {
    const { email, metadata, name, connectedAccountId } = data;
    try {
      const customer = await this.stripe.customers.create(
        {
          email,
          name,
          metadata,
        },
        connectedAccountId ? { stripeAccount: connectedAccountId } : undefined
      );

      return {
        customerId: customer.id,
        email: customer.email || email,
        provider: IPaymentGatewayProvider.STRIPE,
        metadata,
        createdAt: new Date(customer.created * 1000),
      };
    } catch (error) {
      this.log.error(
        { error, email: data.email, connectedAccountId },
        'Error creating Stripe customer'
      );
      throw error;
    }
  }

  async createConnectAccount(input: ICreateConnectAccountInput): Promise<IConnectAccountResponse> {
    try {
      const { email, country, businessType, businessProfile, metadata } = input;

      const account = await this.stripe.accounts.create({
        type: 'express',
        country,
        email,
        business_type: businessType,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        controller: {
          fees: {
            payer: 'application',
          },
          losses: {
            payments: 'application',
          },
          stripe_dashboard: {
            type: 'express',
          },
        },
        ...(businessProfile && {
          business_profile: {
            name: businessProfile.companyName,
            url: businessProfile.url,
            support_email: businessProfile.email,
            support_phone: businessProfile.phone,
            product_description:
              businessProfile.productDescription || 'Property management and rent collection',
          },
        }),
        settings: {
          payouts: {
            schedule: {
              interval: 'weekly',
            },
          },
          branding: {
            icon: metadata?.platformLogoUrl,
            primary_color: metadata?.brandColor,
          },
        },
        metadata,
      });

      return {
        accountId: account.id,
        email: account.email!,
        country: account.country!,
        currency: account.default_currency!,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
      };
    } catch (error) {
      this.log.error({ error, input }, 'Error creating Stripe Connect account');
      throw error;
    }
  }

  async getConnectAccount(accountId: string): Promise<Stripe.Account> {
    try {
      return await this.stripe.accounts.retrieve(accountId);
    } catch (error) {
      this.log.error({ error, accountId }, 'Error fetching Connect account');
      throw error;
    }
  }

  async getInvoice(invoiceId: string, connectedAccountId: string): Promise<Stripe.Invoice> {
    try {
      return await this.stripe.invoices.retrieve(invoiceId, {
        stripeAccount: connectedAccountId, // specify connected account for direct charge
      });
    } catch (error) {
      this.log.error({ error, invoiceId }, 'Error fetching invoice');
      throw error;
    }
  }

  async createKycOnboardingLink(params: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<IOnboardingLinkResponse> {
    try {
      const accountLink = await this.stripe.accountLinks.create({
        account: params.accountId,
        refresh_url: params.refreshUrl,
        return_url: params.returnUrl,
        type: 'account_onboarding',
      });

      return { url: accountLink.url };
    } catch (error) {
      this.log.error({ error, params }, 'Error creating onboarding link');
      throw error;
    }
  }

  async createDashboardLoginLink(accountId: string): Promise<IOnboardingLinkResponse> {
    try {
      const loginLink = await this.stripe.accounts.createLoginLink(accountId);

      return { url: loginLink.url };
    } catch (error) {
      this.log.error({ error, accountId }, 'Error creating login link');
      throw error;
    }
  }

  async createInvoice(input: ICreateInvoiceInput): Promise<ICreateInvoiceResponse> {
    try {
      const {
        tenantCustomerId,
        connectedAccountId,
        applicationFeeAmountInCents: applicationFeeAmount,
        currency,
        description,
        autoChargeDueDate,
        lineItems,
        cuid,
        leaseUid,
      } = input;

      const daysUntilDue = Math.ceil(dayjs(autoChargeDueDate).diff(dayjs(), 'day', true));
      const invoice = await this.stripe.invoices.create(
        {
          customer: tenantCustomerId,
          auto_advance: true,
          collection_method: 'charge_automatically',
          days_until_due: daysUntilDue > 0 ? daysUntilDue : 0,
          description,
          metadata: {
            cuid,
            leaseUid,
          },
          application_fee_amount: applicationFeeAmount,
        },
        {
          stripeAccount: connectedAccountId,
        }
      );

      const itemResults = await Promise.allSettled(
        lineItems.map((item) =>
          this.stripe.invoiceItems.create(
            {
              customer: tenantCustomerId,
              invoice: invoice.id,
              amount: item.amountInCents,
              quantity: item.quantity || 1,
              currency,
              description: item.description,
            },
            {
              stripeAccount: connectedAccountId,
            }
          )
        )
      );

      const failedItems = itemResults.filter((result) => result.status === 'rejected');
      const successfulItems = itemResults.filter((result) => result.status === 'fulfilled');

      if (failedItems.length > 0) {
        this.log.error(
          {
            invoiceId: invoice.id,
            failedCount: failedItems.length,
            successfulCount: successfulItems.length,
            failures: failedItems.map((r, i) => ({
              item: lineItems[i],
              error: r.status === 'rejected' ? r.reason : null,
            })),
          },
          'Some invoice items failed to create'
        );

        throw new Error(
          `Failed to add ${failedItems.length} of ${lineItems.length} invoice items. Invoice ${invoice.id} created but incomplete.`
        );
      }

      return {
        invoiceId: invoice.id,
        amountDue: invoice.amount_due,
        status: invoice.status || 'open',
        hostedInvoiceUrl: invoice.hosted_invoice_url || undefined,
        dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : undefined,
      };
    } catch (error) {
      this.log.error({ error, input }, 'Error creating invoice');
      throw error;
    }
  }

  async finalizeInvoice(
    invoiceId: string,
    connectedAccountId: string
  ): Promise<IFinalizeInvoiceResponse> {
    try {
      const invoice = await this.stripe.invoices.finalizeInvoice(
        invoiceId,
        {
          auto_advance: true,
        },
        {
          stripeAccount: connectedAccountId,
        }
      );

      return {
        invoiceId: invoice.id,
        status: invoice.status!,
        hostedInvoiceUrl: invoice.hosted_invoice_url || undefined,
      };
    } catch (error) {
      this.log.error({ error, invoiceId }, 'Error finalizing invoice');
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
