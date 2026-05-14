import { Response } from 'express';
import { createLogger } from '@utils/index';
import { ForbiddenError } from '@shared/customErrors';
import ROLES from '@shared/constants/roles.constants';
import { CronService } from '@services/cron/cron.service';
import { MediaUploadService } from '@services/mediaUpload';
import { PaymentService, InvoiceService } from '@services/index';
import { ResourceContext, AppRequest } from '@interfaces/utils.interface';

interface IConstructor {
  mediaUploadService: MediaUploadService;
  invoiceService: InvoiceService;
  paymentService: PaymentService;
  cronService: CronService;
}

export class PaymentController {
  private readonly log = createLogger('PaymentController');
  private readonly paymentService: PaymentService;
  private readonly invoiceService: InvoiceService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly cronService: CronService;

  constructor({ paymentService, invoiceService, mediaUploadService, cronService }: IConstructor) {
    this.paymentService = paymentService;
    this.invoiceService = invoiceService;
    this.mediaUploadService = mediaUploadService;
    this.cronService = cronService;
  }

  async listPayments(req: AppRequest, res: Response) {
    const { cuid } = req.params;

    const filters = {
      status: req.query.status as string,
      type: req.query.type as string,
      tenantId: req.query.tenantId as string,
      leaseId: req.query.leaseId as string,
      luid: req.query.luid as string,
      maintenanceRequestUid: req.query.maintenanceRequestUid as string,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 10,
      sortDirection: req.query.sortDirection as 'asc' | 'desc' | undefined,
    };

    const result = await this.paymentService.listPayments(cuid, filters, req.context);

    return res.status(200).json(result);
  }

  async getPayment(req: AppRequest, res: Response) {
    const { cuid, pytuid } = req.params;
    const result = await this.paymentService.getPaymentByUid(cuid, pytuid);
    return res.status(200).json(result);
  }

  /**
   * Tenant self-service: idempotently creates a maintenance charge for the
   * calling tenant when a billable invoice has been approved but no charge record
   * exists (e.g. the event was dropped on approval).
   */
  async ensureSelfMaintenanceCharge(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const tenantId = req.context?.currentuser?.sub;
    if (!tenantId) {
      return res.status(401).json({ success: false, message: 'Unauthenticated' });
    }
    const { mruid, amountInCents } = req.body as { mruid: string; amountInCents: number };
    const result = await this.paymentService.chargeForMaintenance(cuid, tenantId, {
      mruid,
      tenantId,
      amount: amountInCents,
    });
    return res.status(200).json(result);
  }

  async createPayment(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const role = req.context?.currentuser?.client?.role;
    const paymentSource = role === 'staff' ? 'staff_initiated' : 'pm_initiated';

    const result = await this.paymentService.createRentPayment(cuid, req.body, { paymentSource });

    return res.status(201).json(result);
  }

