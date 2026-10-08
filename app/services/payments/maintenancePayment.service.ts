import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { EventEmitterService } from '@services/eventEmitter';
import { PlanName } from '@interfaces/subscription.interface';
import { SMSService } from '@services/smsService/sms.service';
import { SubscriptionPlanConfig } from '@services/subscription';
import { IPromiseReturnedData } from '@interfaces/utils.interface';
import { IInvoiceDocument, InvoiceStatus } from '@interfaces/invoice.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { IMaintenanceRequestDocument } from '@interfaces/maintenanceRequest.interface';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import {
  MaintenanceInvoiceApprovedPayload,
  MaintenanceChargeSkippedPayload,
  EventTypes,
} from '@interfaces/events.interface';
import {
  MaintenanceRequestDAO,
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
  SMSMessageType,
  PaymentMethod,
} from '@interfaces/index';

const LIVE_MAINTENANCE_CHARGE_STATUSES = [
  PaymentRecordStatus.PENDING,
  PaymentRecordStatus.OVERDUE,
  PaymentRecordStatus.PROCESSING,
  PaymentRecordStatus.PAID,
];

// A payout claim older than this is assumed to belong to a crashed attempt and may be
// re-claimed; the Stripe idempotency key makes the retried transfer safe.
const STALE_VENDOR_PAYOUT_CLAIM_MS = 15 * 60 * 1000;

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  maintenanceRequestDAO: MaintenanceRequestDAO;
  paymentGatewayService: PaymentGatewayService;
  paymentProcessorDAO: PaymentProcessorDAO;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  smsService: SMSService;
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
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;
  private readonly emitterService: EventEmitterService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly invoiceDAO: InvoiceDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly clientDAO: ClientDAO;
  private readonly smsService: SMSService;
  private readonly vendorDAO: VendorDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly userDAO: UserDAO;

  constructor({
    maintenanceRequestDAO,
    paymentGatewayService,
    paymentProcessorDAO,
    subscriptionPlanConfig,
    emitterService,
    subscriptionDAO,
    smsService,
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
    this.maintenanceRequestDAO = maintenanceRequestDAO;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
    this.invoiceDAO = invoiceDAO;
    this.profileDAO = profileDAO;
    this.paymentDAO = paymentDAO;
    this.smsService = smsService;
    this.clientDAO = clientDAO;
    this.vendorDAO = vendorDAO;
    this.leaseDAO = leaseDAO;
    this.userDAO = userDAO;
  }

  registerEventListeners(): void {
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
    if (!payload.isBillable) return;

    if (!payload.tenantId) {
      this.reportSkippedCharge(payload, 'no_tenant');
      return;
    }

    try {
      await this.createMaintenanceCharge(payload);
    } catch (err: unknown) {
      this.log.error(
        { err, mruid: payload.mruid, cuid: payload.cuid },
        '[MaintenancePaymentService] Failed to create tenant maintenance charge'
      );
    }
  };

  private reportSkippedCharge(
    payload: MaintenanceInvoiceApprovedPayload,
    reason: MaintenanceChargeSkippedPayload['reason']
  ): void {
    this.log.warn(
      { mruid: payload.mruid, cuid: payload.cuid, reason },
      '[MaintenancePaymentService] Billable invoice approved but no tenant charge was created — PM must bill manually'
    );
    this.emitterService.emit(EventTypes.MAINTENANCE_CHARGE_SKIPPED, {
      reason,
      notifyUserId: payload.approvedBy,
      amountInCents: payload.amount,
      currency: payload.currency,
      title: payload.title,
      mruid: payload.mruid,
      cuid: payload.cuid,
    });
  }

  /**
   * Creates a PENDING tenant charge for an approved, billable maintenance invoice.
   * Used by the PM endpoint, the tenant "ensure" endpoint and lease-expiry offboarding.
   * The amount is always derived from the approved invoice (+ service fee) — any
   * caller-supplied amount is ignored.
   */
  async chargeForMaintenance(
    cuid: string,
    currentUserId: string,
    body: { mruid: string; tenantId: string; amount?: number; description?: string }
  ): IPromiseReturnedData<IPaymentDocument> {
    const { mruid, tenantId, description } = body;

    const client = await this.clientDAO.findFirst({ cuid });
    if (!client) {
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Client' }) });
    }

    const { maintenanceRequest, invoice } = await this.getBillableRequestWithApprovedInvoice(
      cuid,
      mruid
    );
    await this.assertTenantCanBeBilledForRequest(cuid, tenantId, maintenanceRequest);

    const amount = invoice.amountInCents;
    if (body.amount !== undefined && body.amount !== amount) {
      this.log.warn(
        { mruid, cuid, requestedAmount: body.amount, invoiceAmount: amount },
        '[MaintenancePaymentService] Ignoring caller-supplied amount — charging the approved invoice amount'
      );
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
    if (!paymentProcessor?.accountId || !paymentProcessor.chargesEnabled) {
      throw new BadRequestError({
        message:
          'Payment account not configured or charges not enabled. Complete KYC setup before creating charges.',
      });
    }
    if (paymentProcessor.payoutsBlocked || paymentProcessor.payoutsPaused) {
      throw new ForbiddenError({
        message:
          paymentProcessor.payoutsBlockedReason ||
          'Payouts are currently blocked or paused for this account.',
      });
    }

    const tenantProfile = await this.profileDAO.getProfileByUserId(tenantId);
    if (!tenantProfile) {
      throw new NotFoundError({
        message: t('common.errors.notFound', { resource: 'Tenant profile' }),
      });
    }

    const existingCharge = await this.findLiveTenantCharge(cuid, mruid);
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
        vendorLineItems: this.toVendorLineItems(invoice.lineItems, amount),
        invoiceCurrency: invoice.currency,
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
      '[MaintenancePaymentService] Maintenance charge created from approved invoice'
    );

    // Tell the tenant before any auto-charge can run (the overdue auto-charge cron
    // only acts after dueDate).
    this.emitterService.emit(EventTypes.MAINTENANCE_CHARGE_CREATED, {
      pytuid: payment.pytuid,
      tenantId,
      amountInCents: totalAmount,
      serviceFeeInCents: serviceFeeCents,
      currency,
      mruid,
      title: maintenanceRequest.title,
      cuid,
      dueDate,
    });

    return { success: true, data: payment };
  }

  /**
   * Returns the service fee and tenant total for a maintenance invoice amount so the
   * tenant can be quoted exactly what they will be charged.
   */
  async quoteTenantMaintenanceCharge(
    cuid: string,
    invoiceAmountInCents: number
  ): Promise<{ serviceFeeCents: number; totalAmount: number }> {
    const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
    return this.calculateServiceFee(invoiceAmountInCents, subscription?.planName ?? 'essential');
  }

  private calculateServiceFee(
    amount: number,
    planName: PlanName
  ): { serviceFeeCents: number; totalAmount: number } {
    const transactionFeePercent = this.subscriptionPlanConfig.getTransactionFeePercent(planName);
    const serviceFeeCents = Math.round((amount * transactionFeePercent) / 100);
    return { serviceFeeCents, totalAmount: amount + serviceFeeCents };
  }

  /**
   * A charge "exists" only when it is still live — cancelled, refunded or failed
   * charges must not block a fresh charge for the same request.
   */
  private async findLiveTenantCharge(
    cuid: string,
    mruid: string
  ): Promise<IPaymentDocument | null> {
    return this.paymentDAO.findFirst({
      cuid,
      maintenanceRequestUid: mruid,
      paymentType: PaymentRecordType.MAINTENANCE,
      vendorId: { $exists: false },
      status: { $in: LIVE_MAINTENANCE_CHARGE_STATUSES },
      deletedAt: null,
    });
  }

  private async getBillableRequestWithApprovedInvoice(
    cuid: string,
    mruid: string
  ): Promise<{ maintenanceRequest: IMaintenanceRequestDocument; invoice: IInvoiceDocument }> {
    const maintenanceRequest = await this.maintenanceRequestDAO.getByMruid(mruid, cuid);
    if (!maintenanceRequest) {
      throw new NotFoundError({
        message: t('common.errors.notFound', { resource: 'Maintenance request' }),
      });
    }
    if (!maintenanceRequest.isBillable) {
      throw new BadRequestError({
        message: 'This maintenance request is not billable to the tenant.',
      });
    }

    const invoice = await this.invoiceDAO.findByMaintenanceRequest(mruid, cuid);
    if (!invoice || invoice.status !== InvoiceStatus.APPROVED) {
      throw new BadRequestError({
        message: 'An approved invoice is required before the tenant can be charged.',
      });
    }
    if (!invoice.amountInCents || invoice.amountInCents <= 0) {
      throw new BadRequestError({ message: 'The approved invoice has no chargeable amount.' });
    }

    return { maintenanceRequest, invoice };
  }

  /**
   * The billed tenant must be the request's tenant, or a tenant leased on the
   * request's property/unit (PM may bill another occupant), and must belong to this client.
   */
  private async assertTenantCanBeBilledForRequest(
    cuid: string,
    tenantId: string,
    maintenanceRequest: IMaintenanceRequestDocument
  ): Promise<void> {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Tenant' }) });
    }

    const tenantUser = await this.userDAO.findFirst({
      _id: new Types.ObjectId(tenantId),
      'cuids.cuid': cuid,
      deletedAt: null,
    });
    if (!tenantUser) {
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Tenant' }) });
    }

    const isRequestTenant = maintenanceRequest.tenantId?.toString() === tenantId;
    if (isRequestTenant) return;

    const leaseOnRequestProperty = await this.leaseDAO.findFirst({
      cuid,
      tenantId: new Types.ObjectId(tenantId),
      'property.id': maintenanceRequest.propertyId,
      ...(maintenanceRequest.propertyUnitId && {
        'property.unitId': maintenanceRequest.propertyUnitId,
      }),
      deletedAt: null,
    });
    if (!leaseOnRequestProperty) {
      throw new ForbiddenError({
        message: 'This tenant is not associated with the maintenance request.',
      });
    }
  }

  private toVendorLineItems(
    invoiceLineItems: { description: string; amountInCents: number }[] | undefined,
    amount: number
  ): { description: string; amountInCents: number }[] {
    return invoiceLineItems?.length
      ? invoiceLineItems.map((item) => ({
          description: item.description,
          amountInCents: item.amountInCents,
        }))
      : [{ description: 'Maintenance Service', amountInCents: amount }];
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
      if (invoice.vendorPayoutStatus === 'processing' && !this.isStalePayoutClaim(invoice)) {
        throw new BadRequestError({ message: 'A vendor payout for this invoice is in progress.' });
      }

      const pmProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!pmProcessor?.accountId || !pmProcessor.chargesEnabled) {
        throw new BadRequestError({
          message: 'Payment account not configured or charges not enabled.',
        });
      }
      if (pmProcessor.payoutsBlocked || pmProcessor.payoutsPaused) {
        throw new ForbiddenError({
          message: 'PM payouts are currently blocked or paused.',
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
      if (vendorProcessor.payoutsBlocked || vendorProcessor.payoutsPaused) {
        throw new ForbiddenError({
          message:
            vendorProcessor.payoutsBlockedReason ||
            'Vendor payout account is globally blocked or paused.',
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

      // Partial refunds keep the charge PAID — pay out only while the funds still held
      // on the charge cover the vendor invoice.
      const refundedAmount = paymentRecord.refund?.amount ?? 0;
      const retainedAmount = (paymentRecord.baseAmount ?? 0) - refundedAmount;
      if (refundedAmount > 0 && retainedAmount < invoice.amountInCents) {
        throw new BadRequestError({
          message:
            'The tenant charge has been refunded below the vendor invoice amount. Resolve the refund before paying the vendor.',
        });
      }

      const invoiceId = (invoice as any)._id.toString();
      const claimedInvoice = await this.claimInvoiceForPayout(invoiceId);
      if (!claimedInvoice) {
        throw new BadRequestError({
          message: 'A vendor payout for this invoice is in progress or already completed.',
        });
      }

      // Transfer vendor amount from platform to vendor's Connect account.
      // source_transaction links to the tenant's charge so Stripe earmarks the funds
      // and queues the transfer if the charge hasn't fully settled yet.
      let transferResult: Awaited<ReturnType<PaymentGatewayService['createTransfer']>>;
      try {
        transferResult = await this.paymentGatewayService.createTransfer(
          IPaymentGatewayProvider.STRIPE,
          {
            amountInCents: invoice.amountInCents,
            currency,
            destination: vendorProcessor.accountId,
            sourceTransaction: paymentRecord.gatewayChargeId,
            metadata: { cuid, mruid, invuid: invoice.invuid },
            idempotencyKey: `vendor-payout:${invoice.invuid}`,
          }
        );
      } catch (transferError) {
        await this.releasePayoutClaim(invoiceId);
        throw transferError;
      }
      if (!transferResult.success || !transferResult.data) {
        await this.releasePayoutClaim(invoiceId);
        throw new Error(transferResult.message || 'Failed to transfer funds to vendor.');
      }

      // Invoice is the single source of truth for vendor payout state
      await this.invoiceDAO.updateById(invoiceId, {
        $set: {
          vendorPayoutStatus: 'paid',
          vendorPaidAt: new Date(),
          vendorPayoutTransferId: transferResult.data.transferId,
        },
        $unset: { vendorPayoutClaimedAt: 1 },
      });

      this.emitterService.emit(EventTypes.MAINTENANCE_VENDOR_PAID, {
        transferId: transferResult.data.transferId,
        amountInCents: invoice.amountInCents,
        vendorId: vendorUser._id.toString(),
        invuid: invoice.invuid,
        mruid,
        cuid,
      });

      // SMS notification to vendor
      this.smsService
        .sendToUser(
          cuid,
          vendorUser._id.toString(),
          `A payout has been initiated for service request #${mruid}.`,
          SMSMessageType.SYSTEM
        )
        .catch((err: any) => {
          this.log.warn({ err }, 'SMS send failed (fire-and-forget)');
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

  /**
   * Atomically moves the invoice payout from pending → processing so two concurrent
   * payout attempts (PM click + auto-payout cron) cannot both transfer. A stale
   * processing claim (crashed attempt) may be re-claimed.
   */
  private async claimInvoiceForPayout(invoiceId: string): Promise<IInvoiceDocument | null> {
    const staleClaimCutoff = new Date(Date.now() - STALE_VENDOR_PAYOUT_CLAIM_MS);
    return this.invoiceDAO.update(
      {
        _id: new Types.ObjectId(invoiceId),
        status: InvoiceStatus.APPROVED,
        $or: [
          { vendorPayoutStatus: 'pending' },
          { vendorPayoutStatus: { $exists: false } },
          { vendorPayoutStatus: null },
          { vendorPayoutStatus: 'processing', vendorPayoutClaimedAt: { $lt: staleClaimCutoff } },
          { vendorPayoutStatus: 'processing', vendorPayoutClaimedAt: null },
        ],
      },
      { $set: { vendorPayoutStatus: 'processing', vendorPayoutClaimedAt: new Date() } }
    );
  }

  private async releasePayoutClaim(invoiceId: string): Promise<void> {
    try {
      await this.invoiceDAO.update(
        { _id: new Types.ObjectId(invoiceId), vendorPayoutStatus: 'processing' },
        { $set: { vendorPayoutStatus: 'pending' }, $unset: { vendorPayoutClaimedAt: 1 } }
      );
    } catch (err) {
      this.log.error(
        { err, invoiceId },
        '[MaintenancePaymentService] Failed to release vendor payout claim'
      );
    }
  }

  private isStalePayoutClaim(invoice: IInvoiceDocument): boolean {
    if (!invoice.vendorPayoutClaimedAt) return true;
    return (
      Date.now() - new Date(invoice.vendorPayoutClaimedAt).getTime() > STALE_VENDOR_PAYOUT_CLAIM_MS
    );
  }

  private async createMaintenanceCharge(payload: MaintenanceInvoiceApprovedPayload): Promise<void> {
    const { cuid, mruid, tenantId, amount, approvedBy, title } = payload;

    const existing = await this.findLiveTenantCharge(cuid, mruid);
    if (existing) {
      this.log.warn(
        { mruid, cuid },
        '[MaintenancePaymentService] Tenant maintenance charge already exists — skipping duplicate'
      );
      return;
    }

    const tenantProfile = await this.profileDAO.getProfileByUserId(tenantId!);
    if (!tenantProfile) {
      this.reportSkippedCharge(payload, 'tenant_profile_not_found');
      return;
    }

    const subscription = await this.subscriptionDAO.findFirst({ cuid, deletedAt: null });
    const planName = subscription?.planName ?? 'essential';

    const { totalAmount, serviceFeeCents, lineItems, currency, dueDate } =
      await this.buildMaintenanceChargeSetup({
        cuid,
        tenantId: tenantId!,
        amount,
        planName,
        vendorLineItems: this.toVendorLineItems(payload.invoiceLineItems, amount),
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
      serviceFeeInCents: serviceFeeCents,
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

    const { serviceFeeCents, totalAmount } = this.calculateServiceFee(amount, planName);

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
