import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { envVariables } from '@shared/config';
import { FinancialCalculator } from '@utils/financial';
import { IPaymentGatewayProvider } from '@interfaces/index';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { IPayoutSchedule } from '@interfaces/paymentGateway.interface';
import { PaymentProcessorDAO, ProfileDAO, ClientDAO, VendorDAO } from '@dao/index';
import { IPromiseReturnedData, ISuccessReturnData } from '@interfaces/utils.interface';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import {
  PaymentProcessorAccountType,
  IPayoutAccountDetails,
} from '@interfaces/paymentProcessor.interface';
import {
  getCountryCodeFromLocation,
  INSTANT_PAYOUT_MAX_CENTS,
  INSTANT_PAYOUT_COUNTRIES,
  getPaymentProcessorUrls,
  createLogger,
  Weekday,
} from '@utils/index';

export interface IInstantPayoutQuote {
  reason?: InstantPayoutIneligibleReason;
  destination?: string;
  /** Instant-eligible balance before the platform fee, in cents */
  available: number;
  currency?: string;
  eligible: boolean;
  /** True when the balance is above Stripe's per-payout maximum; the rest goes out weekly */
  capped?: boolean;
  /** What reaches the bank, in cents */
  net: number;
  fee: number;
}

export type InstantPayoutIneligibleReason =
  | 'country_not_supported'
  | 'payouts_not_enabled'
  | 'payouts_blocked'
  | 'payouts_paused'
  | 'open_disputes'
  | 'no_instant_balance'
  | 'pricing_unavailable';

interface IStripePayoutEntry {
  application_fee_amount?: number | null;
  description?: string | null;
  arrival_date: number;
  currency: string;
  method?: string;
  created: number;
  amount: number;
  status: string;
  id: string;
}

interface IStripeInstantBalanceEntry extends IStripeBalanceEntry {
  /** Present only when the platform sets instant payout pricing (Platform Pricing Tool) */
  net_available?: { amount: number; destination: string }[];
}

interface IConstructor {
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  vendorDAO: VendorDAO;
}

interface IStripeBalanceData {
  instant_available?: IStripeInstantBalanceEntry[];
  available: IStripeBalanceEntry[];
  pending: IStripeBalanceEntry[];
}

interface IStripePayoutList {
  data: IStripePayoutEntry[];
  has_more: boolean;
}

interface IStripeBalanceEntry {
  currency: string;
  amount: number;
}

export class PayoutAccountService {
  private readonly log: Logger;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly clientDAO: ClientDAO;
  private readonly vendorDAO: VendorDAO;

  constructor({
    paymentGatewayService,
    paymentProcessorDAO,
    profileDAO,
    clientDAO,
    vendorDAO,
  }: IConstructor) {
    this.log = createLogger('PayoutAccountService');
    this.paymentGatewayService = paymentGatewayService;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.profileDAO = profileDAO;
    this.clientDAO = clientDAO;
    this.vendorDAO = vendorDAO;
  }

  private async getProcessorOrThrow(cuid: string) {
    const processor = await this.paymentProcessorDAO.findFirst({
      cuid,
      ownerType: 'client',
      deletedAt: null,
    });
    if (!processor?.accountId) {
      throw new BadRequestError({ message: t('payment.payout.errors.notConfigured') });
    }
    return processor;
  }

  /** Logs the provider's own message and gives the user a neutral one that doesn't name the provider. */
  private providerError(
    providerMessage: string | undefined,
    userMessageKey: string,
    context: Record<string, unknown>
  ): BadRequestError {
    this.log.warn({ ...context, providerMessage }, 'Payout provider request failed');
    return new BadRequestError({ message: t(userMessageKey) });
  }

  /** Dashboard links, balance, payout history, schedule and instant payouts only exist on Stripe. */
  private async getStripeProcessorOrThrow(cuid: string) {
    const processor = await this.getProcessorOrThrow(cuid);
    if (processor.provider === 'paystack') {
      throw new BadRequestError({
        message: t('payment.payout.errors.notAvailableForAccount'),
      });
    }
    return processor;
  }

  /** Bank-account payout setup is for accounts that collect through Paystack (Nigeria). */
  private async assertPaystackClient(cuid: string): Promise<void> {
    const provider = await this.paymentGatewayService.getProviderForClient(cuid);
    if (provider !== IPaymentGatewayProvider.PAYSTACK) {
      throw new BadRequestError({
        message: t('payment.payout.errors.bankSetupNotAvailable'),
      });
    }
  }

