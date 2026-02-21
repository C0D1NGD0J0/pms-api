import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { FilterQuery, Types } from 'mongoose';
import { envVariables } from '@shared/config';
import { SubscriptionPlanConfig } from '@services/subscription';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { IPromiseReturnedData, IPaginateResult } from '@interfaces/utils.interface';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import {
  PaymentProcessorDAO,
  SubscriptionDAO,
  PaymentDAO,
  ProfileDAO,
  ClientDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';
import {
  IPaymentGatewayProvider,
  IManualPaymentFormData,
  PaymentRecordStatus,
  IPaymentPopulated,
  PaymentRecordType,
  IPaymentDocument,
  IPaymentFormData,
  PaymentMethod,
  LeaseStatus,
} from '@interfaces/index';

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  subscriptionDAO: SubscriptionDAO;
  paymentDAO: PaymentDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class PaymentService implements ICronProvider {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;

  constructor({
    userDAO,
    profileDAO,
    clientDAO,
    paymentDAO,
    leaseDAO,
    subscriptionDAO,
    paymentProcessorDAO,
    subscriptionPlanConfig,
    paymentGatewayService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.paymentDAO = paymentDAO;
    this.subscriptionDAO = subscriptionDAO;
    this.log = createLogger('PaymentService');
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.paymentGatewayService = paymentGatewayService;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
  }

  getCronJobs(): ICronJob[] {
    return [];
  }

  async recordManualPayment(
    cuid: string,
    userId: string,
    data: IManualPaymentFormData
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      const client = await this.clientDAO.findFirst({ cuid, deletedAt: null });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const tenantProfile = await this.profileDAO.findFirst({ user: data.tenantId });
      if (!tenantProfile) {
        throw new NotFoundError({ message: 'Tenant profile not found' });
      }

      let lease;
      if (data.leaseId) {
        lease = await this.leaseDAO.findById(data.leaseId);
        if (!lease || lease.cuid !== cuid) {
          throw new NotFoundError({ message: 'Lease not found' });
        }
      }

      const payment = await this.paymentDAO.insert({
        cuid,
        paymentType: data.paymentType,
        paymentMethod: data.paymentMethod,
        lease: data.leaseId ? new Types.ObjectId(data.leaseId) : undefined,
        tenant: tenantProfile._id,
        baseAmount: data.baseAmount,
        processingFee: data.processingFee || 0,
        status: data.status || PaymentRecordStatus.PAID,
        dueDate: data.paidAt,
        paidAt: data.paidAt,
        period: data.period,
        description: data.description,
        receipt: data.receipt
          ? {
              url: data.receipt.url,
              filename: data.receipt.filename,
              key: data.receipt.key,
              uploadedAt: new Date(),
              uploadedBy: new Types.ObjectId(userId),
            }
          : undefined,
        recordedBy: new Types.ObjectId(userId),
        isManualEntry: true,
      });

      return {
        success: true,
        data: payment,
        message: 'Manual payment recorded successfully',
      };
    } catch (error: any) {
      this.log.error('Error recording manual payment:', error);
      throw error;
    }
  }

  async createRentPayment(
    cuid: string,
    data: IPaymentFormData
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      if (!data.leaseId) {
        throw new BadRequestError({ message: 'Lease ID is required for rent payments' });
      }

      const lease = await this.leaseDAO.findById(data.leaseId);
      if (!lease || lease.cuid !== cuid) {
        throw new NotFoundError({ message: 'Lease not found' });
      }
      if (lease.status !== LeaseStatus.ACTIVE) {
        throw new BadRequestError({ message: 'Cannot create payment for inactive lease' });
      }

      const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
      if (!subscription) {
        throw new BadRequestError({ message: 'No active subscription found' });
      }

      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor || !paymentProcessor.accountId) {
        throw new BadRequestError({
          message: 'Payment account not setup. Please complete onboarding.',
        });
      }
      if (!paymentProcessor.chargesEnabled || !paymentProcessor.payoutsEnabled) {
        throw new BadRequestError({ message: 'Payment account verification incomplete' });
      }

      const leaseFees = lease.calculateFees({ daysLate: data.daysLate });
      const totalAmountInCents = leaseFees.monthly.total + (leaseFees.late.fee || 0);
      const transactionFeePercent = this.subscriptionPlanConfig.getTransactionFeePercent(
        subscription.planName
      );
      const feeBreakdown = this.calculateRentFees(totalAmountInCents, transactionFeePercent);

      // 5. Get tenant's customer ID on PM's payment gateway account
      // Customer was created during tenant signup (see STEP 5 in docs)
      // Multi-tenancy: Tenant can rent from multiple PMs, so they have separate customer IDs
      // Gateway-agnostic: Keyed by accountId (supports Stripe, PayPal, etc.)
      // Location: Profile.tenantInfo.paymentGatewayCustomers[accountId]

      const tenantProfile = await this.profileDAO.findFirst(
        { user: data.tenantId },
        {
          populate: ['user'],
        }
      );
      if (!tenantProfile) {
        throw new NotFoundError({ message: 'Tenant profile not found' });
      }

      const tenantCustomerId = tenantProfile.tenantInfo?.paymentGatewayCustomers?.get(
        paymentProcessor.accountId
      );
      if (!tenantCustomerId) {
        this.log.error('Payment gateway customerId not found for tenant', {
          profileId: tenantProfile._id,
          accountId: paymentProcessor.accountId,
          cuid,
        });

        throw new BadRequestError({
          message: 'Payment method not set up. Please contact property management.',
        });
      }

      const lineItems = this.buildLineItemsFromFees(leaseFees);
      const invoiceResult = await this.paymentGatewayService.createInvoice(
        IPaymentGatewayProvider.STRIPE,
        {
          tenantCustomerId,
          connectedAccountId: paymentProcessor.accountId,
          applicationFeeAmountInCents: feeBreakdown.applicationFee,
          currency: 'usd',
          description: data.description || `Rent for ${data.period?.month}/${data.period?.year}`,
          autoChargeDueDate: data.dueDate,
          lineItems,
          cuid,
          leaseUid: lease.luid,
        }
      );
      if (!invoiceResult.success || !invoiceResult.data) {
        throw new Error(invoiceResult.message || 'Failed to create invoice');
      }

      const finalizeResult = await this.paymentGatewayService.finalizeInvoice(
        IPaymentGatewayProvider.STRIPE,
        invoiceResult.data.invoiceId,
        paymentProcessor.accountId
      );

      if (!finalizeResult.success) {
        throw new Error(finalizeResult.message || 'Failed to finalize invoice');
      }

      // status of PENDING, will be updated via webhook when tenant is charged
      // tenant field references Profile (not User)
      const payment = await this.paymentDAO.insert({
        cuid,
        paymentType: PaymentRecordType.RENT,
        paymentMethod: PaymentMethod.ONLINE,
        lease: data.leaseId ? new Types.ObjectId(data.leaseId) : undefined,
        tenant: tenantProfile._id, // References Profile document
        baseAmount: totalAmountInCents,
        processingFee: feeBreakdown.gatewayProcessingFee,
        gatewayPaymentId: invoiceResult.data.invoiceId,
        status: PaymentRecordStatus.PENDING,
        dueDate: data.dueDate,
        period: data.period,
        description: data.description,
        isManualEntry: false,
      });

      return {
        success: true,
        data: payment,
        message: 'Rent payment processed successfully',
      };
    } catch (error: any) {
      this.log.error('Error creating rent payment:', error);
      throw error;
    }
  }

  async listPayments(
    cuid: string,
    filters?: {
      status?: string;
      type?: string;
      tenantId?: string;
      leaseId?: string;
      skip?: number;
      limit?: number;
    }
  ): IPromiseReturnedData<{ items: IPaymentDocument[]; pagination?: IPaginateResult }> {
    try {
      const client = await this.clientDAO.findFirst({ cuid, deletedAt: null });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const query: FilterQuery<IPaymentDocument> = { cuid, deletedAt: null };

      if (filters?.status) {
        query.status = filters.status;
      }
      if (filters?.type) {
        query.paymentType = filters.type;
      }
      if (filters?.tenantId) {
        query.tenant = new Types.ObjectId(filters.tenantId);
      }
      if (filters?.leaseId) {
        query.lease = new Types.ObjectId(filters.leaseId);
      }

      const result = await this.paymentDAO.list(query, {
        sort: { createdAt: -1 },
        populate: ['tenant', 'lease'],
        skip: filters?.skip,
        limit: filters?.limit,
      });

      return {
        success: true,
        data: result,
        message: 'Payments retrieved successfully',
      };
    } catch (error) {
      this.log.error('Error listing payments', error);
      throw error;
    }
  }

  async getPaymentByUid(
    cuid: string,
    pytuid: string
  ): IPromiseReturnedData<{
    tenantProfile: { firstName?: string; lastName?: string; email?: string; puid?: string };
    leaseInfo: {
      address?: any;
      leaseNumber?: string;
      status?: string;
      leaseUid?: string;
      startDate?: Date;
      endDate?: Date;
      unitNumber?: string;
      propertyName?: string;
      propertyType?: string;
      bedrooms?: number;
      bathrooms?: number;
    } | null;
  }> {
    try {
      if (!cuid || !pytuid) {
        throw new BadRequestError({ message: 'Client ID and Payment ID are required' });
      }

      const client = await this.clientDAO.findFirst({ cuid, deletedAt: null });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const payment = (await this.paymentDAO.findFirst(
        { pytuid, cuid, deletedAt: null },
        {
          populate: [
            { path: 'tenant', populate: { path: 'user' } }, // Populate Profile and nested User
            'lease',
          ],
        }
      )) as IPaymentPopulated | null;

      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      const tenantProfile = {
        firstName: payment.tenant?.personalInfo?.firstName,
        lastName: payment.tenant?.personalInfo?.lastName,
        email: (payment.tenant?.user as any)?.email, // Profile has user populated
        puid: payment.tenant?.puid,
      };

      const leaseInfo = payment.lease
        ? {
            address: payment.lease.property?.address,
            leaseNumber: payment.lease.leaseNumber,
            status: payment.lease.status,
            startDate: payment.lease.duration?.startDate,
            endDate: payment.lease.duration?.endDate,
            leaseUid: payment.lease.luid,
            unitNumber: payment.lease.property?.unitNumber,
            propertyName: payment.lease.property?.name,
            propertyType: payment.lease.property?.propertyType,
            bedrooms: payment.lease.property?.specifications?.bedrooms,
            bathrooms: payment.lease.property?.specifications?.bathrooms,
          }
        : null;

      const paymentObj = payment.toObject();
      delete paymentObj.tenant;
      delete paymentObj.lease;

      this.log.info({ pytuid, cuid }, 'Payment retrieved');

      return {
        success: true,
        data: {
          ...paymentObj,
          tenantProfile,
          leaseInfo,
        },
        message: 'Payment retrieved successfully',
      };
    } catch (error) {
      this.log.error('Error getting payment', error);
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

      const accountResult = await this.paymentGatewayService.createConnectAccount(
        IPaymentGatewayProvider.STRIPE,
        {
          cuid,
          email: data.email,
          country: data.country,
          businessType: client.accountType.isEnterpriseAccount ? 'company' : 'individual',
          metadata: { cuid },
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

  async getKycOnboardingLink(cuid: string): IPromiseReturnedData<{ url: string }> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor || !paymentProcessor.accountId) {
        throw new BadRequestError({
          message: 'No Connect account found. Please create one first.',
        });
      }

      const baseUrl = envVariables.FRONTEND.URL || 'http://localhost:3000';
      const linkResult = await this.paymentGatewayService.createKycOnboardingLink(
        IPaymentGatewayProvider.STRIPE,
        {
          accountId: paymentProcessor.accountId,
          refreshUrl: `${baseUrl}/client/${cuid}/account_settings/payment/refresh`,
          returnUrl: `${baseUrl}/client/${cuid}/account_settings/payment/success`,
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

  /**
   * Build invoice line items from pre-calculated lease fees
   * Accepts already-calculated fees to avoid redundant calculations
   *
   * @param fees - Pre-calculated fees from lease.calculateFees()
   * @returns Array of line items with amounts in cents
   */
  private buildLineItemsFromFees(fees: {
    monthly: { rent: number; petFee: number; total: number };
    late: {
      daysLate: number;
      fee: number;
      type: string;
      percentage: number;
      gracePeriod: number;
    };
    deposits: { security: number; pet: number; total: number };
    currency: string;
  }): Array<{
    description: string;
    amountInCents: number;
    quantity?: number;
  }> {
    const lineItems = [];

    // Monthly rent (required)
    if (fees.monthly.rent > 0) {
      lineItems.push({
        description: 'Monthly Rent',
        amountInCents: fees.monthly.rent,
      });
    }

    // Pet fee (if applicable)
    if (fees.monthly.petFee > 0) {
      lineItems.push({
        description: 'Pet Fee',
        amountInCents: fees.monthly.petFee,
      });
    }

    // Late fee (if applicable)
    if (fees.late.fee > 0) {
      const lateFeeDesc =
        fees.late.type === 'percentage'
          ? `Late Fee (${fees.late.percentage}% - ${fees.late.daysLate} days late)`
          : `Late Fee (${fees.late.daysLate} days late)`;

      lineItems.push({
        description: lateFeeDesc,
        amountInCents: fees.late.fee,
      });
    }

    // Validate we have at least one line item
    if (lineItems.length === 0) {
      throw new Error('No valid fees found on lease');
    }

    return lineItems;
  }

  /**
   * Webhook handler: invoice.payment_succeeded
   * Updates payment status when tenant pays rent invoice
   *
   * @param invoiceId - Stripe invoice ID (stored in Payment.gatewayPaymentId)
   * @param invoiceData - Full invoice object from Stripe webhook
   */
  async handleInvoicePaymentSucceeded(
    invoiceId: string,
    invoiceData: any
  ): IPromiseReturnedData<void> {
    try {
      const payment = await this.paymentDAO.findFirst({
        gatewayPaymentId: invoiceId,
        deletedAt: null,
      });

      if (!payment) {
        this.log.warn('Payment not found for invoice', { invoiceId });
        return {
          success: false,
          data: undefined,
          message: 'Payment record not found',
        };
      }

      if (payment.status === PaymentRecordStatus.PAID) {
        this.log.info('Payment already marked as paid', { invoiceId, pytuid: payment.pytuid });
        return {
          success: true,
          data: undefined,
          message: 'Payment already paid',
        };
      }

      const chargeId = invoiceData.charge;
      if (!chargeId) {
        this.log.warn('No charge ID found in invoice', { invoiceId });
      }

      await this.paymentDAO.update(
        { _id: payment._id },
        {
          $set: {
            status: PaymentRecordStatus.PAID,
            paidAt: new Date(),
            gatewayChargeId: chargeId,
          },
        }
      );

      this.log.info('Payment marked as paid', {
        pytuid: payment.pytuid,
        invoiceId,
        chargeId,
      });

      return {
        success: true,
        data: undefined,
        message: 'Payment updated successfully',
      };
    } catch (error: any) {
      this.log.error('Error handling invoice payment succeeded', { invoiceId, error });
      throw error;
    }
  }

  /**
   * Webhook handler: invoice.payment_failed
   * Updates payment status when tenant's payment fails
   *
   * @param invoiceId - Stripe invoice ID
   * @param invoiceData - Full invoice object from Stripe webhook
   */
  async handleInvoicePaymentFailed(
    invoiceId: string,
    invoiceData: any
  ): IPromiseReturnedData<void> {
    try {
      const payment = await this.paymentDAO.findFirst({
        gatewayPaymentId: invoiceId,
        deletedAt: null,
      });

      if (!payment) {
        this.log.warn('Payment not found for failed invoice', { invoiceId });
        return {
          success: false,
          data: undefined,
          message: 'Payment record not found',
        };
      }

      const attemptCount = invoiceData.attempt_count || 0;
      const nextPaymentAttempt = invoiceData.next_payment_attempt
        ? new Date(invoiceData.next_payment_attempt * 1000)
        : undefined;

      await this.paymentDAO.update(
        { _id: payment._id },
        {
          $set: {
            status: PaymentRecordStatus.FAILED,
          },
        }
      );

      this.log.warn('Payment marked as failed', {
        pytuid: payment.pytuid,
        invoiceId,
        attemptCount,
        nextPaymentAttempt,
      });

      return {
        success: true,
        data: undefined,
        message: 'Payment marked as failed',
      };
    } catch (error: any) {
      this.log.error('Error handling invoice payment failed', { invoiceId, error });
      throw error;
    }
  }

  /**
   * Webhook handler: charge.refunded
   * Updates payment status when rent payment is refunded
   *
   * @param chargeId - Stripe charge ID
   * @param chargeData - Full charge object from Stripe webhook
   */
  async handleChargeRefunded(chargeId: string, chargeData: any): IPromiseReturnedData<void> {
    try {
      const payment = await this.paymentDAO.findFirst({
        gatewayChargeId: chargeId,
        deletedAt: null,
      });

      if (!payment) {
        this.log.warn('Payment not found for refunded charge', { chargeId });
        return {
          success: false,
          data: undefined,
          message: 'Payment record not found',
        };
      }

      const refundAmountInCents = chargeData.amount_refunded || 0;
      const isFullRefund = refundAmountInCents >= payment.baseAmount;

      await this.paymentDAO.update(
        { _id: payment._id },
        {
          $set: {
            refundedAt: new Date(),
            refundAmount: refundAmountInCents,
            // Note: Status remains PAID - refundedAt and refundAmount indicate refund
          },
        }
      );

      this.log.info('Payment refund processed', {
        pytuid: payment.pytuid,
        chargeId,
        refundAmount: refundAmountInCents,
        isFullRefund,
      });

      return {
        success: true,
        data: undefined,
        message: 'Refund processed successfully',
      };
    } catch (error: any) {
      this.log.error('Error handling charge refunded', { chargeId, error });
      throw error;
    }
  }

  /**
   * Webhook handler: account.updated
   * Updates PaymentProcessor when PM's Stripe Connect account changes
   *
   * @param accountId - Stripe Connect account ID
   * @param accountData - Full account object from Stripe webhook
   */
  async handleAccountUpdated(accountId: string, accountData: any): IPromiseReturnedData<void> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({
        accountId,
      });

      if (!paymentProcessor) {
        this.log.warn('PaymentProcessor not found for account', { accountId });
        return {
          success: false,
          data: undefined,
          message: 'PaymentProcessor record not found',
        };
      }

      const updateData: any = {
        chargesEnabled: accountData.charges_enabled || false,
        payoutsEnabled: accountData.payouts_enabled || false,
        detailsSubmitted: accountData.details_submitted || false,
      };

      if (accountData.requirements) {
        updateData.requirements = {
          currentlyDue: accountData.requirements.currently_due || [],
          eventuallyDue: accountData.requirements.eventually_due || [],
          pastDue: accountData.requirements.past_due || [],
          disabledReason: accountData.requirements.disabled_reason,
        };
      }

      await this.paymentProcessorDAO.update({ _id: paymentProcessor._id }, { $set: updateData });

      this.log.info('PaymentProcessor updated from webhook', {
        accountId,
        chargesEnabled: updateData.chargesEnabled,
        payoutsEnabled: updateData.payoutsEnabled,
        detailsSubmitted: updateData.detailsSubmitted,
      });

      return {
        success: true,
        data: undefined,
        message: 'PaymentProcessor updated successfully',
      };
    } catch (error: any) {
      this.log.error('Error handling account updated', { accountId, error });
      throw error;
    }
  }

  /**
   * Get payment statistics
   * Calculates stats on-demand from payment records for current month
   */
  async getPaymentStats(cuid: string): IPromiseReturnedData<{
    expectedRevenue: number;
    collected: number;
    pending: number;
    overdue: number;
    collectionRate: number;
    currency: string;
  }> {
    try {
      const client = await this.clientDAO.findFirst({ cuid });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      // Get current month's date range
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // Fetch payments for current month directly using dueDate range
      const result = await this.paymentDAO.findByCuid(
        cuid,
        { dueDate: { $gte: startOfMonth, $lte: endOfMonth } },
        { limit: 10000 },
      );
      const paymentsThisMonth = result.items || [];
      // Calculate stats
      let expectedRevenue = 0;
      let collected = 0;
      let pending = 0;
      let overdue = 0;

      paymentsThisMonth.forEach((payment) => {
        const amount = payment.baseAmount;

        switch (payment.status) {
          case PaymentRecordStatus.CANCELLED:
          case PaymentRecordStatus.FAILED:
            // FAILED and CANCELLED payments don't count toward any stat
            // They are excluded from expectedRevenue
            break;
          case PaymentRecordStatus.PENDING:
            expectedRevenue += amount;
            pending += amount;
            break;
          case PaymentRecordStatus.OVERDUE:
            expectedRevenue += amount;
            overdue += amount;
            break;
          case PaymentRecordStatus.PAID:
            // Only PAID payments contribute to expected revenue and collected
            expectedRevenue += amount;
            collected += amount;
            break;
          default:
            // Log unknown status for debugging
            this.log.warn('Unknown payment status encountered', {
              status: payment.status,
              pytuid: payment.pytuid,
            });
            break;
        }
      });

      const collectionRate =
        expectedRevenue > 0 ? Math.round((collected / expectedRevenue) * 100) : 0;

      return {
        success: true,
        data: {
          expectedRevenue,
          collected,
          pending,
          overdue,
          collectionRate,
          currency: 'USD',
        },
      };
    } catch (error: any) {
      this.log.error('Error getting payment stats', error);
      throw error;
    }
  }

  async cancelPayment(
    cuid: string,
    pytuid: string,
    reason?: string
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      if (!cuid || !pytuid) {
        throw new BadRequestError({ message: 'Client ID and payment ID are required' });
      }

      const client = await this.clientDAO.findFirst({ cuid });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const payment = await this.paymentDAO.findFirst({
        pytuid,
        cuid,
        deletedAt: null,
      });
      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      if (
        payment.status === PaymentRecordStatus.PAID ||
        payment.status === PaymentRecordStatus.CANCELLED
      ) {
        throw new BadRequestError({
          message: `Cannot cancel a payment with status: ${payment.status}`,
        });
      }

      const updated = await this.paymentDAO.updateById((payment as any)._id.toString(), {
        status: PaymentRecordStatus.CANCELLED,
        ...(reason
          ? {
              $push: {
                notes: { text: `Cancelled: ${reason}`, createdAt: new Date(), author: 'system' },
              },
            }
          : {}),
      });

      return { success: true, data: updated as IPaymentDocument };
    } catch (error: any) {
      this.log.error({ error: error.message, cuid, pytuid }, 'Error cancelling payment');
      throw error;
    }
  }

  private calculateRentFees(
    totalAmount: number,
    transactionFeePercent: number,
    provider: string = 'stripe'
  ): {
    baseAmount: number;
    applicationFee: number;
    gatewayProcessingFee: number;
    platformNetRevenue: number;
  } {
    const applicationFee = Math.round(totalAmount * transactionFeePercent);
    const gatewayProcessingFee = this.subscriptionPlanConfig.calculatePaymentGatewayFee(
      totalAmount,
      provider
    );
    const platformNetRevenue = applicationFee - gatewayProcessingFee;

    return {
      baseAmount: totalAmount,
      gatewayProcessingFee,
      platformNetRevenue,
      applicationFee,
    };
  }
}
