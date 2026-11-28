import crypto from 'crypto';
import { t } from '@shared/languages';
import { envVariables } from '@shared/config';
import { PaystackCache } from '@caching/paystack.cache';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { FeatureFlagService } from '@services/featureFlag/featureFlag.service';
import { CircuitBreakerOpenError, CircuitBreaker, createLogger } from '@utils/index';
import {
  ServiceUnavailableError,
  InternalServerError,
  UnauthorizedError,
  BadRequestError,
  ForbiddenError,
} from '@shared/customErrors';
import {
  IPaystackChargeAuthorizationInput,
  IPaystackCreateSubaccountInput,
  IPaystackUpdateSubaccountInput,
  IPaystackCreateRefundInput,
  IPaystackInitializeResult,
  IPaystackInitializeInput,
  IPaystackResolvedAccount,
  IPaystackWebhookEvent,
  IPaystackTransaction,
  IPaystackSubaccount,
  IPaystackResponse,
  IPaystackRefund,
  IPaystackBank,
} from '@interfaces/paystack.interface';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Thin client for the Paystack REST API (Nigerian accounts: rent, maintenance charges,
 * payouts — never subscriptions, which stay on Stripe). Payment code reaches it only through
 * PaymentGatewayService. Amounts are kobo, the same whole-number minor units as cents.
 *
 * Errors: Paystack rejecting a request (4xx) → BadRequestError with Paystack's message;
 * Paystack being down, slow or unreachable (5xx, timeout, network) → ServiceUnavailableError,
 * which is also what trips the circuit breaker.
 */
export class PaystackService {
  private readonly log = createLogger('PaystackService');
  private readonly featureFlagService: FeatureFlagService;
  private readonly paystackCache: PaystackCache;
  private readonly breaker: CircuitBreaker;

  constructor({
    featureFlagService,
    paystackCache,
  }: {
    featureFlagService: FeatureFlagService;
    paystackCache: PaystackCache;
  }) {
    this.featureFlagService = featureFlagService;
    this.paystackCache = paystackCache;
    this.breaker = new CircuitBreaker({
      name: 'paystack',
      failureThreshold: 5,
      cooldownMs: 60_000,
      // Only Paystack's own failures count; a bad request from us shouldn't open the circuit
      isFailure: (err) => err instanceof ServiceUnavailableError,
      logger: this.log,
    });
  }

  // ── Banks and payout accounts ──────────────────────────────────────────────

  /**
   * Every Nigerian bank, cached for a day (the list rarely changes). Paystack pages the list,
   * so a cache miss follows the cursor to the end.
   */
  async listBanks(): Promise<IPaystackBank[]> {
    this.assertEnabled();
    const cached = await this.paystackCache.getBanks();
    if (cached.success && cached.data) {
      return cached.data;
    }

    const banks: IPaystackBank[] = [];
    let cursor: string | null | undefined;
    do {
      const query = new URLSearchParams({
        country: 'nigeria',
        currency: 'NGN',
        use_cursor: 'true',
        perPage: '100',
      });
      if (cursor) query.set('next', cursor);
      const page = await this.requestWithMeta<IPaystackBank[]>('GET', `/bank?${query.toString()}`);
      // Paystack still lists removed banks, flagged is_deleted
      banks.push(...page.data.filter((bank) => !bank.is_deleted));
      cursor = page.meta?.next;
    } while (cursor);

    await this.paystackCache.cacheBanks(banks);
    return banks;
  }

  /** The account holder's name for a bank account — shown to the user to confirm it. */
  async resolveAccount(accountNumber: string, bankCode: string): Promise<IPaystackResolvedAccount> {
    const query = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
    return this.request<IPaystackResolvedAccount>('GET', `/bank/resolve?${query.toString()}`);
  }

  async createSubaccount(input: IPaystackCreateSubaccountInput): Promise<IPaystackSubaccount> {
    return this.request<IPaystackSubaccount>('POST', '/subaccount', input);
  }

  async updateSubaccount(
    subaccountCode: string,
    input: IPaystackUpdateSubaccountInput
  ): Promise<IPaystackSubaccount> {
    return this.request<IPaystackSubaccount>(
      'PUT',
      `/subaccount/${encodeURIComponent(subaccountCode)}`,
      input
    );
  }

  async fetchSubaccount(subaccountCode: string): Promise<IPaystackSubaccount> {
    return this.request<IPaystackSubaccount>(
      'GET',
      `/subaccount/${encodeURIComponent(subaccountCode)}`
    );
  }

  // ── Card payments ──────────────────────────────────────────────────────────

