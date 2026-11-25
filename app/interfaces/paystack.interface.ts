/**
 * Raw Paystack API shapes (https://paystack.com/docs/api). Amounts are in kobo — the same
 * whole-number minor units the app already uses for cents. Only the fields the app reads are
 * typed; Paystack returns more.
 */

export interface IPaystackInitializeInput {
  metadata?: Record<string, unknown>;
  bearer?: 'account' | 'subaccount'; // who pays Paystack's fee
  transaction_charge?: number; // kobo kept by the platform when a subaccount is set
  callback_url?: string;
  subaccount?: string; // ACCT_… — settles to the landlord; omitted for platform-held funds
  reference: string;
  currency: 'NGN';
  amount: number; // kobo
  email: string;
}

export interface IPaystackTransaction {
  metadata?: Record<string, unknown> | string | null;
  subaccount?: { subaccount_code?: string } | null;
  authorization?: IPaystackAuthorization;
  status: PaystackTransactionStatus;
  customer?: { email: string };
  gateway_response?: string;
  paid_at?: string | null;
  fees?: number | null; // kobo
  reference: string;
  currency: string;
  amount: number; // kobo
  id: number;
}

export interface IPaystackChargeAuthorizationInput {
  bearer?: 'account' | 'subaccount';
  transaction_charge?: number;
  authorization_code: string;
  subaccount?: string;
  metadata?: string; // stringified JSON here, unlike initialize which takes an object
  reference: string;
  currency: 'NGN';
  amount: number; // kobo
  email: string;
}

export interface IPaystackCreateSubaccountInput {
  primary_contact_email?: string;
  // 0: the platform's share is sent per charge as transaction_charge instead
  percentage_charge: number;
  settlement_bank: string; // bank code
  account_number: string;
  business_name: string;
  description?: string;
}

export interface IPaystackBank {
  supports_transfer?: boolean; // vendor payouts (transfers) need this
  is_deleted?: boolean;
  currency: string;
  active: boolean;
  name: string;
  code: string; // the bank code used for account resolve, subaccounts and transfers
  slug: string;
}

/** A saved card. Only `reusable` authorizations can be charged again. */
export interface IPaystackAuthorization {
  authorization_code: string; // AUTH_…
  card_type?: string;
  exp_month?: string;
  reusable: boolean;
  exp_year?: string;
  channel: string; // 'card', 'bank', 'ussd', …
  last4?: string;
  bank?: string;
}

export interface IPaystackRefund {
  transaction?: { id: number; reference: string } | number;
  currency: string;
  status: string; // 'pending' | 'processing' | 'processed' | 'failed' …
  amount: number; // kobo
  id: number;
}

export interface IPaystackSubaccount {
  percentage_charge: number;
  subaccount_code: string; // ACCT_…
  settlement_bank: string;
  account_number: string;
  business_name: string;
  active?: boolean;
}

export interface IPaystackCreateRefundInput {
  merchant_note?: string;
  transaction: string; // the transaction reference (or id)
  amount?: number; // kobo; omitted = full refund
}

/** Every Paystack response is wrapped in this envelope. */
export interface IPaystackResponse<T> {
  meta?: { next?: string | null }; // list endpoints with use_cursor=true
  status: boolean;
  message: string;
  data: T;
}

export type PaystackTransactionStatus =
  | 'success'
  | 'failed'
  | 'abandoned'
  | 'ongoing'
  | 'pending'
  | 'processing'
  | 'queued'
  | 'reversed';

export interface IPaystackInitializeResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/** Changes the bank a subaccount settles to; the subaccount code (ACCT_…) stays the same. */
export interface IPaystackUpdateSubaccountInput {
  settlement_bank: string; // bank code
  account_number: string;
}

/** Webhook body: `event` is e.g. 'charge.success', 'refund.processed', 'transfer.success'. */
export interface IPaystackWebhookEvent<T = Record<string, unknown>> {
  event: string;
  data: T;
}

export interface IPaystackResolvedAccount {
  account_number: string;
  account_name: string;
}
