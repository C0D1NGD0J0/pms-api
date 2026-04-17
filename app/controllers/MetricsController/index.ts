import { Response } from 'express';
import { httpStatusCodes } from '@utils/index';
import { AppRequest } from '@interfaces/utils.interface';
import { MetricType } from '@interfaces/metrics.interface';
import { MetricsService } from '@services/metrics/metrics.service';

interface IConstructor {
  metricsService: MetricsService;
}

export class MetricsController {
  private readonly metricsService: MetricsService;

  constructor({ metricsService }: IConstructor) {
    this.metricsService = metricsService;
  }

  async getDashboard(req: AppRequest, res: Response) {
    const { cuid } = req.params;
    const data = await this.metricsService.getDashboardStats(cuid);
    return res.status(httpStatusCodes.OK).json({ success: true, data });
  }

  async getHistory(req: AppRequest, res: Response) {
    const { cuid, metricType } = req.params;
    const { from, to } = req.query as { from: string; to: string };
    const data = await this.metricsService.getHistory(
      cuid,
      metricType as MetricType,
      new Date(from),
      new Date(to)
    );
    return res.status(httpStatusCodes.OK).json({ success: true, data });
  }

  async getTrend(req: AppRequest, res: Response) {
    const { cuid, metricType } = req.params;
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
    const data = await this.metricsService.getTrend(cuid, metricType as MetricType, days);
    return res.status(httpStatusCodes.OK).json({ success: true, data });
  }
}
