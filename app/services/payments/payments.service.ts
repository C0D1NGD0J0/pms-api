import dayjs from 'dayjs';
import Logger from 'bunyan';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { envVariables } from '@shared/config';
import { MoneyUtils } from '@utils/money.utils';
import { type QueryFilter, Types } from 'mongoose';
import { MAX_CHARGE_ATTEMPTS } from '@utils/constants';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { PdfGeneratorService } from '@services/pdfGenerator';
import { SubscriptionPlanConfig } from '@services/subscription';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { IPayoutSchedule } from '@interfaces/paymentGateway.interface';
import { ROLE_GROUPS, ROLES } from '@shared/constants/roles.constants';
import { StripeService } from '@services/external/stripe/stripe.service';
import { InvoiceTemplateRenderer, InvoiceRenderData } from '@services/invoice';
import { TenantPaymentStatus, InvoiceStatus } from '@interfaces/invoice.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { preventTenantConflict, calcCollectionRate, createLogger } from '@utils/index';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { isAllowedCheckoutReturnUrl } from '@shared/validations/PaymentsValidation/checkoutReturnUrl';
import {
  IPromiseReturnedData,
  IPaginateResult,
  IRequestContext,
} from '@interfaces/utils.interface';
import {
  IVendorEarningsResponse,
  IVendorEarningItem,
  PaymentErrorCode,
} from '@interfaces/payments.interface';
import {
  MaintenanceRequestDAO,
  PaymentProcessorDAO,
  SubscriptionDAO,
  PropertyUnitDAO,
  PropertyDAO,
  PaymentDAO,
  ProfileDAO,
  VendorDAO,
  ClientDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';
import {
  IPaymentGatewayProvider,
  IPaymentFullyPopulated,
  IManualPaymentFormData,
  PaymentRecordStatus,
  IRefundPaymentData,
  IPaymentPopulated,
  PaymentRecordType,
  IPaymentListItem,
  IPaymentDocument,
  IProfileDocument,
  IPaymentFormData,
  IProfileWithUser,
  ILeaseDocument,
  PaymentSource,
  PaymentMethod,
} from '@interfaces/index';

import { PaymentCronService } from './paymentCron.service';
import { RentPaymentService } from './rentPayment.service';
import { PayoutAccountService } from './payoutAccount.service';
import { MaintenancePaymentService } from './maintenancePayment.service';
import {
  IStripeDisputeWebhookData,
  IStripeAccountWebhookData,
  IStripeInvoiceWebhookData,
  IStripeChargeWebhookData,
  IStripePayoutWebhookData,
  PaymentWebhookService,
} from './paymentWebhook.service';

export type IManualPaymentResult = { manualEntryOutcome: ManualEntryOutcome } & IPaymentDocument;

interface IConstructor {
  maintenancePaymentService: MaintenancePaymentService;
  invoiceTemplateRenderer: InvoiceTemplateRenderer;
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  paymentWebhookService: PaymentWebhookService;
  maintenanceRequestDAO: MaintenanceRequestDAO;
  payoutAccountService: PayoutAccountService;
  pdfGeneratorService: PdfGeneratorService;
  paymentProcessorDAO: PaymentProcessorDAO;
  paymentCronService: PaymentCronService;
  rentPaymentService: RentPaymentService;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  propertyUnitDAO: PropertyUnitDAO;
  stripeService: StripeService;
  propertyDAO: PropertyDAO;
  invoiceDAO: InvoiceDAO;
  paymentDAO: PaymentDAO;
  profileDAO: ProfileDAO;
  vendorDAO: VendorDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

interface IManualEntryTarget {
  propertyObjectId?: Types.ObjectId;
  maintenanceRequestUid?: string;
  unitObjectId?: Types.ObjectId;
  lease?: ILeaseDocument;
}

type ManualEntryOutcome = 'settled' | 'created';

// Charges still owed by the tenant — a manual payment settles one of these
const OPEN_CHARGE_STATUSES: PaymentRecordStatus[] = [
  PaymentRecordStatus.PENDING,
  PaymentRecordStatus.OVERDUE,
  PaymentRecordStatus.FAILED,
];

const MANUAL_ENTRY_VOID_ROLES: string[] = [ROLES.ROOT_ADMIN, ...ROLE_GROUPS.MANAGEMENT_ROLES];

export class PaymentService implements ICronProvider {
  private readonly log: Logger;
  private readonly payoutAccountService: PayoutAccountService;
  private readonly paymentWebhookService: PaymentWebhookService;
  private readonly paymentCronService: PaymentCronService;
  private readonly maintenancePaymentService: MaintenancePaymentService;
  private readonly rentPaymentService: RentPaymentService;

  // DAOs and services used by query/operations methods (previously in sub-services)
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly invoiceDAO: InvoiceDAO;
  private readonly emitterService: EventEmitterService;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly vendorDAO: VendorDAO;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly paymentProcessorDAO: PaymentProcessorDAO;
  private readonly paymentGatewayService: PaymentGatewayService;
  private readonly stripeService: StripeService;
  private readonly pdfGeneratorService: PdfGeneratorService;
  private readonly invoiceTemplateRenderer: InvoiceTemplateRenderer;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;

  constructor({
    payoutAccountService,
    paymentWebhookService,
    paymentCronService,
    maintenancePaymentService,
    rentPaymentService,
    invoiceTemplateRenderer,
    subscriptionPlanConfig,
    paymentGatewayService,
    pdfGeneratorService,
    paymentProcessorDAO,
    emitterService,
    subscriptionDAO,
    stripeService,
    maintenanceRequestDAO,
    propertyUnitDAO,
    propertyDAO,
    vendorDAO,
    invoiceDAO,
    paymentDAO,
    profileDAO,
    clientDAO,
    leaseDAO,
    userDAO,
  }: IConstructor) {
    this.payoutAccountService = payoutAccountService;
    this.paymentWebhookService = paymentWebhookService;
    this.paymentCronService = paymentCronService;
    this.maintenancePaymentService = maintenancePaymentService;
    this.rentPaymentService = rentPaymentService;

    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.paymentDAO = paymentDAO;
    this.invoiceDAO = invoiceDAO;
    this.propertyDAO = propertyDAO;
    this.propertyUnitDAO = propertyUnitDAO;
    this.vendorDAO = vendorDAO;
    this.maintenanceRequestDAO = maintenanceRequestDAO;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
    this.paymentProcessorDAO = paymentProcessorDAO;
    this.paymentGatewayService = paymentGatewayService;
    this.stripeService = stripeService;
    this.pdfGeneratorService = pdfGeneratorService;
    this.invoiceTemplateRenderer = invoiceTemplateRenderer;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.log = createLogger('PaymentService');
  }

  private async getProfileOrThrow(userId: string | Types.ObjectId, msg?: string): Promise<any> {
    const profile = await this.profileDAO.findFirst({
      user: typeof userId === 'string' ? new Types.ObjectId(userId) : userId,
    });
    if (!profile) throw new NotFoundError({ message: msg || 'Profile not found' });
    return profile;
  }

  // ── Cron ──────────────────────────────────────────────────────────────

  getCronJobs(): Promise<ICronJob[]> {
    return this.paymentCronService.getCronJobs();
  }

  // ── Rent / Charge ────────────────────────────────────────────────────

  async createRentPayment(
    cuid: string,
    data: IPaymentFormData,
    options?: {
      createStripeInvoice?: boolean;
      paymentSource?: PaymentSource;
      idempotencyKey?: string;
    }
  ): IPromiseReturnedData<IPaymentDocument> {
    return this.rentPaymentService.createRentPayment(cuid, data, options);
  }

  async payPendingCharge(
    cuid: string,
    pytuid: string,
    tenantUserId: string
  ): IPromiseReturnedData<IPaymentDocument> {
    return this.rentPaymentService.payPendingCharge(cuid, pytuid, tenantUserId);
  }

  async listPayments(
    cuid: string,
    filters?: {
      status?: string;
      type?: string;
      tenantId?: string;
      leaseId?: string;
      luid?: string;
      maintenanceRequestUid?: string;
      pendingReview?: boolean;
      page?: number;
      limit?: number;
      sortDirection?: 'asc' | 'desc';
    },
    context?: IRequestContext
  ): IPromiseReturnedData<{ items: IPaymentListItem[]; pagination?: IPaginateResult }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 10;
    const skip = (page - 1) * limit;

    let tenantUserId: string | undefined;
    let tenantId: string | undefined = filters?.tenantId;

    if (context?.currentuser?.client?.role === 'tenant') {
      tenantUserId = context.currentuser.sub;
      tenantId = undefined;
    }

    try {
      const client = await this.clientDAO.findFirst({ cuid, deletedAt: null });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const query: QueryFilter<IPaymentDocument> = { cuid, deletedAt: null };

      if (filters?.status) {
        // Support comma-separated multi-status filter: "pending,overdue" → $in query
        const statuses = filters.status
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        query.status = (statuses.length === 1 ? statuses[0] : { $in: statuses }) as any;
      }
      if (filters?.type) {
        query.paymentType = filters.type as any;
      }

      // tenantUserId (User._id) takes precedence — resolve to Profile._id
      if (tenantUserId) {
        const profile = await this.profileDAO.findFirst({
          user: new Types.ObjectId(tenantUserId),
        });
        if (profile) {
          query.tenant = profile._id;
        }
      } else if (tenantId) {
        query.tenant = new Types.ObjectId(tenantId);
      }

      if (filters?.leaseId) {
        query.lease = new Types.ObjectId(filters.leaseId);
      } else if (filters?.luid) {
        const lease = await this.leaseDAO.findFirst({ luid: filters.luid, cuid, deletedAt: null });
        if (lease) {
          query.lease = lease._id;
        }
      }

      if (filters?.maintenanceRequestUid) {
        query.maintenanceRequestUid = filters.maintenanceRequestUid;
      }

      if (filters?.pendingReview === true) {
        query.managerReviewRequired = true;
      }

      const role = context?.currentuser?.client?.role;
      const vendorSub = context?.currentuser?.sub;
      if (role === 'vendor' && vendorSub) {
        // Vendors only see their own payout records
        query.vendorId = new Types.ObjectId(vendorSub);
      } else {
        // Exclude vendor payout records for all other roles — these surface in the Payouts tab
        query.vendorId = { $exists: false };
      }

      const sortOrder = filters?.sortDirection === 'asc' ? 1 : -1;
      const result = await this.paymentDAO.list(
        query,
        {
          sort: { dueDate: sortOrder, createdAt: sortOrder },
          populate: [
            {
              path: 'tenant',
              select: 'personalInfo',
            },
            {
              path: 'lease',
              select: 'property',
            },
            {
              path: 'maintenanceRequest',
              select: 'propertyId',
              populate: { path: 'propertyId', select: 'address name' },
            },
          ],
          projection:
            'pytuid paymentMethod paymentType baseAmount processingFee applicationFee platformRevenue status dueDate paidAt period failure receipt lineItems currency maintenanceRequestUid refund managerReviewRequired',
          skip,
          limit,
        },
        true
      );

      // Only ROOT_ADMIN (platform internal) sees gateway fees and platform revenue.
      // Client super admins see applicationFee (what's deducted from their payout)
      // but not the internal split between Stripe costs and platform profit.
      const isPlatformAdmin = role === 'root-admin';

      const cleanItems = (result.items as unknown as IPaymentPopulated[]).map((payment) => {
        const addr = payment.lease?.property?.address;
        const addressStr = typeof addr === 'string' ? addr : (addr?.fullAddress ?? '');
        return {
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
          property: (() => {
            if (payment.lease?.property?.name) return payment.lease.property.name;
            if (addressStr) return addressStr;
            const mrProp = (payment as any).maintenanceRequest?.propertyId;
            if (mrProp) {
              const mrAddr =
                typeof mrProp.address === 'string' ? mrProp.address : mrProp.address?.fullAddress;
              return mrAddr || mrProp.name || 'Unknown Property';
            }
            return 'Unknown Property';
          })(),
          amount: payment.baseAmount,
          baseAmount: payment.baseAmount,
          applicationFee: payment.applicationFee || 0,
          ...(isPlatformAdmin && {
            processingFee: payment.processingFee || 0,
            platformRevenue: (payment as any).platformRevenue || 0,
          }),
          status: payment.status,
          paymentType: payment.paymentType,
          paymentMethod: payment.paymentMethod,
          dueDate: payment.dueDate,
          paidAt: payment.paidAt,
          period: payment.period,
          currency: payment.currency,
          lineItems: payment.lineItems || [],
          failure: payment.failure || undefined,
          receipt: payment.receipt || undefined,
          maintenanceRequestUid: (payment as any).maintenanceRequestUid || undefined,
          managerReviewRequired: (payment as any).managerReviewRequired || false,
          // Partial refunds keep the payment PAID, so show any refunded amount
          ...(payment.refund?.amount
            ? {
                refundAmount: payment.refund.amount,
                refundedAt: payment.refund.refundedAt,
              }
            : {}),
        };
      });

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

  async getPaymentByUid(
    cuid: string,
    pytuid: string,
    context?: IRequestContext
  ): IPromiseReturnedData<any> {
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
                'property.id property.unitId property.address property.name property.unitNumber leaseNumber status duration.startDate duration.endDate luid',
              populate: [
                {
                  path: 'property.id',
                  select:
                    'propertyType specifications.bedrooms specifications.bathrooms status managedBy',
                },
                {
                  path: 'property.unitId',
                  select: 'specifications.bedrooms specifications.bathrooms unitNumber',
                },
              ],
            },
          ],
        }
      )) as IPaymentFullyPopulated | null;

      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      // Role-based ownership enforcement — external roles may only read their own records
      const callerRole = context?.currentuser?.client?.role;
      if (callerRole === 'tenant') {
        const callerProfile = await this.profileDAO.findFirst({
          user: new Types.ObjectId(context!.currentuser.sub),
        });
        if (!callerProfile || !payment.tenant?._id?.equals(callerProfile._id)) {
          throw new ForbiddenError({ message: 'You do not have permission to view this payment' });
        }
      } else if (callerRole === 'vendor') {
        // Vendor payouts are tracked on Invoice documents; no direct payment records use vendorId.
        // A vendor may only read a payment record if it is explicitly linked to them via vendorId.
        if (!payment.vendorId || payment.vendorId.toString() !== context!.currentuser.sub) {
          throw new ForbiddenError({ message: 'You do not have permission to view this payment' });
        }
      }

      const tenantProfile = {
        firstName: payment.tenant?.personalInfo?.firstName,
        lastName: payment.tenant?.personalInfo?.lastName,
        phoneNumber: payment.tenant?.personalInfo?.phoneNumber,
        email: payment.tenant?.user?.email,
        puid: payment.tenant?.puid,
      };

      const propertyDoc = payment.lease?.property?.id;
      const unitDoc = payment.lease?.property?.unitId;
      let propertyManager = null;
      if (propertyDoc?.managedBy) {
        const managerProfile = (await this.profileDAO.findFirst(
          { user: propertyDoc.managedBy },
          {
            select: 'personalInfo.firstName personalInfo.lastName personalInfo.phoneNumber user',
            populate: { path: 'user', select: 'email' },
          }
        )) as IProfileWithUser | null;
        if (managerProfile) {
          propertyManager = {
            fullName:
              `${managerProfile.personalInfo?.firstName || ''} ${managerProfile.personalInfo?.lastName || ''}`.trim(),
            email: managerProfile.user?.email || '',
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
            unitNumber: unitDoc?.unitNumber ?? (payment.lease.property as any)?.unitNumber,
            propertyName: payment.lease.property?.name,
            propertyType: propertyDoc?.propertyType,
            propertyStatus: propertyDoc?.operationalStatus,
            bedrooms: unitDoc?.specifications?.bedrooms ?? propertyDoc?.specifications?.bedrooms,
            bathrooms: unitDoc?.specifications?.bathrooms ?? propertyDoc?.specifications?.bathrooms,
            propertyManager,
          }
        : null;

      const paymentObj = payment.toObject();
      delete paymentObj.tenant;
      delete paymentObj.lease;

      // Strip internal platform economics from non-platform-admin responses.
      // PMs see applicationFee (what's deducted from their payout) but not
      // the breakdown between Stripe costs and platform profit.
      const detailRole = context?.currentuser?.client?.role;
      if (detailRole !== 'root-admin') {
        delete paymentObj.processingFee;
        delete paymentObj.platformRevenue;
      }

      // For maintenance payments, look up the invoice for line items and vendor payout info
      let vendorPayout = null;
      if (paymentObj.maintenanceRequestUid) {
        const invoice = await this.invoiceDAO.findByMaintenanceRequest(
          paymentObj.maintenanceRequestUid,
          cuid
        );

        if (invoice) {
          // Backfill line items if missing
          if (!paymentObj.lineItems?.length && invoice.lineItems?.length) {
            paymentObj.lineItems = invoice.lineItems.map((item) => ({
              description: item.description,
              amountInCents: item.amountInCents,
            }));
          }

          // Resolve vendor org name from the submitter
          let vendorName = '';
          if (invoice.submittedBy) {
            const submitter = await this.userDAO.findFirst({ _id: invoice.submittedBy });
            const clientEntry = submitter?.cuids?.find((c: any) => c.cuid === cuid);
            const vendorVuid = clientEntry?.linkedVendorUid;

            let vendorOrg;
            if (vendorVuid) {
              vendorOrg = await this.vendorDAO.getVendorByVuid(String(vendorVuid));
            } else if (clientEntry?.primaryRole === 'vendor') {
              vendorOrg = await this.vendorDAO.findFirst({
                'connectedClients.primaryAccountHolderUserId': invoice.submittedBy,
                deletedAt: null,
              });
            }
            vendorName = vendorOrg?.companyName || '';
          }

          vendorPayout = {
            status: invoice.vendorPayoutStatus || 'pending',
            paidAt: (invoice as any).vendorPaidAt || null,
            transferId: (invoice as any).vendorPayoutTransferId || null,
            vendorName,
            invoiceAmount: invoice.amountInCents,
            invoiceCurrency: invoice.currency || paymentObj.currency || 'USD',
          };
        }
      }

      // For maintenance payments with no lease, resolve property from the MR
      let propertyInfo = {
        pid: '',
        name: leaseInfo?.propertyName || '',
        address: leaseInfo?.address || '',
      };

      if (!leaseInfo && paymentObj.maintenanceRequestUid) {
        const mr = await this.maintenanceRequestDAO.getByMruid(
          String(paymentObj.maintenanceRequestUid),
          cuid
        );
        if (mr?.propertyId) {
          const prop = await this.propertyDAO.findFirst({
            _id: mr.propertyId,
            deletedAt: null,
          });
          if (prop) {
            propertyInfo = {
              pid: (prop as any).pid || '',
              name: (prop as any).name || '',
              address: (prop as any).address?.fullAddress || '',
            };
          }
        }
      }

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
          property: propertyInfo,
          leaseInfo,
          vendorPayout,
        },
        message: 'Payment retrieved successfully',
      };
    } catch (error) {
      this.log.error('Error getting payment', error);
      throw error;
    }
  }

  async getPaymentStats(
    cuid: string,
    context?: IRequestContext,
    tenantId?: string
  ): IPromiseReturnedData<{
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

      // Tenant role: always scope to own payments — ignore any caller-supplied tenantId
      // Non-tenant (PM/admin): use provided tenantId to filter stats for a specific tenant
      const daoFilters: Record<string, any> = {};
      if (context?.currentuser?.client?.role === 'tenant') {
        const profile = await this.profileDAO.findFirst({
          user: new Types.ObjectId(context.currentuser.sub),
        });
        if (profile) {
          daoFilters.tenantId = profile._id.toString();
        }
      } else if (tenantId) {
        daoFilters.tenantId = tenantId;
      }

      // Fetch ALL payments for this client across all time (no date filter).
      // Overdue payments from past months are still outstanding and relevant —
      // restricting to current month would hide unpaid historical debt.
      const allPayments = await this.fetchAllPaymentsForStats(cuid, daoFilters);

      // Running totals — all values are in cents (e.g. 150000 = $1,500.00)
      let expectedRevenue = 0; // PAID + PENDING + OVERDUE (excludes CANCELLED, FAILED, REFUNDED)
      let collected = 0; // Sum of all PAID payments (baseAmount)
      let pending = 0; // Sum of all PENDING payments (baseAmount)
      let overdue = 0; // Sum of all OVERDUE payments (baseAmount)
      let refunded = 0; // Sum of all REFUNDED amounts (refundAmount if partial, else baseAmount)

      // Collection rate is rent-specific: how much expected rent has been collected.
      // Maintenance charges, late fees, and deposits skew this metric if included.
      let rentExpected = 0;
      let rentCollected = 0;

      allPayments.forEach((payment) => {
        // baseAmount is stored in cents. Guard against missing values on legacy records.
        const amount = payment.baseAmount ?? 0;
        const isRent = payment.paymentType === PaymentRecordType.RENT;

        switch (payment.status) {
          // PENDING_REFUND: a collected deposit whose refund is staged but not yet released.
          // The money is still held, so it counts as collected; refund.amount is only the
          // staged figure and is not subtracted until the refund actually goes out.
          case PaymentRecordStatus.PENDING_REFUND:
            expectedRevenue += amount;
            collected += amount;
            if (isRent) {
              rentExpected += amount;
              rentCollected += amount;
            }
            break;
          // PROCESSING: charge submitted to the bank, awaiting settlement (bank transfer).
          // Treated identically to PENDING — expected but not yet collected.
          // PENDING: payment is due but not yet collected.
          // If past due date, treat as overdue (cron may not have flipped status yet).
          case PaymentRecordStatus.PROCESSING:
          case PaymentRecordStatus.PENDING: {
            const isPendingPastDue = payment.dueDate && new Date(payment.dueDate) < new Date();
            expectedRevenue += amount;
            if (isPendingPastDue) {
              overdue += amount;
            } else {
              pending += amount;
            }
            if (isRent) rentExpected += amount;
            break;
          }

          // CANCELLED: obligation waived, excluded from all stats.
          case PaymentRecordStatus.CANCELLED:
            break;

          // REFUNDED: use refundAmount (partial refund) or full baseAmount (full refund).
          // Refunded payments are excluded from expectedRevenue since the money was returned.
          case PaymentRecordStatus.REFUNDED:
            refunded += payment.refund?.amount || amount;
            break;
          // OVERDUE: payment is past its due date and still unpaid.
          // Counts toward expectedRevenue — the money is owed and tracked.
          case PaymentRecordStatus.OVERDUE:
            expectedRevenue += amount;
            overdue += amount;
            if (isRent) rentExpected += amount;
            break;

          // FAILED: payment attempt was unsuccessful; money is still owed.
          // If the due date is past, treat it as overdue (same as OVERDUE status).
          // If the due date is in the future, exclude — it may still be retried in time.
          case PaymentRecordStatus.FAILED: {
            const isPastDue = payment.dueDate && new Date(payment.dueDate) <= new Date();
            if (isPastDue) {
              expectedRevenue += amount;
              overdue += amount;
              if (isRent) rentExpected += amount;
            }
            break;
          }

          // PAID: payment was successfully collected.
          // Counts toward both expectedRevenue and collected, net of any partial refund.
          case PaymentRecordStatus.PAID: {
            // A deposit refund is money paid out to the tenant — never revenue
            if (payment.paymentType === PaymentRecordType.DEPOSIT_REFUND) break;

            // Staff manual entries aren't verified until a manager reviews them
            if (payment.managerReviewRequired) {
              expectedRevenue += amount;
              pending += amount;
              if (isRent) rentExpected += amount;
              break;
            }

            const partiallyRefunded = Math.min(payment.refund?.amount ?? 0, amount);
            const netAmount = amount - partiallyRefunded;
            refunded += partiallyRefunded;
            expectedRevenue += netAmount;
            collected += netAmount;
            if (isRent) {
              rentExpected += netAmount;
              rentCollected += netAmount;
            }
            break;
          }

          default:
            this.log.warn('Unknown payment status encountered', {
              status: payment.status,
              pytuid: payment.pytuid,
            });
            break;
        }
      });

      // collectionRate = rent collected / rent expected x 100.
      // Scoped to RENT-only so maintenance charges and late fees don't skew the metric.
      const collectionRate = calcCollectionRate(rentCollected, rentExpected);

      return {
        success: true,
        data: {
          expectedRevenue, // PAID + PENDING + OVERDUE (in cents)
          collected, // PAID only (in cents)
          pending, // PENDING only (in cents)
          overdue, // OVERDUE only (in cents)
          refunded, // REFUNDED amounts (in cents)
          collectionRate, // percentage (0–100)
          currency: allPayments[0]?.currency ?? 'USD',
        },
      };
    } catch (error: any) {
      this.log.error('Error getting payment stats', error);
      throw error;
    }
  }

  // BaseDAO.list caps a single page at 1000, so page through until every record is read
  private async fetchAllPaymentsForStats(
    cuid: string,
    daoFilters: Record<string, any>
  ): Promise<IPaymentDocument[]> {
    const pageSize = 1000;
    const allPayments: IPaymentDocument[] = [];
    for (let skip = 0; ; skip += pageSize) {
      const page = await this.paymentDAO.findByCuid(cuid, daoFilters, {
        sort: { dueDate: -1, _id: -1 },
        populate: [],
        limit: pageSize,
        skip,
      });
      const items = page.items || [];
      allPayments.push(...items);
      if (items.length < pageSize) return allPayments;
    }
  }

  async getTenantPaymentHistory(
    cuid: string,
    tenantUserId: string,
    filters: { status?: string; from?: string; to?: string; page?: number; limit?: number }
  ): IPromiseReturnedData<any> {
    try {
      const tenantProfile = await this.getProfileOrThrow(tenantUserId, 'Tenant profile not found');

      const query: QueryFilter<IPaymentDocument> = {
        cuid,
        tenant: tenantProfile._id,
        deletedAt: null,
      };
      if (filters.status) query.status = filters.status as any;
      if (filters.from || filters.to) {
        query.dueDate = {};
        if (filters.from) query.dueDate.$gte = dayjs(filters.from).toDate();
        if (filters.to) query.dueDate.$lte = dayjs(filters.to).toDate();
      }

      const limit = filters.limit || 20;
      const skip = ((filters.page || 1) - 1) * limit;
      const result = await this.paymentDAO.list(
        query,
        {
          sort: { dueDate: -1 },
          limit,
          skip,
          populate: [{ path: 'lease', select: 'leaseNumber luid property' }],
          projection:
            'pytuid invoiceNumber status paymentType paymentMethod baseAmount processingFee applicationFee dueDate paidAt period description receipt lease',
        },
        true
      );

      const items = (result.items as unknown as IPaymentPopulated[]).map((p) => ({
        pytuid: p.pytuid,
        invoiceNumber: p.invoiceNumber,
        status: p.status,
        paymentType: p.paymentType,
        paymentMethod: p.paymentMethod,
        baseAmount: p.baseAmount,
        processingFee: p.processingFee || 0,
        applicationFee: p.applicationFee || 0,
        totalAmount: p.baseAmount + (p.processingFee || 0),
        dueDate: p.dueDate,
        paidAt: p.paidAt,
        description: p.description,
        period: p.period,
        hasReceipt: !!p.receipt?.url,
        leaseNumber: p.lease?.leaseNumber,
      }));

      return {
        success: true,
        data: { ...result, items },
        message: 'Payment history retrieved',
      };
    } catch (error) {
      this.log.error('Error fetching tenant payment history', error);
      throw error;
    }
  }

  async getTenantPaymentById(
    pytuid: string,
    cuid: string,
    tenantUserId: string
  ): IPromiseReturnedData<any> {
    try {
      const tenantProfile = await this.getProfileOrThrow(tenantUserId, 'Tenant profile not found');

      const payment = await this.paymentDAO.findFirst(
        { pytuid, cuid, tenant: tenantProfile._id, deletedAt: null },
        { populate: [{ path: 'lease', select: 'leaseNumber luid' }] }
      );
      if (!payment) throw new NotFoundError({ message: 'Payment not found' });

      return { success: true, data: payment, message: 'Payment retrieved' };
    } catch (error) {
      this.log.error('Error fetching tenant payment', error);
      throw error;
    }
  }

  async getVendorEarnings(
    cuid: string,
    vendorUid: string,
    filters: { page?: number; limit?: number } = {}
  ): IPromiseReturnedData<IVendorEarningsResponse> {
    try {
      const page = filters.page ?? 1;
      const limit = filters.limit ?? 50;

      const vendor = await this.userDAO.findFirst({ uid: vendorUid, deletedAt: null });
      if (!vendor) {
        throw new NotFoundError({ message: 'Vendor not found.' });
      }

      // Resolve the vendor org's vuid, then find ALL team members so we capture
      // invoices submitted by any member of the vendor organization.
      const clientEntry = vendor.cuids?.find((c: any) => c.cuid === cuid);
      let vendorVuid = clientEntry?.linkedVendorUid;

      // Primary account holders may not have linkedVendorUid set — resolve from vendor collection
      if (!vendorVuid) {
        const vendorOrg = await this.vendorDAO.findFirst({
          'connectedClients.primaryAccountHolderUserId': vendor._id,
          deletedAt: null,
        });
        vendorVuid = vendorOrg?.vuid || undefined;
      }

      let vendorUserIds = [vendor._id.toString()];
      if (vendorVuid) {
        // Find all users linked to this vendor org (team members + primary holder)
        const teamMembers = await this.userDAO.list(
          {
            'cuids.cuid': cuid,
            deletedAt: null,
            $or: [{ 'cuids.linkedVendorUid': vendorVuid }, { _id: vendor._id }],
          },
          { projection: '_id' }
        );
        if (teamMembers?.items?.length) {
          vendorUserIds = (teamMembers.items as any[]).map((u) => u._id.toString());
        }
      }

      // Vendor payout state lives on the Invoice document — query approved invoices directly.
      const result = await this.invoiceDAO.listByVendor(vendorUserIds, cuid, {
        status: InvoiceStatus.APPROVED,
        page,
        limit,
      });

      const invoices = result.items as any[];

      // Batch-fetch maintenance payment records to get pytuid for each invoice
      const mruids = invoices.map((inv) => inv.mruid).filter(Boolean);
      let pytuidByMruid = new Map<string, string>();
      if (mruids.length > 0) {
        const paymentResult = await this.paymentDAO.list(
          {
            maintenanceRequestUid: { $in: mruids },
            paymentType: PaymentRecordType.MAINTENANCE,
            cuid,
          },
          { projection: 'pytuid maintenanceRequestUid', limit: mruids.length },
          true
        );
        pytuidByMruid = new Map(
          (paymentResult.items as any[]).map((p) => [p.maintenanceRequestUid, p.pytuid])
        );
      }

      const items: IVendorEarningItem[] = invoices.map((inv) => ({
        invuid: inv.invuid,
        mruid: inv.mruid,
        pytuid: pytuidByMruid.get(inv.mruid) ?? null,
        title: inv.description,
        amountInCents: inv.amountInCents ?? 0,
        status:
          inv.vendorPayoutStatus === 'paid'
            ? PaymentRecordStatus.PAID
            : PaymentRecordStatus.PENDING,
        paidAt: inv.vendorPaidAt,
        createdAt: inv.createdAt,
      }));

      const paid = items.filter((i) => i.status === PaymentRecordStatus.PAID);
      const pending = items.filter((i) => i.status === PaymentRecordStatus.PENDING);

      const totalPaidInCents = paid.reduce((s, i) => s + i.amountInCents, 0);
      const pendingPayoutInCents = pending.reduce((s, i) => s + i.amountInCents, 0);

      return {
        success: true,
        data: {
          items,
          stats: {
            totalPaidInCents,
            pendingPayoutInCents,
            completedJobs: paid.length,
            expectedEarningsInCents: pendingPayoutInCents,
          },
          pagination: result.pagination
            ? {
                total: result.pagination.total,
                page: result.pagination.currentPage,
                limit: result.pagination.perPage,
                pages: result.pagination.totalPages,
              }
            : { total: items.length, page, limit, pages: 1 },
        },
        message: 'Vendor earnings retrieved successfully.',
      };
    } catch (error) {
      this.log.error('Error fetching vendor earnings', error);
      throw error;
    }
  }

  // ── Operations ───────────────────────────────────────────────────────

  /**
   * Records money a property manager received outside the app (cash, cheque, bank transfer).
   *
   * When the payment is for a charge the app already tracks, that charge is settled instead of
   * creating a second record: either the one named by `data.pytuid`, or the single open charge
   * that matches (rent: lease + period; late fee: lease + period; maintenance: mruid; deposit:
   * lease). Open charges that can't be matched unambiguously are rejected so the PM picks one —
   * otherwise the crons would keep charging, marking overdue and adding late fees to a debt the
   * tenant already paid. With no open charge a new PAID record is created.
   */
  async recordManualPayment(
    cuid: string,
    userId: string,
    requestingUserSub: string,
    data: IManualPaymentFormData,
    paymentSource?: PaymentSource
  ): IPromiseReturnedData<IManualPaymentResult> {
    try {
      // Prevent conflict of interest: cannot record payment where you are the tenant
      preventTenantConflict(requestingUserSub, data.tenantId as string);
      this.assertValidManualEntry(data);

      const client = await this.clientDAO.findFirst({ cuid, deletedAt: null });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const tenantProfile = await this.getClientTenantProfileOrThrow(cuid, data.tenantId);
      const target = await this.resolveManualEntryTarget(cuid, data);

      const chargeToSettle = data.pytuid
        ? await this.getChargeToSettleOrThrow(cuid, data, tenantProfile._id, target.lease?._id)
        : await this.findOpenChargeToSettle(cuid, data, tenantProfile._id, target.lease?._id);

      let payment: IPaymentDocument;
      let manualEntryOutcome: ManualEntryOutcome;

      if (chargeToSettle) {
        payment = await this.settleChargeWithManualPayment(
          chargeToSettle,
          data,
          userId,
          paymentSource
        );
        manualEntryOutcome = 'settled';
      } else {
        const currency =
          target.lease?.fees?.currency || (client as any).settings?.defaultCurrency || 'USD';

        payment = await this.paymentDAO.insert({
          cuid,
          paymentType: data.paymentType,
          paymentMethod: data.paymentMethod,
          lease: target.lease ? target.lease._id : undefined,
          propertyId: target.propertyObjectId,
          unitId: target.unitObjectId,
          tenant: tenantProfile._id,
          baseAmount: data.baseAmount,
          processingFee: data.processingFee || 0,
          currency,
          status: PaymentRecordStatus.PAID,
          dueDate: data.paidAt,
          paidAt: data.paidAt,
          period: data.period,
          description: data.description,
          recordedBy: new Types.ObjectId(userId),
          isManualEntry: true,
          ...(target.maintenanceRequestUid
            ? { maintenanceRequestUid: target.maintenanceRequestUid }
            : {}),
          // Staff-initiated entries require PM/admin confirmation before considered verified
          managerReviewRequired: paymentSource === 'staff_initiated',
          ...(paymentSource ? { paymentSource } : {}),
          ...(data.receipt
            ? { receipt: { ...data.receipt, uploadedBy: new Types.ObjectId(userId) } }
            : {}),
        });
        manualEntryOutcome = 'created';
      }

      // A charge that was already a manual entry has been counted once — don't count it again
      if (!chargeToSettle?.isManualEntry) {
        this.incrementManualRecordCount(cuid).catch((err) => {
          this.log.error({ err, cuid }, 'Background manual record usage tracking failed');
        });
      }

      await this.completeManualMaintenancePayment(payment).catch((err) => {
        this.log.error(
          { err, cuid, pytuid: payment.pytuid },
          'Could not complete the maintenance flow for a manual payment'
        );
      });

      const paymentData = typeof payment.toObject === 'function' ? payment.toObject() : payment;
      return {
        success: true,
        data: { ...paymentData, manualEntryOutcome } as IManualPaymentResult,
        message:
          manualEntryOutcome === 'settled'
            ? 'Open charge settled with the manual payment'
            : 'Payment recorded successfully',
      };
    } catch (error: any) {
      this.log.error('Error recording manual payment:', error);
      throw error;
    }
  }

  /**
   * Counts a manual record toward the plan's quota for the current billing period.
   * The counter is reset only by the subscription webhook when Stripe starts a new period.
   */
  async incrementManualRecordCount(cuid: string): Promise<void> {
    await this.subscriptionDAO.incrementUsageCounter(cuid, 'manualRecords.countThisPeriod');
  }

  // Defence in depth — the route schema enforces the same rules
  private assertValidManualEntry(data: IManualPaymentFormData): void {
    if (data.status && data.status !== PaymentRecordStatus.PAID) {
      throw new BadRequestError({ message: 'Manual payments can only be recorded as paid' });
    }
    if (data.paymentMethod === PaymentMethod.ONLINE) {
      throw new BadRequestError({
        message: 'Online payments are recorded automatically and cannot be entered manually',
      });
    }
    if (dayjs(data.paidAt).isAfter(dayjs().add(1, 'day'))) {
      throw new BadRequestError({ message: 'Payment date cannot be in the future' });
    }
  }

  /** The tenant must be a member of this client — a user id from another client is rejected. */
  private async getClientTenantProfileOrThrow(
    cuid: string,
    tenantUserId: string
  ): Promise<IProfileDocument> {
    if (!Types.ObjectId.isValid(tenantUserId)) {
      throw new BadRequestError({ message: 'Invalid tenant ID' });
    }
    const tenantUser = await this.userDAO.findFirst({
      _id: new Types.ObjectId(tenantUserId),
      'cuids.cuid': cuid,
    });
    if (!tenantUser) {
      throw new NotFoundError({ message: 'Tenant not found for this account' });
    }
    return this.getProfileOrThrow(tenantUserId, 'Tenant profile not found');
  }

  /** Resolves and validates the lease / property / maintenance request a manual entry points to. */
  private async resolveManualEntryTarget(
    cuid: string,
    data: IManualPaymentFormData
  ): Promise<IManualEntryTarget> {
    const target: IManualEntryTarget = {};

    if (data.leaseId) {
      const lease = await this.leaseDAO.findFirst({ luid: data.leaseId, cuid, deletedAt: null });
      if (!lease) {
        throw new NotFoundError({ message: 'Lease not found' });
      }
      if (lease.useInvitationIdAsTenantId || lease.tenantId?.toString() !== data.tenantId) {
        throw new BadRequestError({
          message: 'The selected tenant is not the tenant on this lease',
        });
      }
      target.lease = lease;
    } else if (data.propertyId) {
      // Property-tied entry without a lease. Values are pre-validated by Zod safeString.
      const property = await this.propertyDAO.findFirst({
        pid: String(data.propertyId),
        cuid,
        deletedAt: null,
      });
      if (!property) {
        throw new NotFoundError({ message: 'Property not found' });
      }
      target.propertyObjectId = property._id;

      if (data.unitId) {
        const unit = await this.propertyUnitDAO.findFirst({
          puid: String(data.unitId),
          propertyId: property._id,
          deletedAt: null,
        });
        if (!unit) {
          throw new NotFoundError({ message: 'Unit not found for this property' });
        }
        target.unitObjectId = unit._id as Types.ObjectId;
      }
    }

    if (data.mruid) {
      if (data.paymentType !== PaymentRecordType.MAINTENANCE) {
        throw new BadRequestError({
          message: 'A maintenance request can only be linked to a maintenance payment',
        });
      }
      const request = await this.maintenanceRequestDAO.getByMruid(data.mruid, cuid);
      if (!request) {
        throw new NotFoundError({ message: 'Maintenance request not found' });
      }
      if (request.tenantId && request.tenantId.toString() !== data.tenantId) {
        throw new BadRequestError({
          message: 'The selected tenant is not the tenant on this maintenance request',
        });
      }
      target.maintenanceRequestUid = data.mruid;
      if (!target.lease && !target.propertyObjectId) {
        target.propertyObjectId = request.propertyId as Types.ObjectId;
        target.unitObjectId = (request.propertyUnitId as Types.ObjectId) || undefined;
      }
    }

    return target;
  }

  /** The PM named the charge (pytuid) — it must belong to this tenant and still be owed. */
  private async getChargeToSettleOrThrow(
    cuid: string,
    data: IManualPaymentFormData,
    tenantProfileId: Types.ObjectId,
    leaseObjectId?: Types.ObjectId
  ): Promise<IPaymentDocument> {
    const charge = await this.paymentDAO.findFirst({
      pytuid: data.pytuid,
      cuid,
      deletedAt: null,
      vendorId: { $exists: false },
    });
    if (!charge) {
      throw new NotFoundError({ message: 'Charge not found' });
    }
    if (!charge.tenant?.equals(tenantProfileId)) {
      throw new BadRequestError({ message: 'This charge belongs to a different tenant' });
    }
    if (charge.paymentType !== data.paymentType) {
      throw new BadRequestError({
        message: `This charge is a ${charge.paymentType} charge, not ${data.paymentType}`,
      });
    }
    if (leaseObjectId && charge.lease && !charge.lease.equals(leaseObjectId)) {
      throw new BadRequestError({ message: 'This charge belongs to a different lease' });
    }
    if (data.mruid && charge.maintenanceRequestUid !== data.mruid) {
      throw new BadRequestError({
        message: 'This charge belongs to a different maintenance request',
      });
    }
    this.assertChargeCanBeSettled(charge);
    this.assertAmountMatchesCharge(charge, data.baseAmount);
    return charge;
  }

  /**
   * Finds the single open charge a manual payment pays off. Returns null when nothing is owed
   * for it (a new record is created). Throws when open charges exist but none or several match.
   */
  private async findOpenChargeToSettle(
    cuid: string,
    data: IManualPaymentFormData,
    tenantProfileId: Types.ObjectId,
    leaseObjectId?: Types.ObjectId
  ): Promise<IPaymentDocument | null> {
    const baseFilter: QueryFilter<IPaymentDocument> = {
      cuid,
      paymentType: data.paymentType,
      deletedAt: null,
      vendorId: { $exists: false },
    };
    const hasPeriod = !!(data.period?.month && data.period?.year);
    const periodFilter: Record<string, number> = hasPeriod
      ? { 'period.month': data.period!.month, 'period.year': data.period!.year }
      : {};

    let scope: QueryFilter<IPaymentDocument>;
    let isExactMatch: boolean;

    switch (data.paymentType) {
      case PaymentRecordType.SECURITY_DEPOSIT:
        if (!leaseObjectId) return null;
        scope = { lease: leaseObjectId };
        isExactMatch = true;
        break;
      case PaymentRecordType.MAINTENANCE:
        scope = data.mruid
          ? { maintenanceRequestUid: data.mruid }
          : { tenant: tenantProfileId, ...(leaseObjectId ? { lease: leaseObjectId } : {}) };
        isExactMatch = !!data.mruid;
        break;
      case PaymentRecordType.LATE_FEE:
        if (!leaseObjectId) return null;
        scope = { lease: leaseObjectId, ...periodFilter };
        isExactMatch = hasPeriod;
        break;
      case PaymentRecordType.RENT:
        if (!leaseObjectId) return null; // property-mode rent has no lease-bound charges
        if (hasPeriod) {
          return this.findRentChargeForPeriod(baseFilter, leaseObjectId, periodFilter, data);
        }
        scope = { lease: leaseObjectId };
        isExactMatch = false;
        break;
      default:
        // Deposit refunds are money paid out — there is no charge to settle
        return null;
    }

    const { items } = await this.paymentDAO.list(
      {
        ...baseFilter,
        ...scope,
        status: { $in: [...OPEN_CHARGE_STATUSES, PaymentRecordStatus.PROCESSING] },
      },
      { limit: 10 }
    );
    const candidates = items as IPaymentDocument[];

    if (candidates.some((charge) => charge.status === PaymentRecordStatus.PROCESSING)) {
      throw new BadRequestError({
        message:
          'A bank debit for this charge is already in progress. Wait for it to settle before recording a manual payment.',
        code: PaymentErrorCode.DEBIT_IN_PROGRESS,
      });
    }
    if (candidates.length === 0) {
      if (data.mruid) await this.assertMaintenanceRequestNotPaid(baseFilter, data.mruid);
      return null;
    }
    if (isExactMatch && candidates.length === 1) {
      this.assertAmountMatchesCharge(candidates[0], data.baseAmount);
      return candidates[0];
    }

    throw new BadRequestError({
      message: `This tenant has ${candidates.length} open ${data.paymentType.replace('_', ' ')} charge(s) that this payment could be for. Choose the charge being paid (pytuid) so it is settled instead of recorded twice.`,
      code: PaymentErrorCode.CHARGE_SELECTION_REQUIRED,
    });
  }

  /** Rent is unique per lease + period, so the existing record decides what happens. */
  private async findRentChargeForPeriod(
    baseFilter: QueryFilter<IPaymentDocument>,
    leaseObjectId: Types.ObjectId,
    periodFilter: Record<string, number>,
    data: IManualPaymentFormData
  ): Promise<IPaymentDocument | null> {
    const existing = await this.paymentDAO.findFirst({
      ...baseFilter,
      ...periodFilter,
      lease: leaseObjectId,
    });
    if (!existing) return null;

    this.assertChargeCanBeSettled(existing);
    this.assertAmountMatchesCharge(existing, data.baseAmount);
    return existing;
  }

  private async assertMaintenanceRequestNotPaid(
    baseFilter: QueryFilter<IPaymentDocument>,
    mruid: string
  ): Promise<void> {
    const paid = await this.paymentDAO.findFirst({
      ...baseFilter,
      maintenanceRequestUid: mruid,
      status: { $in: [PaymentRecordStatus.PAID, PaymentRecordStatus.REFUNDED] },
    });
    if (paid) {
      throw new BadRequestError({
        message: `This maintenance request has already been paid (${paid.pytuid})`,
      });
    }
  }

  // Open charges can be settled; so can a cancelled one the tenant ends up paying anyway
  private assertChargeCanBeSettled(charge: IPaymentDocument): void {
    if (charge.status === PaymentRecordStatus.PROCESSING) {
      throw new BadRequestError({
        message:
          'A bank debit for this charge is already in progress. Wait for it to settle before recording a manual payment.',
        code: PaymentErrorCode.DEBIT_IN_PROGRESS,
      });
    }
    const isSettleable =
      OPEN_CHARGE_STATUSES.includes(charge.status) ||
      charge.status === PaymentRecordStatus.CANCELLED;
    if (!isSettleable) {
      throw new BadRequestError({
        message: `This charge is already ${charge.status.replace('_', ' ')} (${charge.pytuid}) and cannot be paid again`,
        code: PaymentErrorCode.CHARGE_ALREADY_SETTLED,
      });
    }
  }

  // Partial manual payments would silently write off the rest of the charge
  private assertAmountMatchesCharge(charge: IPaymentDocument, amountInCents: number): void {
    if (charge.baseAmount !== amountInCents) {
      throw new BadRequestError({
        message: `The amount must match the charge being settled (${charge.baseAmount} cents, ${charge.pytuid}). Partial manual payments are not supported.`,
        code: PaymentErrorCode.AMOUNT_MISMATCH,
      });
    }
  }

  private async settleChargeWithManualPayment(
    charge: IPaymentDocument,
    data: IManualPaymentFormData,
    userId: string,
    paymentSource?: PaymentSource
  ): Promise<IPaymentDocument> {
    // Stop Stripe from collecting the same charge after it was paid in cash
    await this.expireOpenCardCheckout(charge);
    await this.voidGatewayInvoices(
      charge,
      'This charge is already being paid online and cannot be settled manually right now.'
    );

    const now = new Date();
    const recordedBy = new Types.ObjectId(userId);
    const settled = await this.paymentDAO.update(
      { _id: charge._id, cuid: charge.cuid, status: charge.status, deletedAt: null },
      {
        $set: {
          status: PaymentRecordStatus.PAID,
          isManualEntry: true,
          paidAt: data.paidAt,
          paymentMethod: data.paymentMethod,
          recordedBy,
          // No money moved through the gateway, so no gateway or platform fees apply
          processingFee: data.processingFee || 0,
          applicationFee: 0,
          platformRevenue: 0,
          cancelledAt: null,
          managerReviewRequired: paymentSource === 'staff_initiated',
          ...(data.description ? { description: data.description } : {}),
          ...(data.receipt
            ? { receipt: { ...data.receipt, uploadedBy: recordedBy, uploadedAt: now } }
            : {}),
        },
        $push: {
          notes: {
            note: `Settled by a manual ${data.paymentMethod.replace('_', ' ')} payment`,
            author: userId,
            createdAt: now,
          },
        },
      }
    );

    if (!settled) {
      throw new BadRequestError({
        message: 'This charge changed while it was being settled. Refresh and try again.',
      });
    }
    this.log.info(
      { pytuid: charge.pytuid, cuid: charge.cuid, previousStatus: charge.status },
      'Open charge settled by manual payment'
    );
    return settled;
  }

  /**
   * A paid maintenance charge completes the service request — same outcome as the Stripe path
   * (PaymentWebhookService.markMaintenanceChargePaid): the invoice is marked paid and
   * MAINTENANCE_CHARGE_PAID lets the service request auto-complete.
   */
  private async completeManualMaintenancePayment(payment: IPaymentDocument): Promise<void> {
    if (
      payment.paymentType !== PaymentRecordType.MAINTENANCE ||
      payment.vendorId ||
      !payment.maintenanceRequestUid
    ) {
      return;
    }

    await this.invoiceDAO.update(
      { mruid: payment.maintenanceRequestUid, cuid: payment.cuid, isDeleted: false },
      { $set: { tenantPaymentStatus: TenantPaymentStatus.PAID } }
    );

    this.emitterService.emit(EventTypes.MAINTENANCE_CHARGE_PAID, {
      cuid: payment.cuid,
      pytuid: payment.pytuid,
      mruid: payment.maintenanceRequestUid,
      amountInCents: payment.baseAmount,
    });
  }

  /**
   * Cancels an unpaid charge (voiding its Stripe invoice). A PAID record can only be voided
   * when it is a manual entry, by a manager or above, with a reason — this corrects a wrong
   * manual entry without any money movement. The manual-record usage counter is not reduced:
   * the record was created and stays in the audit trail.
   */
  async cancelPayment(
    cuid: string,
    pytuid: string,
    reason?: string,
    actor?: { role?: string; userId?: string }
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

      if (payment.status === PaymentRecordStatus.PAID) {
        return await this.voidManualPayment(payment, reason, actor);
      }

      if (payment.status === PaymentRecordStatus.CANCELLED) {
        throw new BadRequestError({
          message: `Cannot cancel a payment with status: ${payment.status}`,
        });
      }

      if (payment.gatewayPaymentId) {
        const voidResult = await this.paymentGatewayService.voidInvoice(
          IPaymentGatewayProvider.STRIPE,
          payment.gatewayPaymentId
        );
        if (!voidResult.success) {
          this.log.warn(
            { pytuid, invoiceId: payment.gatewayPaymentId, message: voidResult.message },
            'Failed to void Stripe invoice — proceeding with local cancellation'
          );
        }
      }

      const updated = await this.paymentDAO.updateById(payment._id.toString(), {
        status: PaymentRecordStatus.CANCELLED,
        cancelledAt: dayjs().toDate(),
        $unset: { gatewayPaymentId: 1 },
        ...(reason
          ? {
              $push: {
                notes: {
                  note: `Cancelled: ${reason}`,
                  createdAt: dayjs().toDate(),
                  author: actor?.userId ?? 'system',
                },
              },
            }
          : {}),
      });

      try {
        const tenantProfile = await this.profileDAO.findById(payment.tenant.toString());
        if (tenantProfile?.user) {
          this.emitterService.emit(EventTypes.PAYMENT_CANCELLED, {
            tenantUserId: tenantProfile.user.toString(),
            amountInCents: payment.baseAmount,
            reason,
            pytuid,
            cuid,
          });
        }
      } catch (emitError) {
        this.log.error('Failed to emit payment cancelled event', { emitError, pytuid, cuid });
      }

      return { success: true, data: updated as IPaymentDocument };
    } catch (error: any) {
      this.log.error({ error: error.message, cuid, pytuid }, 'Error cancelling payment');
      throw error;
    }
  }

  private async voidManualPayment(
    payment: IPaymentDocument,
    reason: string | undefined,
    actor?: { role?: string; userId?: string }
  ): IPromiseReturnedData<IPaymentDocument> {
    if (!payment.isManualEntry || payment.gatewayChargeId) {
      throw new BadRequestError({
        message: 'A paid online payment cannot be cancelled — refund it instead',
      });
    }
    if (!actor?.role || !MANUAL_ENTRY_VOID_ROLES.includes(actor.role)) {
      throw new ForbiddenError({
        message: 'Only managers and administrators can void a recorded manual payment',
      });
    }
    if (!reason?.trim()) {
      throw new BadRequestError({ message: 'A reason is required to void a manual payment' });
    }

    const now = new Date();
    const voided = await this.paymentDAO.update(
      {
        _id: payment._id,
        cuid: payment.cuid,
        status: PaymentRecordStatus.PAID,
        isManualEntry: true,
      },
      {
        $set: { status: PaymentRecordStatus.CANCELLED, cancelledAt: now },
        $push: {
          notes: {
            note: `Manual entry voided: ${reason.trim()}`,
            author: actor.userId ?? actor.role,
            createdAt: now,
          },
        },
      }
    );
    if (!voided) {
      throw new BadRequestError({
        message: 'This payment changed while it was being voided. Refresh and try again.',
      });
    }

    if (payment.paymentType === PaymentRecordType.MAINTENANCE && payment.maintenanceRequestUid) {
      await this.invoiceDAO
        .update(
          {
            mruid: payment.maintenanceRequestUid,
            cuid: payment.cuid,
            isDeleted: false,
            tenantPaymentStatus: TenantPaymentStatus.PAID,
          },
          { $set: { tenantPaymentStatus: TenantPaymentStatus.UNPAID } }
        )
        .catch((err) => {
          this.log.error(
            { err, pytuid: payment.pytuid },
            'Could not reset invoice payment status after voiding a manual payment'
          );
        });
    }

    this.log.info(
      { pytuid: payment.pytuid, cuid: payment.cuid, voidedBy: actor.userId, reason },
      'Manual payment voided'
    );
    return { success: true, data: voided, message: 'Manual payment voided' };
  }

  /**
   * Refunds part or all of a paid online payment. `refund.amount` is cumulative: partial
   * refunds keep the record PAID and further refunds are allowed up to the remaining amount;
   * it becomes REFUNDED only once fully refunded.
   *
   * The refunded total is claimed atomically before Stripe is called (so two concurrent
   * requests can't both refund) and released if Stripe fails. The idempotency key is tied to
   * the new total, so a retried request can't refund twice.
   */
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
      preventTenantConflict(requestingUserSub, tenantProfile?.user);

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

      const alreadyRefunded = payment.refund?.amount ?? 0;
      const refundableAmount = payment.baseAmount - alreadyRefunded;
      if (refundableAmount <= 0) {
        throw new BadRequestError({ message: 'This payment has already been fully refunded' });
      }

      const refundAmount = data.amount ?? refundableAmount;
      if (refundAmount > refundableAmount) {
        throw new BadRequestError({
          message: `Refund amount cannot exceed the remaining refundable amount of ${refundableAmount}`,
        });
      }

      const paymentProcessor = await this.paymentProcessorDAO.findFirst({ cuid });
      if (!paymentProcessor?.accountId) {
        throw new BadRequestError({ message: 'Payment processor not configured for this account' });
      }

      const vendorPayout = await this.getVendorPayoutToReverse(payment, data.reverseVendorTransfer);

      const totalRefunded = alreadyRefunded + refundAmount;
      const isFullyRefunded = totalRefunded >= payment.baseAmount;

      const claimed = await this.paymentDAO.update(
        {
          _id: payment._id,
          cuid,
          status: PaymentRecordStatus.PAID,
          'refund.amount': alreadyRefunded > 0 ? alreadyRefunded : { $in: [null, 0] },
        },
        { $set: { 'refund.amount': totalRefunded } }
      );
      if (!claimed) {
        throw new BadRequestError({
          message: 'This payment changed or another refund is in progress. Refresh and try again.',
        });
      }

      let vendorTransferReversalId: string | undefined;
      let gatewayRefundId: string | undefined;
      try {
        if (vendorPayout) {
          const reversal = await this.paymentGatewayService.createTransferReversal(
            IPaymentGatewayProvider.STRIPE,
            vendorPayout.transferId,
            Math.min(refundAmount, vendorPayout.amountInCents),
            {
              metadata: { pytuid, cuid, reason: 'tenant_refund' },
              idempotencyKey: `refund-vendor-reversal:${pytuid}:${totalRefunded}`,
            }
          );
          if (!reversal.success) {
            throw new BadRequestError({
              message: `Could not reverse the vendor payout: ${reversal.message || 'unknown error'}`,
            });
          }
          vendorTransferReversalId = reversal.data?.reversalId;
        }

        const refundResult = await this.paymentGatewayService.createRefund(
          IPaymentGatewayProvider.STRIPE,
          {
            chargeId: payment.gatewayChargeId,
            amountInCents: refundAmount,
            reason: 'requested_by_customer',
            note: data.reason,
            idempotencyKey: `refund:${pytuid}:${totalRefunded}`,
          }
        );
        if (!refundResult.success) {
          throw new BadRequestError({
            message: refundResult.message || 'Stripe refund failed',
          });
        }
        gatewayRefundId = refundResult.data?.refundId;
      } catch (refundError) {
        await this.releaseRefundClaim(payment._id, alreadyRefunded, totalRefunded);
        if (vendorTransferReversalId) {
          // Retrying the same refund reuses the reversal (same idempotency key)
          this.log.error(
            { pytuid, cuid, vendorTransferReversalId },
            'Vendor payout was reversed but the tenant refund failed — retry the refund'
          );
        }
        throw refundError;
      }

      const updated = await this.paymentDAO.updateById(payment._id.toString(), {
        $set: {
          status: isFullyRefunded ? PaymentRecordStatus.REFUNDED : PaymentRecordStatus.PAID,
          'refund.refundedAt': dayjs().toDate(),
          'refund.refundedBy': requestingUserSub,
          'refund.amount': totalRefunded,
          ...(data.reason ? { 'refund.reason': data.reason } : {}),
          ...(gatewayRefundId ? { 'refund.gatewayRefundId': gatewayRefundId } : {}),
          ...(vendorTransferReversalId
            ? { 'refund.vendorTransferReversalId': vendorTransferReversalId }
            : {}),
        },
        $unset: { 'refund.failureReason': 1, 'refund.failedAt': 1 },
      });

      if (isFullyRefunded && payment.paymentType === PaymentRecordType.MAINTENANCE) {
        await this.invoiceDAO
          .update(
            { mruid: payment.maintenanceRequestUid, cuid, isDeleted: false },
            { $set: { tenantPaymentStatus: TenantPaymentStatus.REFUNDED } }
          )
          .catch((err) => {
            this.log.error({ err, pytuid }, 'Could not mark the maintenance invoice refunded');
          });
      }

      this.emitterService.emit(EventTypes.PAYMENT_REFUNDED, {
        cuid,
        pytuid,
        chargeId: payment.gatewayChargeId,
        tenantId: tenantProfile?.user?.toString() ?? payment.tenant.toString(),
        amount: refundAmount,
        refundAmount,
        totalRefunded,
        currency: payment.currency,
        isPartial: !isFullyRefunded,
        reason: data.reason,
      });

      this.log.info('Payment refund initiated', {
        pytuid: payment.pytuid,
        refundedBy: requestingUserSub,
        refundAmount,
        totalRefunded,
        isPartial: !isFullyRefunded,
        vendorTransferReversalId,
      });

      return { success: true, data: updated as IPaymentDocument };
    } catch (error: any) {
      this.log.error({ error: error.message, cuid, pytuid }, 'Error refunding payment');
      throw error;
    }
  }

  private async releaseRefundClaim(
    paymentId: Types.ObjectId,
    alreadyRefunded: number,
    claimedTotal: number
  ): Promise<void> {
    try {
      await this.paymentDAO.update(
        { _id: paymentId, 'refund.amount': claimedTotal },
        alreadyRefunded > 0
          ? { $set: { 'refund.amount': alreadyRefunded } }
          : { $unset: { 'refund.amount': 1 } }
      );
    } catch (err) {
      this.log.error({ err, paymentId }, 'Could not release the refund claim');
    }
  }

  /**
   * Maintenance charges are not transferred to the PM — the vendor is paid by a separate
   * transfer. Once the vendor is paid, refunding the tenant would come out of the platform's
   * balance, so the refund is refused unless the PM explicitly asks to reverse the vendor payout.
   */
  private async getVendorPayoutToReverse(
    payment: IPaymentDocument,
    reverseVendorTransfer?: boolean
  ): Promise<{ transferId: string; amountInCents: number } | null> {
    if (
      payment.paymentType !== PaymentRecordType.MAINTENANCE ||
      payment.vendorId ||
      !payment.maintenanceRequestUid
    ) {
      return null;
    }

    const invoice = await this.invoiceDAO.findByMaintenanceRequest(
      payment.maintenanceRequestUid,
      payment.cuid
    );
    const vendorWasPaid =
      invoice?.vendorPayoutStatus === 'paid' || !!invoice?.vendorPayoutTransferId;
    if (!invoice || !vendorWasPaid) return null;

    if (!reverseVendorTransfer) {
      throw new BadRequestError({
        message:
          'The vendor has already been paid for this maintenance request. To refund the tenant, confirm that the vendor payout should be reversed (reverseVendorTransfer: true).',
        code: PaymentErrorCode.VENDOR_PAYOUT_REVERSAL_REQUIRED,
      });
    }
    if (!invoice.vendorPayoutTransferId) {
      throw new BadRequestError({
        message:
          'The vendor was paid outside the platform, so the payout cannot be reversed automatically.',
      });
    }
    return {
      transferId: invoice.vendorPayoutTransferId,
      amountInCents: invoice.amountInCents || payment.baseAmount,
    };
  }

  /**
   * Releases a security deposit that is staged as PENDING_REFUND (requires PM/admin action
   * when requireDepositRefundApproval is enabled on the client).
   * Executes the Stripe refund against the deposit's original charge.
   */
  async releaseDepositRefund(
    cuid: string,
    pytuid: string,
    releasedBy: string,
    data?: IRefundPaymentData
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      const payment = await this.paymentDAO.findFirst({ pytuid, cuid, deletedAt: null });
      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      if (payment.paymentType !== PaymentRecordType.SECURITY_DEPOSIT) {
        throw new BadRequestError({
          message: 'Only security deposit payments can be released via this route',
        });
      }

      if (payment.status !== PaymentRecordStatus.PENDING_REFUND) {
        throw new BadRequestError({
          message: `Cannot release deposit with status: ${payment.status}. Only PENDING_REFUND deposits can be released.`,
        });
      }

      const refundAmount = payment.refund?.amount ?? payment.baseAmount;

      if (data?.isManualRelease || !payment.gatewayChargeId) {
        // PM recorded the refund as processed outside the app, or no Stripe charge exists — DB update only
        const updated = await this.paymentDAO.updateById(payment._id.toString(), {
          $set: {
            status: PaymentRecordStatus.REFUNDED,
            'refund.refundedAt': dayjs().toDate(),
            'refund.refundedBy': releasedBy,
            'refund.amount': refundAmount,
            'refund.reason': data?.reason || 'Security deposit refund released by PM (offline)',
          },
        });
        this.log.info({ pytuid, cuid, releasedBy }, 'Offline deposit refund released');
        // refund.amount was set when the refund was staged, so the Stripe webhook won't announce
        // it — tell the tenant here, offline releases included
        await this.emitDepositRefunded(payment, refundAmount, data?.reason);
        return { success: true, data: updated as IPaymentDocument };
      }

      const refundResult = await this.paymentGatewayService.createRefund(
        IPaymentGatewayProvider.STRIPE,
        {
          chargeId: payment.gatewayChargeId,
          amountInCents: refundAmount,
          reason: 'requested_by_customer',
          note: data?.reason || 'Security deposit refund released by PM',
          // A new key per failed attempt so a retry isn't answered with Stripe's cached failure
          idempotencyKey: `deposit-refund:${payment.pytuid}:${payment.refund?.failedAt?.getTime() ?? 0}`,
        }
      );

      if (!refundResult.success) {
        throw new BadRequestError({
          message: refundResult.message || 'Stripe deposit refund failed',
        });
      }

      const updated = await this.paymentDAO.updateById(payment._id.toString(), {
        $set: {
          status: PaymentRecordStatus.REFUNDED,
          'refund.refundedAt': dayjs().toDate(),
          'refund.refundedBy': releasedBy,
          'refund.amount': refundAmount,
          'refund.reason': data?.reason || 'Security deposit refund released by PM',
          'refund.gatewayRefundId': refundResult.data?.refundId,
        },
        $unset: { 'refund.failureReason': '', 'refund.failedAt': '' },
      });

      this.log.info(
        { pytuid, cuid, releasedBy, refundAmount },
        'Security deposit refund released via Stripe'
      );

      await this.emitDepositRefunded(payment, refundAmount, data?.reason);

      return { success: true, data: updated as IPaymentDocument };
    } catch (error: any) {
      this.log.error({ error: error.message, cuid, pytuid }, 'Error releasing deposit refund');
      throw error;
    }
  }

  private async emitDepositRefunded(
    payment: IPaymentDocument,
    refundAmount: number,
    reason?: string
  ): Promise<void> {
    try {
      const tenantProfile = await this.profileDAO.findFirst({ _id: payment.tenant });
      this.emitterService.emit(EventTypes.PAYMENT_REFUNDED, {
        cuid: payment.cuid,
        pytuid: payment.pytuid,
        chargeId: payment.gatewayChargeId ?? '',
        tenantId: tenantProfile?.user?.toString() ?? payment.tenant.toString(),
        amount: refundAmount,
        refundAmount,
        totalRefunded: refundAmount,
        currency: payment.currency,
        isPartial: refundAmount < payment.baseAmount,
        reason,
      });
    } catch (err) {
      this.log.error({ err, pytuid: payment.pytuid }, 'Could not announce the deposit refund');
    }
  }

  /**
   * PM/admin confirms a staff-initiated manual payment entry.
   * Clears the managerReviewRequired flag and records who reviewed it.
   */
  async reviewManualPayment(
    cuid: string,
    pytuid: string,
    reviewerId: string,
    data?: { notes?: string }
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      const payment = await this.paymentDAO.findFirst({ pytuid, cuid, deletedAt: null });
      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      if (!payment.managerReviewRequired) {
        throw new BadRequestError({ message: 'This payment does not require manager review' });
      }

      const updated = await this.paymentDAO.updateById(payment._id.toString(), {
        $set: {
          managerReviewRequired: false,
          'managerReview.reviewedBy': new Types.ObjectId(reviewerId),
          'managerReview.reviewedAt': dayjs().toDate(),
          ...(data?.notes ? { 'managerReview.notes': data.notes } : {}),
        },
      });

      this.log.info({ pytuid, cuid, reviewerId }, 'Manual payment reviewed and confirmed');
      return {
        success: true,
        data: updated as IPaymentDocument,
        message: 'Payment review confirmed',
      };
    } catch (error: any) {
      this.log.error({ error: error.message, cuid, pytuid }, 'Error reviewing manual payment');
      throw error;
    }
  }

  /**
   * Creates a Stripe Checkout Session (mode: payment) so a tenant can pay a pending
   * charge with a debit or credit card. The card is charged once — no payment method
   * is saved. The existing bank auto-debit setup is left untouched.
   */
  async createCardPaymentSession(
    cuid: string,
    pytuid: string,
    tenantUserId: string,
    returnUrls?: { successUrl?: string; cancelUrl?: string }
  ): IPromiseReturnedData<{ checkoutUrl: string }> {
    try {
      const payment = await this.paymentDAO.findFirst({ pytuid, cuid, deletedAt: null });
      if (!payment) {
        throw new NotFoundError({ message: 'Payment not found' });
      }

      const isRetryableStatus =
        payment.status === PaymentRecordStatus.PENDING ||
        payment.status === PaymentRecordStatus.OVERDUE ||
        payment.status === PaymentRecordStatus.FAILED;

      if (!isRetryableStatus) {
        throw new BadRequestError({
          message: `This payment cannot be paid — current status: ${payment.status}`,
        });
      }

      if (
        payment.status === PaymentRecordStatus.FAILED &&
        (payment.failure?.retryCount ?? 0) >= MAX_CHARGE_ATTEMPTS
      ) {
        throw new BadRequestError({
          message: 'This payment has exceeded the maximum number of retry attempts',
        });
      }

      const CARD_CHECKOUT_ALLOWED_TYPES: string[] = [
        PaymentRecordType.RENT,
        PaymentRecordType.MAINTENANCE,
        PaymentRecordType.LATE_FEE,
      ];
      if (!CARD_CHECKOUT_ALLOWED_TYPES.includes(payment.paymentType)) {
        throw new BadRequestError({
          message: `Card checkout is not supported for payment type: ${payment.paymentType}`,
        });
      }

      const tenantProfile = await this.getProfileOrThrow(tenantUserId, 'Tenant profile not found');
      if (!payment.tenant.equals(tenantProfile._id)) {
        throw new BadRequestError({ message: 'You do not have permission to pay this charge' });
      }

      const paymentProcessor = await this.paymentProcessorDAO.findFirst({
        cuid,
        ownerType: 'client',
        deletedAt: null,
      });
      if (!paymentProcessor?.accountId || !paymentProcessor.chargesEnabled) {
        throw new BadRequestError({
          message: 'Payment account not configured or not ready for charges',
        });
      }

      const MONTH_NAMES = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      const periodLabel =
        payment.period?.month && payment.period?.year
          ? `${MONTH_NAMES[(payment.period.month - 1) % 12]} ${payment.period.year}`
          : '';

      const paymentTypeLabelMap: Record<string, string> = {
        rent: 'Rent',
        maintenance: 'Maintenance',
        late_fee: 'Late Fee',
      };
      const typeLabel = paymentTypeLabelMap[payment.paymentType] ?? 'Payment';
      const itemName = periodLabel ? `${typeLabel} — ${periodLabel}` : typeLabel;

      const totalAmountCents = payment.baseAmount ?? 0;
      const currency = payment.currency ?? 'usd';

      // Recalculate application fee for card rates.
      // The payment record may have been created with ACH/ACSS rates (1.75%)
      // but card payments incur higher Stripe fees (2.9% + $0.30). We must
      // use the plan's card transaction fee (3.5-4.5%) to ensure the platform
      // covers Stripe's card processing cost from the application fee.
      let cardApplicationFee = payment.applicationFee ?? 0;
      if (!payment.paymentType || payment.paymentType !== PaymentRecordType.MAINTENANCE) {
        try {
          const subscription = await this.subscriptionDAO.findFirst({ cuid });
          if (subscription?.planName) {
            const cardTxFeePercent = this.subscriptionPlanConfig.getTransactionFeePercent(
              subscription.planName
            );
            const recalculated = Math.round(totalAmountCents * (cardTxFeePercent / 100));
            // Only use the recalculated fee if it's higher — never lower the fee
            // below what was originally set (protects against config edge cases).
            if (recalculated > cardApplicationFee) {
              cardApplicationFee = recalculated;
              this.log.info(
                {
                  pytuid,
                  cuid,
                  originalFee: payment.applicationFee,
                  cardFee: cardApplicationFee,
                  rate: cardTxFeePercent,
                },
                'Recalculated application fee for card checkout'
              );
            }
          }
        } catch (feeError: any) {
          this.log.warn(
            { pytuid, cuid, error: feeError.message },
            'Failed to recalculate card application fee — using original'
          );
        }
      }

      const tenantUser = await this.userDAO.findFirst({
        _id: new Types.ObjectId(tenantUserId),
      });
      const customerEmail = tenantUser?.email ?? '';

      const uid = tenantUserId;
      const frontendUrl = envVariables.FRONTEND.URL;

      // Fall back to the specific payment-detail page so the user lands in the
      // right context and can see success / cancel state immediately.
      const defaultSuccessUrl = `${frontendUrl}/tenants/${cuid}/${uid}/payments/${pytuid}?payment_success=true`;
      const defaultCancelUrl = `${frontendUrl}/tenants/${cuid}/${uid}/payments/${pytuid}?payment_cancelled=true`;

      const successUrl = this.resolveCheckoutReturnUrl(
        returnUrls?.successUrl,
        cuid,
        defaultSuccessUrl
      );
      const cancelUrl = this.resolveCheckoutReturnUrl(
        returnUrls?.cancelUrl,
        cuid,
        defaultCancelUrl
      );

      // Use Stripe customer ID (if available) so the card is saved for future
      // charges (e.g., automatic ACSS-to-card retry when bank debit fails).
      const tenantCustomerId = tenantProfile.tenantInfo?.paymentGatewayCustomers?.get('platform');

      // Only one checkout per charge can be payable — paying two sessions would charge twice
      await this.expireOpenCardCheckout(payment);

      // Card checkout charges through its own PaymentIntent. Void the open Stripe invoice(s)
      // first so the auto-charge cron can't also pay them while the tenant is checking out.
      await this.voidGatewayInvoices(
        payment,
        'This payment is already being processed and cannot be paid by card right now.'
      );

      const session = await this.stripeService.createPaymentCheckoutSession({
        customerEmail,
        customerId: tenantCustomerId,
        lineItems: [
          {
            name: itemName,
            description: `Payment ID: ${pytuid}`,
            amountInCents: totalAmountCents,
            currency,
          },
        ],
        applicationFeeAmount: cardApplicationFee,
        destinationAccountId: paymentProcessor.accountId,
        metadata: { pytuid, cuid, uid, type: 'card_payment' },
        successUrl,
        cancelUrl,
        skipDestinationTransfer: payment.paymentType === PaymentRecordType.MAINTENANCE,
      });

      if (!session.url) {
        throw new Error('Stripe did not return a checkout URL');
      }

      try {
        await this.paymentDAO.updateById(payment._id.toString(), {
          $set: { cardCheckoutSessionId: session.id },
        });
      } catch (err) {
        this.log.error(
          { err, pytuid, sessionId: session.id },
          'Could not store the checkout session id — it cannot be expired later'
        );
      }

      this.log.info(
        { pytuid, cuid, sessionId: session.id },
        'Card payment checkout session created'
      );

      return {
        success: true,
        data: { checkoutUrl: session.url },
      };
    } catch (error: any) {
      this.log.error({ pytuid, cuid, error }, 'Error creating card payment checkout session');
      throw error;
    }
  }

  /**
   * Expires the charge's previous card checkout session so it can no longer be paid. Refuses
   * when that session was already paid (the webhook is still confirming it) or when Stripe
   * can't be reached — leaving it open could let the tenant pay the same charge twice.
   */
  private async expireOpenCardCheckout(payment: IPaymentDocument): Promise<void> {
    if (!payment.cardCheckoutSessionId) return;

    const result = await this.paymentGatewayService.expireCheckoutSession(
      IPaymentGatewayProvider.STRIPE,
      payment.cardCheckoutSessionId
    );
    if (!result.success) {
      throw new BadRequestError({
        message: 'Could not close the previous card checkout for this payment. Try again shortly.',
      });
    }
    if (result.data?.status === 'complete') {
      throw new BadRequestError({
        message:
          'A card payment for this charge has already been completed and is being confirmed.',
      });
    }

    await this.paymentDAO.updateById(payment._id.toString(), {
      $unset: { cardCheckoutSessionId: 1 },
    });
  }

  /**
   * Caller-supplied checkout return URLs must stay inside this client's tenant portal on the
   * frontend origin (relative paths are resolved against it); anything else falls back to the
   * payment page, so Stripe can't be used as an open redirect.
   */
  private resolveCheckoutReturnUrl(
    requestedUrl: string | undefined,
    cuid: string,
    fallbackUrl: string
  ): string {
    if (!requestedUrl || !isAllowedCheckoutReturnUrl(requestedUrl)) return fallbackUrl;
    try {
      const resolved = new URL(requestedUrl, envVariables.FRONTEND.URL);
      return resolved.pathname.startsWith(`/tenants/${cuid}/`) ? resolved.toString() : fallbackUrl;
    } catch {
      return fallbackUrl;
    }
  }

  /**
   * Voids every Stripe invoice still attached to a payment (including ACSS split invoices)
   * and detaches them. Used before the charge is paid another way (card checkout or a manual
   * payment). Refuses with `blockedMessage` when one can't be voided — e.g. it is already paid
   * or a bank debit is in flight — because paying it another way would charge the tenant twice.
   * If the tenant then abandons card checkout, the payment stays payable: a new invoice is
   * created when they pay, and the overdue cron tracks it like any invoice-less payment.
   */
  private async voidGatewayInvoices(
    payment: IPaymentDocument,
    blockedMessage: string
  ): Promise<void> {
    const invoiceIds = [
      ...new Set(
        [payment.gatewayPaymentId, ...(payment.splitInvoices ?? []).map((s) => s.invoiceId)].filter(
          (id): id is string => !!id && id.startsWith('in_')
        )
      ),
    ];
    if (invoiceIds.length === 0) return;

    const voided: string[] = [];
    for (const invoiceId of invoiceIds) {
      const voidResult = await this.paymentGatewayService.voidInvoice(
        IPaymentGatewayProvider.STRIPE,
        invoiceId
      );
      if (!voidResult.success) {
        this.log.warn(
          { pytuid: payment.pytuid, invoiceId, voided, message: voidResult.message },
          'Could not void invoice before the charge is paid another way'
        );
        if (voided.length > 0) {
          // Some invoices were already voided at the gateway — detach them so the DB stays consistent
          await this.paymentDAO.updateById(payment._id.toString(), {
            $unset: { gatewayPaymentId: 1 },
            $pull: { splitInvoices: { invoiceId: { $in: voided } } },
          });
        }
        throw new BadRequestError({ message: blockedMessage });
      }
      voided.push(invoiceId);
    }

    await this.paymentDAO.updateById(payment._id.toString(), {
      $unset: { gatewayPaymentId: 1, splitInvoices: 1 },
    });
  }

  async generateTenantReceipt(
    pytuid: string,
    cuid: string,
    tenantUserId: string
  ): Promise<{ buffer: Buffer; filename: string }> {
    try {
      const tenantProfile = await this.profileDAO.findFirst(
        { user: new Types.ObjectId(tenantUserId) },
        { populate: { path: 'user', select: 'email' } }
      );
      if (!tenantProfile) throw new NotFoundError({ message: 'Tenant profile not found' });

      const payment = await this.paymentDAO.findFirst(
        { pytuid, cuid, tenant: tenantProfile._id, deletedAt: null },
        { populate: [{ path: 'lease', select: 'leaseNumber property' }] }
      );
      if (!payment) throw new NotFoundError({ message: 'Payment not found' });
      if ((payment.status as string) !== PaymentRecordStatus.PAID) {
        throw new BadRequestError({ message: 'Receipt only available for paid payments' });
      }

      const tenantName =
        `${tenantProfile.personalInfo?.firstName || ''} ${tenantProfile.personalInfo?.lastName || ''}`.trim() ||
        'Tenant';
      const lease = (payment as unknown as IPaymentPopulated).lease;
      const propertyAddress =
        typeof lease?.property?.address === 'string'
          ? lease.property.address
          : lease?.property?.address?.fullAddress || '';

      const fmt = (cents: number) => `${payment.currency} ${MoneyUtils.centsToDisplay(cents)}`;
      const fmtDate = (d: Date) =>
        d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      const titleCase = (s: string) =>
        s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      const total = payment.baseAmount + (payment.processingFee || 0);

      const referenceEntries: { key: string; value: string }[] = [];
      if (lease?.leaseNumber) referenceEntries.push({ key: 'Lease', value: lease.leaseNumber });
      if (payment.period)
        referenceEntries.push({
          key: 'Period',
          value: `${payment.period.month}/${payment.period.year}`,
        });
      referenceEntries.push({ key: 'Due Date', value: fmtDate(payment.dueDate) });
      if (payment.paidAt) referenceEntries.push({ key: 'Paid On', value: fmtDate(payment.paidAt) });

      const lineItems = [
        { description: titleCase(payment.paymentType as string), amount: fmt(payment.baseAmount) },
      ];
      if (payment.processingFee > 0) {
        lineItems.push({ description: 'Processing Fee', amount: fmt(payment.processingFee) });
      }

      const renderData: InvoiceRenderData = {
        companyName: 'Property Management',
        documentTitle: 'Payment Receipt',
        invoiceNumber: payment.invoiceNumber,
        statusLabel: 'PAID',
        statusKey: 'paid',
        billTo: {
          label: 'Tenant',
          name: tenantName,
          address: propertyAddress,
        },
        reference: {
          label: 'Payment Reference',
          entries: referenceEntries,
        },
        details: [{ key: 'Payment Type', value: titleCase(payment.paymentType as string) }],
        detailsTitle: 'Payment Details',
        lineItems,
        lineItemsTitle: 'Amount Breakdown',
        subtotals:
          payment.processingFee > 0 ? [{ label: 'Subtotal', amount: fmt(payment.baseAmount) }] : [],
        totalAmount: fmt(total),
        footerNote: 'This is an official payment receipt.',
        accentColor: '#16a34a',
        accentColorLight: '#4ade80',
      };

      const html = await this.invoiceTemplateRenderer.render(renderData);

      const result = await this.pdfGeneratorService.generatePdf(html, {
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
        displayHeaderFooter: false,
      });

      if (!result.success || !result.buffer) throw new Error('Failed to generate receipt PDF');

      return { buffer: result.buffer, filename: `receipt-${payment.invoiceNumber}.pdf` };
    } catch (error) {
      this.log.error('Error generating tenant receipt', error);
      throw error;
    }
  }

  // ── Payout Account ──────────────────────────────────────────────────

  async createConnectAccount(
    cuid: string,
    data: { email: string; country: string }
  ): IPromiseReturnedData<any> {
    return this.payoutAccountService.createConnectAccount(cuid, data);
  }

  async getKycOnboardingLink(
    cuid: string,
    urlOverrides?: { returnUrl?: string; refreshUrl?: string }
  ): IPromiseReturnedData<{ url: string }> {
    return this.payoutAccountService.getKycOnboardingLink(cuid, urlOverrides);
  }

  async getAccountUpdateLink(
    cuid: string,
    urlOverrides?: { returnUrl?: string; refreshUrl?: string }
  ): IPromiseReturnedData<{ url: string }> {
    return this.payoutAccountService.getAccountUpdateLink(cuid, urlOverrides);
  }

  async getExternalDashboardLoginLink(cuid: string): IPromiseReturnedData<{ url: string }> {
    return this.payoutAccountService.getExternalDashboardLoginLink(cuid);
  }

  async getPayoutBalance(cuid: string): IPromiseReturnedData<any> {
    return this.payoutAccountService.getPayoutBalance(cuid);
  }

  async getPayoutHistory(
    cuid: string,
    query: { limit?: number; cursor?: string }
  ): IPromiseReturnedData<any> {
    return this.payoutAccountService.getPayoutHistory(cuid, query);
  }

  async getPayoutSchedule(cuid: string): IPromiseReturnedData<IPayoutSchedule> {
    return this.payoutAccountService.getPayoutSchedule(cuid);
  }

  async updatePayoutSchedule(
    cuid: string,
    interval: 'daily' | 'weekly' | 'monthly',
    weeklyAnchor?: string
  ): IPromiseReturnedData<null> {
    return this.payoutAccountService.updatePayoutSchedule(cuid, interval, weeklyAnchor);
  }

  async unblockPayouts(cuid: string, userId: string): IPromiseReturnedData<null> {
    return this.payoutAccountService.unblockPayouts(cuid, userId);
  }

  // ── Maintenance Payment ─────────────────────────────────────────────

  async chargeForMaintenance(
    cuid: string,
    currentUserId: string,
    body: { mruid: string; tenantId: string; amount?: number; description?: string }
  ): IPromiseReturnedData<IPaymentDocument> {
    return this.maintenancePaymentService.chargeForMaintenance(cuid, currentUserId, body);
  }

  async payVendor(cuid: string, mruid: string): IPromiseReturnedData<null> {
    return this.maintenancePaymentService.payVendor(cuid, mruid);
  }

  // ── Webhook handlers ────────────────────────────────────────────────

  async handleInvoicePaymentSucceeded(
    invoiceId: string,
    invoiceData: IStripeInvoiceWebhookData
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleInvoicePaymentSucceeded(invoiceId, invoiceData);
  }

  async handleInvoicePaymentFailed(
    invoiceId: string,
    invoiceData: IStripeInvoiceWebhookData
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleInvoicePaymentFailed(invoiceId, invoiceData);
  }

  async handleChargePending(
    chargeId: string,
    chargeData: {
      invoice?: string | null;
      payment_intent?: string | null;
      amount?: number;
      currency?: string;
    }
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleChargePending(chargeId, chargeData);
  }

  async handleChargeRefunded(
    chargeId: string,
    chargeData: IStripeChargeWebhookData
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleChargeRefunded(chargeId, chargeData);
  }

  async handleAccountUpdated(
    accountId: string,
    accountData: IStripeAccountWebhookData
  ): IPromiseReturnedData<null> {
    return this.paymentWebhookService.handleAccountUpdated(accountId, accountData);
  }

  async handlePayoutPaid(
    payoutId: string,
    payoutData: IStripePayoutWebhookData,
    connectedAccountId: string
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handlePayoutPaid(payoutId, payoutData, connectedAccountId);
  }

  async handlePayoutFailed(
    payoutId: string,
    payoutData: IStripePayoutWebhookData,
    connectedAccountId: string
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handlePayoutFailed(payoutId, payoutData, connectedAccountId);
  }

  async handleInvoiceOverdue(
    invoiceId: string,
    invoiceData: { amount_due?: number; currency?: string } & IStripeInvoiceWebhookData
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleInvoiceOverdue(invoiceId, invoiceData);
  }

  async handleInvoiceUpcoming(invoiceData: {
    id: string;
    subscription?: string;
    amount_due?: number;
    currency?: string;
    period_start?: number;
  }): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleInvoiceUpcoming(invoiceData);
  }

  async handleSetupSessionCompleted(
    session: {
      mode: string;
      id: string;
      customer?: string | null;
      metadata?: Record<string, string> | null;
      setup_intent?: string | null;
    },
    _source: string
  ): Promise<void> {
    return this.paymentWebhookService.handleSetupSessionCompleted(session, _source);
  }

  async handleCardPaymentSessionCompleted(session: {
    id: string;
    payment_intent?: string | null;
    metadata?: Record<string, string> | null;
    payment_status?: string;
  }): Promise<void> {
    return this.paymentWebhookService.handleCardPaymentSessionCompleted(session);
  }

  async handleSetupIntentSucceeded(setupIntent: {
    id: string;
    metadata?: Record<string, string> | null;
    customer?: string | { id?: string } | null;
    payment_method?: string | { id?: string } | null;
    mandate?: string | { id?: string } | null;
  }): Promise<void> {
    return this.paymentWebhookService.handleSetupIntentSucceeded(setupIntent);
  }

  async handleDisputeCreated(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleDisputeCreated(disputeId, disputeData);
  }

  async handleDisputeWon(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleDisputeWon(disputeId, disputeData);
  }

  async handleDisputeLost(
    disputeId: string,
    disputeData: IStripeDisputeWebhookData
  ): IPromiseReturnedData<void> {
    return this.paymentWebhookService.handleDisputeLost(disputeId, disputeData);
  }
}
