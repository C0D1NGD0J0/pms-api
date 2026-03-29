import Logger from 'bunyan';
import { FilterQuery, Types } from 'mongoose';
import { envVariables } from '@shared/config';
import { QueueFactory } from '@services/queue';
import { PaymentQueue } from '@queues/payment.queue';
import { EventTypes } from '@interfaces/events.interface';
import { preventTenantConflict } from '@shared/middlewares';
import { EventEmitterService } from '@services/eventEmitter';
import { SubscriptionPlanConfig } from '@services/subscription';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { IPromiseReturnedData, IPaginateResult } from '@interfaces/utils.interface';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { getPaymentProcessorUrls, calcCollectionRate, createLogger, daysInMs } from '@utils/index';
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
  IRefundPaymentData,
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
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  queueFactory: QueueFactory;
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
  private readonly emitterService: EventEmitterService;
  private readonly queueFactory: QueueFactory;
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
    emitterService,
    queueFactory,
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
    this.emitterService = emitterService;
    this.queueFactory = queueFactory;
    this.subscriptionDAO = subscriptionDAO;
    this.log = createLogger('PaymentService');
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.paymentGatewayService = paymentGatewayService;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
  }

  getCronJobs(): ICronJob[] {
    return [
      {
        name: 'payment.weekly-rent-invoices',
        schedule: '0 0 * * 0', // Sunday midnight UTC
        handler: this.queueWeeklyRentInvoices.bind(this),
        enabled: true,
        service: 'PaymentService',
        description: 'Queue rent invoice creation for leases due in the upcoming week',
        timeout: 600000,
      },
      {
        name: 'payment.daily-rent-safety-net',
        schedule: '0 9 * * *', // 9 AM UTC daily
        handler: this.queueDailySafetyNetInvoices.bind(this),
        enabled: true,
        service: 'PaymentService',
        description:
          'Queue rent invoices for leases due today or tomorrow (catches any missed by weekly job)',
        timeout: 300000,
      },
    ];
  }

  /**
   * Returns the next due date for a lease given its rentDueDay and a reference date.
   * If the due day has already passed this month, returns next month's due date.
   */
  private calculateNextDueDate(rentDueDay: number, referenceDate: Date): Date {
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth(); // 0-indexed
    const thisMonthDue = new Date(year, month, rentDueDay);
    if (thisMonthDue >= referenceDate) {
      return thisMonthDue;
    }
    return new Date(year, month + 1, rentDueDay);
  }

  /**
   * Weekly cron (Sunday midnight): queue invoice jobs for leases due in the next 7 days.
   */
  private async queueWeeklyRentInvoices(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysLater = new Date(today.getTime() + daysInMs(7));

    const { items: leases } = await this.leaseDAO.list(
      { status: LeaseStatus.ACTIVE, 'fees.acceptedPaymentMethod': 'auto-debit', deletedAt: null },
      { limit: 5000 }
    );

    let queued = 0;
    for (const lease of leases) {
      try {
        const dueDate = this.calculateNextDueDate(lease.fees.rentDueDay, today);
        if (dueDate < today || dueDate > sevenDaysLater) continue;

        const period = { month: dueDate.getMonth() + 1, year: dueDate.getFullYear() };
        const existing = await this.paymentDAO.findByPeriod(
          lease.cuid,
          lease._id.toString(),
          period.month,
          period.year
        );
        if (existing) continue;

        const paymentQueue = this.queueFactory.getQueue('paymentQueue') as PaymentQueue;
        await paymentQueue.addCreateRentInvoiceJob({
          cuid: lease.cuid,
          leaseId: lease._id.toString(),
          tenantId: lease.tenantId.toString(),
          period,
          dueDate,
          paymentType: PaymentRecordType.RENT,
        });
        queued++;
      } catch (error) {
        this.log.error(
          { error, leaseId: lease._id },
          'Weekly rent invoice: error processing lease'
        );
      }
    }

    this.log.info({ queued, total: leases.length }, 'Weekly rent invoice queue complete');
  }

  /**
   * Daily cron (9 AM): safety net for leases due today or tomorrow.
   */
  private async queueDailySafetyNetInvoices(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + daysInMs(1));

    const { items: leases } = await this.leaseDAO.list(
      {
        status: LeaseStatus.ACTIVE,
        'fees.acceptedPaymentMethod': 'auto-debit',
        'fees.rentDueDay': { $in: [today.getDate(), tomorrow.getDate()] },
        deletedAt: null,
      },
      { limit: 5000 }
    );

    let queued = 0;
    for (const lease of leases) {
      try {
        const dueDate = this.calculateNextDueDate(lease.fees.rentDueDay, today);
        const period = { month: dueDate.getMonth() + 1, year: dueDate.getFullYear() };
        const existing = await this.paymentDAO.findByPeriod(
          lease.cuid,
          lease._id.toString(),
          period.month,
          period.year
        );
        if (existing) continue;

        const paymentQueue = this.queueFactory.getQueue('paymentQueue') as PaymentQueue;
        await paymentQueue.addCreateRentInvoiceJob({
          cuid: lease.cuid,
          leaseId: lease._id.toString(),
          tenantId: lease.tenantId.toString(),
          period,
          dueDate,
          paymentType: PaymentRecordType.RENT,
        });
        queued++;
      } catch (error) {
        this.log.error({ error, leaseId: lease._id }, 'Daily safety net: error processing lease');
      }
    }

    this.log.info({ queued, total: leases.length }, 'Daily rent invoice safety net complete');
  }

  async recordManualPayment(
    cuid: string,
    userId: string,
    requestingUserSub: string,
    data: IManualPaymentFormData
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      // Prevent conflict of interest: cannot record payment where you are the tenant
      preventTenantConflict(requestingUserSub, data.tenantId as string);

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
        lease = await this.leaseDAO.findFirst({ luid: data.leaseId, cuid });
        if (!lease) {
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
        recordedBy: new Types.ObjectId(userId),
        isManualEntry: true,
        ...(data.receipt
          ? { receipt: { ...data.receipt, uploadedBy: new Types.ObjectId(userId) } }
          : {}),
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

      const lease = await this.leaseDAO.findFirst({ luid: data.leaseId, cuid });
      if (!lease) {
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
        invoiceResult.data.invoiceId
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
  ): IPromiseReturnedData<{ items: any[]; pagination?: IPaginateResult }> {
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

      const result = await this.paymentDAO.list(
        query,
        {
          sort: { dueDate: -1, createdAt: -1 },
          populate: [
            {
              path: 'tenant',
              select: 'personalInfo',
            },
            {
              path: 'lease',
              select: 'property',
            },
          ],
          projection:
            'pytuid paymentMethod paymentType baseAmount processingFee status dueDate paidAt period',
          skip: filters?.skip,
          limit: filters?.limit,
        },
        true
      );

      const cleanItems = result.items.map((payment: any) => ({
        pytuid: payment.pytuid,
        tenant: payment.tenant
          ? {
              firstName: payment.tenant.personalInfo?.firstName || '',
              lastName: payment.tenant.personalInfo?.lastName || '',
              fullName:
                `${payment.tenant.personalInfo?.firstName || ''} ${payment.tenant.personalInfo?.lastName || ''}`.trim() ||
                'Unknown Tenant',
            }
          : null,
        property:
          payment.lease?.property?.name || payment.lease?.property?.address || 'Unknown Property',
        amount: payment.baseAmount + (payment.processingFee || 0),
        baseAmount: payment.baseAmount,
        processingFee: payment.processingFee || 0,
        status: payment.status,
        paymentType: payment.paymentType,
        paymentMethod: payment.paymentMethod,
        dueDate: payment.dueDate,
        paidAt: payment.paidAt,
        period: payment.period,
      }));

      return {
        success: true,
        data: {
          items: cleanItems,
          ...(result.pagination ? { pagination: result.pagination } : {}),
        },
        message: 'Payments retrieved successfully',
      };
    } catch (error) {
      this.log.error('Error listing payments', error);
      throw error;
    }
  }

  async getPaymentByUid(cuid: string, pytuid: string): IPromiseReturnedData<any> {
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
            {
              path: 'tenant',
              select:
                'personalInfo.firstName personalInfo.lastName personalInfo.phoneNumber puid user',
              populate: { path: 'user', select: 'email' },
            },
            {
              path: 'lease',
              select:
                'property.id property.address property.name property.unitNumber leaseNumber status duration.startDate duration.endDate luid',
              populate: {
                path: 'property.id',
                select:
                  'propertyType specifications.bedrooms specifications.bathrooms status managedBy',
              },
            },
          ],
        }
      )) as IPaymentPopulated | null;

      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      const tenantProfile = {
        firstName: payment.tenant?.personalInfo?.firstName,
        lastName: payment.tenant?.personalInfo?.lastName,
        phoneNumber: payment.tenant?.personalInfo?.phoneNumber,
        email: (payment.tenant?.user as any)?.email, // Profile has user populated
        puid: payment.tenant?.puid,
      };

      const propertyDoc = (payment.lease?.property as any)?.id;
      let propertyManager = null;
      if (propertyDoc?.managedBy) {
        const managerProfile = await this.profileDAO.findFirst(
          { user: propertyDoc.managedBy },
          {
            select: 'personalInfo.firstName personalInfo.lastName personalInfo.phoneNumber user',
            populate: { path: 'user', select: 'email' },
          }
        );
        if (managerProfile) {
          propertyManager = {
            fullName:
              `${managerProfile.personalInfo?.firstName || ''} ${managerProfile.personalInfo?.lastName || ''}`.trim(),
            email: (managerProfile.user as any)?.email || '',
            phoneNumber: managerProfile.personalInfo?.phoneNumber || '',
          };
        }
      }

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
            propertyType: propertyDoc?.propertyType,
            propertyStatus: propertyDoc?.status,
            bedrooms: propertyDoc?.specifications?.bedrooms,
            bathrooms: propertyDoc?.specifications?.bathrooms,
            propertyManager,
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
          tenant: {
            uid: tenantProfile.puid || '',
            fullName: `${tenantProfile.firstName || ''} ${tenantProfile.lastName || ''}`.trim(),
            email: tenantProfile.email || '',
            phoneNumber: tenantProfile.phoneNumber || '',
          },
          property: {
            pid: '',
            name: leaseInfo?.propertyName || '',
            address: leaseInfo?.address || '',
          },
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

      // Fetch the account admin's profile to prefill the Stripe KYC form
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
            companyName: isEnterprise ? (client as any).companyName : undefined,
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
      // Express accounts only support account_onboarding type — Stripe shows the
      // appropriate update form when the account is already verified.
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

      this.emitterService.emit(EventTypes.PAYMENT_SUCCEEDED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        invoiceId,
        amount: payment.baseAmount,
        paidAt: new Date(),
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

      this.emitterService.emit(EventTypes.PAYMENT_FAILED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        invoiceId,
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

      await this.paymentDAO.update(
        { _id: payment._id },
        {
          $set: {
            status: PaymentRecordStatus.REFUNDED,
            'refund.refundedAt': new Date(),
            'refund.amount': refundAmountInCents,
          },
        }
      );

      this.log.info('Payment refund processed via webhook', {
        pytuid: payment.pytuid,
        chargeId,
        refundAmount: refundAmountInCents,
      });

      this.emitterService.emit(EventTypes.PAYMENT_REFUNDED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        chargeId,
        refundAmount: refundAmountInCents,
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

  async refundPayment(
    cuid: string,
    pytuid: string,
    requestingUserSub: string,
    data: IRefundPaymentData
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      if (!cuid || !pytuid) {
        throw new BadRequestError({ message: 'Client ID and payment ID are required' });
      }

      const payment = await this.paymentDAO.findFirst({ pytuid, cuid, deletedAt: null });
      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      // Prevent conflict of interest: cannot refund a payment where you are the tenant
      const tenantProfile = await this.profileDAO.findFirst({ _id: payment.tenant });
      preventTenantConflict(requestingUserSub, tenantProfile?.user as any);

      if (payment.status !== PaymentRecordStatus.PAID) {
        throw new BadRequestError({
          message: `Cannot refund a payment with status: ${payment.status}`,
        });
      }

      if (!payment.gatewayChargeId) {
        throw new BadRequestError({
          message: 'Refunds are only available for online payments processed through Stripe',
        });
      }

      if (data.amount && data.amount > payment.baseAmount) {
        throw new BadRequestError({
          message: `Refund amount cannot exceed the original payment amount of ${payment.baseAmount}`,
        });
      }

      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) {
        throw new BadRequestError({ message: 'Payment processor not configured for this account' });
      }

      await this.paymentGatewayService.createRefund(IPaymentGatewayProvider.STRIPE, {
        chargeId: payment.gatewayChargeId,
        amountInCents: data.amount,
        reason: data.reason,
      });

      const updated = await this.paymentDAO.updateById((payment as any)._id.toString(), {
        status: PaymentRecordStatus.REFUNDED,
        'refund.refundedAt': new Date(),
        'refund.amount': data.amount || payment.baseAmount,
        'refund.reason': data.reason,
      });

      this.log.info('Payment refund initiated', {
        pytuid: payment.pytuid,
        refundAmount: data.amount || payment.baseAmount,
        isPartial: !!data.amount && data.amount < payment.baseAmount,
      });

      return { success: true, data: updated as IPaymentDocument };
    } catch (error: any) {
      this.log.error({ error: error.message, cuid, pytuid }, 'Error refunding payment');
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
  async handleAccountUpdated(accountId: string, accountData: any): IPromiseReturnedData<null> {
    try {
      const paymentProcessor = await this.paymentProcessorDAO.findFirst({
        accountId,
      });

      if (!paymentProcessor) {
        this.log.warn('PaymentProcessor not found for account', { accountId });
        return {
          success: false,
          data: null,
          message: 'PaymentProcessor record not found',
        };
      }

      const justVerified = !paymentProcessor.payoutsEnabled && accountData.payouts_enabled;

      const updateData: any = {
        chargesEnabled: accountData.charges_enabled || false,
        payoutsEnabled: accountData.payouts_enabled || false,
        detailsSubmitted: accountData.details_submitted || false,
        ...(justVerified && { onboardedAt: new Date() }),
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
        justVerified,
        chargesEnabled: updateData.chargesEnabled,
        payoutsEnabled: updateData.payoutsEnabled,
        detailsSubmitted: updateData.detailsSubmitted,
      });

      if (justVerified) {
        this.emitterService.emit(EventTypes.PAYMENT_PROCESSOR_VERIFIED, {
          cuid: paymentProcessor.cuid,
          accountId,
          verifiedAt: new Date(),
        });
      }

      return {
        data: null,
        success: true,
        message: 'PaymentProcessor updated successfully',
      };
    } catch (error: any) {
      this.log.error('Error handling account updated', { accountId, error });
      throw error;
    }
  }

  /**
   * Webhook handler: charge.dispute.created
   * Reverses the transfer to recover disputed funds from PM, then notifies PM.
   */
  async handleDisputeCreated(disputeId: string, disputeData: any): IPromiseReturnedData<void> {
    try {
      const chargeId =
        typeof disputeData.charge === 'string' ? disputeData.charge : disputeData.charge?.id;
      const amount: number = disputeData.amount;
      const currency: string = disputeData.currency;
      const reason: string = disputeData.reason || 'unknown';

      const payment = await this.paymentDAO.findFirst({
        gatewayChargeId: chargeId,
        deletedAt: null,
      });
      if (!payment) {
        this.log.warn('Payment not found for disputed charge', { chargeId, disputeId });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      // Get the original charge to find the transfer ID, then reverse it
      const chargeResult = await this.paymentGatewayService.getCharge(
        IPaymentGatewayProvider.STRIPE,
        chargeId
      );
      const transferRaw = chargeResult.data?.transfer;
      const transferId = typeof transferRaw === 'string' ? transferRaw : (transferRaw as any)?.id;

      if (transferId) {
        try {
          await this.paymentGatewayService.createTransferReversal(
            IPaymentGatewayProvider.STRIPE,
            transferId,
            amount
          );
          this.log.info('Transfer reversed for dispute', { disputeId, transferId, amount });
        } catch (reversalError: any) {
          this.log.error('Transfer reversal failed — blocking payouts', {
            disputeId,
            transferId,
            error: reversalError,
          });
          await this.paymentProcessorDAO.update(
            { cuid: payment.cuid },
            {
              $set: {
                payoutsBlocked: true,
                payoutsBlockedReason: `Transfer reversal failed for dispute ${disputeId}`,
                payoutsBlockedAt: new Date(),
              },
            }
          );
          this.emitterService.emit(EventTypes.PAYMENT_DISPUTE_REVERSAL_FAILED, {
            cuid: payment.cuid,
            pytuid: payment.pytuid,
            disputeId,
            transferId,
            amount,
            currency,
          });
        }
      } else {
        this.log.warn('No transfer on charge — skipping reversal', { chargeId, disputeId });
      }

      await this.paymentDAO.update(
        { _id: payment._id },
        {
          $set: {
            'dispute.disputeId': disputeId,
            'dispute.amount': amount,
            'dispute.reason': reason,
            'dispute.disputedAt': new Date(),
            'dispute.status': 'open',
          },
        }
      );

      this.emitterService.emit(EventTypes.PAYMENT_DISPUTE_CREATED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        disputeId,
        invoiceNumber: payment.invoiceNumber,
        chargeId,
        amount,
        currency,
        reason,
      });

      this.log.info('Dispute handled — transfer reversed, PM notified', {
        disputeId,
        chargeId,
        pytuid: payment.pytuid,
      });
      return { success: true, data: undefined, message: 'Dispute handled' };
    } catch (error: any) {
      this.log.error('Error handling dispute created', { disputeId, error });
      throw error;
    }
  }

  /**
   * Webhook handler: charge.dispute.funds_reinstated
   * Platform won the dispute — re-transfer funds back to PM.
   */
  async handleDisputeWon(disputeId: string, disputeData: any): IPromiseReturnedData<void> {
    try {
      const chargeId =
        typeof disputeData.charge === 'string' ? disputeData.charge : disputeData.charge?.id;
      const amount: number = disputeData.amount;
      const currency: string = disputeData.currency;

      const payment = await this.paymentDAO.findFirst({
        gatewayChargeId: chargeId,
        deletedAt: null,
      });
      if (!payment) {
        this.log.warn('Payment not found for won dispute charge', { chargeId, disputeId });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid: payment.cuid });
      if (!paymentProcessor?.accountId) {
        this.log.warn('Payment processor not found for won dispute', {
          cuid: payment.cuid,
          disputeId,
        });
        return { success: false, data: undefined, message: 'Payment processor not found' };
      }

      // Re-transfer the disputed amount back to the PM
      await this.paymentGatewayService.createTransfer(IPaymentGatewayProvider.STRIPE, {
        amountInCents: amount,
        currency,
        destination: paymentProcessor.accountId,
        metadata: { disputeId, reason: 'dispute_won', invoiceNumber: payment.invoiceNumber },
      });

      await this.paymentDAO.update(
        { _id: payment._id },
        { $set: { 'dispute.status': 'won', 'dispute.resolvedAt': new Date() } }
      );

      this.emitterService.emit(EventTypes.PAYMENT_DISPUTE_WON, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        disputeId,
        invoiceNumber: payment.invoiceNumber,
        chargeId,
        amount,
        currency,
      });

      this.log.info('Dispute won — PM re-transferred and notified', {
        disputeId,
        chargeId,
        pytuid: payment.pytuid,
      });
      return { success: true, data: undefined, message: 'Dispute won handled' };
    } catch (error: any) {
      this.log.error('Error handling dispute won', { disputeId, error });
      throw error;
    }
  }

  /**
   * Webhook handler: charge.dispute.closed (status=lost)
   * Blocks PM payouts — platform is liable for the disputed amount.
   */
  async handleDisputeLost(disputeId: string, disputeData: any): IPromiseReturnedData<void> {
    try {
      const chargeId =
        typeof disputeData.charge === 'string' ? disputeData.charge : disputeData.charge?.id;
      const amount: number = disputeData.amount;
      const currency: string = disputeData.currency;

      const payment = await this.paymentDAO.findFirst({
        gatewayChargeId: chargeId,
        deletedAt: null,
      });
      if (!payment) {
        this.log.warn('Payment not found for lost dispute charge', { chargeId, disputeId });
        return { success: false, data: undefined, message: 'Payment record not found' };
      }

      await this.paymentProcessorDAO.update(
        { cuid: payment.cuid },
        {
          $set: {
            payoutsBlocked: true,
            payoutsBlockedReason: `Dispute ${disputeId} lost — funds debited from platform account`,
            payoutsBlockedAt: new Date(),
          },
        }
      );

      await this.paymentDAO.update(
        { _id: payment._id },
        { $set: { 'dispute.status': 'lost', 'dispute.resolvedAt': new Date() } }
      );

      this.emitterService.emit(EventTypes.PAYMENT_DISPUTE_LOST, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        disputeId,
        invoiceNumber: payment.invoiceNumber,
        chargeId,
        amount,
        currency,
      });

      this.log.info('Dispute lost — payouts blocked, PM notified', {
        disputeId,
        chargeId,
        pytuid: payment.pytuid,
      });
      return { success: true, data: undefined, message: 'Dispute lost handled' };
    } catch (error: any) {
      this.log.error('Error handling dispute lost', { disputeId, error });
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
    refunded: number;
    collectionRate: number;
    currency: string;
  }> {
    try {
      const client = await this.clientDAO.findFirst({ cuid });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      // Fetch ALL payments for this client across all time (no date filter).
      // Overdue payments from past months are still outstanding and relevant —
      // restricting to current month would hide unpaid historical debt.
      const result = await this.paymentDAO.findByCuid(cuid, {}, { limit: 10000 });
      const allPayments = result.items || [];

      // Running totals — all values are in cents (e.g. 150000 = $1,500.00)
      let expectedRevenue = 0; // PAID + PENDING + OVERDUE (excludes CANCELLED, FAILED, REFUNDED)
      let collected = 0; // Sum of all PAID payments (baseAmount)
      let pending = 0; // Sum of all PENDING payments (baseAmount)
      let overdue = 0; // Sum of all OVERDUE payments (baseAmount)
      let refunded = 0; // Sum of all REFUNDED amounts (refundAmount if partial, else baseAmount)

      allPayments.forEach((payment) => {
        // baseAmount is stored in cents. Guard against missing values on legacy records.
        const amount = payment.baseAmount ?? 0;

        switch (payment.status) {
          // CANCELLED and FAILED payments are excluded from all stats —
          // they were never collected and are no longer expected.
          case PaymentRecordStatus.CANCELLED:
          case PaymentRecordStatus.FAILED:
            break;

          // REFUNDED: use refundAmount (partial refund) or full baseAmount (full refund).
          // Refunded payments are excluded from expectedRevenue since the money was returned.
          case PaymentRecordStatus.REFUNDED:
            refunded += payment.refund?.amount || amount;
            break;

          // PENDING: payment is due but not yet collected.
          // Counts toward expectedRevenue because it is expected to be paid.
          case PaymentRecordStatus.PENDING:
            expectedRevenue += amount;
            pending += amount;
            break;

          // OVERDUE: payment is past its due date and still unpaid.
          // Counts toward expectedRevenue — the money is owed and tracked.
          case PaymentRecordStatus.OVERDUE:
            expectedRevenue += amount;
            overdue += amount;
            break;

          // PAID: payment was successfully collected.
          // Counts toward both expectedRevenue and collected.
          case PaymentRecordStatus.PAID:
            expectedRevenue += amount;
            collected += amount;
            break;

          default:
            this.log.warn('Unknown payment status encountered', {
              status: payment.status,
              pytuid: payment.pytuid,
            });
            break;
        }
      });

      // collectionRate = what percentage of expected revenue has actually been collected.
      // Formula: (collected / expectedRevenue) * 100, rounded to nearest integer.
      // Example: collected=$453,818 / expected=$537,418 = ~84%
      const collectionRate = calcCollectionRate(collected, expectedRevenue);

      return {
        success: true,
        data: {
          expectedRevenue, // PAID + PENDING + OVERDUE (in cents)
          collected, // PAID only (in cents)
          pending, // PENDING only (in cents)
          overdue, // OVERDUE only (in cents)
          refunded, // REFUNDED amounts (in cents)
          collectionRate, // percentage (0–100)
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