  async recordManualPayment(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const userId = req.context?.currentuser?.sub;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const role = req.context?.currentuser?.client?.role;
    const paymentSource = role === 'staff' ? 'staff_initiated' : 'pm_initiated';
    const result = await this.paymentService.recordManualPayment(
      cuid,
      userId,
      userId,
      req.body,
      paymentSource
    );

    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: (result.data as any).pytuid,
      uploadedBy: userId,
      resourceContext: ResourceContext.PAYMENT,
    });

    // Fire-and-forget: queue receipt PDF generation in the background
    const pytuid = (result.data as any).pytuid;
    if (pytuid) {
      this.invoiceService.requestInvoice(pytuid, cuid).catch((err) => {
        this.log.warn({ err, pytuid, cuid }, 'Background receipt generation failed to queue');
      });
    }

    const response = uploadResult.hasFiles
      ? {
          ...result,
          fileUpload: uploadResult.message,
          processedFiles: uploadResult.processedFiles,
        }
      : result;

    return res.status(201).json(response);
  }

  async createConnectAccount(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const { email, country } = req.body;

    const result = await this.paymentService.createConnectAccount(cuid, {
      email,
      country,
    });

    return res.status(201).json(result);
  }

  async getOnboardingLink(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const { returnUrl, refreshUrl } = req.query as { returnUrl?: string; refreshUrl?: string };

    const result = await this.paymentService.getKycOnboardingLink(cuid, { returnUrl, refreshUrl });

    return res.status(200).json(result);
  }

  async getAccountUpdateLink(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const { returnUrl, refreshUrl } = req.query as { returnUrl?: string; refreshUrl?: string };

    const result = await this.paymentService.getAccountUpdateLink(cuid, { returnUrl, refreshUrl });

    return res.status(200).json(result);
  }

  async getLoginLink(req: AppRequest, res: Response) {
    const { cuid } = req.params;

    if (req.context?.currentuser?.client.role !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenError({
        message: 'Only the account owner can access the payout dashboard.',
      });
    }

    const result = await this.paymentService.getExternalDashboardLoginLink(cuid);
    return res.status(200).json(result);
  }

  async getPayoutBalance(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const result = await this.paymentService.getPayoutBalance(cuid);
    return res.status(200).json(result);
  }

  async getPayoutHistory(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const { limit, cursor } = req.query as { limit?: string; cursor?: string };
    const result = await this.paymentService.getPayoutHistory(cuid, {
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
    return res.status(200).json(result);
  }

  async getPayoutSchedule(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const result = await this.paymentService.getPayoutSchedule(cuid);
    return res.status(200).json(result);
  }

  async updatePayoutSchedule(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const { interval, weeklyAnchor } = req.body as {
      interval: 'daily' | 'weekly' | 'monthly';
      weeklyAnchor?: string;
    };
    const result = await this.paymentService.updatePayoutSchedule(cuid, interval, weeklyAnchor);
    return res.status(200).json(result);
  }

  async getPaymentStats(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const { tenantId } = req.query as { tenantId?: string };
    const result = await this.paymentService.getPaymentStats(cuid, req.context, tenantId);
    return res.status(200).json(result);
  }

  async chargeForMaintenance(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    // sub = User._id as hex string (valid ObjectId) — used for recordedBy
    const currentUserId = req.context?.currentuser?.sub;

    if (!currentUserId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const result = await this.paymentService.chargeForMaintenance(cuid, currentUserId, req.body);

    return res.status(201).json(result);
  }

  async payVendor(req: AppRequest, res: Response) {
    const { cuid, mruid } = req.params;
    const result = await this.paymentService.payVendor(cuid, mruid);
    return res.status(200).json(result);
  }

  async cancelPayment(req: AppRequest, res: Response) {
    const { cuid, pytuid } = req.params;
    const { reason } = req.body;

    const result = await this.paymentService.cancelPayment(cuid, pytuid, reason);

    return res.status(200).json(result);
  }

  async requestInvoice(req: AppRequest, res: Response) {
    const { cuid, pytuid } = req.params;
    const result = await this.invoiceService.requestInvoice(pytuid, cuid);
    return res.status(200).json({ success: true, data: result });
  }

  async refundPayment(req: AppRequest, res: Response) {
    const { cuid, pytuid } = req.params;
    const { amount, reason } = req.body;
    const userSub = req.context?.currentuser?.sub ?? '';

    const result = await this.paymentService.refundPayment(cuid, pytuid, userSub, {
      amount,
      reason,
    });

    return res.status(201).json(result);
  }

  async createCardPaymentSession(req: AppRequest, res: Response) {
    const { cuid, pytuid } = req.params;
    const tenantUserId = req.context?.currentuser?.sub;
    const { successUrl, cancelUrl } = req.body as { successUrl?: string; cancelUrl?: string };

    if (!tenantUserId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const result = await this.paymentService.createCardPaymentSession(cuid, pytuid, tenantUserId, {
      successUrl,
      cancelUrl,
    });
    return res.status(200).json(result);
  }

  async payPendingCharge(req: AppRequest, res: Response) {
    const { cuid, pytuid } = req.params;
    const tenantUserId = req.context?.currentuser?.sub;

    if (!tenantUserId) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const result = await this.paymentService.payPendingCharge(cuid, pytuid, tenantUserId);

    if (result.routeToCard) {
      return res.status(200).json({
        success: false,
        routeToCard: true,
        message: result.message,
      });
    }

    return res.status(200).json(result);
  }

  async getMyPayments(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const { status, from, to, page, limit } = req.query as any;
    const result = await this.paymentService.getTenantPaymentHistory(
      cuid,
      req.context.currentuser!.sub,
      { status, from, to, page: Number(page) || 1, limit: Number(limit) || 20 }
    );
    return res.status(200).json(result);
  }

  async getMyPaymentById(req: AppRequest, res: Response) {
    const { cuid, pytuid } = req.params;
    const result = await this.paymentService.getTenantPaymentById(
      pytuid,
      cuid,
      req.context.currentuser!.sub
    );
    return res.status(200).json(result);
  }

  async triggerCronJob(req: AppRequest, res: Response) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ message: 'Not found' });
    }

    const { cuid, jobName } = req.params;

    // Maps short dev-friendly alias → full registered job name in CronService
    const aliasMap: Record<string, string> = {
      'weekly-invoices': 'payment.weekly-rent-invoices',
      'daily-safety-net': 'payment.daily-rent-safety-net',
      'mark-overdue': 'payment.mark-overdue',
      'auto-charge-rent': 'payment.auto-charge-due-rent',
      'auto-charge-maintenance': 'payment.auto-charge-overdue-maintenance',
    };

    const fullJobName = aliasMap[jobName];
    if (!fullJobName) {
      return res.status(400).json({
        message: `Unknown job. Allowed: ${Object.keys(aliasMap).join(', ')}`,
      });
    }

    const handler = this.cronService.getJobHandler(fullJobName);
    if (!handler) {
      return res.status(500).json({ message: `Handler not registered for: ${fullJobName}` });
    }

    this.log.info({ cuid, jobName, fullJobName }, 'Dev: manually triggering cron job');
    await handler();
    return res.status(200).json({ success: true, jobName, fullJobName });
  }

  async downloadMyReceipt(req: AppRequest, res: Response) {
    const { cuid, pytuid } = req.params;
    const { buffer, filename } = await this.paymentService.generateTenantReceipt(
      pytuid,
      cuid,
      req.context.currentuser!.sub
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.status(200).end(buffer);
  }

  async getVendorEarnings(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const currentUser = req.context.currentuser!;
    const role = currentUser.client.role;

    // Vendors can only view their own earnings — ignore any vendorUid query param.
    // PMs, admins, and super-admins may specify a vendorUid to view any vendor's earnings.
    const vendorUid =
      role === ROLES.VENDOR ? currentUser.uid : (req.query.vendorUid as string) || currentUser.uid;

    const result = await this.paymentService.getVendorEarnings(cuid, vendorUid, {
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    return res.status(200).json(result);
  }
}
