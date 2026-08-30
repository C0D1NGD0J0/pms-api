import { Response } from 'express';
import { AppRequest } from '@interfaces/utils.interface';
import { ReportService } from '@services/report/report.service';

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
    const result = await this.reportService.listReports(cuid, req.query as any);
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
}