  /** Starts a hosted checkout; the tenant is sent to `authorization_url`. */
  async initializeTransaction(input: IPaystackInitializeInput): Promise<IPaystackInitializeResult> {
    return this.request<IPaystackInitializeResult>('POST', '/transaction/initialize', input);
  }

  async verifyTransaction(reference: string): Promise<IPaystackTransaction> {
    return this.request<IPaystackTransaction>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`
    );
  }

  /** Charges a saved (reusable) card. The result can be 'success', 'failed' or still pending. */
  async chargeAuthorization(
    input: IPaystackChargeAuthorizationInput
  ): Promise<IPaystackTransaction> {
    return this.request<IPaystackTransaction>('POST', '/transaction/charge_authorization', input);
  }

  // ── Refunds ────────────────────────────────────────────────────────────────

  async createRefund(input: IPaystackCreateRefundInput): Promise<IPaystackRefund> {
    return this.request<IPaystackRefund>('POST', '/refund', input);
  }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  /**
   * Checks the `x-paystack-signature` header: HMAC-SHA512 (hex) of the raw request body, keyed
   * with the secret key. Returns the parsed event, or throws UnauthorizedError.
   */
  verifyWebhookSignature(rawBody: Buffer | string, signature?: string): IPaystackWebhookEvent {
    this.assertEnabled();
    const secretKey = envVariables.PAYSTACK.SECRET_KEY;
    if (!secretKey || !signature) {
      this.log.warn(
        { hasSignature: !!signature },
        'Paystack webhook rejected: missing signature or key'
      );
      throw new UnauthorizedError({ message: t('payment.errors.invalidWebhook') });
    }

    const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const receivedBuffer = Buffer.from(signature, 'utf8');
    const matches =
      expectedBuffer.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    if (!matches) {
      this.log.warn('Paystack webhook rejected: signature mismatch');
      throw new UnauthorizedError({ message: t('payment.errors.invalidWebhook') });
    }

    try {
      return JSON.parse(rawBody.toString()) as IPaystackWebhookEvent;
    } catch {
      this.log.warn('Paystack webhook rejected: signed body is not valid JSON');
      throw new BadRequestError({ message: t('payment.errors.invalidWebhook') });
    }
  }

  private assertEnabled(): void {
    if (!this.featureFlagService.isEnabled(FeatureFlag.PAYSTACK)) {
      throw new ForbiddenError({ message: t('payment.errors.onlinePaymentsUnavailable') });
    }
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown
  ): Promise<T> {
    const payload = await this.requestWithMeta<T>(method, path, body);
    return payload.data;
  }

  /** The whole response, for list endpoints that page with `meta.next`. */
  private async requestWithMeta<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown
  ): Promise<IPaystackResponse<T>> {
    this.assertEnabled();

    try {
      return await this.sendRequest<T>(method, path, body);
    } catch (error) {
      // Too many recent outages: fail fast as an outage, not as a bad request
      if (error instanceof CircuitBreakerOpenError) {
        throw new ServiceUnavailableError({
          message: t('payment.errors.serviceUnavailable'),
          originalError: error,
        });
      }
      throw error;
    }
  }

  private async sendRequest<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown
  ): Promise<IPaystackResponse<T>> {
    return this.breaker.exec(async () => {
      let response: Response;
      try {
        response = await fetch(`${envVariables.PAYSTACK.BASE_URL}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${envVariables.PAYSTACK.SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          ...(body !== undefined && { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        this.log.error({ error, method, path }, 'Paystack request failed to reach the API');
        throw new ServiceUnavailableError({
          message: t('payment.errors.serviceUnavailable'),
          originalError: error as Error,
        });
      }

      const payload = (await response.json().catch(() => null)) as IPaystackResponse<T> | null;

      // A 429 is Paystack asking us to back off: an outage for the caller, and it trips the breaker
      if (response.status >= 500 || response.status === 429) {
        this.log.error({ status: response.status, method, path }, 'Paystack server error');
        throw new ServiceUnavailableError({
          message: t('payment.errors.serviceUnavailable'),
        });
      }
      // Our secret key was refused: a configuration problem, never the user's fault
      if (response.status === 401 || response.status === 403) {
        this.log.error(
          { status: response.status, method, path, message: payload?.message },
          'Paystack refused the API key — check PAYSTACK_SECRET_KEY'
        );
        throw new InternalServerError({ message: t('payment.errors.serviceUnavailable') });
      }
      if (!response.ok || !payload?.status) {
        this.log.warn(
          { status: response.status, method, path, message: payload?.message },
          'Paystack rejected the request'
        );
        // Paystack's own message stays in the logs; users get a neutral one
        throw new BadRequestError({ message: t('payment.errors.requestRejected') });
      }

      return payload;
    });
  }
}
