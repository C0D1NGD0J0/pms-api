import crypto from 'crypto';
import { t } from '@shared/languages';
import { envVariables } from '@shared/config';
import { PaystackService } from '@services/external/paystack/paystack.service';
import {
  ServiceUnavailableError,
  UnauthorizedError,
  BadRequestError,
  ForbiddenError,
} from '@shared/customErrors';

const SECRET = 'sk_test_dummy';

// Shaped like Paystack's documented responses (https://paystack.com/docs/api)
const fixtures = {
  initialize: {
    status: true,
    message: 'Authorization URL created',
    data: {
      authorization_url: 'https://checkout.paystack.com/0peioxfhpn',
      access_code: '0peioxfhpn',
      reference: 'psk_PYT123_1',
    },
  },
  resolve: {
    status: true,
    message: 'Account number resolved',
    data: { account_number: '0001234567', account_name: 'Doe Jane Mary', bank_id: 9 },
  },
  invalidKey: { status: false, message: 'Invalid key' },
};

// In-memory stand-in for the Redis bank-list cache
const makeBankCache = () => {
  let stored: unknown[] | null = null;
  return {
    getBanks: jest.fn(async () =>
      stored ? { success: true, data: stored } : { success: false, data: null }
    ),
    cacheBanks: jest.fn(async (banks: unknown[]) => {
      stored = banks;
      return { success: true, data: null };
    }),
  };
};

const jsonResponse = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

