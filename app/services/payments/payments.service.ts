import dayjs from 'dayjs';
import Logger from 'bunyan';
import mongoose from 'mongoose';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { MoneyUtils } from '@utils/money.utils';
import { type QueryFilter, Types } from 'mongoose';
import { MAX_CHARGE_ATTEMPTS } from '@utils/constants';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { PdfGeneratorService } from '@services/pdfGenerator';
import { InvoiceStatus } from '@interfaces/invoice.interface';
import { SubscriptionPlanConfig } from '@services/subscription';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { IPayoutSchedule } from '@interfaces/paymentGateway.interface';
import { StripeService } from '@services/external/stripe/stripe.service';
import { InvoiceTemplateRenderer, InvoiceRenderData } from '@services/invoice';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { preventTenantConflict, calcCollectionRate, createLogger } from '@utils/index';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { IVendorEarningsResponse, IVendorEarningItem } from '@interfaces/payments.interface';
import {
  IPromiseReturnedData,
  IPaginateResult,
  IRequestContext,
} from '@interfaces/utils.interface';
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
  IPaymentFullyPopulated,
  IManualPaymentFormData,
  PaymentRecordStatus,
  IRefundPaymentData,
  IPaymentPopulated,
  PaymentRecordType,
  IPaymentListItem,
  IPaymentDocument,
  IPaymentFormData,
  IProfileWithUser,
  PaymentSource,
} from '@interfaces/index';

import { PaymentCronService } from './paymentCron.service';
import { RentPaymentService } from './rentPayment.service';
import { PayoutAccountService } from './payoutAccount.service';
import { MaintenancePaymentService } from './maintenancePayment.service';
import { IStripeInvoiceWebhookData, PaymentWebhookService } from './paymentWebhook.service';

