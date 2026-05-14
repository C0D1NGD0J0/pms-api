import fs from 'fs';
import { Response } from 'express';
import { httpStatusCodes } from '@utils/index';
import { InvoiceSource } from '@interfaces/maintenanceRequest.interface';
import { ResourceContext, AppRequest } from '@interfaces/utils.interface';
import { MaintenanceRequestService, InvoiceAIService } from '@services/index';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';

interface IConstructor {
  maintenanceRequestService: MaintenanceRequestService;
  mediaUploadService: MediaUploadService;
  invoiceAIService: InvoiceAIService;
}

export class MaintenanceController {
  private readonly maintenanceRequestService: MaintenanceRequestService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly invoiceAIService: InvoiceAIService;

  constructor({ maintenanceRequestService, mediaUploadService, invoiceAIService }: IConstructor) {
    this.maintenanceRequestService = maintenanceRequestService;
    this.mediaUploadService = mediaUploadService;
    this.invoiceAIService = invoiceAIService;
  }

  async createRequest(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.createRequest(req.context, req.body);

    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: result.data.mruid,
      uploadedBy: req.context.currentuser!.sub,
      resourceContext: ResourceContext.MAINTENANCE,
    });

    const response = uploadResult.hasFiles
      ? { ...result, fileUpload: uploadResult.message, processedFiles: uploadResult.processedFiles }
      : result;

    return res.status(httpStatusCodes.CREATED).json(response);
  }

  async listRequests(req: AppRequest, res: Response) {
    const { page, limit, sort, ...filters } = req.query as any;
    const result = await this.maintenanceRequestService.listRequests(req.context, filters, {
      page,
      limit,
      sort,
    });
    return res.status(httpStatusCodes.OK).json(result);
  }

  async getRequest(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.getRequest(req.context, req.params.mruid);
    return res.status(httpStatusCodes.OK).json(result);
  }

  async getStats(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.getStats(
      req.context,
      req.query.pid as string | undefined
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async assignVendor(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.assignVendor(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.CREATED).json(result);
  }

  async respondToAssignment(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.respondToAssignment(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async updateStatus(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.updateStatus(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async markWorkDone(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.markWorkDone(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async finalizeCompletion(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.finalizeCompletion(
      req.context,
      req.params.mruid
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async submitTenantFeedback(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.submitTenantFeedback(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async cancelRequest(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.cancelRequest(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async updateRequest(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.updateRequest(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async submitInvoice(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.submitInvoice(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async scanInvoice(req: AppRequest, res: Response) {
    const files = (req.files as Express.Multer.File[]) || [];
    const file = files[0];

    if (!file) {
      return res.status(400).json({ success: false, message: 'No invoice file uploaded' });
    }

    // Read file into buffer then clean up temp file
    const buffer = fs.readFileSync(file.path);
    fs.unlink(file.path, () => {});

    const extracted = await this.invoiceAIService.extractInvoiceData(buffer, file.mimetype);

    if (!extracted) {
      return res.status(422).json({
        success: false,
        message: 'AI invoice scanning is disabled or failed to extract data',
      });
    }

    // Upload the scanned file to S3 for attachment
    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: req.params.mruid,
      uploadedBy: req.context.currentuser!.sub,
      resourceContext: ResourceContext.MAINTENANCE,
    });

    return res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        extracted,
        attachment: uploadResult.hasFiles
          ? {
              url: uploadResult.processedFiles?.[0]?.url,
              key: uploadResult.processedFiles?.[0]?.key,
            }
          : undefined,
      },
    });
  }

  async reviewInvoice(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.reviewInvoice(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async submitWorkOrder(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.submitWorkOrder(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.CREATED).json(result);
  }

  async reviewWorkOrder(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.reviewWorkOrder(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async handleWebhook(req: AppRequest, res: Response) {
    const source = req.params.source as InvoiceSource;
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const result = await this.maintenanceRequestService.handleInvoiceWebhook(
      source,
      rawBody,
      req.headers as Record<string, string>,
      { ...req.body, rawPayload: req.body }
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async getMyRequests(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const { page, limit, status } = req.query as any;
    const result = await this.maintenanceRequestService.getTenantRequests(
      cuid,
      req.context.currentuser!.sub,
      { page: Number(page) || 1, limit: Number(limit) || 10, status }
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async getMyRequestById(req: AppRequest, res: Response) {
    const { cuid, mruid } = req.params;
    const result = await this.maintenanceRequestService.getTenantRequestById(
      mruid,
      cuid,
      req.context.currentuser!.sub
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async acceptAISuggestion(req: AppRequest, res: Response) {
    const { mruid } = req.params;
    const result = await this.maintenanceRequestService.acceptAISuggestion(req.context, mruid);
    return res.status(httpStatusCodes.OK).json(result);
  }

  async dismissAISuggestion(req: AppRequest, res: Response) {
    const { mruid } = req.params;
    const result = await this.maintenanceRequestService.dismissAISuggestion(req.context, mruid);
    return res.status(httpStatusCodes.OK).json(result);
  }
}