describe('PaystackService', () => {
  let fetchMock: jest.SpyInstance;
  let flagEnabled: boolean;
  let service: PaystackService;
  let bankCache: ReturnType<typeof makeBankCache>;
  const original = { ...envVariables.PAYSTACK };

  beforeEach(() => {
    flagEnabled = true;
    envVariables.PAYSTACK.SECRET_KEY = SECRET;
    envVariables.PAYSTACK.BASE_URL = 'https://api.paystack.co';
    fetchMock = jest.spyOn(global, 'fetch');
    bankCache = makeBankCache();
    service = new PaystackService({
      featureFlagService: { isEnabled: () => flagEnabled } as any,
      paystackCache: bankCache as any,
    });
  });

  afterEach(() => {
    fetchMock.mockRestore();
    Object.assign(envVariables.PAYSTACK, original);
  });

  describe('requests', () => {
    it('posts the checkout with the secret key, amount in kobo and the landlord subaccount', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, fixtures.initialize));

      const result = await service.initializeTransaction({
        amount: 120_000_000, // ₦1,200,000
        email: 'tenant@example.com',
        currency: 'NGN',
        reference: 'psk_PYT123_1',
        subaccount: 'ACCT_landlord',
        transaction_charge: 1_800_000,
        bearer: 'account',
      });

      expect(result.authorization_url).toBe('https://checkout.paystack.com/0peioxfhpn');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.paystack.co/transaction/initialize');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe(`Bearer ${SECRET}`);
      expect(JSON.parse(init.body)).toMatchObject({
        amount: 120_000_000,
        subaccount: 'ACCT_landlord',
        transaction_charge: 1_800_000,
      });
    });

    it('changes a subaccount bank with a PUT to the same subaccount code', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          status: true,
          message: 'Subaccount updated',
          data: { subaccount_code: 'ACCT_landlord1', settlement_bank: 'Access Bank', active: true },
        })
      );

      await service.updateSubaccount('ACCT_landlord1', {
        settlement_bank: '044',
        account_number: '9876543210',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.paystack.co/subaccount/ACCT_landlord1');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({
        settlement_bank: '044',
        account_number: '9876543210',
      });
    });

    it('resolves an account with an encoded query string and no body', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, fixtures.resolve));

      const account = await service.resolveAccount('0001234567', '058');

      expect(account.account_name).toBe('Doe Jane Mary');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://api.paystack.co/bank/resolve?account_number=0001234567&bank_code=058'
      );
      expect(init.body).toBeUndefined();
    });

    it('follows the bank list pages to the end', async () => {
      const bank = (code: string) => ({
        name: `Bank ${code}`,
        code,
        slug: code,
        currency: 'NGN',
        active: true,
      });
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(200, {
            status: true,
            message: 'ok',
            data: [bank('058')],
            meta: { next: 'YmFua186OTk=' },
          })
        )
        .mockResolvedValueOnce(
          jsonResponse(200, {
            status: true,
            message: 'ok',
            data: [bank('044')],
            meta: { next: null },
          })
        );

      const banks = await service.listBanks();

      expect(banks.map((b) => b.code)).toEqual(['058', '044']);
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.paystack.co/bank?country=nigeria&currency=NGN&use_cursor=true&perPage=100'
      );
      expect(fetchMock.mock.calls[1][0]).toContain('&next=YmFua186OTk%3D');
    });

    it('leaves out banks Paystack has marked as deleted', async () => {
      const banks = [
        { name: 'GTBank', code: '058', slug: 'gtb', currency: 'NGN', active: true },
        {
          name: 'Old Bank',
          code: '999',
          slug: 'old',
          currency: 'NGN',
          active: false,
          is_deleted: true,
        },
      ];
      fetchMock.mockResolvedValue(jsonResponse(200, { status: true, message: 'ok', data: banks }));

      const result = await service.listBanks();

      expect(result.map((bank) => bank.code)).toEqual(['058']);
    });

    it('serves the bank list from the cache after the first load', async () => {
      const banks = [{ name: 'GTBank', code: '058', slug: 'gtb', currency: 'NGN', active: true }];
      fetchMock.mockResolvedValue(jsonResponse(200, { status: true, message: 'ok', data: banks }));

      await service.listBanks();
      const second = await service.listBanks();

      expect(second).toEqual(banks);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(bankCache.cacheBanks).toHaveBeenCalledWith(banks);
    });

    it('does not serve cached banks while the Paystack switch is off', async () => {
      await bankCache.cacheBanks([{ code: '058' }]);
      flagEnabled = false;

      await expect(service.listBanks()).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('is refused while the Paystack switch is off, without calling Paystack', async () => {
      flagEnabled = false;

      await expect(service.listBanks()).rejects.toBeInstanceOf(ForbiddenError);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('errors', () => {
    it("turns a rejected request into a neutral BadRequestError, never Paystack's message", async () => {
      fetchMock.mockResolvedValue(jsonResponse(401, fixtures.invalidKey));

      await expect(service.listBanks()).rejects.toMatchObject({
        constructor: BadRequestError,
        message: t('payment.errors.requestRejected'),
      });
    });

    it('turns a Paystack server error or an unreachable API into ServiceUnavailableError', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(502, null));
      await expect(service.listBanks()).rejects.toBeInstanceOf(ServiceUnavailableError);

      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(service.listBanks()).rejects.toBeInstanceOf(ServiceUnavailableError);
    });

    it('opens the circuit after repeated outages, but not for rejected requests', async () => {
      fetchMock.mockResolvedValue(jsonResponse(400, { status: false, message: 'Bad bank' }));
      for (let i = 0; i < 6; i++) {
        await expect(service.listBanks()).rejects.toBeInstanceOf(BadRequestError);
      }

      fetchMock.mockResolvedValue(jsonResponse(503, null));
      for (let i = 0; i < 5; i++) {
        await expect(service.listBanks()).rejects.toBeInstanceOf(ServiceUnavailableError);
      }
      fetchMock.mockClear();
      await expect(service.listBanks()).rejects.toThrow(/Circuit breaker "paystack" is open/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('verifyWebhookSignature', () => {
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'psk_PYT123_1' } });
    const sign = (raw: string, key = SECRET) =>
      crypto.createHmac('sha512', key).update(raw).digest('hex');

    it('accepts a body signed with the secret key and returns the event', () => {
      const event = service.verifyWebhookSignature(Buffer.from(body), sign(body));
      expect(event).toEqual({ event: 'charge.success', data: { reference: 'psk_PYT123_1' } });
    });

    it('rejects a tampered body, a wrong key or a missing signature', () => {
      const tampered = body.replace('psk_PYT123_1', 'psk_PYT999_1');
      expect(() => service.verifyWebhookSignature(tampered, sign(body))).toThrow(UnauthorizedError);
      expect(() => service.verifyWebhookSignature(body, sign(body, 'sk_other'))).toThrow(
        UnauthorizedError
      );
      expect(() => service.verifyWebhookSignature(body, undefined)).toThrow(UnauthorizedError);
    });

    it('refuses webhooks while the Paystack switch is off, even when correctly signed', () => {
      flagEnabled = false;

      expect(() => service.verifyWebhookSignature(body, sign(body))).toThrow(ForbiddenError);
    });
  });
});
