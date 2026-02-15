import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { SubscriptionPlanConfig } from '@services/subscription';
import { IPromiseReturnedData } from '@interfaces/utils.interface';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
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
  PaymentRecordStatus,
  PaymentRecordType,
  IPaymentDocument,
  IPaymentFormData,
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

      const tenant = await this.profileDAO.findFirst(
        { user: data.tenantId },
        {
          populate: ['user'],
        }
      );
      if (!tenant) {
        throw new NotFoundError({ message: 'Tenant profile not found' });
      }

      const tenantCustomerId = tenant.tenantInfo?.paymentGatewayCustomers?.get(
        paymentProcessor.accountId
      );
      if (!tenantCustomerId) {
        this.log.error('Payment gateway customerId not found for tenant', {
          tenantId: tenant._id,
          accountId: paymentProcessor.accountId,
          cuid,
        });

        throw new BadRequestError({
          message: 'Payment method not set up. Please contact property management.',
        });
      }

      const lineItems = this.buildLineItemsFromLease(lease, data.daysLate);
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
      const payment = await this.paymentDAO.insert({
        cuid,
        paymentType: PaymentRecordType.RENT,
        lease: data.leaseId ? new Types.ObjectId(data.leaseId) : undefined,
        tenant: new Types.ObjectId(data.tenantId),
        baseAmount: totalAmountInCents,
        processingFee: feeBreakdown.gatewayProcessingFee,
        gatewayPaymentId: invoiceResult.data.invoiceId,
        status: PaymentRecordStatus.PENDING,
        dueDate: data.dueDate,
        period: data.period,
        description: data.description,
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

  /**
   * Build invoice line items from lease fees
   * Uses lease.calculateFees() method for centralized fee calculation
   *
   * @param lease - Lease document with calculateFees() method
   * @param daysLate - Number of days payment is late (for late fee calculation)
   * @returns Array of line items with amounts in cents
   */
  private buildLineItemsFromLease(
    lease: any,
    daysLate?: number
  ): Array<{
    description: string;
    amountInCents: number;
    quantity?: number;
  }> {
    const fees = lease.calculateFees({ daysLate });
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
   * Calculate rent payment fees
   *
   * Money flow (Direct Charges with Application Fee):
   * 1. Tenant pays $2,000 → PM's Stripe Connect Account
   * 2. Stripe deducts application fee from PM: $2,000 × 4% = $80
   * 3. Stripe transfers $80 to Platform account
   * 4. Platform pays Stripe processing fee from the $80:
   *    - Processing fee = ($2,000 × 2.9%) + $0.30 = $58.30 (ESTIMATED from config)
   *    - Platform net revenue = $80 - $58.30 = $21.70
   * 5. PM receives: $2,000 - $80 = $1,920
   *
   * FINAL:
   * - PM: $1,920
   * - Platform: $21.70 (estimated)
   * - Stripe: $58.30 (paid by platform from application fee)
   *
   * NOTE:
   * - Processing fee is ESTIMATED from platform.config.json
   * - Actual fee will be fetched from Stripe Balance Transaction API after payment
   * - Webhook will update Payment record with actual fee
   * - Actual fees may vary by card type (debit/credit/international/amex)
   */
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
    // what we charge the PM (deducted by Stripe from PM's account)
    const applicationFee = Math.round(totalAmount * transactionFeePercent);

    // Gateway processing fee: ESTIMATED from config, calculated on FULL transaction amount
    // paid by platform from application fee, will be updated with actual fee from Stripe API after payment succeeds
    const gatewayProcessingFee = this.subscriptionPlanConfig.calculatePaymentGatewayFee(
      totalAmount,
      provider
    );

    // what we keep after paying gateway (ESTIMATED)
    const platformNetRevenue = applicationFee - gatewayProcessingFee;

    return {
      baseAmount: totalAmount,
      gatewayProcessingFee,
      platformNetRevenue,
      applicationFee,
    };
  }
}
