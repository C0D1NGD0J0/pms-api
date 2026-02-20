import { Response } from 'express';
import { createLogger } from '@utils/index';
import { PaymentService } from '@services/index';
import { MediaUploadService } from '@services/mediaUpload';
import { ExtractedMediaFile, ResourceContext, AppRequest } from '@interfaces/utils.interface';

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
    const filters = {
      status: req.query.status as string,
      type: req.query.type as string,
      tenantId: req.query.tenantId as string,
      leaseId: req.query.leaseId as string,
      skip: req.query.skip ? Number(req.query.skip) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
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
    const userId = req.user?.uid;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated',
      });
    }

    // Handle receipt file upload if present
    let receiptData;
    if (req.body.scannedFiles && req.body.scannedFiles.length > 0) {
      const receiptFile: ExtractedMediaFile = req.body.scannedFiles[0];

      // Extract receipt metadata for immediate use
      receiptData = {
        url: receiptFile.path, // Temporary local path, will be replaced by S3 URL
        filename: receiptFile.originalname,
        key: receiptFile.filename, // Disk storage filename
      };

      // Queue for S3 upload (happens asynchronously)
      await this.mediaUploadService.handleFiles(req, {
        primaryResourceId: cuid,
        uploadedBy: userId,
        resourceContext: ResourceContext.PAYMENT,
      });
    }

    // Add receipt data to request body if file was uploaded
    if (receiptData) {
      req.body.receipt = receiptData;
    }

    const result = await this.paymentService.recordManualPayment(cuid, userId, req.body);

    return res.status(201).json(result);
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

    const result = await this.paymentService.getKycOnboardingLink(cuid);

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
}
