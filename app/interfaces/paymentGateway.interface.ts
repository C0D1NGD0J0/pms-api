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
  createCheckoutSession(data: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<ICheckoutSession>;
  createCustomer(data: {
    email: string;
    metadata?: Record<string, string>;
  }): Promise<IPaymentCustomer>;
  verifyWebhookSignature(payload: string | Buffer<ArrayBufferLike>, signature: string): unknown;
  cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  getSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  getCustomer(customerId: string): Promise<Stripe.Customer>;
  getProducts(): Promise<Stripe.Product[]>;
}

export interface ICheckoutSession {
  provider: IPaymentGatewayProvider;
  metadata?: Record<string, string>;
  redirectUrl: string; // redirect URL for payment
  customerId: string;
  sessionId: string;
}

export interface ICreateCheckoutInput {
  provider: IPaymentGatewayProvider;
  metadata?: Record<string, string>;
  customerId: string;
  successUrl: string;
  cancelUrl: string;
  priceId: string;
}

export interface IPaymentCustomer {
  provider: IPaymentGatewayProvider;
  metadata?: Record<string, string>;
  customerId: string;
  createdAt?: Date;
  email: string;
}

export interface ICreateCustomerInput {
  metadata?: Record<string, string>;
  provider: IPaymentGatewayProvider;
  email: string;
  name?: string;
}