  private async getOnboardingOrUpdateLink(
    cuid: string,
    type: 'onboarding' | 'update',
    urls: { refreshUrl: string; returnUrl: string }
  ): Promise<ISuccessReturnData<{ url: string }>> {
    try {
      const paymentProcessor = await this.getStripeProcessorOrThrow(cuid);

      const baseUrl = envVariables.FRONTEND.URL || 'http://localhost:3000';
      const fallback = getPaymentProcessorUrls(baseUrl, cuid);
      const returnUrl =
        urls.returnUrl ||
        (type === 'onboarding' ? fallback.kycReturnUrl : fallback.accountUpdateReturnUrl);
      const refreshUrl = urls.refreshUrl || fallback.refreshUrl;

      const linkResult = await this.paymentGatewayService.createKycOnboardingLink(
        IPaymentGatewayProvider.STRIPE,
        {
          accountId: paymentProcessor.accountId,
          refreshUrl,
          returnUrl,
        }
      );

      if (!linkResult.success || !linkResult.data) {
        throw this.providerError(linkResult.message, 'payment.payout.errors.linkFailed', {
          cuid,
          type,
        });
      }

      const message =
        type === 'onboarding'
          ? t('payment.payout.success.onboardingLinkCreated')
          : t('payment.payout.success.updateLinkCreated');

      return { success: true, data: { url: linkResult.data.url }, message };
    } catch (error) {
      const label = type === 'onboarding' ? 'onboarding' : 'account update';
      this.log.error(`Error creating ${label} link`, error);
      throw error;
    }
  }

  async createConnectAccount(
    cuid: string,
    data: { email: string; country: string }
  ): IPromiseReturnedData<any> {
    try {
      // Vendor processors carry the inviting client's cuid too — only the client's own counts
      const existingProcessor = await this.paymentProcessorDAO.findFirst({
        cuid,
        ownerType: 'client',
      });
      if (existingProcessor?.accountId) {
        throw new BadRequestError({ message: t('payment.payout.errors.alreadyExists') });
      }

      const provider = await this.paymentGatewayService.getProviderForClient(cuid);
      if (provider === IPaymentGatewayProvider.PAYSTACK) {
        throw new BadRequestError({
          message: t('payment.payout.errors.useBankAccountSetup'),
        });
      }

      const client = await this.clientDAO.findFirst({ cuid });
      if (!client) {
        throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Client' }) });
      }

      const adminProfile = client.accountAdmin
        ? await this.profileDAO.findFirst({ user: client.accountAdmin as Types.ObjectId })
        : null;

      const isEnterprise = client.accountType.isEnterpriseAccount;
      const serviceAgreement = (INSTANT_PAYOUT_COUNTRIES as readonly string[]).includes(
        data.country
      )
        ? 'full'
        : 'recipient';
      const accountResult = await this.paymentGatewayService.createConnectAccount(
        IPaymentGatewayProvider.STRIPE,
        {
          cuid,
          email: data.email,
          country: data.country,
          serviceAgreement,
          businessType: isEnterprise ? 'company' : 'individual',
          metadata: { cuid },
          prefill: {
            firstName: adminProfile?.personalInfo?.firstName,
            lastName: adminProfile?.personalInfo?.lastName,
            phone: adminProfile?.personalInfo?.phoneNumber,
            companyName: isEnterprise
              ? client.companyProfile?.tradingName || client.companyProfile?.legalEntityName
              : undefined,
          },
        }
      );
      if (!accountResult.success || !accountResult.data) {
        throw this.providerError(accountResult.message, 'payment.payout.errors.setupFailed', {
          cuid,
        });
      }

      await this.paymentProcessorDAO.insert({
        cuid,
        serviceAgreement,
        client: client._id,
        accountId: accountResult.data.accountId,
        chargesEnabled: accountResult.data.chargesEnabled || false,
        payoutsEnabled: accountResult.data.payoutsEnabled || false,
        detailsSubmitted: accountResult.data.detailsSubmitted || false,
      });

      return {
        success: true,
        data: {
          accountId: accountResult.data.accountId,
          chargesEnabled: accountResult.data.chargesEnabled,
          payoutsEnabled: accountResult.data.payoutsEnabled,
          detailsSubmitted: accountResult.data.detailsSubmitted,
        },
        message: t('payment.payout.success.accountCreated'),
      };
    } catch (error) {
      this.log.error('Error creating Connect account', error);
      throw error;
    }
  }

