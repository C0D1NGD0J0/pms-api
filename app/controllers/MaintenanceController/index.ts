import { Response } from 'express';
import { httpStatusCodes } from '@utils/index';
import { MaintenanceRequestService } from '@services/index';
import { InvoiceSource } from '@interfaces/maintenanceRequest.interface';
import { ResourceContext, AppRequest } from '@interfaces/utils.interface';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';

interface IConstructor {
  maintenanceRequestService: MaintenanceRequestService;
  mediaUploadService: MediaUploadService;
}

export class MaintenanceController {
  private readonly maintenanceRequestService: MaintenanceRequestService;
  private readonly mediaUploadService: MediaUploadService;

  constructor({ maintenanceRequestService, mediaUploadService }: IConstructor) {
    this.maintenanceRequestService = maintenanceRequestService;
    this.mediaUploadService = mediaUploadService;
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
    const { action, reason, technician } = req.body;

    const result =
      action === 'accept'
        ? await this.maintenanceRequestService.acceptAssignment(req.context, req.params.mruid, {
            action,
            technician,
          })
        : await this.maintenanceRequestService.declineAssignment(req.context, req.params.mruid, {
            reason,
          });

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

  async completeRequest(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.completeRequest(
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

  async submitInvoice(req: AppRequest, res: Response) {
    const result = await this.maintenanceRequestService.submitInvoice(
      req.context,
      req.params.mruid,
      req.body
    );
    return res.status(httpStatusCodes.OK).json(result);
  }

  async reviewInvoice(req: AppRequest, res: Response) {
    const { action, rejectionReason } = req.body;

    const result =
      action === 'approve'
        ? await this.maintenanceRequestService.approveInvoice(req.context, req.params.mruid)
        : await this.maintenanceRequestService.rejectInvoice(req.context, req.params.mruid, {
            rejectionReason,
          });

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
}