interface IConstructor {
  maintenancePaymentService: MaintenancePaymentService;
  invoiceTemplateRenderer: InvoiceTemplateRenderer;
  subscriptionPlanConfig: SubscriptionPlanConfig;
  paymentGatewayService: PaymentGatewayService;
  paymentWebhookService: PaymentWebhookService;
  payoutAccountService: PayoutAccountService;
  pdfGeneratorService: PdfGeneratorService;
  paymentProcessorDAO: PaymentProcessorDAO;
  paymentCronService: PaymentCronService;
  rentPaymentService: RentPaymentService;
  emitterService: EventEmitterService;
  subscriptionDAO: SubscriptionDAO;
  stripeService: StripeService;
  invoiceDAO: InvoiceDAO;
  paymentDAO: PaymentDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

interface IStripePayoutWebhookData {
  status: 'paid' | 'pending' | 'in_transit' | 'canceled' | 'failed';
  failure_message?: string;
  failure_reason?: string;
  failure_code?: string;
  arrival_date: number;
  destination: string;
  currency: string;
  amount: number;
  id: string;
}

interface IStripeAccountWebhookData {
  requirements?: {
    currently_due?: string[];
    eventually_due?: string[];
    past_due?: string[];
    disabled_reason?: string;
  };
  details_submitted?: boolean;
  payouts_enabled?: boolean;
  charges_enabled?: boolean;
}

interface IStripeDisputeWebhookData {
  evidence_details?: { due_by?: number };
  charge?: string | { id: string };
  currency: string;
  reason?: string;
  amount: number;
}

interface IStripeChargeWebhookData {
  amount_refunded?: number;
}

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
    options?: { createStripeInvoice?: boolean; paymentSource?: PaymentSource }
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
            'pytuid paymentMethod paymentType baseAmount processingFee applicationFee platformRevenue status dueDate paidAt period failure receipt lineItems currency maintenanceRequestUid',
          skip,
          limit,
        },
        true
      );

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
          amount: payment.baseAmount + (payment.processingFee || 0),
          baseAmount: payment.baseAmount,
          processingFee: payment.processingFee || 0,
          applicationFee: payment.applicationFee || 0,
          platformRevenue: (payment as any).platformRevenue || 0,
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
              // Team member — look up org by vuid
              vendorOrg = await mongoose.connection.db
                ?.collection('vendors')
                .findOne({ vuid: vendorVuid, deletedAt: null }, { projection: { companyName: 1 } });
            } else if (clientEntry?.primaryRole === 'vendor') {
              // Primary account holder — look up org by primaryAccountHolderUserId
              vendorOrg = await mongoose.connection.db?.collection('vendors').findOne(
                {
                  'connectedClients.primaryAccountHolderUserId': invoice.submittedBy,
                  deletedAt: null,
                },
                { projection: { companyName: 1 } }
              );
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
        const mr = await mongoose.connection.db
          ?.collection('maintenancerequests')
          .findOne(
            { mruid: paymentObj.maintenanceRequestUid, cuid },
            { projection: { propertyId: 1 } }
          );
        if (mr?.propertyId) {
          const prop = await mongoose.connection.db
            ?.collection('properties')
            .findOne(
              { _id: mr.propertyId },
              { projection: { pid: 1, name: 1, 'address.fullAddress': 1 } }
            );
          if (prop) {
            propertyInfo = {
              pid: prop.pid || '',
              name: prop.name || '',
              address: prop.address?.fullAddress || '',
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
      const result = await this.paymentDAO.findByCuid(cuid, daoFilters, { limit: 10000 });
      const allPayments = result.items || [];

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
          // Counts toward both expectedRevenue and collected.
          case PaymentRecordStatus.PAID:
            expectedRevenue += amount;
            collected += amount;
            if (isRent) {
              rentExpected += amount;
              rentCollected += amount;
            }
            break;

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
        const vendorOrg = await mongoose.connection.db
          ?.collection('vendors')
          .findOne(
            { 'connectedClients.primaryAccountHolderUserId': vendor._id, deletedAt: null },
            { projection: { vuid: 1 } }
          );
        vendorVuid = vendorOrg?.vuid || null;
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

  async recordManualPayment(
    cuid: string,
    userId: string,
    requestingUserSub: string,
    data: IManualPaymentFormData,
    paymentSource?: PaymentSource
  ): IPromiseReturnedData<IPaymentDocument> {
    try {
      // Prevent conflict of interest: cannot record payment where you are the tenant
      preventTenantConflict(requestingUserSub, data.tenantId as string);

      const client = await this.clientDAO.findFirst({ cuid, deletedAt: null });
      if (!client) {
        throw new NotFoundError({ message: 'Client not found' });
      }

      const tenantProfile = await this.getProfileOrThrow(
        data.tenantId as string,
        'Tenant profile not found'
      );

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
        lease: lease ? lease._id : undefined,
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
        ...(paymentSource ? { paymentSource } : {}),
        ...(data.receipt
          ? { receipt: { ...data.receipt, uploadedBy: new Types.ObjectId(userId) } }
          : {}),
      });

      // Track manual record usage for quota (fire-and-forget)
      this.incrementManualRecordCount(cuid).catch((err) => {
        this.log.error({ err, cuid }, 'Background manual record usage tracking failed');
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

  async incrementManualRecordCount(cuid: string): Promise<void> {
    const subscription = await this.subscriptionDAO.findFirst({ cuid });
    if (!subscription) return;

    const now = dayjs();
    const periodStart = subscription.manualRecords?.periodStart
      ? dayjs(subscription.manualRecords.periodStart)
      : dayjs(subscription.startDate);

    const monthsElapsed =
      (now.year() - periodStart.year()) * 12 + (now.month() - periodStart.month());

    if (monthsElapsed >= 1) {
      await this.subscriptionDAO.update(
        { cuid },
        {
          $set: {
            'manualRecords.countThisPeriod': 1,
            'manualRecords.periodStart': now.toDate(),
          },
        }
      );
      return;
    }

    await this.subscriptionDAO.update({ cuid }, { $inc: { 'manualRecords.countThisPeriod': 1 } });
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
                  text: `Cancelled: ${reason}`,
                  createdAt: dayjs().toDate(),
                  author: 'system',
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

      const updated = await this.paymentDAO.updateById(payment._id.toString(), {
        status: PaymentRecordStatus.REFUNDED,
        'refund.refundedAt': dayjs().toDate(),
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
      const frontendUrl = process.env.FRONTEND_URL ?? '';

      // Validate that a caller-supplied URL belongs to this app before using it.
      const isSafeReturnUrl = (url: string) => url.startsWith(`${frontendUrl}/tenants/${cuid}/`);

      // Fall back to the specific payment-detail page so the user lands in the
      // right context and can see success / cancel state immediately.
      const defaultSuccessUrl = `${frontendUrl}/tenants/${cuid}/${uid}/payments/${pytuid}?payment_success=true`;
      const defaultCancelUrl = `${frontendUrl}/tenants/${cuid}/${uid}/payments/${pytuid}?payment_cancelled=true`;

      const successUrl =
        returnUrls?.successUrl && isSafeReturnUrl(returnUrls.successUrl)
          ? returnUrls.successUrl
          : defaultSuccessUrl;

      const cancelUrl =
        returnUrls?.cancelUrl && isSafeReturnUrl(returnUrls.cancelUrl)
          ? returnUrls.cancelUrl
          : defaultCancelUrl;

      // Use Stripe customer ID (if available) so the card is saved for future
      // charges (e.g., automatic ACSS-to-card retry when bank debit fails).
      const tenantCustomerId = tenantProfile.tenantInfo?.paymentGatewayCustomers?.get('platform');

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
    body: { mruid: string; tenantId: string; amount: number; description?: string }
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
