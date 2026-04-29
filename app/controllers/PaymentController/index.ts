import { Response } from 'express';
import { createLogger } from '@utils/index';
import { ForbiddenError } from '@shared/customErrors';
import ROLES from '@shared/constants/roles.constants';
import { MediaUploadService } from '@services/mediaUpload';
import { PaymentService, InvoiceService } from '@services/index';
import { ResourceContext, AppRequest } from '@interfaces/utils.interface';

interface IConstructor {
  mediaUploadService: MediaUploadService;
  invoiceService: InvoiceService;
  paymentService: PaymentService;
}

export class PaymentController {
  private readonly log = createLogger('PaymentController');
  private readonly paymentService: PaymentService;
  private readonly invoiceService: InvoiceService;
  private readonly mediaUploadService: MediaUploadService;

  constructor({ paymentService, invoiceService, mediaUploadService }: IConstructor) {
    this.paymentService = paymentService;
    this.invoiceService = invoiceService;
    this.mediaUploadService = mediaUploadService;
  }

  async listPayments(req: AppRequest, res: Response) {
    const { cuid } = req.params;

    const filters = {
      status: req.query.status as string,
      type: req.query.type as string,
      tenantId: req.query.tenantId as string,
      leaseId: req.query.leaseId as string,
      luid: req.query.luid as string,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 10,
    };

    const result = await this.paymentService.listPayments(cuid, filters, req.context);

    return res.status(200).json(result);
  }

  async getPayment(req: AppRequest, res: Response) {
    const { cuid, pytuid } = req.params;
    const result = await this.paymentService.getPaymentByUid(cuid, pytuid);
    return res.status(200).json(result);
  }

  async createPayment(req: AppRequest, res: Response) {
    const { cuid } = req.params;

    const result = await this.paymentService.createRentPayment(cuid, req.body);

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

    const result = await this.paymentService.recordManualPayment(cuid, userId, userId, req.body);

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
    const service = this.paymentService as any;

    const allowed: Record<string, () => Promise<void>> = {
      'weekly-invoices': () => service.queueWeeklyRentInvoices(),
      'daily-safety-net': () => service.queueDailySafetyNetInvoices(),
      'mark-overdue': () => service.markOverduePayments(),
    };

    const handler = allowed[jobName];
    if (!handler) {
      return res.status(400).json({
        message: `Unknown job. Allowed: ${Object.keys(allowed).join(', ')}`,
      });
    }

    this.log.info({ cuid, jobName }, 'Dev: manually triggering cron job');
    await handler();
    return res.status(200).json({ success: true, jobName });
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
}
