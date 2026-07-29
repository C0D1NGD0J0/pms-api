import { Response } from 'express';
import { ResourceContext, AppRequest } from '@interfaces/utils.interface';
import { InspectionService } from '@services/inspection/inspection.service';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import { InspectionAIService } from '@services/inspection/inspectionAI.service';
import { InspectionReportService } from '@services/inspection/inspectionReport.service';

interface IConstructor {
  inspectionReportService: InspectionReportService;
  inspectionAIService: InspectionAIService;
  mediaUploadService: MediaUploadService;
  inspectionService: InspectionService;
}

export class InspectionController {
  private readonly inspectionService: InspectionService;
  private readonly inspectionAIService: InspectionAIService;
  private readonly inspectionReportService: InspectionReportService;
  private readonly mediaUploadService: MediaUploadService;

  constructor({
    inspectionService,
    inspectionAIService,
    inspectionReportService,
    mediaUploadService,
  }: IConstructor) {
    this.inspectionService = inspectionService;
    this.inspectionAIService = inspectionAIService;
    this.inspectionReportService = inspectionReportService;
    this.mediaUploadService = mediaUploadService;
  }

  async scheduleInspection(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const result = await this.inspectionService.scheduleInspection(cuid, userId, req.body);
    return res.status(201).json(result);
  }

  async listInspections(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const userRole = req.context.currentuser!.client.role;
    const result = await this.inspectionService.listInspections(
      cuid,
      userId,
      userRole,
      req.query as any
    );
    return res.status(200).json(result);
  }

  async getInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const userRole = req.context.currentuser!.client.role;
    const result = await this.inspectionService.getInspection(cuid, userId, userRole, iuid);
    return res.status(200).json(result);
  }

  async updateInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const userRole = req.context.currentuser!.client.role;
    const result = await this.inspectionService.updateInspection(
      cuid,
      userId,
      userRole,
      iuid,
      req.body
    );

    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: iuid,
      uploadedBy: userId,
      resourceContext: ResourceContext.INSPECTION,
    });

    const response = uploadResult.hasFiles
      ? { ...result, fileUpload: uploadResult.message, processedFiles: uploadResult.processedFiles }
      : result;

    return res.status(200).json(response);
  }

  async submitInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const userRole = req.context.currentuser!.client.role;
    const result = await this.inspectionService.submitInspection(cuid, userId, userRole, iuid);

    const uploadResult = await this.mediaUploadService.handleFiles(req, {
      primaryResourceId: iuid,
      uploadedBy: userId,
      resourceContext: ResourceContext.INSPECTION,
    });

    const response = uploadResult.hasFiles
      ? { ...result, fileUpload: uploadResult.message, processedFiles: uploadResult.processedFiles }
      : result;

    return res.status(200).json(response);
  }

  async approveInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const result = await this.inspectionService.approveInspection(
      cuid,
      iuid,
      req.body?.refundAmount
    );
    return res.status(200).json(result);
  }

  async acknowledgeInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const result = await this.inspectionService.acknowledgeInspection(cuid, userId, iuid);
    return res.status(200).json(result);
  }

  async rejectInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const result = await this.inspectionService.rejectInspection(cuid, iuid, req.body.reason);
    return res.status(200).json(result);
  }

  async disputeInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const result = await this.inspectionService.disputeInspection(cuid, userId, iuid, req.body);
    return res.status(200).json(result);
  }

  async cancelInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const result = await this.inspectionService.cancelInspection(cuid, iuid);
    return res.status(200).json(result);
  }

  async deleteInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const result = await this.inspectionService.softDeleteInspection(cuid, iuid);
    return res.status(200).json(result);
  }

  async getAIAnalysis(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const userRole = req.context.currentuser!.client.role;
    const inspection = await this.inspectionService.getInspection(cuid, userId, userRole, iuid);
    const data = inspection.data as Record<string, any> | undefined;
    return res.status(200).json({
      success: true,
      data: data?.aiAnalysis || null,
    });
  }

  async triggerAIAnalysis(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const planName = req.context.currentuser!.subscription?.plan?.name || 'essential';
    const result = await this.inspectionAIService.analyzeInspection(cuid, iuid, planName);
    return res.status(200).json({ success: true, data: result });
  }

  async generateReport(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const includePhotos = req.query.includePhotos !== 'false';
    const forceRegenerate = req.query.forceRegenerate === 'true';
    const userRole = req.context.currentuser!.client.role;
    const userDepartment = req.context.currentuser!.employeeInfo?.department;
    const result = await this.inspectionReportService.generateReport(
      cuid,
      iuid,
      includePhotos,
      forceRegenerate,
      userRole,
      userDepartment
    );
    return res.status(200).json(result);
  }
}
