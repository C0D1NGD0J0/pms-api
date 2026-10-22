import { Response } from 'express';
import { AppRequest } from '@interfaces/utils.interface';
import { IInspection } from '@interfaces/inspection.interface';
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
    // The service uploads the room media and saves it in the same write as the update
    const result = await this.inspectionService.updateInspection(
      cuid,
      userId,
      userRole,
      iuid,
      req.body,
      req.scannedFiles
    );
    return res.status(200).json(result);
  }

  async submitInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const userRole = req.context.currentuser!.client.role;
    const result = await this.inspectionService.submitInspection(
      cuid,
      userId,
      userRole,
      iuid,
      req.scannedFiles
    );
    return res.status(200).json(result);
  }

  async reviewInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const userId = req.context.currentuser!.uid;
    const userRole = req.context.currentuser!.client.role;
    const result = await this.inspectionService.reviewInspection(
      cuid,
      iuid,
      userId,
      userRole,
      req.body
    );
    return res.status(200).json(result);
  }

  async approveInspection(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const userId = req.context.currentuser!.uid;
    const userRole = req.context.currentuser!.client.role;
    const result = await this.inspectionService.approveInspection(
      cuid,
      iuid,
      userId,
      userRole,
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
    const userId = req.context.currentuser!.uid;
    const userRole = req.context.currentuser!.client.role;
    const result = await this.inspectionService.rejectInspection(
      cuid,
      iuid,
      userId,
      userRole,
      req.body.reason
    );
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

  async addNote(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const userRole = req.context.currentuser!.client.role;
    const result = await this.inspectionService.addNote(cuid, userId, userRole, iuid, req.body);
    return res.status(201).json(result);
  }

  async getAIAnalysis(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const userRole = req.context.currentuser!.client.role;
    const inspection = await this.inspectionService.getInspection(cuid, userId, userRole, iuid);
    const data = inspection.data as IInspection | undefined;
    return res.status(200).json({
      success: true,
      data: data?.aiAnalysis || null,
    });
  }

  async triggerAIAnalysis(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const planName = req.context.currentuser!.subscription?.plan?.name || 'essential';
    const result = await this.inspectionAIService.analyzeInspection(cuid, iuid, planName);

    if (!result.ok) {
      const failureMap: Record<string, { status: number; message: string }> = {
        feature_disabled: { status: 403, message: 'AI analysis is not available' },
        plan_not_eligible: {
          status: 403,
          message: 'AI analysis is not included in your current plan',
        },
        budget_exceeded: {
          status: 429,
          message: 'AI analysis limit reached for this period. Please try again later.',
        },
        inspection_not_found: { status: 404, message: 'Inspection not found' },
        analysis_error: { status: 500, message: 'AI analysis failed. Please try again.' },
      };
      const failure = failureMap[result.reason] ?? failureMap.analysis_error;
      return res
        .status(failure.status)
        .json({ success: false, message: failure.message, code: result.reason });
    }

    return res.status(200).json({ success: true, data: result.analysis });
  }

  async generateReport(req: AppRequest, res: Response) {
    const { cuid, iuid } = req.params;
    const { includePhotos, forceRegenerate } = req.query as unknown as {
      includePhotos: boolean;
      forceRegenerate: boolean;
    };
    const userRole = req.context.currentuser!.client.role;
    const userId = req.context.currentuser!.sub;
    const userDepartment = req.context.currentuser!.employeeInfo?.department;
    const result = await this.inspectionReportService.generateReport(
      cuid,
      iuid,
      includePhotos,
      forceRegenerate,
      userRole,
      userId,
      userDepartment
    );
    return res.status(200).json(result);
  }
}