  /** The landlord's payout account for the payment settings page, or null when none is set up. */
  async getPayoutAccountDetails(cuid: string): IPromiseReturnedData<IPayoutAccountDetails | null> {
    const processor = await this.paymentProcessorDAO.findFirst({
      cuid,
      ownerType: 'client',
      deletedAt: null,
    });
    if (!processor?.accountId) {
      return { success: true, data: null };
    }

    return {
      success: true,
      data: {
        provider: processor.provider ?? 'stripe',
        accountIdLast4: processor.accountId.slice(-4),
        chargesEnabled: processor.chargesEnabled,
        payoutsEnabled: processor.payoutsEnabled,
        onboardedAt: processor.onboardedAt ?? null,
        bank: processor.bankDetails
          ? {
              bankName: processor.bankDetails.bankName,
              accountName: processor.bankDetails.accountName,
              accountNumberLast4: processor.bankDetails.accountNumberLast4,
            }
          : null,
      },
    };
  }

  // ── Paystack (Nigerian accounts) ─────────────────────────────────────────────
  // The landlord picks a bank and enters an account number; the app checks the account name
  // with Paystack, then creates a Paystack subaccount that rent settles into.

  /** Active Nigerian banks for the payout form. */
  async listPayoutBanks(cuid: string): IPromiseReturnedData<{ name: string; code: string }[]> {
    await this.assertPaystackClient(cuid);
    const banks = await this.paymentGatewayService.listBanks();
    const data = banks
      .filter((bank) => bank.active)
      .map((bank) => ({ name: bank.name, code: bank.code }));
    return { success: true, data };
  }

  /** The account holder's name, shown to the landlord to confirm before saving. */
  async resolvePayoutBankAccount(
    cuid: string,
    data: { bankCode: string; accountNumber: string }
  ): IPromiseReturnedData<{ accountName: string }> {
    await this.assertPaystackClient(cuid);
    const account = await this.resolveBankAccountOrThrow(cuid, data);
    return { success: true, data: { accountName: account.account_name } };
  }

  /** A failed account check becomes "we couldn't verify this bank account"; outages pass through. */
  private async resolveBankAccountOrThrow(
    cuid: string,
    data: { bankCode: string; accountNumber: string }
  ) {
    try {
      return await this.paymentGatewayService.resolveBankAccount(data.accountNumber, data.bankCode);
    } catch (error) {
      if (error instanceof BadRequestError) {
        this.log.warn({ cuid, bankCode: data.bankCode }, 'Bank account could not be verified');
        throw new BadRequestError({ message: t('payment.payout.errors.accountNotVerified') });
      }
      throw error;
    }
  }

  async createPaystackPayoutAccount(
    cuid: string,
    data: { bankCode: string; accountNumber: string }
  ): IPromiseReturnedData<{
    accountNumberLast4: string;
    accountName: string;
    accountId: string;
    bankName: string;
  }> {
    try {
      await this.assertPaystackClient(cuid);

      const existingProcessor = await this.paymentProcessorDAO.findFirst({
        cuid,
        ownerType: 'client',
      });
      if (existingProcessor?.accountId) {
        throw new BadRequestError({ message: t('payment.payout.errors.alreadyExists') });
      }

      const client = await this.clientDAO.findFirst({ cuid });
      if (!client) {
        throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Client' }) });
      }

      const banks = await this.paymentGatewayService.listBanks();
      const bank = banks.find((entry) => entry.code === data.bankCode && entry.active);
      if (!bank) {
        throw new BadRequestError({ message: t('payment.payout.errors.chooseBankFromList') });
      }

      // Checked again here rather than trusting the name the form showed
      const account = await this.resolveBankAccountOrThrow(cuid, data);

      const subaccount = await this.paymentGatewayService.createPayoutSubaccount({
        business_name:
          client.companyProfile?.tradingName ||
          client.companyProfile?.legalEntityName ||
          client.displayName,
        settlement_bank: data.bankCode,
        account_number: data.accountNumber,
        // The platform fee is taken per charge (transaction_charge), not as a fixed share
        percentage_charge: 0,
        description: `PropertyDesk client ${cuid}`,
      });

      const bankDetails = {
        bankCode: bank.code,
        bankName: bank.name,
        accountName: account.account_name,
        accountNumberLast4: data.accountNumber.slice(-4),
      };
      const isActive = subaccount.active !== false;

      await this.paymentProcessorDAO.insert({
        cuid,
        client: client._id,
        provider: 'paystack',
        accountType: PaymentProcessorAccountType.SUBACCOUNT,
        accountId: subaccount.subaccount_code,
        chargesEnabled: isActive,
        payoutsEnabled: isActive,
        detailsSubmitted: true,
        onboardedAt: new Date(),
        bankDetails,
      });

      return {
        success: true,
        data: {
          accountId: subaccount.subaccount_code,
          bankName: bankDetails.bankName,
          accountName: bankDetails.accountName,
          accountNumberLast4: bankDetails.accountNumberLast4,
        },
        message: t('payment.payout.success.bankAccountAdded'),
      };
    } catch (error) {
      this.log.error('Error creating Paystack payout account', error);
      throw error;
    }
  }

