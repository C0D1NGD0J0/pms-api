import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { EventEmitterService } from '@services/eventEmitter';
import { InvoiceStatus } from '@interfaces/invoice.interface';
import { SubscriptionPlanConfig } from '@services/subscription';
import { IPromiseReturnedData } from '@interfaces/utils.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { MaintenanceInvoiceApprovedPayload, EventTypes } from '@interfaces/events.interface';
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
  ISubscriptionStatus,
  PaymentRecordType,
  IPaymentDocument,
  PaymentMethod,
} from '@interfaces/index';

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  invoiceDAO: InvoiceDAO;
  profileDAO: ProfileDAO;
  paymentDAO: PaymentDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class MaintenancePaymentService {
  private readonly log: Logger;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;
  private readonly emitterService: EventEmitterService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly invoiceDAO: InvoiceDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly clientDAO: ClientDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly userDAO: UserDAO;

  constructor({
    paymentGatewayService,
    paymentProcessorDAO,
    subscriptionPlanConfig,
    emitterService,
    subscriptionDAO,
    invoiceDAO,
    profileDAO,
    paymentDAO,
    clientDAO,
    leaseDAO,
    userDAO,
  }: IConstructor) {
    this.log = createLogger('MaintenancePaymentService');
    this.paymentGatewayService = paymentGatewayService;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
    this.invoiceDAO = invoiceDAO;
    this.profileDAO = profileDAO;
    this.paymentDAO = paymentDAO;
    this.clientDAO = clientDAO;
    this.leaseDAO = leaseDAO;
    this.userDAO = userDAO;
    this.emitterService.on(
      EventTypes.MAINTENANCE_INVOICE_APPROVED,
      this.handleMaintenanceInvoiceApproved
    );
  }

  /**
   * Event handler for MAINTENANCE_INVOICE_APPROVED.
   * Creates a tenant charge when the request is billable.
   * Vendor payout tracking lives on the Invoice document — no separate payment record needed.
   */
  handleMaintenanceInvoiceApproved = async (
    payload: MaintenanceInvoiceApprovedPayload
  ): Promise<void> => {
    if (payload.isBillable && payload.tenantId) {
      try {
        await this.createMaintenanceCharge(payload);
      } catch (err: unknown) {
        this.log.error(
          { err, mruid: payload.mruid, cuid: payload.cuid },
          '[MaintenancePaymentService] Failed to create tenant maintenance charge'
        );
      }
    }
  };

  /**
   * PM-initiated charge: creates a PENDING payment record linking the tenant to
   * a specific maintenance request.
   */
  async chargeForMaintenance(
    cuid: string,
    currentUserId: string,
    body: { mruid: string; tenantId: string; amount: number; description?: string }
  ): IPromiseReturnedData<IPaymentDocument> {
    const { mruid, tenantId, amount, description } = body;

    const client = await this.clientDAO.findFirst({ cuid });
    if (!client) {
      throw new NotFoundError({ message: 'Client not found' });
    }

    const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
    if (!subscription) {
      throw new BadRequestError({ message: 'No subscription found' });
    }
    if (subscription.status !== ISubscriptionStatus.ACTIVE) {
      this.log.warn(
        'Subscription not active — maintenance charge will be collected but payouts are paused',
        { cuid, subscriptionStatus: subscription.status }
      );
    }

    const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
    if (paymentProcessor?.payoutsBlocked) {
      throw new ForbiddenError({
        message:
          paymentProcessor.payoutsBlockedReason ||
          'Payouts are currently blocked for this account.',
      });
    }

    const tenantProfile = await this.profileDAO.getProfileByUserId(tenantId);
    if (!tenantProfile) {
      throw new NotFoundError({ message: 'Tenant profile not found' });
    }

    const existingCharge = await this.paymentDAO.findFirst({
      cuid,
      maintenanceRequestUid: mruid,
      paymentType: PaymentRecordType.MAINTENANCE,
      vendorId: { $exists: false },
      deletedAt: null,
    });
    if (existingCharge) {
      this.log.warn(
        { mruid, cuid },
        '[MaintenancePaymentService] Tenant maintenance charge already exists — returning existing record'
      );
      return { success: true, data: existingCharge, message: 'Charge already created' };
    }

    const activeLease = await this.leaseDAO.getActiveLeaseByTenant(cuid, tenantId);
    const currency = activeLease?.fees?.currency ?? 'USD';

    const transactionFeePercent = this.subscriptionPlanConfig.getTransactionFeePercent(
      subscription.planName
    );
    const serviceFeeCents = Math.round((amount * transactionFeePercent) / 100);
    const totalAmount = amount + serviceFeeCents;
    const lineItems = [
      { description: 'Maintenance Service', amountInCents: amount },
      ...(serviceFeeCents > 0
        ? [{ description: 'Service Fee', amountInCents: serviceFeeCents }]
        : []),
    ];

    const GRACE_PERIOD_DAYS = 5;
    const dueDate = dayjs().add(GRACE_PERIOD_DAYS, 'day').toDate();

    const payment = await this.paymentDAO.insert({
      cuid,
      paymentType: PaymentRecordType.MAINTENANCE,
      paymentMethod: PaymentMethod.OTHER,
      status: PaymentRecordStatus.PENDING,
      tenant: tenantProfile._id,
      maintenanceRequestUid: mruid,
      baseAmount: totalAmount,
      applicationFee: serviceFeeCents,
      currency,
      processingFee: 0,
      lineItems,
      description: description || `Maintenance charge for request ${mruid}`,
      isManualEntry: false,
      recordedBy: new Types.ObjectId(currentUserId),
      dueDate,
    });

    this.log.info(
      { mruid, amount, cuid, dueDate },
      '[MaintenancePaymentService] PM-initiated maintenance charge created'
    );

    return { success: true, data: payment };
  }

  /**
   * Transfer funds from the PM's Stripe Connect account to the vendor's Stripe Connect account.
   * Uses the approved Invoice as the single source of truth — no separate vendor expense
   * payment record is needed. Payout state (status, paidAt, transferId) is persisted on
   * the Invoice document directly.
   */
  async payVendor(cuid: string, mruid: string): IPromiseReturnedData<null> {
    try {
      const invoice = await this.invoiceDAO.findByMaintenanceRequest(mruid, cuid);
      if (!invoice) {
        throw new NotFoundError({
          message: 'No invoice found for this maintenance request.',
        });
      }
      if (invoice.status !== InvoiceStatus.APPROVED) {
        throw new BadRequestError({
          message: 'Invoice must be approved before paying the vendor.',
        });
      }
      if (invoice.vendorPayoutStatus === 'paid') {
        throw new BadRequestError({
          message: 'Vendor has already been paid for this request.',
        });
      }

      const pmProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!pmProcessor?.accountId || !pmProcessor.chargesEnabled) {
        throw new BadRequestError({
          message: 'Payment account not configured or charges not enabled.',
        });
      }

      // Resolve vendor from the invoice submitter
      const vendorUser = await this.userDAO.findFirst({
        _id: invoice.submittedBy,
        deletedAt: null,
      });
      if (!vendorUser?.uid) {
        throw new NotFoundError({ message: 'Vendor user record not found.' });
      }
      const vendorProcessor = await this.paymentProcessorDAO.findByVuid(vendorUser.uid, cuid);
      if (!vendorProcessor?.accountId) {
        throw new BadRequestError({
          message:
            'Vendor has not set up their payout account. Ask them to complete Stripe Connect onboarding.',
        });
      }
      if (!vendorProcessor.payoutsEnabled) {
        throw new BadRequestError({
          message:
            'Vendor payout account is not yet verified. Ask them to complete their Stripe Connect setup.',
        });
      }

      const currency = (invoice.currency ?? 'usd').toLowerCase();
      const transferResult = await this.paymentGatewayService.createTransfer(
        IPaymentGatewayProvider.STRIPE,
        {
          amountInCents: invoice.amountInCents,
          currency,
          destination: vendorProcessor.accountId,
          metadata: { cuid, mruid, invuid: invoice.invuid },
        }
      );
      if (!transferResult.success || !transferResult.data) {
        throw new Error(transferResult.message || 'Failed to transfer funds to vendor.');
      }

      // Invoice is the single source of truth for vendor payout state
      await this.invoiceDAO.updateById((invoice as any)._id.toString(), {
        $set: {
          vendorPayoutStatus: 'paid',
          vendorPaidAt: new Date(),
          vendorPayoutTransferId: transferResult.data.transferId,
        },
      });

      this.emitterService.emit(EventTypes.MAINTENANCE_VENDOR_PAID, {
        transferId: transferResult.data.transferId,
        amountInCents: invoice.amountInCents,
        vendorId: vendorUser._id.toString(),
        invuid: invoice.invuid,
        mruid,
        cuid,
      });

      this.log.info(
        { mruid, invuid: invoice.invuid, transferId: transferResult.data.transferId, cuid },
        '[MaintenancePaymentService] Vendor paid — transfer created'
      );

      return { success: true, data: null, message: 'Vendor paid successfully.' };
    } catch (error: any) {
      this.log.error({ error: error.message, cuid, mruid }, 'Error paying vendor');
      throw error;
    }
  }

  private async createMaintenanceCharge(payload: MaintenanceInvoiceApprovedPayload): Promise<void> {
    const { cuid, mruid, tenantId, amount, approvedBy, title } = payload;

    const existing = await this.paymentDAO.findFirst({
      cuid,
      maintenanceRequestUid: mruid,
      paymentType: PaymentRecordType.MAINTENANCE,
      vendorId: { $exists: false },
      deletedAt: null,
    });
    if (existing) {
      this.log.warn(
        { mruid, cuid },
        '[MaintenancePaymentService] Tenant maintenance charge already exists — skipping duplicate'
      );
      return;
    }

    const tenantProfile = await this.profileDAO.getProfileByUserId(tenantId!);
    if (!tenantProfile) {
      this.log.warn(
        { mruid, tenantId },
        '[MaintenancePaymentService] Skipping maintenance charge: tenant profile not found'
      );
      return;
    }

    const activeLease = await this.leaseDAO.getActiveLeaseByTenant(cuid, tenantId!);
    const currency = activeLease?.fees?.currency ?? 'USD';

    const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
    const planName = subscription?.planName ?? 'essential';
    const maintenanceFeePercent = this.subscriptionPlanConfig.getTransactionFeePercent(planName);
    const serviceFeeCents = Math.round((amount * maintenanceFeePercent) / 100);

    const GRACE_PERIOD_DAYS = 5;
    const dueDate = dayjs().add(GRACE_PERIOD_DAYS, 'day').toDate();

    const totalAmount = amount + serviceFeeCents;
    const vendorItems: { description: string; amountInCents: number }[] = payload.invoiceLineItems
      ?.length
      ? payload.invoiceLineItems
      : [{ description: 'Maintenance Service', amountInCents: amount }];
    const lineItems = [
      ...vendorItems,
      ...(serviceFeeCents > 0
        ? [{ description: 'Service Fee', amountInCents: serviceFeeCents }]
        : []),
    ];

    const record = await this.paymentDAO.insert({
      cuid,
      paymentType: PaymentRecordType.MAINTENANCE,
      paymentMethod: PaymentMethod.OTHER,
      status: PaymentRecordStatus.PENDING,
      tenant: tenantProfile._id,
      maintenanceRequestUid: mruid,
      baseAmount: totalAmount,
      applicationFee: serviceFeeCents,
      currency,
      processingFee: 0,
      description: `Maintenance charge for request ${mruid}`,
      lineItems,
      isManualEntry: false,
      recordedBy: approvedBy ? new Types.ObjectId(approvedBy) : undefined,
      dueDate,
    });

    this.log.info(
      { mruid, amount, serviceFeeCents, cuid, dueDate },
      '[MaintenancePaymentService] Maintenance charge created for tenant'
    );

    this.emitterService.emit(EventTypes.MAINTENANCE_CHARGE_CREATED, {
      pytuid: record.pytuid,
      tenantId: tenantId!,
      amountInCents: totalAmount,
      currency,
      mruid,
      title,
      cuid,
      dueDate,
    });
  }
}
