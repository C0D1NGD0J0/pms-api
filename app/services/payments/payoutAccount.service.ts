import dayjs from 'dayjs';
import Logger from 'bunyan';
import { envVariables } from '@shared/config';
import { IPaymentGatewayProvider } from '@interfaces/index';
import { IPromiseReturnedData } from '@interfaces/utils.interface';
import { getPaymentProcessorUrls, createLogger } from '@utils/index';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { IPayoutSchedule } from '@interfaces/paymentGateway.interface';
import { PaymentProcessorDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';

interface IStripePayoutEntry {
  description?: string | null;
  arrival_date: number;
  currency: string;
  created: number;
  amount: number;
  status: string;
  id: string;
}

interface IConstructor {
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
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

  constructor({ paymentGatewayService, paymentProcessorDAO, profileDAO, clientDAO }: IConstructor) {
    this.log = createLogger('PayoutAccountService');
    this.paymentGatewayService = paymentGatewayService;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.profileDAO = profileDAO;
    this.clientDAO = clientDAO;
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
        ? await this.profileDAO.findFirst({ user: client.accountAdmin })
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
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor || !paymentProcessor.accountId) {
        throw new BadRequestError({
          message: 'No Connect account found. Please create one first.',
        });
      }

      const baseUrl = envVariables.FRONTEND.URL || 'http://localhost:3000';
      const fallback = getPaymentProcessorUrls(baseUrl, cuid);
      const linkResult = await this.paymentGatewayService.createKycOnboardingLink(
        IPaymentGatewayProvider.STRIPE,
        {
          accountId: paymentProcessor.accountId,
          refreshUrl: urlOverrides?.refreshUrl || fallback.refreshUrl,
          returnUrl: urlOverrides?.returnUrl || fallback.kycReturnUrl,
        }
      );

      if (!linkResult.success || !linkResult.data) {
        throw new BadRequestError({
          message: linkResult.message || 'Failed to create onboarding link',
        });
      }

      return {
        success: true,
        data: { url: linkResult.data.url },
        message: 'Onboarding link created successfully',
      };
    } catch (error) {
      this.log.error('Error creating onboarding link', error);
      throw error;
    }
  }

  async getAccountUpdateLink(
    cuid: string,
    urlOverrides?: { returnUrl?: string; refreshUrl?: string }
  ): IPromiseReturnedData<{ url: string }> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor || !paymentProcessor.accountId) {
        throw new BadRequestError({
          message: 'No Connect account found.',
        });
      }

      const baseUrl = envVariables.FRONTEND.URL || 'http://localhost:3000';
      const fallback = getPaymentProcessorUrls(baseUrl, cuid);
      const linkResult = await this.paymentGatewayService.createKycOnboardingLink(
        IPaymentGatewayProvider.STRIPE,
        {
          accountId: paymentProcessor.accountId,
          refreshUrl: urlOverrides?.refreshUrl || fallback.refreshUrl,
          returnUrl: urlOverrides?.returnUrl || fallback.accountUpdateReturnUrl,
        }
      );

      if (!linkResult.success || !linkResult.data) {
        throw new BadRequestError({
          message: linkResult.message || 'Failed to create account update link',
        });
      }

      return {
        success: true,
        data: { url: linkResult.data.url },
        message: 'Account update link created successfully',
      };
    } catch (error) {
      this.log.error('Error creating account update link', error);
      throw error;
    }
  }

  async getExternalDashboardLoginLink(cuid: string): IPromiseReturnedData<{ url: string }> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor || !paymentProcessor.accountId) {
        throw new BadRequestError({
          message: 'No Connect account found',
        });
      }

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
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) {
        throw new NotFoundError({ message: 'No Connect account found for this client' });
      }
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
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) {
        throw new NotFoundError({ message: 'No Connect account found for this client' });
      }
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
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) {
        throw new NotFoundError({ message: 'No Connect account found for this client' });
      }

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
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) {
        throw new NotFoundError({ message: 'No Connect account found for this client' });
      }
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
}