  async getKycOnboardingLink(
    cuid: string,
    urlOverrides?: { returnUrl?: string; refreshUrl?: string }
  ): IPromiseReturnedData<{ url: string }> {
    return this.getOnboardingOrUpdateLink(cuid, 'onboarding', {
      refreshUrl: urlOverrides?.refreshUrl || '',
      returnUrl: urlOverrides?.returnUrl || '',
    });
  }

  async getAccountUpdateLink(
    cuid: string,
    urlOverrides?: { returnUrl?: string; refreshUrl?: string }
  ): IPromiseReturnedData<{ url: string }> {
    return this.getOnboardingOrUpdateLink(cuid, 'update', {
      refreshUrl: urlOverrides?.refreshUrl || '',
      returnUrl: urlOverrides?.returnUrl || '',
    });
  }

  async getExternalDashboardLoginLink(cuid: string): IPromiseReturnedData<{ url: string }> {
    try {
      const paymentProcessor = await this.getStripeProcessorOrThrow(cuid);

      const linkResult = await this.paymentGatewayService.createDashboardLoginLink(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId
      );

      if (!linkResult.success || !linkResult.data) {
        throw this.providerError(linkResult.message, 'payment.payout.errors.linkFailed', { cuid });
      }

      return {
        success: true,
        data: { url: linkResult.data.url },
        message: t('payment.payout.success.dashboardLinkCreated'),
      };
    } catch (error) {
      this.log.error('Error creating login link', error);
      throw error;
    }
  }

  async getPayoutBalance(cuid: string): IPromiseReturnedData<any> {
    try {
      const paymentProcessor = await this.getStripeProcessorOrThrow(cuid);
      if (!paymentProcessor.payoutsEnabled) {
        throw new BadRequestError({ message: t('payment.payout.errors.payoutsNotEnabled') });
      }

      const result = await this.paymentGatewayService.getConnectBalance(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId
      );
      if (!result.success || !result.data) {
        throw this.providerError(result.message, 'payment.payout.errors.balanceUnavailable', {
          cuid,
        });
      }

      const balance = result.data as IStripeBalanceData;
      return {
        success: true,
        data: {
          available: balance.available.map((b) => ({ amount: b.amount, currency: b.currency })),
          pending: balance.pending.map((b) => ({ amount: b.amount, currency: b.currency })),
          instant: this.buildInstantPayoutQuote(paymentProcessor, balance),
        },
      };
    } catch (error) {
      this.log.error('Error fetching payout balance', error);
      throw error;
    }
  }

