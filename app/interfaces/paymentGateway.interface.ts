import { Stripe } from 'stripe';

import { IPaymentGatewayProvider } from './subscription.interface';

export interface IPaymentProvider {
  getInvoicePaymentDetails(invoiceId: string): Promise<{
    chargeId?: string;
    paymentIntentId?: string;
    lastPaymentError?: {
      message?: string;
      code?: string;
      type?: string;
      payment_method?: { type?: string };
    };
    paymentMethodType?: string;
  }>;
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
    provider: IPaymentGatewayProvider;
    connectedAccountId?: string;
    metadata?: Record<string, string>;
  }): Promise<IPaymentCustomer>;
  createCheckoutSession(data: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<ICheckoutSession>;
  createTransfer(params: {
    amountInCents: number;
    currency: string;
    destination: string;
    metadata?: Record<string, string>;
  }): Promise<{ transferId: string; amount: number }>;
  createRefund(params: {
    chargeId: string;
    amountInCents?: number;
    reason?: string;
  }): Promise<{ refundId: string; status: string; amount: number; currency: string }>;
  updatePayoutSchedule(
    accountId: string,
    interval: 'manual' | 'daily' | 'weekly' | 'monthly',
    weeklyAnchor?: string
  ): Promise<void>;
  createKycOnboardingLink(params: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<IOnboardingLinkResponse>;
  createAccountUpdateLink(params: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<IOnboardingLinkResponse>;
  createTransferReversal(
    transferId: string,
    amountInCents?: number
  ): Promise<{ reversalId: string; amount: number }>;
  createIdentityVerificationSession(
    input: ICreateIdentitySessionInput
  ): Promise<IIdentitySessionResponse>;
  updateCustomerDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void>;
  verifyWebhookSignature(payload: string | Buffer<ArrayBufferLike>, signature: string): unknown;
  updateSubscription(subscriptionId: string, newPriceId: string): Promise<Stripe.Subscription>;
  retrieveIdentityVerificationSession(sessionId: string): Promise<IIdentityVerificationReport>;
  createConnectAccount(input: ICreateConnectAccountInput): Promise<IConnectAccountResponse>;
  getCustomerInvoices(customerId: string, limit?: number): Promise<Stripe.Invoice[]>;
  payInvoice(invoiceId: string, opts?: { paymentMethod?: string }): Promise<void>;
  createDashboardLoginLink(accountId: string): Promise<IOnboardingLinkResponse>;
  createInvoice(input: ICreateInvoiceInput): Promise<ICreateInvoiceResponse>;
  cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  finalizeInvoice(invoiceId: string): Promise<IFinalizeInvoiceResponse>;
  getSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  getPayoutSchedule(accountId: string): Promise<IPayoutSchedule>;
  getCustomer(customerId: string): Promise<Stripe.Customer>;
  getCharge(chargeId: string): Promise<Stripe.Charge>;
  getConnectAccount(accountId: string): Promise<any>;
  voidInvoice(invoiceId: string): Promise<void>;
  getInvoice(invoiceId: string): Promise<any>;
  getProducts(): Promise<Stripe.Product[]>;
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
  prefill?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    companyName?: string;
  };
  businessType: 'individual' | 'company';
  metadata?: Record<string, string>;
  country: string;
  email: string;
  cuid: string;
}

export interface ICreateInvoiceInput {
  lineItems: Array<{
    description: string;
    amountInCents: number;
  }>;
  applicationFeeAmountInCents: number;
  connectedAccountId: string;
  tenantCustomerId: string;
  paymentMethodId?: string;
  autoChargeDueDate: Date;
  description: string;
  leaseUid?: string;
  currency: string;
  cuid: string;
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
export interface ICreateIdentitySessionInput {
  allowedTypes?: Array<'driving_license' | 'passport' | 'id_card'>;
  metadata?: Record<string, string>;
  returnUrl: string;
  email?: string;
}

export interface ICreateCustomerInput {
  metadata?: Record<string, string>;
  provider: IPaymentGatewayProvider;
  connectedAccountId?: string;
  email: string;
  name?: string;
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

export interface IPayoutSchedule {
  interval: 'manual' | 'daily' | 'weekly' | 'monthly';
  monthlyAnchor?: number;
  weeklyAnchor?: string;
  delayDays?: number;
}

export interface IIdentityVerificationReport {
  issuingCountry?: string;
  documentType?: string;
  status: string;
}

export interface IFinalizeInvoiceResponse {
  hostedInvoiceUrl?: string;
  invoiceId: string;
  status: string;
}

export interface IIdentitySessionResponse {
  sessionId: string;
  url: string;
}

export interface IOnboardingLinkResponse {
  url: string;
}
