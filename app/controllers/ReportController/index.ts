import { Response } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { ReportStatus } from '@interfaces/report.interface';
import { ReportService } from '@services/report/report.service';
import { ROLE_GROUPS } from '@shared/constants/roles.constants';

interface IConstructor {
  reportService: ReportService;
}

export class ReportController {
  private readonly reportService: ReportService;

  constructor({ reportService }: IConstructor) {
    this.reportService = reportService;
  }

  generate = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const result = await this.reportService.requestReport(cuid, userId, req.body);
    return res.status(202).json(result);
  };

  getStatus = async (req: AppRequest, res: Response) => {
    const { cuid, reportId } = req.params;
    const result = await this.reportService.getReportStatus(cuid, reportId);
    return res.status(200).json(result);
  };

  list = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const query = {
      page: req.query.page ? parseInt(req.query.page as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      status: req.query.status as ReportStatus | undefined,
    };
    const result = await this.reportService.listReports(cuid, query);

    // Only management roles see quota/limit metadata
    const userRole = req.context.currentuser?.client?.role;
    if (!userRole || !ROLE_GROUPS.MANAGEMENT_ROLES.includes(userRole as any)) {
      delete (result.data as any).meta;
    }

    return res.status(200).json(result);
  };

  upsertSchedule = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const userId = req.context.currentuser!.sub;
    const result = await this.reportService.upsertSchedule(cuid, userId, req.body);
    return res.status(200).json(result);
  };

  getSchedule = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const result = await this.reportService.getSchedule(cuid);
    return res.status(200).json(result);
  };

  deactivateSchedule = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const result = await this.reportService.deactivateSchedule(cuid);
    return res.status(200).json(result);
  };

  deleteReport = async (req: AppRequest, res: Response) => {
    const { cuid, reportId } = req.params;
    const { currentuser } = req.context;

    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'User not authenticated',
      });
    }
    const result = await this.reportService.deleteReport(cuid, reportId);
    return res.status(200).json(result);
  };
}
