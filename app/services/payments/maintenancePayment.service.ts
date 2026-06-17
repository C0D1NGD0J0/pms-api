import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { EventEmitterService } from '@services/eventEmitter';
import { InvoiceStatus } from '@interfaces/invoice.interface';
import { PlanName } from '@interfaces/subscription.interface';
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
  VendorDAO,
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
  vendorDAO: VendorDAO;
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
  private readonly vendorDAO: VendorDAO;
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
    vendorDAO,
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
    this.vendorDAO = vendorDAO;
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
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Client' }) });
    }

    const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
    if (!subscription) {
      throw new BadRequestError({
        message: t('common.errors.notFound', { resource: 'Subscription' }),
      });
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
      throw new NotFoundError({
        message: t('common.errors.notFound', { resource: 'Tenant profile' }),
      });
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

    const { totalAmount, serviceFeeCents, lineItems, currency, dueDate } =
      await this.buildMaintenanceChargeSetup({
        cuid,
        tenantId,
        amount,
        planName: subscription.planName,
        vendorLineItems: [{ description: 'Maintenance Service', amountInCents: amount }],
      });

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
          message: t('common.errors.notFound', { resource: 'Invoice' }),
        });
      }
      if (invoice.status !== InvoiceStatus.APPROVED) {
        throw new BadRequestError({
          message: 'Invoice must be approved before paying the vendor.',
        });
      }
      if (invoice.vendorPayoutStatus === 'paid') {
        throw new BadRequestError({
          message: t('common.errors.alreadyInState', { resource: 'Vendor payout', state: 'paid' }),
        });
      }

      const pmProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!pmProcessor?.accountId || !pmProcessor.chargesEnabled) {
        throw new BadRequestError({
          message: 'Payment account not configured or charges not enabled.',
        });
      }

      // Resolve vendor ORG from the invoice submitter (a team member of the vendor org)
      const vendorUser = await this.userDAO.findFirst({
        _id: invoice.submittedBy,
        deletedAt: null,
      });
      if (!vendorUser?.uid) {
        throw new NotFoundError({
          message: t('common.errors.notFound', { resource: 'Vendor user record' }),
        });
      }

      // Resolve vendor org vuid: team members have linkedVendorUid,
      // primary account holders (linkedVendorUid is null) are looked up by userId
      const clientEntry = vendorUser.cuids?.find((c: any) => c.cuid === cuid);
      let vendorVuid = clientEntry?.linkedVendorUid;
      if (!vendorVuid) {
        const vendorOrg = await this.vendorDAO.findFirst({
          'connectedClients.primaryAccountHolderUserId': vendorUser._id,
          deletedAt: null,
        });
        vendorVuid = vendorOrg?.vuid;
      }
      if (!vendorVuid) {
        throw new BadRequestError({
          message: 'Could not resolve vendor organization for this user.',
        });
      }

      // Global Stripe-level check — account frozen/closed affects all clients
      const vendorProcessor = await this.paymentProcessorDAO.findByVuid(vendorVuid);
      if (!vendorProcessor?.accountId) {
        throw new BadRequestError({
          message:
            'Vendor has not set up their payout account. Ask them to complete Stripe Connect onboarding.',
        });
      }
      if ((vendorProcessor as any).payoutsBlocked) {
        throw new ForbiddenError({
          message:
            (vendorProcessor as any).payoutsBlockedReason ||
            'Vendor payout account is globally blocked.',
        });
      }

      // Per-client check — isSetup, enabled flags, and admin block from connectedClients
      const vendorRecord = await this.vendorDAO.findFirst({
        vuid: vendorVuid,
        deletedAt: null,
      });
      const clientConn = vendorRecord?.connectedClients?.find((c: any) => c.cuid === cuid);
      if (!clientConn?.payoutAccount?.isSetup || !clientConn?.payoutAccount?.payoutsEnabled) {
        throw new BadRequestError({
          message:
            'Vendor payout account is not yet verified. Ask them to complete their Stripe Connect setup.',
        });
      }
      if (clientConn.payoutAccount.payoutsBlocked) {
        throw new ForbiddenError({
          message:
            clientConn.payoutAccount.payoutsBlockedReason ||
            'Vendor payouts are blocked for this account.',
        });
      }

      const currency = (invoice.currency ?? 'usd').toLowerCase();

      // Maintenance charges use separate charges (no transfer_data) so funds stay
      // on the platform. We need the tenant's charge ID to link via source_transaction.
      const paymentRecord = await this.paymentDAO.findFirst({
        cuid,
        maintenanceRequestUid: mruid,
        paymentType: PaymentRecordType.MAINTENANCE,
        vendorId: { $exists: false },
        status: PaymentRecordStatus.PAID,
        deletedAt: null,
      });
      if (!paymentRecord?.gatewayChargeId) {
        throw new BadRequestError({
          message: 'Tenant payment charge not found. The tenant may not have paid yet.',
        });
      }

      // Transfer vendor amount from platform to vendor's Connect account.
      // source_transaction links to the tenant's charge so Stripe earmarks the funds
      // and queues the transfer if the charge hasn't fully settled yet.
      const transferResult = await this.paymentGatewayService.createTransfer(
        IPaymentGatewayProvider.STRIPE,
        {
          amountInCents: invoice.amountInCents,
          currency,
          destination: vendorProcessor.accountId,
          sourceTransaction: paymentRecord.gatewayChargeId,
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

    const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
    const planName = subscription?.planName ?? 'essential';

    const vendorItems: { description: string; amountInCents: number }[] = payload.invoiceLineItems
      ?.length
      ? payload.invoiceLineItems
      : [{ description: 'Maintenance Service', amountInCents: amount }];

    const { totalAmount, serviceFeeCents, lineItems, currency, dueDate } =
      await this.buildMaintenanceChargeSetup({
        cuid,
        tenantId: tenantId!,
        amount,
        planName,
        vendorLineItems: vendorItems,
        invoiceCurrency: payload.currency,
      });

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

  /**
   * Shared setup logic for maintenance charges: subscription fee calculation,
   * currency resolution, line item assembly, and due date computation.
   */
  private async buildMaintenanceChargeSetup(params: {
    cuid: string;
    tenantId: string;
    amount: number;
    planName: PlanName;
    vendorLineItems: { description: string; amountInCents: number }[];
    invoiceCurrency?: string;
  }): Promise<{
    totalAmount: number;
    serviceFeeCents: number;
    lineItems: { description: string; amountInCents: number }[];
    currency: string;
    dueDate: Date;
  }> {
    const { cuid, tenantId, amount, planName, vendorLineItems, invoiceCurrency } = params;

    const activeLease = await this.leaseDAO.getActiveLeaseByTenant(cuid, tenantId);
    // Invoice currency takes priority — it's the currency the vendor invoiced in
    const currency = invoiceCurrency || activeLease?.fees?.currency || 'USD';

    const transactionFeePercent = this.subscriptionPlanConfig.getTransactionFeePercent(planName);
    const serviceFeeCents = Math.round((amount * transactionFeePercent) / 100);
    const totalAmount = amount + serviceFeeCents;

    const lineItems = [
      ...vendorLineItems,
      ...(serviceFeeCents > 0
        ? [{ description: 'Service Fee', amountInCents: serviceFeeCents }]
        : []),
    ];

    const GRACE_PERIOD_DAYS = 5;
    const dueDate = dayjs().add(GRACE_PERIOD_DAYS, 'day').toDate();

    return { totalAmount, serviceFeeCents, lineItems, currency, dueDate };
  }
}
