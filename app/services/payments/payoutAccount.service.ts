import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { envVariables } from '@shared/config';
import { IPaymentGatewayProvider } from '@interfaces/index';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { IPayoutSchedule } from '@interfaces/paymentGateway.interface';
import { PaymentProcessorDAO, ProfileDAO, ClientDAO, VendorDAO } from '@dao/index';
import { IPromiseReturnedData, ISuccessReturnData } from '@interfaces/utils.interface';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { getCountryCodeFromLocation, getPaymentProcessorUrls, createLogger } from '@utils/index';

interface IConstructor {
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  vendorDAO: VendorDAO;
}

interface IStripePayoutEntry {
  description?: string | null;
  arrival_date: number;
  currency: string;
  created: number;
  amount: number;
  status: string;
  id: string;
}

interface IStripeBalanceData {
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
    const processor = await this.paymentProcessorDAO.findFirst({ cuid });
    if (!processor?.accountId) {
      throw new BadRequestError({ message: 'Payment account not configured' });
    }
    return processor;
  }

  private async getOnboardingOrUpdateLink(
    cuid: string,
    type: 'onboarding' | 'update',
    urls: { refreshUrl: string; returnUrl: string }
  ): Promise<ISuccessReturnData<{ url: string }>> {
    try {
      const paymentProcessor = await this.getProcessorOrThrow(cuid);

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
        const label = type === 'onboarding' ? 'onboarding link' : 'account update link';
        throw new BadRequestError({
          message: linkResult.message || `Failed to create ${label}`,
        });
      }

      const message =
        type === 'onboarding'
          ? 'Onboarding link created successfully'
          : 'Account update link created successfully';

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
      const existingProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (existingProcessor?.accountId) {
        throw new BadRequestError({
          message: 'Connect account already exists for this client',
        });
      }

      const client = await this.clientDAO.findFirst({ cuid });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const adminProfile = client.accountAdmin
        ? await this.profileDAO.findFirst({ user: client.accountAdmin as Types.ObjectId })
        : null;

      const isEnterprise = client.accountType.isEnterpriseAccount;
      const accountResult = await this.paymentGatewayService.createConnectAccount(
        IPaymentGatewayProvider.STRIPE,
        {
          cuid,
          email: data.email,
          country: data.country,
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
        throw new BadRequestError({
          message: accountResult.message || 'Failed to create Connect account',
        });
      }

      await this.paymentProcessorDAO.insert({
        cuid,
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
        message: 'Connect account created successfully',
      };
    } catch (error) {
      this.log.error('Error creating Connect account', error);
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
      const paymentProcessor = await this.getProcessorOrThrow(cuid);

      const linkResult = await this.paymentGatewayService.createDashboardLoginLink(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId
      );

      if (!linkResult.success || !linkResult.data) {
        throw new BadRequestError({ message: linkResult.message || 'Failed to create login link' });
      }

      return {
        success: true,
        data: { url: linkResult.data.url },
        message: 'Login link created successfully',
      };
    } catch (error) {
      this.log.error('Error creating login link', error);
      throw error;
    }
  }

  async getPayoutBalance(cuid: string): IPromiseReturnedData<any> {
    try {
      const paymentProcessor = await this.getProcessorOrThrow(cuid);
      if (!paymentProcessor.payoutsEnabled) {
        throw new BadRequestError({ message: 'Payouts are not enabled for this account' });
      }

      const result = await this.paymentGatewayService.getConnectBalance(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId
      );
      if (!result.success || !result.data) {
        throw new BadRequestError({ message: result.message || 'Failed to fetch balance' });
      }

      const balance = result.data as IStripeBalanceData;
      return {
        success: true,
        data: {
          available: balance.available.map((b) => ({ amount: b.amount, currency: b.currency })),
          pending: balance.pending.map((b) => ({ amount: b.amount, currency: b.currency })),
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
      const paymentProcessor = await this.getProcessorOrThrow(cuid);
      if (!paymentProcessor.payoutsEnabled) {
        throw new BadRequestError({ message: 'Payouts are not enabled for this account' });
      }

      const result = await this.paymentGatewayService.listConnectPayouts(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId,
        { limit: query.limit, starting_after: query.cursor }
      );
      if (!result.success || !result.data) {
        throw new BadRequestError({ message: result.message || 'Failed to fetch payouts' });
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
      const paymentProcessor = await this.getProcessorOrThrow(cuid);

      const result = await this.paymentGatewayService.getPayoutSchedule(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId
      );
      if (!result.success || !result.data) {
        throw new BadRequestError({ message: result.message || 'Failed to fetch payout schedule' });
      }

      return { success: true, data: result.data };
    } catch (error) {
      this.log.error('Error fetching payout schedule', error);
      throw error;
    }
  }

  async updatePayoutSchedule(
    cuid: string,
    interval: 'daily' | 'weekly' | 'monthly',
    weeklyAnchor?: string
  ): IPromiseReturnedData<null> {
    try {
      const paymentProcessor = await this.getProcessorOrThrow(cuid);
      if (!paymentProcessor.payoutsEnabled) {
        throw new BadRequestError({ message: 'Payouts are not enabled for this account' });
      }

      const result = await this.paymentGatewayService.updatePayoutSchedule(
        IPaymentGatewayProvider.STRIPE,
        paymentProcessor.accountId,
        interval,
        weeklyAnchor
      );
      if (!result.success) {
        throw new BadRequestError({
          message: result.message || 'Failed to update payout schedule',
        });
      }

      this.log.info({ cuid, interval, weeklyAnchor }, 'Payout schedule updated');
      return { success: true, data: null, message: 'Payout schedule updated successfully' };
    } catch (error) {
      this.log.error('Error updating payout schedule', error);
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

      if (!client) throw new NotFoundError({ message: 'Client not found' });
      if (!vendor) throw new NotFoundError({ message: 'Vendor not found' });

      const email = (vendor.contactPerson as any)?.email;
      if (!email) {
        throw new BadRequestError({
          message: 'Vendor contact email is required to set up a payout account.',
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
        throw new BadRequestError({
          message: result.message || 'Failed to create payout account with provider.',
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
        throw new NotFoundError({
          message: 'Payout account not found. Please initiate onboarding first.',
        });
      }

      const result = await this.paymentGatewayService.createKycOnboardingLink(
        IPaymentGatewayProvider.STRIPE,
        { accountId: processor.accountId, returnUrl, refreshUrl }
      );

      if (!result.success || !result.data) {
        throw new BadRequestError({
          message: result.message || 'Failed to generate onboarding link.',
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
        throw new NotFoundError({ message: 'Payout account not found.' });
      }

      if (!processor.detailsSubmitted) {
        throw new BadRequestError({ message: 'Payout account setup not complete.' });
      }

      const result = await this.paymentGatewayService.createDashboardLoginLink(
        IPaymentGatewayProvider.STRIPE,
        processor.accountId
      );

      if (!result.success || !result.data) {
        throw new BadRequestError({
          message: result.message || 'Failed to generate dashboard link.',
        });
      }

      return { success: true, data: { url: result.data.url } };
    } catch (error) {
      this.log.error({ error, cuid, vuid }, 'Error getting vendor dashboard link');
      throw error;
    }
  }
}
