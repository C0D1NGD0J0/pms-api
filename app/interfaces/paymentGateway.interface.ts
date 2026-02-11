import { Stripe } from 'stripe';

import { IPaymentGatewayProvider } from './subscription.interface';

export interface IPaymentProvider {
  getProductsWithPrices(): Promise<
    Map<
      string,
      {
        monthly: { priceId: string; amount: number; lookUpKey: string | null };
        annual: { priceId: string; amount: number; lookUpKey: string | null };
      }
    >
  >;
  createCustomer(data: {
    email: string;
    name?: string;
    connectedAccountId?: string;
    provider: IPaymentGatewayProvider;
    metadata?: Record<string, string>;
  }): Promise<IPaymentCustomer>;
  createCheckoutSession(data: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<ICheckoutSession>;
  createKycOnboardingLink(params: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<IOnboardingLinkResponse>;
  finalizeInvoice(invoiceId: string, connectedAccountId: string): Promise<IFinalizeInvoiceResponse>;
  verifyWebhookSignature(payload: string | Buffer<ArrayBufferLike>, signature: string): unknown;
  updateSubscription(subscriptionId: string, newPriceId: string): Promise<Stripe.Subscription>;
  createConnectAccount(input: ICreateConnectAccountInput): Promise<IConnectAccountResponse>;
  getCustomerInvoices(customerId: string, limit?: number): Promise<Stripe.Invoice[]>;
  createDashboardLoginLink(accountId: string): Promise<IOnboardingLinkResponse>;
  createInvoice(input: ICreateInvoiceInput): Promise<ICreateInvoiceResponse>;
  cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  getInvoice(invoiceId: string, connectedAccountId: string): Promise<any>;
  getSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  getCustomer(customerId: string): Promise<Stripe.Customer>;
  getCharge(chargeId: string): Promise<Stripe.Charge>;
  getConnectAccount(accountId: string): Promise<any>;
  getProducts(): Promise<Stripe.Product[]>;
}

export interface ICreateInvoiceInput {
  lineItems: Array<{
    description: string;
    amountInCents: number;
    quantity?: number;
  }>;
  applicationFeeAmountInCents: number;
  connectedAccountId: string;
  tenantCustomerId: string;
  autoChargeDueDate: Date;
  description: string;
  currency: string;
  leaseUid: string;
  cuid: string;
}

export interface ICreateConnectAccountInput {
  businessProfile?: {
    companyName: string;
    email: string;
    phone?: string;
    address?: string;
    url?: string;
    productDescription?: string;
  };
  businessType: 'individual' | 'company';
  metadata?: Record<string, string>;
  country: string;
  email: string;
  cuid: string;
}

export interface ICreateCustomerInput {
  metadata?: Record<string, string>;
  provider: IPaymentGatewayProvider;
  connectedAccountId?: string; // For creating customer on PM's connected account (Stripe Connect)
  email: string;
  name?: string;
}

export interface IConnectAccountResponse {
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  accountId: string;
  currency: string;
  country: string;
  email: string;
}

export interface ICreateCheckoutInput {
  provider: IPaymentGatewayProvider;
  metadata?: Record<string, string>;
  customerId: string;
  successUrl: string;
  cancelUrl: string;
  priceId: string;
}
export interface ICreateInvoiceResponse {
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  hostedInvoiceUrl?: string;
  invoiceId: string;
  amountDue: number;
  dueDate?: Date;
}

export interface ICheckoutSession {
  provider: IPaymentGatewayProvider;
  metadata?: Record<string, string>;
  redirectUrl: string;
  customerId: string;
  sessionId: string;
}

export interface IPaymentCustomer {
  provider: IPaymentGatewayProvider;
  metadata?: Record<string, string>;
  customerId: string;
  createdAt?: Date;
  email: string;
}

export interface IFinalizeInvoiceResponse {
  hostedInvoiceUrl?: string;
  invoiceId: string;
  status: string;
}

export interface IOnboardingLinkResponse {
  url: string;
}