  async getPayoutHistory(
    cuid: string,
    query: { limit?: number; cursor?: string }
  ): IPromiseReturnedData<any> {
    try {
      const paymentProcessor = await this.getStripeProcessorOrThrow(cuid);
      if (!paymentProcessor.payoutsEnabled) {
        throw new BadRequestError({ message: t('payment.payout.errors.payoutsNotEnabled') });
      }

      const result = await this.paymentGatewayService.listConnectPayouts(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId,
        { limit: query.limit, starting_after: query.cursor }
      );
      if (!result.success || !result.data) {
        throw this.providerError(result.message, 'payment.payout.errors.historyUnavailable', {
          cuid,
        });
      }

      const list = result.data as IStripePayoutList;
      const payouts = list.data.map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        arrivalDate: dayjs(p.arrival_date * 1000)
          .toDate()
          .toISOString(),
        createdAt: dayjs(p.created * 1000)
          .toDate()
          .toISOString(),
        description: p.description ?? undefined,
        method: p.method === 'instant' ? 'instant' : 'standard',
        applicationFeeAmount: p.application_fee_amount ?? undefined,
      }));

      return {
        success: true,
        data: {
          payouts,
          hasMore: list.has_more,
          nextCursor: list.has_more ? list.data[list.data.length - 1]?.id : undefined,
        },
      };
    } catch (error) {
      this.log.error('Error fetching payout history', error);
      throw error;
    }
  }

  async getPayoutSchedule(cuid: string): IPromiseReturnedData<IPayoutSchedule> {
    try {
      const paymentProcessor = await this.getStripeProcessorOrThrow(cuid);

      const result = await this.paymentGatewayService.getPayoutSchedule(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId
      );
      if (!result.success || !result.data) {
        throw this.providerError(result.message, 'payment.payout.errors.scheduleUnavailable', {
          cuid,
        });
      }

      return { success: true, data: result.data };
    } catch (error) {
      this.log.error('Error fetching payout schedule', error);
      throw error;
    }
  }

  async updatePayoutSchedule(
    cuid: string,
    interval: 'weekly',
    weeklyAnchor: Weekday
  ): IPromiseReturnedData<null> {
    try {
      const paymentProcessor = await this.getStripeProcessorOrThrow(cuid);
      if (!paymentProcessor.payoutsEnabled) {
        throw new BadRequestError({ message: t('payment.payout.errors.payoutsNotEnabled') });
      }

      const result = await this.paymentGatewayService.updatePayoutSchedule(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId,
        interval,
        weeklyAnchor
      );
      if (!result.success) {
        throw this.providerError(result.message, 'payment.payout.errors.scheduleUpdateFailed', {
          cuid,
        });
      }

      await this.paymentProcessorDAO.update(
        { _id: paymentProcessor._id },
        { $set: { payoutWeeklyAnchor: weeklyAnchor } }
      );

      this.log.info({ cuid, interval, weeklyAnchor }, 'Payout schedule updated');
      return { success: true, data: null, message: t('payment.payout.success.scheduleUpdated') };
    } catch (error) {
      this.log.error('Error updating payout schedule', error);
      throw error;
    }
  }

  /**
   * Pays out the whole instant-eligible balance now. The platform fee is taken by Stripe
   * (Platform Pricing Tool), so the payout amount is Stripe's net figure — the caller can't pick
   * an amount. Eligibility is re-checked against a fresh balance on every request.
   */
  async requestInstantPayout(
    cuid: string,
    actorId: string,
    requestKey: string
  ): IPromiseReturnedData<{
    payoutId: string;
    amount: number;
    fee: number;
    currency: string;
    arrivalDate: string;
  }> {
    try {
      const paymentProcessor = await this.getStripeProcessorOrThrow(cuid);

      const balanceResult = await this.paymentGatewayService.getConnectBalance(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId
      );
      if (!balanceResult.success || !balanceResult.data) {
        throw this.providerError(
          balanceResult.message,
          'payment.payout.errors.balanceUnavailable',
          {
            cuid,
          }
        );
      }

      const quote = this.buildInstantPayoutQuote(
        paymentProcessor,
        balanceResult.data as IStripeBalanceData
      );
      if (!quote.eligible || !quote.currency) {
        throw new BadRequestError({
          message: t('payment.errors.instantPayoutUnavailable', {
            reason: t(`payment.instantPayoutReasons.${quote.reason ?? 'no_instant_balance'}`),
          }),
        });
      }

      const payoutResult = await this.paymentGatewayService.createInstantPayout(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId,
        {
          amount: quote.net,
          currency: quote.currency,
          destination: quote.destination,
          idempotencyKey: `instant-payout:${paymentProcessor.accountId}:${requestKey}`,
        }
      );
      if (!payoutResult.success || !payoutResult.data) {
        throw this.providerError(
          payoutResult.message,
          'payment.payout.errors.instantPayoutFailed',
          {
            cuid,
          }
        );
      }

      const payout = payoutResult.data;
      this.log.info(
        { cuid, actorId, payoutId: payout.payoutId, amount: quote.net, fee: quote.fee },
        'Instant payout requested'
      );

      return {
        success: true,
        data: {
          payoutId: payout.payoutId,
          amount: payout.amount,
          fee: payout.applicationFeeAmount ?? quote.fee,
          currency: payout.currency,
          arrivalDate: payout.arrivalDate.toISOString(),
        },
        message: t('payment.success.instantPayoutRequested'),
      };
    } catch (error) {
      this.log.error('Error requesting instant payout', error);
      throw error;
    }
  }

  private buildInstantPayoutQuote(
    processor: {
      disputeStats?: { open?: number };
      serviceAgreement?: string;
      payoutsEnabled: boolean;
      payoutsBlocked?: boolean;
      payoutsPaused?: boolean;
    },
    balance: IStripeBalanceData
  ): IInstantPayoutQuote {
    const ineligible = (reason: InstantPayoutIneligibleReason): IInstantPayoutQuote => ({
      eligible: false,
      available: 0,
      net: 0,
      fee: 0,
      reason,
    });

    if (processor.serviceAgreement !== 'full') return ineligible('country_not_supported');
    if (!processor.payoutsEnabled) return ineligible('payouts_not_enabled');
    if (processor.payoutsBlocked) return ineligible('payouts_blocked');
    // Paused while the subscription is inactive or past due
    if (processor.payoutsPaused) return ineligible('payouts_paused');
    // Funds released instantly can't be clawed back if a dispute is lost — losses are the platform's
    if ((processor.disputeStats?.open ?? 0) > 0) return ineligible('open_disputes');

    // Stripe lists instant balance only when the account has an eligible debit card or bank
    const instantBalance = balance.instant_available?.find((entry) => entry.amount > 0);
    if (!instantBalance) return ineligible('no_instant_balance');

    // Without platform pricing Stripe would pay out fee-free while billing the platform its cost
    const net = instantBalance.net_available?.[0];
    if (!net) return ineligible('pricing_unavailable');
    if (net.amount <= 0) return ineligible('no_instant_balance');

    const fee = instantBalance.amount - net.amount;
    const maxPayout = INSTANT_PAYOUT_MAX_CENTS[instantBalance.currency.toLowerCase()];
    if (maxPayout && net.amount > maxPayout) {
      // Stripe rejects a single instant payout above its maximum. Pay out the maximum now and
      // leave the rest for the weekly payout; the fee shown is pro-rated, and the actual fee
      // comes back on the payout (application_fee_amount).
      const cappedFee = FinancialCalculator.proportionalShare(fee, maxPayout, net.amount);
      return {
        eligible: true,
        capped: true,
        available: maxPayout + cappedFee,
        net: maxPayout,
        fee: cappedFee,
        currency: instantBalance.currency,
        destination: net.destination,
      };
    }

    return {
      eligible: true,
      available: instantBalance.amount,
      net: net.amount,
      fee,
      currency: instantBalance.currency,
      destination: net.destination,
    };
  }

  async unblockPayouts(cuid: string, userId: string): IPromiseReturnedData<null> {
    try {
      const processor = await this.getProcessorOrThrow(cuid);

      if (!processor.payoutsBlocked) {
        return { success: true, data: null, message: t('payment.payout.success.notBlocked') };
      }

      // Only allow unblocking if there are no open disputes
      if (processor.disputeStats?.open && processor.disputeStats.open > 0) {
        throw new BadRequestError({
          message: t('payment.payout.errors.openDisputes', { count: processor.disputeStats.open }),
        });
      }

      await this.paymentProcessorDAO.update(
        { _id: processor._id },
        {
          $set: {
            payoutsBlocked: false,
            payoutsBlockedReason: undefined,
            payoutsBlockedAt: undefined,
            payoutsBlockedBy: undefined,
          },
        }
      );

      this.log.info({ cuid, userId, ppuid: processor.ppuid }, 'Payouts unblocked by admin');

      return { success: true, data: null, message: t('payment.payout.success.unblocked') };
    } catch (error) {
      this.log.error('Error unblocking payouts', error);
      throw error;
    }
  }

  // ─── Vendor-scoped methods ───────────────────────────────────────────────

  async initiateVendorAccount(
    cuid: string,
    vuid: string
  ): IPromiseReturnedData<{ accountId: string }> {
    try {
      const [client, vendor] = await Promise.all([
        this.clientDAO.getClientByCuid(cuid),
        this.vendorDAO.findFirst({ vuid, cuid, deletedAt: null }),
      ]);

      if (!client) {
        throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Client' }) });
      }
      if (!vendor) {
        throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Vendor' }) });
      }

      const email = (vendor.contactPerson as any)?.email;
      if (!email) {
        throw new BadRequestError({
          message: t('payment.payout.errors.vendorEmailRequired'),
        });
      }

      // Normalize to ISO-3166-1 alpha-2: stored value may be a full name ("Canada") or already a code ("CA")
      const rawCountry: string = (vendor.address as any)?.country || '';
      const country =
        rawCountry.length === 2
          ? rawCountry.toUpperCase()
          : (getCountryCodeFromLocation(rawCountry) ?? 'CA');

      const result = await this.paymentGatewayService.createConnectAccount(
        IPaymentGatewayProvider.STRIPE,
        {
          email,
          country,
          businessType: 'individual',
          metadata: { vuid, cuid },
          cuid,
        }
      );

      if (!result.success || !result.data) {
        throw this.providerError(result.message, 'payment.payout.errors.setupFailed', {
          cuid,
          vuid,
        });
      }

      await this.paymentProcessorDAO.upsertForVendor({
        accountId: result.data.accountId,
        chargesEnabled: result.data.chargesEnabled,
        payoutsEnabled: result.data.payoutsEnabled,
        detailsSubmitted: result.data.detailsSubmitted,
        client: client._id,
        ownerType: 'vendor',
        vuid,
        cuid,
      });

      // Sync payout status into this client's connectedClients entry
      await this.vendorDAO.updateClientPayoutAccount(vuid, cuid, {
        isSetup: result.data.detailsSubmitted || false,
        payoutsEnabled: result.data.payoutsEnabled || false,
        chargesEnabled: result.data.chargesEnabled || false,
      });

      return { success: true, data: { accountId: result.data.accountId } };
    } catch (error) {
      this.log.error({ error, cuid, vuid }, 'Error initiating vendor payout account');
      throw error;
    }
  }

  async getVendorKycOnboardingLink(
    cuid: string,
    vuid: string,
    returnUrl: string,
    refreshUrl: string
  ): IPromiseReturnedData<{ url: string }> {
    try {
      const processor = await this.paymentProcessorDAO.findByVuid(vuid);
      if (!processor) {
        throw new NotFoundError({ message: t('payment.payout.errors.vendorAccountNotFound') });
      }

      const result = await this.paymentGatewayService.createKycOnboardingLink(
        IPaymentGatewayProvider.STRIPE,
        { accountId: processor.accountId, returnUrl, refreshUrl }
      );

      if (!result.success || !result.data) {
        throw this.providerError(result.message, 'payment.payout.errors.linkFailed', {
          cuid,
          vuid,
        });
      }

      return { success: true, data: { url: result.data.url } };
    } catch (error) {
      this.log.error({ error, cuid, vuid }, 'Error getting vendor KYC onboarding link');
      throw error;
    }
  }

  async getVendorDashboardLink(cuid: string, vuid: string): IPromiseReturnedData<{ url: string }> {
    try {
      const processor = await this.paymentProcessorDAO.findByVuid(vuid);
      if (!processor) {
        throw new NotFoundError({ message: t('payment.payout.errors.vendorAccountNotFound') });
      }

      if (!processor.detailsSubmitted) {
        throw new BadRequestError({ message: t('payment.payout.errors.vendorAccountIncomplete') });
      }

      const result = await this.paymentGatewayService.createDashboardLoginLink(
        IPaymentGatewayProvider.STRIPE,
        processor.accountId
      );

      if (!result.success || !result.data) {
        throw this.providerError(result.message, 'payment.payout.errors.linkFailed', {
          cuid,
          vuid,
        });
      }

      return { success: true, data: { url: result.data.url } };
    } catch (error) {
      this.log.error({ error, cuid, vuid }, 'Error getting vendor dashboard link');
      throw error;
    }
  }
}
