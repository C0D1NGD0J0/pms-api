import fs from 'fs';
import { Response } from 'express';
import { httpStatusCodes } from '@utils/index';
import { BadRequestError } from '@shared/customErrors';
import { InvoiceSource } from '@interfaces/maintenanceRequest.interface';
import { ResourceContext, AppRequest } from '@interfaces/utils.interface';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import {
  MaintenanceRequestService,
  MaintenanceInvoiceService,
  VendorSuggestionService,
  InvoiceAIService,
} from '@services/index';

import { serializeMaintenanceRequestListItem, serializeMaintenanceRequest } from './serializers';

interface IConstructor {
  maintenanceRequestService: MaintenanceRequestService;
  maintenanceInvoiceService: MaintenanceInvoiceService;
  vendorSuggestionService: VendorSuggestionService;
  mediaUploadService: MediaUploadService;
  invoiceAIService: InvoiceAIService;
}

export class MaintenanceController {
  private readonly maintenanceRequestService: MaintenanceRequestService;
  private readonly maintenanceInvoiceService: MaintenanceInvoiceService;
  private readonly vendorSuggestionService: VendorSuggestionService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly invoiceAIService: InvoiceAIService;

  constructor({
    maintenanceRequestService,
    maintenanceInvoiceService,
    vendorSuggestionService,
    mediaUploadService,
    invoiceAIService,
  }: IConstructor) {
    this.maintenanceRequestService = maintenanceRequestService;
    this.maintenanceInvoiceService = maintenanceInvoiceService;
    this.vendorSuggestionService = vendorSuggestionService;
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
    const role = req.context.currentuser!.client.role;
    const items = (result.data?.items ?? []).map((item: any) =>
      serializeMaintenanceRequestListItem(item, role)
    );
    return res.status(httpStatusCodes.OK).json({ ...result, data: { ...result.data, items } });
  }

  async getRequest(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.getRequest(req.context, req.params.mruid);
    const role = req.context.currentuser!.client.role;
    const serialized = serializeMaintenanceRequest(result.data, role);
    return res.status(httpStatusCodes.OK).json({ ...result, data: serialized });
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

    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: req.params.mruid,
      uploadedBy: req.context.currentuser!.sub,
      resourceContext: ResourceContext.MAINTENANCE,
    });

    const response = uploadResult.hasFiles
      ? { ...result, fileUpload: uploadResult.message, processedFiles: uploadResult.processedFiles }
      : result;

    return res.status(httpStatusCodes.OK).json(response);
  }

  async submitInvoice(req: AppRequest, res: Response) {
    const result = await this.maintenanceInvoiceService.submitInvoice(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async scanInvoice(req: AppRequest, res: Response) {
    const file = req.scannedFiles?.[0];

    if (!file) {
      throw new BadRequestError({ message: 'No invoice file uploaded' });
    }

    const buffer = await fs.promises.readFile(file.path);
    fs.promises.unlink(file.path).catch(() => {}); // fire-and-forget — buffer already in memory

    const scanResult = await this.invoiceAIService.extractInvoiceData(
      buffer,
      file.mimeType,
      req.params.cuid
    );

    if (!scanResult.success || !scanResult.data) {
      throw new BadRequestError({
        message: scanResult.message ?? 'Failed to extract invoice data.',
      });
    }

    return res.status(httpStatusCodes.OK).json({
      success: true,
      data: { extracted: scanResult.data },
    });
  }

  async reviewInvoice(req: AppRequest, res: Response) {
    const result = await this.maintenanceInvoiceService.reviewInvoice(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async submitWorkOrder(req: AppRequest, res: Response) {
    const result = await this.maintenanceInvoiceService.submitWorkOrder(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.CREATED).json(result);
  }

  async reviewWorkOrder(req: AppRequest, res: Response) {
    const result = await this.maintenanceInvoiceService.reviewWorkOrder(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async handleWebhook(req: AppRequest, res: Response) {
    const source = req.params.source as InvoiceSource;
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const result = await this.maintenanceInvoiceService.handleInvoiceWebhook(
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
    const result = await this.vendorSuggestionService.acceptAISuggestion(req.context, mruid);
    return res.status(httpStatusCodes.OK).json(result);
  }

  async dismissAISuggestion(req: AppRequest, res: Response) {
    const { mruid } = req.params;
    const result = await this.vendorSuggestionService.dismissAISuggestion(req.context, mruid);
    return res.status(httpStatusCodes.OK).json(result);
  }
}
