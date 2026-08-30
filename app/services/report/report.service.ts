import ejs from 'ejs';
import path from 'path';
import { Job } from 'bull';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { createLogger } from '@utils/index';
import { QueueFactory } from '@services/queue';
import { EmailQueue } from '@queues/email.queue';
import { ReportQueue } from '@queues/report.queue';
import { IPromiseReturnedData } from '@interfaces/utils.interface';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { PdfGeneratorService, ExpenseService, SSEService, S3Service } from '@services/index';
import {
  MaintenanceRequestDAO,
  ReportScheduleDAO,
  PropertyUnitDAO,
  InspectionDAO,
  ExpenseDAO,
  PaymentDAO,
  ReportDAO,
  VendorDAO,
  ClientDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';
import {
  IReportScheduleDocument,
  IReportStatusResponse,
  ScheduleFrequency,
  REPORT_SECTIONS,
  IReportDocument,
  IReportJobData,
  ReportSection,
  ReportPeriod,
  ReportStatus,
} from '@interfaces/report.interface';

interface IConstructor {
  maintenanceRequestDAO: MaintenanceRequestDAO;
  pdfGeneratorService: PdfGeneratorService;
  reportScheduleDAO: ReportScheduleDAO;
  propertyUnitDAO: PropertyUnitDAO;
  expenseService: ExpenseService;
  inspectionDAO: InspectionDAO;
  queueFactory: QueueFactory;
  emailQueue: EmailQueue;
  paymentDAO: PaymentDAO;
  expenseDAO: ExpenseDAO;
  sseService: SSEService;
  reportDAO: ReportDAO;
  vendorDAO: VendorDAO;
  clientDAO: ClientDAO;
  s3Service: S3Service;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class ReportService implements ICronProvider {
  private readonly reportDAO: ReportDAO;
  private readonly reportScheduleDAO: ReportScheduleDAO;
  private readonly queueFactory: QueueFactory;
  private readonly emailQueue: EmailQueue;
  private readonly expenseService: ExpenseService;
  private readonly leaseDAO: LeaseDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;
  private readonly expenseDAO: ExpenseDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly userDAO: UserDAO;
  private readonly vendorDAO: VendorDAO;
  private readonly clientDAO: ClientDAO;
  private readonly inspectionDAO: InspectionDAO;
  private readonly pdfGeneratorService: PdfGeneratorService;
  private readonly s3Service: S3Service;
  private readonly sseService: SSEService;
  private readonly log: Logger;

  constructor({
    reportDAO,
    reportScheduleDAO,
    queueFactory,
    emailQueue,
    expenseService,
    leaseDAO,
    paymentDAO,
    maintenanceRequestDAO,
    expenseDAO,
    propertyUnitDAO,
    userDAO,
    vendorDAO,
    clientDAO,
    inspectionDAO,
    pdfGeneratorService,
    s3Service,
    sseService,
  }: IConstructor) {
    this.reportDAO = reportDAO;
    this.reportScheduleDAO = reportScheduleDAO;
    this.queueFactory = queueFactory;
    this.emailQueue = emailQueue;
    this.expenseService = expenseService;
    this.leaseDAO = leaseDAO;
    this.paymentDAO = paymentDAO;
    this.maintenanceRequestDAO = maintenanceRequestDAO;
    this.expenseDAO = expenseDAO;
    this.propertyUnitDAO = propertyUnitDAO;
    this.userDAO = userDAO;
    this.vendorDAO = vendorDAO;
    this.clientDAO = clientDAO;
    this.inspectionDAO = inspectionDAO;
    this.pdfGeneratorService = pdfGeneratorService;
    this.s3Service = s3Service;
    this.sseService = sseService;
    this.log = createLogger('ReportService');
  }

  // ─── ICronProvider ────────────────────────────────────────────────

  getCronJobs(): ICronJob[] {
    return [
      {
        name: 'report:scheduled-generation',
        schedule: '0 6 * * *', // 6 AM UTC daily
        handler: this.processScheduledReports.bind(this),
        service: 'ReportService',
        enabled: true,
        description: 'Generate scheduled reports for clients with active report schedules',
        timeout: 300_000,
      },
    ];
  }

  // ─── On-demand report generation ──────────────────────────────────
  async requestReport(
    cuid: string,
    userId: string,
    body: {
      period: ReportPeriod;
      startDate?: string;
      endDate?: string;
      propertyId?: string;
      sections?: ReportSection[];
      emailRecipients?: string[];
    }
  ): IPromiseReturnedData<{ reportId: string; status: ReportStatus }> {
    const { period, propertyId } = body;
    const sections = body.sections?.length ? body.sections : [...REPORT_SECTIONS];
    const emailRecipients = body.emailRecipients || [];
    const { startDate, endDate, prevStartDate, prevEndDate } = this._resolveDateRange(
      period,
      body.startDate,
      body.endDate
    );

    const client = await this.clientDAO.findFirst({ cuid });
    if (!client) {
      throw new NotFoundError({ message: 'Client not found' });
    }

    const report = await this.reportDAO.createReport({
      cuid,
      requestedBy: new Types.ObjectId(userId),
      period,
      status: ReportStatus.PENDING,
      startDate,
      endDate,
      propertyId,
      sections,
      emailRecipients,
    });

    const reportQueue = this.queueFactory.getQueue('reportQueue') as ReportQueue;
    await reportQueue.addReportJob({
      reportId: report._id.toString(),
      cuid,
      userId,
      period,
      startDate,
      endDate,
      prevStartDate,
      prevEndDate,
      propertyId,
      sections,
      emailRecipients,
    });

    return {
      success: true,
      data: { reportId: report._id.toString(), status: ReportStatus.PENDING },
      message: 'Report generation started',
    };
  }

  async getReportStatus(
    cuid: string,
    reportId: string
  ): IPromiseReturnedData<IReportStatusResponse> {
    const report = await this.reportDAO.findById(reportId);
    if (!report || report.cuid !== cuid) {
      throw new NotFoundError({ message: 'Report not found' });
    }

    const response: IReportStatusResponse = {
      reportId: report._id.toString(),
      status: report.status,
      period: report.period,
      startDate: report.startDate,
      endDate: report.endDate,
      sections: report.sections,
      failedReason: report.failedReason,
      createdAt: report.createdAt,
      completedAt: report.completedAt,
    };

    if (report.status === ReportStatus.COMPLETED && report.file?.key) {
      response.presignedUrl = await this.s3Service.getSignedUrl(report.file.key);
      response.expiresAt = new Date(Date.now() + 3600 * 1000);
      response.filename = report.file.filename;
    }

    return { success: true, data: response };
  }

  async listReports(
    cuid: string,
    query?: { page?: number; limit?: number; status?: ReportStatus }
  ): IPromiseReturnedData<{ reports: IReportDocument[]; pagination?: Record<string, any> }> {
    const result = await this.reportDAO.listByClient(cuid, query);
    return {
      success: true,
      data: { reports: result.items, pagination: result.pagination },
    };
  }

  // ─── Schedule management ──────────────────────────────────────────
  async upsertSchedule(
    cuid: string,
    userId: string,
    body: {
      frequency: ScheduleFrequency;
      sections?: ReportSection[];
      emailRecipients?: string[];
      propertyId?: string;
      isActive?: boolean;
    }
  ): IPromiseReturnedData<{ scheduleId: string }> {
    const sections = body.sections?.length ? body.sections : [...REPORT_SECTIONS];
    const nextRunAt = this._computeNextRunAt(body.frequency);

    const schedule = await this.reportScheduleDAO.upsertSchedule(cuid, {
      cuid,
      createdBy: new Types.ObjectId(userId),
      frequency: body.frequency,
      sections,
      emailRecipients: body.emailRecipients || [],
      propertyId: body.propertyId,
      nextRunAt,
      isActive: body.isActive !== false,
    });

    return {
      success: true,
      data: { scheduleId: schedule._id.toString() },
      message: 'Report schedule saved',
    };
  }

  async getSchedule(cuid: string): IPromiseReturnedData<IReportScheduleDocument | null> {
    const schedule = await this.reportScheduleDAO.getSchedule(cuid);
    return { success: true, data: schedule };
  }

  async deactivateSchedule(cuid: string): IPromiseReturnedData<{ deactivated: boolean }> {
    await this.reportScheduleDAO.deactivateSchedule(cuid);
    return { success: true, data: { deactivated: true } };
  }

  // ─── Worker entry point ───────────────────────────────────────────
  async _processReport(job: Job<IReportJobData>): Promise<void> {
    const {
      reportId,
      cuid,
      userId,
      period,
      startDate,
      endDate,
      prevStartDate,
      prevEndDate,
      propertyId,
      sections,
      emailRecipients,
    } = job.data;

    try {
      await this.reportDAO.updateStatus(reportId, ReportStatus.PROCESSING);
      await job.progress(10);

      const client = await this.clientDAO.findFirst({ cuid });
      const clientName =
        client?.companyProfile?.tradingName ||
        client?.companyProfile?.legalEntityName ||
        'Property Management';

      // Fetch current + previous period data in parallel, only for selected sections
      const [currentData, previousData] = await Promise.all([
        this._aggregateData(cuid, startDate, endDate, propertyId, sections),
        this._aggregateData(cuid, prevStartDate, prevEndDate, propertyId, sections),
      ]);
      await job.progress(50);

      const trends = this._computeTrends(currentData, previousData);

      const templateData: Record<string, any> = {
        ...currentData,
        trends,
        clientName,
        period,
        startDate,
        endDate,
        prevStartDate,
        prevEndDate,
        sections,
        generatedAt: new Date(),
      };

      const templatePath = path.join(__dirname, '../../templates/reports', 'report.ejs');
      const html = await ejs.renderFile(templatePath, templateData);
      await job.progress(65);

      const pdfResult = await this.pdfGeneratorService.generatePdf(html, {
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
      });

      if (!pdfResult.success || !pdfResult.buffer) {
        throw new Error(pdfResult.error || 'PDF generation failed');
      }
      await job.progress(80);

      // Upload to S3
      const dateStr = new Date().toISOString().split('T')[0];
      const uniqueId = randomUUID().replace(/-/g, '').substring(0, 8);
      const s3Key = `reports/${cuid}/report-${dateStr}-${uniqueId}.pdf`;
      const filename = `report-${dateStr}.pdf`;

      const uploadResult = await this.s3Service.uploadBuffer(
        pdfResult.buffer,
        s3Key,
        'application/pdf',
        reportId
      );
      await job.progress(90);

      await this.reportDAO.updateStatus(reportId, ReportStatus.COMPLETED, {
        file: {
          url: uploadResult.url,
          key: uploadResult.key,
          filename,
          size: pdfResult.buffer.length,
          mimeType: 'application/pdf',
          uploadedAt: new Date(),
        },
        completedAt: new Date(),
      });

      const presignedUrl = await this.s3Service.getSignedUrl(uploadResult.key);
      const expiresAt = new Date(Date.now() + 3600 * 1000);

      // Email delivery
      if (emailRecipients.length) {
        const periodLabel = this._getPeriodLabel(period, startDate, endDate);
        for (const recipient of emailRecipients) {
          this.emailQueue.addToEmailQueue('reportReady', {
            emailType: 'report/report-ready',
            subject: `Your ${periodLabel} Property Report is Ready`,
            to: recipient,
            data: { presignedUrl, filename, clientName, periodLabel, expiresAt },
            client: { cuid, id: client?._id?.toString() || '' },
          });
        }
      }

      // SSE push to requesting user
      await this.sseService.sendToUser(
        userId,
        cuid,
        { reportId, presignedUrl, expiresAt, filename },
        'report:ready'
      );

      this.log.info({ reportId, cuid }, 'Report generation completed');
    } catch (error: any) {
      this.log.error({ error: error.message, reportId }, 'Report generation failed');
      await this.reportDAO.updateStatus(reportId, ReportStatus.FAILED, {
        failedReason: error.message,
      });
      throw error; // rethrow for Bull retry
    }
  }

  // ─── Cron handler ─────────────────────────────────────────────────

  private async processScheduledReports(): Promise<void> {
    const now = new Date();
    const dueSchedules = await this.reportScheduleDAO.getDueSchedules(now);

    for (const schedule of dueSchedules) {
      try {
        const frequencyToPeriod: Record<ScheduleFrequency, ReportPeriod> = {
          [ScheduleFrequency.MONTHLY]: ReportPeriod.LAST_30_DAYS,
          [ScheduleFrequency.QUARTERLY]: ReportPeriod.LAST_90_DAYS,
        };
        const period = frequencyToPeriod[schedule.frequency];
        if (!period) {
          this.log.error({ frequency: schedule.frequency }, 'Unknown schedule frequency');
          continue;
        }

        const { startDate, endDate, prevStartDate, prevEndDate } = this._resolveDateRange(period);

        const report = await this.reportDAO.createReport({
          cuid: schedule.cuid,
          requestedBy: schedule.createdBy,
          period,
          status: ReportStatus.PENDING,
          startDate,
          endDate,
          sections: schedule.sections,
          emailRecipients: schedule.emailRecipients,
          propertyId: schedule.propertyId,
          scheduledBy: schedule._id,
        });

        const reportQueue = this.queueFactory.getQueue('reportQueue') as ReportQueue;
        await reportQueue.addReportJob({
          reportId: report._id.toString(),
          cuid: schedule.cuid,
          userId: schedule.createdBy.toString(),
          period,
          startDate,
          endDate,
          prevStartDate,
          prevEndDate,
          propertyId: schedule.propertyId,
          sections: schedule.sections,
          emailRecipients: schedule.emailRecipients,
        });

        const nextRunAt = this._computeNextRunAt(schedule.frequency);
        await this.reportScheduleDAO.advanceNextRunAt(schedule._id.toString(), nextRunAt);

        this.log.info(
          { cuid: schedule.cuid, frequency: schedule.frequency },
          'Scheduled report enqueued'
        );
      } catch (error: any) {
        this.log.error(
          { error: error.message, cuid: schedule.cuid },
          'Failed to enqueue scheduled report'
        );
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private async _aggregateData(
    cuid: string,
    startDate: Date,
    endDate: Date,
    propertyId: string | undefined,
    sections: ReportSection[]
  ): Promise<Record<string, any>> {
    const has = (s: ReportSection) => sections.includes(s);
    const data: Record<string, any> = {};

    // Wave 1 — aggregate stats (all run in parallel)
    const [
      paymentStats,
      leaseStats,
      unitCounts,
      pnlResult,
      maintenanceStats,
      tenantStats,
      userStats,
      vendorStats,
      inspectionStats,
    ] = await Promise.all([
      has('executive_summary') || has('payment_analysis')
        ? this.paymentDAO.getPaymentStats(cuid)
        : null,
      has('executive_summary') || has('lease_occupancy') ? this.leaseDAO.getLeaseStats(cuid) : null,
      has('executive_summary') ? this.propertyUnitDAO.getPropertyUnitCounts(cuid) : null,
      has('financial_overview')
        ? this.expenseService.getPnLSummary(cuid, startDate.toISOString(), endDate.toISOString())
        : null,
      has('maintenance') ? this.maintenanceRequestDAO.getStats(cuid) : null,
      has('tenants') ? this.userDAO.getTenantStats(cuid) : null,
      has('tenants') ? this.userDAO.getUserStats(cuid) : null,
      has('vendors') ? this.vendorDAO.getClientVendorStats(cuid, {}) : null,
      has('inspections') ? this.inspectionDAO.getStats(cuid) : null,
    ]);

    if (paymentStats) data.paymentStats = paymentStats;
    if (leaseStats) data.leaseStats = leaseStats;
    if (unitCounts) data.unitCounts = unitCounts;
    if (pnlResult) data.pnl = pnlResult.data;
    if (maintenanceStats) data.maintenanceStats = maintenanceStats;
    if (tenantStats) data.tenantStats = tenantStats;
    if (userStats) data.userStats = userStats;
    if (vendorStats) data.vendorStats = vendorStats;
    if (inspectionStats) data.inspectionStats = inspectionStats;

    // Wave 2 — list/table data
    const dateMatch = { date: { $gte: startDate, $lte: endDate } };

    const [
      rentRoll,
      expiringLeases,
      recentPayments,
      recentWorkOrders,
      expenseByCategory,
      expenseByProperty,
      recentExpenses,
    ] = await Promise.all([
      has('lease_occupancy') ? this.leaseDAO.getRentRollData(cuid, propertyId) : null,
      has('lease_occupancy') ? this.leaseDAO.getExpiringLeases(cuid, 90) : null,
      has('payment_analysis') ? this.paymentDAO.findByCuid(cuid, {}, { limit: 15 }) : null,
      has('maintenance')
        ? this.maintenanceRequestDAO.listWithDetails({ cuid, deletedAt: null }, { limit: 20 })
        : null,
      has('expenses') ? this.expenseDAO.aggregateByCategory(cuid, dateMatch) : null,
      has('expenses') ? this.expenseDAO.aggregateByProperty(cuid, dateMatch) : null,
      has('expenses')
        ? this.expenseDAO.findByClient(
            cuid,
            { from: startDate.toISOString(), to: endDate.toISOString() },
            { limit: 20 }
          )
        : null,
    ]);

    if (rentRoll) data.rentRoll = rentRoll;
    if (expiringLeases) data.expiringLeases = expiringLeases;
    if (recentPayments) data.recentPayments = recentPayments;
    if (recentWorkOrders) data.recentWorkOrders = recentWorkOrders;
    if (expenseByCategory) data.expenseByCategory = expenseByCategory;
    if (expenseByProperty) data.expenseByProperty = expenseByProperty;
    if (recentExpenses) data.recentExpenses = recentExpenses;

    return data;
  }

  private _computeTrends(
    current: Record<string, any>,
    previous: Record<string, any>
  ): Record<string, any> {
    const trends: Record<string, any> = {};

    const delta = (cur: number, prev: number) => ({
      current: cur,
      previous: prev,
      delta: cur - prev,
      deltaPercent: prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10,
    });

    // Payment stats (per-currency)
    if (current.paymentStats?.byCurrency && previous.paymentStats?.byCurrency) {
      trends.revenue = {};
      for (const cur of current.paymentStats.byCurrency) {
        const prev = previous.paymentStats.byCurrency.find((p: any) => p.currency === cur.currency);
        trends.revenue[cur.currency] = delta(cur.totalRevenue, prev?.totalRevenue || 0);
      }
      trends.overdueCount = delta(
        current.paymentStats.overdueCount,
        previous.paymentStats.overdueCount
      );
      trends.onTimeRate = delta(current.paymentStats.onTimeRate, previous.paymentStats.onTimeRate);
    }

    // P&L (per-currency)
    if (current.pnl?.byCurrency && previous.pnl?.byCurrency) {
      trends.netIncome = {};
      trends.totalExpenses = {};
      for (const cur of current.pnl.byCurrency) {
        const prev = previous.pnl.byCurrency.find((p: any) => p.currency === cur.currency);
        trends.netIncome[cur.currency] = delta(cur.netIncome, prev?.netIncome || 0);
        trends.totalExpenses[cur.currency] = delta(
          cur.expenses?.total || 0,
          prev?.expenses?.total || 0
        );
      }
    }

    // Lease/occupancy
    if (current.leaseStats && previous.leaseStats) {
      trends.activeLeases = delta(
        current.leaseStats.activeLeases || 0,
        previous.leaseStats.activeLeases || 0
      );
    }
    if (current.unitCounts && previous.unitCounts) {
      trends.occupancyRate = delta(
        current.unitCounts.occupancyRate,
        previous.unitCounts.occupancyRate
      );
    }

    // Maintenance
    if (current.maintenanceStats && previous.maintenanceStats) {
      trends.openWorkOrders = delta(
        current.maintenanceStats.open || 0,
        previous.maintenanceStats.open || 0
      );
    }

    return trends;
  }

  private _resolveDateRange(
    period: ReportPeriod,
    startDateStr?: string,
    endDateStr?: string
  ): { startDate: Date; endDate: Date; prevStartDate: Date; prevEndDate: Date } {
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    switch (period) {
      case ReportPeriod.LAST_30_DAYS:
        endDate = now;
        startDate = new Date(now.getTime() - 30 * 86400000);
        break;
      case ReportPeriod.LAST_90_DAYS:
        endDate = now;
        startDate = new Date(now.getTime() - 90 * 86400000);
        break;
      case ReportPeriod.CUSTOM:
        if (!startDateStr || !endDateStr) {
          throw new BadRequestError({
            message: 'startDate and endDate are required for custom period',
          });
        }
        startDate = new Date(startDateStr);
        endDate = new Date(endDateStr);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throw new BadRequestError({ message: 'Invalid startDate or endDate' });
        }
        if (startDate >= endDate) {
          throw new BadRequestError({ message: 'startDate must be before endDate' });
        }
        break;
      default:
        throw new BadRequestError({ message: `Invalid report period: ${period}` });
    }

    const durationMs = endDate.getTime() - startDate.getTime();
    const prevEndDate = new Date(startDate.getTime() - 1);
    const prevStartDate = new Date(prevEndDate.getTime() - durationMs);

    return { startDate, endDate, prevStartDate, prevEndDate };
  }

  private _computeNextRunAt(frequency: ScheduleFrequency): Date {
    const now = new Date();
    if (frequency === ScheduleFrequency.MONTHLY) {
      return new Date(now.getFullYear(), now.getMonth() + 1, 1, 6, 0, 0);
    }
    // Quarterly: next quarter start
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const nextQuarterMonth = (currentQuarter + 1) * 3;
    return new Date(now.getFullYear(), nextQuarterMonth, 1, 6, 0, 0);
  }

  private _getPeriodLabel(period: ReportPeriod, startDate: Date, endDate: Date): string {
    switch (period) {
      case ReportPeriod.LAST_30_DAYS:
        return 'Monthly';
      case ReportPeriod.LAST_90_DAYS:
        return 'Quarterly';
      case ReportPeriod.CUSTOM:
        return `${startDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
      default:
        return 'Report';
    }
  }
}
