import Stripe from 'stripe';
import Logger from 'bunyan';
import { envVariables } from '@shared/config';
import { isValidPhoneNumber, createLogger } from '@utils/index';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';
import {
  IIdentityVerificationReport,
  ICreateIdentitySessionInput,
  ICreateConnectAccountInput,
  IFinalizeInvoiceResponse,
  IIdentitySessionResponse,
  IConnectAccountResponse,
  IOnboardingLinkResponse,
  ICreateInvoiceResponse,
  ICreateCheckoutInput,
  ICreateCustomerInput,
  ICreateInvoiceInput,
  IPaymentProvider,
  IPaymentCustomer,
  ICheckoutSession,
  IPayoutSchedule,
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
        customer_update: {
          name: 'auto',
          address: 'auto',
        },
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
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      const subscriptionItemId = subscription.items.data[0].id;

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

  async getPaymentIntentReceiptUrl(paymentIntentId: string): Promise<string | null> {
    return (await this.getPaymentIntentChargeInfo(paymentIntentId)).receiptUrl;
  }

  async getPaymentIntentChargeInfo(paymentIntentId: string): Promise<{
    chargeId: string | null;
    receiptUrl: string | null;
    paymentMethodId: string | null;
  }> {
    try {
      const pi = await this.stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge'],
      });
      const charge = pi.latest_charge as Stripe.Charge | null;
      const pmId = typeof pi.payment_method === 'string' ? pi.payment_method : null;
      return {
        chargeId: charge?.id ?? null,
        receiptUrl: charge?.receipt_url ?? null,
        paymentMethodId: pmId,
      };
    } catch (error) {
      this.log.error({ error, paymentIntentId }, 'Error retrieving charge info from PaymentIntent');
      return { chargeId: null, receiptUrl: null, paymentMethodId: null };
    }
  }

  async createRefund(params: {
    chargeId: string;
    amountInCents?: number;
    reason?: string;
  }): Promise<{ refundId: string; status: string; amount: number; currency: string }> {
    const { chargeId, amountInCents, reason } = params;
    try {
      const refundParams: Stripe.RefundCreateParams = { charge: chargeId };
      if (amountInCents) refundParams.amount = amountInCents;
      if (reason) refundParams.reason = reason as Stripe.RefundCreateParams.Reason;

      const refund = await this.stripe.refunds.create(refundParams);
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

  async createTransferReversal(
    transferId: string,
    amountInCents?: number
  ): Promise<{ reversalId: string; amount: number }> {
    try {
      const reversal = await this.stripe.transfers.createReversal(
        transferId,
        amountInCents ? { amount: amountInCents } : undefined
      );
      this.log.info(
        { transferId, reversalId: reversal.id, amount: reversal.amount },
        'Transfer reversal created'
      );
      return { reversalId: reversal.id, amount: reversal.amount };
    } catch (error) {
      this.log.error({ error, transferId }, 'Error creating transfer reversal');
      throw error;
    }
  }

  async createTransfer(params: {
    amountInCents: number;
    currency: string;
    destination: string;
    sourceTransaction?: string;
    metadata?: Record<string, string>;
  }): Promise<{ transferId: string; amount: number }> {
    try {
      const transfer = await this.stripe.transfers.create({
        amount: params.amountInCents,
        currency: params.currency,
        destination: params.destination,
        ...(params.sourceTransaction && { source_transaction: params.sourceTransaction }),
        ...(params.metadata && { metadata: params.metadata }),
      });
      this.log.info(
        { transferId: transfer.id, amount: transfer.amount, destination: params.destination },
        'Transfer created'
      );
      return { transferId: transfer.id, amount: transfer.amount };
    } catch (error) {
      this.log.error({ error, destination: params.destination }, 'Error creating transfer');
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
      const requestOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;
      const customer = await this.stripe.customers.create(
        { email, name, metadata },
        requestOptions
      );

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

  async createConnectAccount(input: ICreateConnectAccountInput): Promise<IConnectAccountResponse> {
    try {
      const { email, country, businessType, businessProfile, prefill, metadata } = input;

      const account = await this.stripe.accounts.create({
        country,
        email,
        business_type: businessType,
        capabilities: {
          transfers: { requested: true },
        },
        // 'recipient' service agreement — only requires 'transfers' capability,
        // works for all countries including those without full Stripe support (e.g. NG).
        tos_acceptance: { service_agreement: 'recipient' },
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
        // Prefill the hosted KYC form so the PM doesn't re-enter their own data
        ...(prefill &&
          businessType === 'individual' && {
            individual: {
              first_name: prefill.firstName,
              last_name: prefill.lastName,
              email,
              ...(prefill.phone &&
                prefill.phone.startsWith('+') &&
                isValidPhoneNumber(prefill.phone) && { phone: prefill.phone }),
            },
          }),
        ...(prefill &&
          businessType === 'company' && {
            company: {
              name: prefill.companyName,
              ...(prefill.phone &&
                prefill.phone.startsWith('+') &&
                isValidPhoneNumber(prefill.phone) && { phone: prefill.phone }),
            },
          }),
        settings: {
          payouts: {
            schedule: {
              interval: 'weekly',
              weekly_anchor: 'monday',
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

  async updatePayoutSchedule(
    accountId: string,
    interval: 'manual' | 'daily' | 'weekly' | 'monthly',
    weeklyAnchor?: string
  ): Promise<void> {
    const schedule: Stripe.AccountUpdateParams.Settings.Payouts.Schedule = { interval };
    if (interval === 'weekly' && weeklyAnchor) {
      schedule.weekly_anchor =
        weeklyAnchor as Stripe.AccountUpdateParams.Settings.Payouts.Schedule.WeeklyAnchor;
    }
    await this.stripe.accounts.update(accountId, {
      settings: { payouts: { schedule } },
    });
    this.log.info({ accountId, interval }, 'Updated payout schedule');
  }

  async getPayoutSchedule(accountId: string): Promise<IPayoutSchedule> {
    try {
      const account = await this.stripe.accounts.retrieve(accountId);
      const schedule = account.settings?.payouts?.schedule;
      return {
        interval: (schedule?.interval ?? 'weekly') as IPayoutSchedule['interval'],
        weeklyAnchor: schedule?.weekly_anchor ?? undefined,
        monthlyAnchor: schedule?.monthly_anchor ?? undefined,
        delayDays: schedule?.delay_days ?? undefined,
      };
    } catch (error) {
      this.log.error({ error, accountId }, 'Error fetching payout schedule');
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

  async getConnectBalance(accountId: string): Promise<Stripe.Balance> {
    try {
      return await this.stripe.balance.retrieve({}, { stripeAccount: accountId });
    } catch (error) {
      this.log.error({ error, accountId }, 'Error fetching Connect balance');
      throw error;
    }
  }

  async listConnectPayouts(
    accountId: string,
    options: { limit?: number; starting_after?: string } = {}
  ): Promise<Stripe.ApiList<Stripe.Payout>> {
    try {
      return await this.stripe.payouts.list(
        {
          limit: options.limit ?? 20,
          ...(options.starting_after && { starting_after: options.starting_after }),
        },
        { stripeAccount: accountId }
      );
    } catch (error) {
      this.log.error({ error, accountId }, 'Error listing Connect payouts');
      throw error;
    }
  }

  async getInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    try {
      return await this.stripe.invoices.retrieve(invoiceId);
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

  async createAccountUpdateLink(params: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<IOnboardingLinkResponse> {
    try {
      const accountLink = await this.stripe.accountLinks.create({
        account: params.accountId,
        refresh_url: params.refreshUrl,
        return_url: params.returnUrl,
        type: 'account_update',
      });

      return { url: accountLink.url };
    } catch (error) {
      this.log.error({ error, params }, 'Error creating account update link');
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
        lineItems,
        paymentMethodId,
        cuid,
        leaseUid,
      } = input;

      // Destination charges (rent): application_fee_amount is all-inclusive — Stripe takes
      // its processing fee from it, platform keeps the rest.
      // Separate charges (maintenance): charge stays on platform, no transfer_data.
      // Vendor is paid later via source_transaction transfer.
      const invoiceParams: Stripe.InvoiceCreateParams = {
        customer: tenantCustomerId,
        currency,
        ...(paymentMethodId && { default_payment_method: paymentMethodId }),
        auto_advance: false,
        collection_method: 'charge_automatically',
        description,
        metadata: {
          cuid,
          ...(leaseUid ? { leaseUid } : {}),
        },
        ...(!input.skipDestinationTransfer && {
          application_fee_amount: applicationFeeAmount,
          transfer_data: { destination: connectedAccountId },
        }),
      };

      const invoice = await this.stripe.invoices.create(invoiceParams);

      const itemResults = await Promise.allSettled(
        lineItems.map((item) =>
          this.stripe.invoiceItems.create({
            customer: tenantCustomerId,
            invoice: invoice.id,
            amount: item.amountInCents,
            currency,
            description: item.description,
          })
        )
      );

      const failedItems = itemResults.reduce<{ index: number; reason: any }[]>((acc, r, i) => {
        if (r.status === 'rejected') acc.push({ index: i, reason: r.reason });
        return acc;
      }, []);
      const successCount = itemResults.filter((r) => r.status === 'fulfilled').length;

      if (failedItems.length > 0) {
        this.log.error(
          {
            invoiceId: invoice.id,
            failedCount: failedItems.length,
            successCount,
            failures: failedItems.map(({ index, reason }) => ({
              item: lineItems[index],
              stripeCode: (reason as any)?.code ?? null,
              stripeType: (reason as any)?.type ?? null,
              stripeMessage: (reason as any)?.message ?? null,
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

  async createInvoiceItem(params: {
    customerId: string;
    amountInCents: number;
    currency: string;
    description: string;
  }): Promise<Stripe.InvoiceItem> {
    try {
      const item = await this.stripe.invoiceItems.create({
        customer: params.customerId,
        amount: params.amountInCents,
        currency: params.currency,
        description: params.description,
      });
      this.log.info(
        { customerId: params.customerId, amount: params.amountInCents },
        'Pending invoice item created'
      );
      return item;
    } catch (error) {
      this.log.error({ error, params }, 'Error creating invoice item');
      throw error;
    }
  }

  async updateCustomerDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string
  ): Promise<void> {
    try {
      await this.stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    } catch (error) {
      this.log.error(
        { error, customerId, paymentMethodId },
        'Error setting customer default payment method'
      );
      throw error;
    }
  }

  async payInvoice(
    invoiceId: string,
    opts?: { paymentMethod?: string; mandate?: string }
  ): Promise<void> {
    try {
      if (opts?.paymentMethod) {
        await this.stripe.invoices.update(invoiceId, {
          default_payment_method: opts.paymentMethod,
        });
      }

      await this.stripe.invoices.pay(invoiceId, {
        ...(opts?.mandate && { mandate: opts.mandate }),
      });
    } catch (error: any) {
      if (error?.rawType === 'invoice_already_paid') return;
      this.log.error({ error, invoiceId }, 'Error paying invoice');
      throw error;
    }
  }

  async finalizeInvoice(invoiceId: string): Promise<IFinalizeInvoiceResponse> {
    try {
      const invoice = await this.stripe.invoices.finalizeInvoice(invoiceId);

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

  async voidInvoice(invoiceId: string): Promise<void> {
    try {
      await this.stripe.invoices.voidInvoice(invoiceId);
    } catch (error: any) {
      // If the invoice is still in draft, delete it instead
      if (error?.code === 'invoice_not_open' || error?.statusCode === 400) {
        try {
          await this.stripe.invoices.del(invoiceId);
          return;
        } catch (delError) {
          this.log.error({ delError, invoiceId }, 'Error deleting draft invoice');
          throw delError;
        }
      }
      // Already voided — safe to ignore
      if (error?.code === 'invoice_already_voided') return;
      this.log.error({ error, invoiceId }, 'Error voiding invoice');
      throw error;
    }
  }

  async verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
    secret?: string
  ): Promise<any> {
    try {
      const webhookSecret = secret || envVariables.STRIPE.WEBHOOK_SECRET;

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

  async createIdentityVerificationSession(
    input: ICreateIdentitySessionInput
  ): Promise<IIdentitySessionResponse> {
    try {
      const session = await this.stripe.identity.verificationSessions.create({
        type: 'document',
        provided_details: input.email ? { email: input.email } : undefined,
        metadata: input.metadata,
        return_url: input.returnUrl,
        options: {
          document: {
            allowed_types: input.allowedTypes ?? ['driving_license', 'passport', 'id_card'],
          },
        },
      });
      return { sessionId: session.id, url: session.url! };
    } catch (error) {
      this.log.error({ error }, 'Error creating Stripe Identity verification session');
      throw error;
    }
  }

  async retrieveIdentityVerificationSession(
    sessionId: string
  ): Promise<IIdentityVerificationReport> {
    try {
      const session = await this.stripe.identity.verificationSessions.retrieve(sessionId, {
        expand: ['last_verification_report'],
      });
      const report = session.last_verification_report as Stripe.Identity.VerificationReport | null;
      return {
        status: session.status,
        documentType: report?.document?.type ?? undefined,
        issuingCountry: report?.document?.issuing_country ?? undefined,
      };
    } catch (error) {
      this.log.error({ error }, 'Error retrieving Stripe Identity verification session');
      throw error;
    }
  }

  async createSetupCheckoutSession(
    customerId: string,
    successUrl: string,
    cancelUrl: string,
    currency: string,
    paymentMethodTypes?: string[],
    metadata?: Record<string, string>
  ): Promise<{ url: string }> {
    try {
      // Bank-debit types require mandate options so Stripe can enforce the charge schedule
      const paymentMethodOptions: Record<string, any> = {};

      if (paymentMethodTypes?.includes('acss_debit')) {
        paymentMethodOptions.acss_debit = {
          currency,
          mandate_options: {
            default_for: ['invoice', 'subscription'],
            transaction_type: 'personal',
          },
          verification_method: 'automatic',
        };
      }

      if (paymentMethodTypes?.includes('us_bank_account')) {
        paymentMethodOptions.us_bank_account = {
          verification_method: 'automatic',
          financial_connections: {
            permissions: ['payment_method'],
          },
        };
      }

      if (paymentMethodTypes?.includes('sepa_debit')) {
        paymentMethodOptions.sepa_debit = {
          mandate_options: {},
        };
      }

      if (paymentMethodTypes?.includes('bacs_debit')) {
        paymentMethodOptions.bacs_debit = {
          mandate_options: {},
        };
      }

      const session = await this.stripe.checkout.sessions.create({
        mode: 'setup',
        currency,
        customer: customerId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        ...(paymentMethodTypes && { payment_method_types: paymentMethodTypes as any }),
        ...(Object.keys(paymentMethodOptions).length > 0 && {
          payment_method_options: paymentMethodOptions,
        }),
        ...(metadata && {
          metadata,
          setup_intent_data: { metadata },
        }),
      });

      this.log.info({ sessionId: session.id, customerId }, 'Created setup checkout session');
      return { url: session.url ?? '' };
    } catch (error: any) {
      this.log.error(
        {
          customerId,
          stripeType: error?.type,
          stripeCode: error?.code,
          stripeMessage: error?.message,
        },
        'Error creating Stripe setup checkout session'
      );
      throw error;
    }
  }

  async createPaymentCheckoutSession(params: {
    customerEmail: string;
    customerId?: string;
    lineItems: Array<{
      name: string;
      description: string;
      amountInCents: number;
      currency: string;
    }>;
    applicationFeeAmount: number;
    destinationAccountId: string;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
    skipDestinationTransfer?: boolean;
  }): Promise<Stripe.Checkout.Session> {
    try {
      const {
        customerEmail,
        customerId,
        lineItems,
        applicationFeeAmount,
        destinationAccountId,
        metadata,
        successUrl,
        cancelUrl,
        skipDestinationTransfer,
      } = params;
      const currency = lineItems[0]?.currency ?? 'usd';

      const session = await this.stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        ...(customerId ? { customer: customerId } : { customer_email: customerEmail }),
        line_items: lineItems.map((item) => ({
          price_data: {
            currency: currency.toLowerCase(),
            product_data: { name: item.name, description: item.description },
            unit_amount: item.amountInCents,
          },
          quantity: 1,
        })),
        payment_intent_data: {
          ...(!skipDestinationTransfer && {
            application_fee_amount: applicationFeeAmount,
            transfer_data: { destination: destinationAccountId },
          }),
          metadata,
          // Save the card for future charges (e.g., ACSS-to-card retry)
          ...(customerId && { setup_future_usage: 'off_session' as const }),
        },
        metadata,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      this.log.info(
        { sessionId: session.id, customerEmail, destinationAccountId },
        'Created payment checkout session'
      );
      return session;
    } catch (error: any) {
      this.log.error(
        {
          customerEmail: params.customerEmail,
          stripeType: error?.type,
          stripeCode: error?.code,
          stripeMessage: error?.message,
        },
        'Error creating Stripe payment checkout session'
      );
      throw error;
    }
  }

  /**
   * Retrieve payment details for a Stripe invoice by expanding the payments
   * sub-object. Since API v2025-03-31.basil, `charge` and `payment_intent`
   * were removed from the Invoice top-level and moved into `payments.data[]`.
   */
  async getInvoicePaymentDetails(invoiceId: string): Promise<{
    chargeId?: string;
    receiptUrl?: string;
    paymentIntentId?: string;
    lastPaymentError?: {
      message?: string;
      code?: string;
      type?: string;
      payment_method?: { type?: string };
    };
    paymentMethodType?: string;
  }> {
    try {
      const invoice = await this.stripe.invoices.retrieve(invoiceId, {
        expand: ['payments.data.payment.payment_intent'],
      });

      const firstPayment = (invoice as any).payments?.data?.[0];
      const pi = firstPayment?.payment?.payment_intent;
      const piObj = pi && typeof pi === 'object' ? pi : undefined;
      const paymentIntentId = typeof pi === 'string' ? pi : piObj?.id;

      // Extract charge ID from expanded PaymentIntent
      let chargeId: string | undefined;
      if (piObj?.latest_charge) {
        chargeId =
          typeof piObj.latest_charge === 'string' ? piObj.latest_charge : piObj.latest_charge.id;
      }

      // Fallback: if expansion didn't yield a charge (e.g. pi was a string),
      // retrieve the PaymentIntent directly to get latest_charge.
      if (!chargeId && paymentIntentId) {
        try {
          const piDirect = await this.stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ['latest_charge'],
          });
          const charge = piDirect.latest_charge as Stripe.Charge | null;
          chargeId =
            charge?.id ??
            (typeof piDirect.latest_charge === 'string' ? piDirect.latest_charge : undefined);
        } catch (err) {
          this.log.warn({ err, paymentIntentId }, 'Fallback PaymentIntent retrieve failed');
        }
      }

      return {
        chargeId,
        paymentIntentId,
        lastPaymentError: piObj?.last_payment_error ?? undefined,
        paymentMethodType:
          piObj?.last_payment_error?.payment_method?.type ?? piObj?.payment_method_types?.[0],
      };
    } catch (error) {
      this.log.warn({ error, invoiceId }, 'Could not retrieve invoice payment details');
      return {};
    }
  }

  async retrievePaymentMethod(
    paymentMethodId: string
  ): Promise<{ type: string; bankName?: string; last4?: string; accountType?: string }> {
    try {
      const pm = await this.stripe.paymentMethods.retrieve(paymentMethodId);

      const type = pm.type;
      let bankName: string | undefined;
      let last4: string | undefined;
      let accountType: string | undefined;

      if (type === 'us_bank_account' && pm.us_bank_account) {
        bankName = pm.us_bank_account.bank_name ?? undefined;
        last4 = pm.us_bank_account.last4 ?? undefined;
        accountType = pm.us_bank_account.account_type ?? undefined;
      } else if (type === 'acss_debit' && pm.acss_debit) {
        bankName = pm.acss_debit.bank_name ?? undefined;
        last4 = pm.acss_debit.last4 ?? undefined;
      } else if (type === 'sepa_debit' && pm.sepa_debit) {
        bankName = pm.sepa_debit.bank_code ?? undefined;
        last4 = pm.sepa_debit.last4 ?? undefined;
      } else if (type === 'bacs_debit' && pm.bacs_debit) {
        last4 = pm.bacs_debit.last4 ?? undefined;
      } else if (type === 'card' && pm.card) {
        bankName = pm.card.brand ?? undefined;
        last4 = pm.card.last4 ?? undefined;
      }

      return { type, bankName, last4, accountType };
    } catch (error) {
      this.log.error({ error, paymentMethodId }, 'Error retrieving payment method');
      throw error;
    }
  }

  async retrieveSetupIntent(
    setupIntentId: string
  ): Promise<{ paymentMethodId: string; mandateId: string | null }> {
    try {
      const si = await this.stripe.setupIntents.retrieve(setupIntentId, {
        expand: ['mandate', 'payment_method'],
      });
      const mandateId = typeof si.mandate === 'string' ? si.mandate : (si.mandate?.id ?? null);
      const paymentMethodId =
        typeof si.payment_method === 'string' ? si.payment_method : (si.payment_method?.id ?? '');
      return { paymentMethodId, mandateId };
    } catch (error) {
      this.log.error({ error, setupIntentId }, 'Error retrieving setup intent');
      throw error;
    }
  }
}
