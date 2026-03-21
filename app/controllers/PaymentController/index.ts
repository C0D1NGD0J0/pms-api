import { Response } from 'express';
import { createLogger } from '@utils/index';
import { PaymentService } from '@services/index';
import { MediaUploadService } from '@services/mediaUpload';
import { ResourceContext, AppRequest } from '@interfaces/utils.interface';

interface IConstructor {
  mediaUploadService: MediaUploadService;
  paymentService: PaymentService;
}

export class PaymentController {
  private readonly log = createLogger('PaymentController');
  private readonly paymentService: PaymentService;
  private readonly mediaUploadService: MediaUploadService;

  constructor({ paymentService, mediaUploadService }: IConstructor) {
    this.paymentService = paymentService;
    this.mediaUploadService = mediaUploadService;
  }

  async listPayments(req: AppRequest, res: Response) {
    const { cuid } = req.params;

    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const skip = (page - 1) * limit;

    const filters = {
      status: req.query.status as string,
      type: req.query.type as string,
      tenantId: req.query.tenantId as string,
      leaseId: req.query.leaseId as string,
      skip,
      limit,
    };

    const result = await this.paymentService.listPayments(cuid, filters);

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
    const userId = req.context?.currentuser?.uid;
    const userSub = req.context?.currentuser?.sub;

    if (!userId || !userSub) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    const result = await this.paymentService.recordManualPayment(cuid, userId, userSub, req.body);

    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: (result.data as any).pytuid,
      uploadedBy: userId,
      resourceContext: ResourceContext.PAYMENT,
    });

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

    const result = await this.paymentService.getExternalDashboardLoginLink(cuid);
    return res.status(200).json(result);
  }

  async getPaymentStats(req: AppRequest, res: Response) {
    const { cuid } = req.params;

    const result = await this.paymentService.getPaymentStats(cuid);

    return res.status(200).json(result);
  }

  async cancelPayment(req: AppRequest, res: Response) {
    const { cuid, pytuid } = req.params;
    const { reason } = req.body;

    const result = await this.paymentService.cancelPayment(cuid, pytuid, reason);

    return res.status(200).json(result);
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
}
