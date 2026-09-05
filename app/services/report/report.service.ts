import ejs from 'ejs';
import path from 'path';
import { Job } from 'bull';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { QueueFactory } from '@services/queue';
import { RedisService } from '@database/index';
import { EmailQueue } from '@queues/email.queue';
import { ReportQueue } from '@queues/report.queue';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { PlanName } from '@interfaces/subscription.interface';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { IPromiseReturnedData, MailType } from '@interfaces/utils.interface';
import { SubscriptionPlanConfig } from '@services/subscription/subscription_plans.config';
import {
  ReportAnalysisAIService,
  PdfGeneratorService,
  ExpenseService,
  SSEService,
  S3Service,
} from '@services/index';
import {
  MaintenanceRequestDAO,
  ReportScheduleDAO,
  PropertyUnitDAO,
  InspectionDAO,
  PropertyDAO,
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

const COOLDOWN_TTL_SECONDS = 900; // 15 minutes
const REPORT_COOLDOWN_PREFIX = 'report-cooldown';

interface IConstructor {
  reportAnalysisAIService: ReportAnalysisAIService;
  subscriptionPlanConfig: SubscriptionPlanConfig;
  maintenanceRequestDAO: MaintenanceRequestDAO;
  pdfGeneratorService: PdfGeneratorService;
  reportScheduleDAO: ReportScheduleDAO;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  subscriptionDAO: SubscriptionDAO;
  expenseService: ExpenseService;
  inspectionDAO: InspectionDAO;
  queueFactory: QueueFactory;
  redisService: RedisService;
  propertyDAO: PropertyDAO;
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
  private readonly propertyDAO: PropertyDAO;
  private readonly reportAnalysisAIService: ReportAnalysisAIService;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;
  private readonly pdfGeneratorService: PdfGeneratorService;
  private readonly emitterService: EventEmitterService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly redisService: RedisService;
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
    propertyDAO,
    pdfGeneratorService,
    reportAnalysisAIService,
    subscriptionPlanConfig,
    emitterService,
    subscriptionDAO,
    redisService,
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
    this.propertyDAO = propertyDAO;
    this.pdfGeneratorService = pdfGeneratorService;
    this.reportAnalysisAIService = reportAnalysisAIService;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.emitterService = emitterService;
    this.subscriptionDAO = subscriptionDAO;
    this.redisService = redisService;
    this.s3Service = s3Service;
    this.sseService = sseService;
    this.log = createLogger('ReportService');
    this._setupEventListeners();
  }

  private _setupEventListeners(): void {
    this.emitterService.on(EventTypes.PLAN_DOWNGRADED, (payload) => {
      if (payload.disabledFeatures.includes('reportingAnalytics')) {
        this.reportScheduleDAO
          .deactivateSchedule(payload.cuid)
          .then(() =>
            this.log.info(
              { cuid: payload.cuid },
              'Report schedule deactivated due to plan downgrade'
            )
          )
          .catch((err) =>
            this.log.warn(
              { err, cuid: payload.cuid },
              'Failed to deactivate report schedule on downgrade'
            )
          );
      }
    });
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
      {
        name: 'report:monthly-usage-reset',
        schedule: '30 4 * * *', // 4:30 AM UTC — after SMS reset at 4:15
        handler: this._resetUsageForBillingCycle.bind(this),
        service: 'ReportService',
        enabled: true,
        description:
          'Reset report generation usage counters for clients whose billing cycle renews today',
        timeout: 120_000,
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
    // executive_summary is always included and doesn't count toward the section limit
    const requestedSections = body.sections?.length ? body.sections : [...REPORT_SECTIONS];
    const sections: ReportSection[] = requestedSections.includes('executive_summary')
      ? requestedSections
      : ['executive_summary', ...requestedSections];
    const selectableSections = sections.filter((s) => s !== 'executive_summary');
    const emailRecipients = body.emailRecipients || [];

    // ── Plan-based limits ──
    const subscription = await this.subscriptionDAO.findFirst({ cuid });
    const planName = (subscription?.planName ?? 'essential') as PlanName;
    const limits = this.subscriptionPlanConfig.getReportLimits(planName);

    if (selectableSections.length > limits.maxReportSections) {
      throw new BadRequestError({
        message: `Your plan allows up to ${limits.maxReportSections} report sections`,
      });
    }
    if (emailRecipients.length > limits.maxReportEmails) {
      throw new BadRequestError({
        message: `Your plan allows up to ${limits.maxReportEmails} email recipients`,
      });
    }

    // ── Cooldown check (Redis) ──
    await this._checkCooldown(cuid);

    // ── Atomic quota check + increment (prevents race conditions) ──
    const updatedSub = await this.subscriptionDAO.incrementUsageCounterIfUnder(
      cuid,
      'reportGenerationUsage.countThisPeriod',
      limits.maxReportsPerMonth
    );
    if (!updatedSub) {
      throw new BadRequestError({
        message: `Monthly report limit reached (${limits.maxReportsPerMonth} per month on your plan)`,
      });
    }

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

    this._setCooldown(cuid);

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
      response.presignedUrl = await this.s3Service.getSignedUrl(report.file.key, {
        disposition: 'inline',
      });
      response.expiresAt = new Date(Date.now() + 3600 * 1000);
      response.filename = report.file.filename;
    }

    return { success: true, data: response };
  }

  async deleteReport(cuid: string, reportId: string): IPromiseReturnedData<{ deleted: boolean }> {
    const report = await this.reportDAO.findById(reportId);
    if (!report || report.cuid !== cuid) {
      throw new NotFoundError({ message: 'Report not found' });
    }

    // Delete file from S3 if it exists
    if (report.file?.key) {
      try {
        await this.s3Service.deleteFile(report.file.key);
      } catch (err: any) {
        this.log.warn(
          { err, reportId, key: report.file.key },
          'Failed to delete report file from S3'
        );
      }
    }

    await this.reportDAO.deleteItem({ _id: report._id });
    this.log.info({ reportId, cuid }, 'Report deleted');

    return { success: true, data: { deleted: true }, message: 'Report deleted successfully' };
  }

  async listReports(
    cuid: string,
    query?: { page?: number; limit?: number; status?: ReportStatus }
  ): IPromiseReturnedData<{
    reports: IReportDocument[];
    pagination?: Record<string, any>;
    meta: {
      maxReportsPerMonth: number;
      maxReportSections: number;
      maxReportEmails: number;
      usedThisMonth: number;
      cooldownActive: boolean;
      cooldownRemaining: number;
    };
  }> {
    const subscription = await this.subscriptionDAO.findFirst({ cuid });
    const planName = (subscription?.planName ?? 'essential') as PlanName;
    const limits = this.subscriptionPlanConfig.getReportLimits(planName);

    const [result, cooldownRemaining, usedThisMonth] = await Promise.all([
      this.reportDAO.listByClient(cuid, query),
      this._getCooldownRemaining(cuid),
      this._syncUsageCounter(cuid),
    ]);

    return {
      success: true,
      data: {
        reports: result.items,
        pagination: result.pagination,
        meta: {
          ...limits,
          usedThisMonth,
          cooldownActive: cooldownRemaining > 0,
          cooldownRemaining,
        },
      },
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
    const requestedSections = body.sections?.length ? body.sections : [...REPORT_SECTIONS];
    const sections: ReportSection[] = requestedSections.includes('executive_summary')
      ? requestedSections
      : ['executive_summary', ...requestedSections];
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
    const { reportId, cuid, userId, period, propertyId, sections, emailRecipients } = job.data;

    // Bull serializes Date objects as ISO strings in JSON — cast back to Date
    const startDate = new Date(job.data.startDate);
    const endDate = new Date(job.data.endDate);
    const prevStartDate = new Date(job.data.prevStartDate);
    const prevEndDate = new Date(job.data.prevEndDate);

    try {
      await this.reportDAO.updateStatus(reportId, ReportStatus.PROCESSING);
      await job.progress(10);

      const client = await this.clientDAO.findFirst({ cuid });
      const clientName =
        client?.displayName ||
        client?.companyProfile?.tradingName ||
        client?.companyProfile?.legalEntityName ||
        'Your Company';

      // Fetch current + previous period data in parallel, only for selected sections
      const [currentData, previousData] = await Promise.all([
        this._aggregateData(cuid, startDate, endDate, propertyId, sections),
        this._aggregateData(cuid, prevStartDate, prevEndDate, propertyId, sections),
      ]);
      await job.progress(50);

      const trends = this._computeTrends(currentData, previousData);

      // AI executive analysis (graceful degradation — fallback template if unavailable)
      let aiSummary: string | null = null;
      let aiGenerated = false;
      const subscription = await this.subscriptionDAO.findFirst({ cuid });
      const planName = (subscription?.planName ?? 'essential') as PlanName;

      const aiResult = await this.reportAnalysisAIService.analyzeReport(planName, {
        ...currentData,
        trends,
        period,
      });
      if (aiResult.ok) {
        aiSummary = aiResult.summary;
        aiGenerated = true;
      } else {
        this.log.info(
          { reason: aiResult.reason, reportId },
          'AI analysis unavailable, using fallback'
        );
        const fallbackPath = path.join(
          __dirname,
          '../../templates/reports/partials',
          'executive-analysis-fallback.ejs'
        );
        aiSummary = await ejs.renderFile(fallbackPath, { ...currentData, trends, period });
      }
      await job.progress(55);

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
        aiSummary,
        aiGenerated,
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

      // Upload to S3 — follows buildS3Key convention: {resource}/{name}|||{id}|||_{timestamp}.{ext}
      const timestamp = Date.now();
      const s3Key = `reports/report|||${reportId}|||_${timestamp}.pdf`;
      const safeName = clientName
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .toLowerCase();
      const periodSlug = this._getPeriodLabel(period, startDate, endDate)
        .replace(/\s+/g, '_')
        .toLowerCase();
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `${safeName}_${periodSlug}_${dateStr}.pdf`;

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
        aiSummary: aiSummary || undefined,
        completedAt: new Date(),
      });

      const presignedUrl = await this.s3Service.getSignedUrl(uploadResult.key);
      const expiresAt = new Date(Date.now() + 3600 * 1000);

      // Email delivery
      if (emailRecipients.length) {
        const periodLabel = this._getPeriodLabel(period, startDate, endDate);
        for (const recipient of emailRecipients) {
          try {
            this.emailQueue.addToEmailQueue(MailType.REPORT_READY, {
              emailType: MailType.REPORT_READY,
              subject: `Your ${periodLabel} Property Report is Ready`,
              to: recipient,
              data: { presignedUrl, filename, clientName, periodLabel, expiresAt },
              client: { cuid, id: client?._id?.toString() || '' },
            });
          } catch (err) {
            this.log.error({ err, recipient, reportId }, 'Failed to enqueue report email');
          }
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

        // Check monthly quota for scheduled reports too
        const sub = await this.subscriptionDAO.findFirst({ cuid: schedule.cuid });
        const pName = (sub?.planName ?? 'essential') as PlanName;
        const reportLimits = this.subscriptionPlanConfig.getReportLimits(pName);
        const usedCount = sub?.reportGenerationUsage?.countThisPeriod ?? 0;
        if (usedCount >= reportLimits.maxReportsPerMonth) {
          this.log.info(
            { cuid: schedule.cuid, usedCount, limit: reportLimits.maxReportsPerMonth },
            'Scheduled report skipped — monthly quota reached'
          );
          continue;
        }

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

        // Track usage on subscription
        try {
          const { matched } = await this.subscriptionDAO.incrementUsageCounter(
            schedule.cuid,
            'reportGenerationUsage.countThisPeriod'
          );
          if (!matched) {
            this.log.warn(
              { cuid: schedule.cuid },
              'Scheduled report usage increment matched no subscription'
            );
          }
        } catch (err) {
          this.log.error(
            { err, cuid: schedule.cuid },
            'Failed to increment scheduled report usage'
          );
        }

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
      propertySummary,
    ] = await Promise.all([
      has('executive_summary') || has('payment_analysis')
        ? this.paymentDAO.getPaymentStats(cuid, { propertyId })
        : null,
      has('executive_summary') || has('lease_occupancy')
        ? this.leaseDAO.getLeaseStats(
            cuid,
            propertyId ? { 'property.id': new Types.ObjectId(propertyId) } : undefined
          )
        : null,
      has('executive_summary')
        ? this.propertyUnitDAO.getPropertyUnitCounts(cuid, propertyId)
        : null,
      has('financial_overview')
        ? this.expenseService.getPnLSummary(
            cuid,
            startDate.toISOString(),
            endDate.toISOString(),
            propertyId
          )
        : null,
      has('maintenance') ? this.maintenanceRequestDAO.getStats(cuid, { propertyId }) : null,
      has('tenants') ? this.userDAO.getTenantStats(cuid) : null,
      has('tenants') ? this.userDAO.getUserStats(cuid) : null,
      has('vendors') ? this.vendorDAO.getClientVendorStats(cuid, {}) : null,
      has('inspections') ? this.inspectionDAO.getStats(cuid, { propertyId }) : null,
      has('executive_summary')
        ? this.propertyDAO.aggregate([
            {
              $match: {
                cuid,
                deletedAt: null,
                ...(propertyId ? { _id: new Types.ObjectId(propertyId) } : {}),
              },
            },
            {
              $lookup: {
                from: 'propertyunits',
                localField: '_id',
                foreignField: 'propertyId',
                pipeline: [
                  { $match: { deletedAt: null, isArchived: { $ne: true } } },
                  { $count: 'count' },
                ],
                as: '_unitCount',
              },
            },
            {
              $project: {
                name: 1,
                propertyType: 1,
                'address.fullAddress': 1,
                'address.street': 1,
                'address.city': 1,
                'address.state': 1,
                unitCount: { $ifNull: [{ $arrayElemAt: ['$_unitCount.count', 0] }, 0] },
              },
            },
          ])
        : null,
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
    if (propertySummary) {
      data.properties = (propertySummary as any[]).map((p: any) => ({
        name: p.name || 'Unnamed Property',
        type: p.propertyType || 'other',
        address:
          p.address?.fullAddress ||
          [p.address?.street, p.address?.city, p.address?.state].filter(Boolean).join(', ') ||
          '—',
        unitCount: p.unitCount || 0,
      }));
    }

    // Wave 2 — list/table data
    const dateMatch: Record<string, any> = { date: { $gte: startDate, $lte: endDate } };
    if (propertyId) dateMatch.propertyId = new Types.ObjectId(propertyId);

    const mrFilter: Record<string, any> = { cuid, deletedAt: null };
    if (propertyId) mrFilter.propertyId = new Types.ObjectId(propertyId);

    const expenseFilters: Record<string, any> = {
      from: startDate.toISOString(),
      to: endDate.toISOString(),
    };
    if (propertyId) expenseFilters.propertyId = propertyId;

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
      has('lease_occupancy') ? this.leaseDAO.getExpiringLeases(cuid, 90, propertyId) : null,
      has('payment_analysis') ? this.paymentDAO.findByCuid(cuid, {}, { limit: 15 }) : null,
      has('maintenance')
        ? this.maintenanceRequestDAO.listWithDetails(mrFilter, { limit: 20 })
        : null,
      has('expenses') ? this.expenseDAO.aggregateByCategory(cuid, dateMatch) : null,
      has('expenses') ? this.expenseDAO.aggregateByProperty(cuid, dateMatch) : null,
      has('expenses') ? this.expenseDAO.findByClient(cuid, expenseFilters, { limit: 20 }) : null,
    ]);

    if (rentRoll) data.rentRoll = rentRoll;
    if (expiringLeases) data.expiringLeases = expiringLeases;
    if (recentPayments) data.recentPayments = recentPayments;
    if (recentWorkOrders) data.recentWorkOrders = recentWorkOrders;
    if (expenseByCategory) data.expenseByCategory = expenseByCategory;
    if (expenseByProperty) {
      // Hydrate property names for expense-by-property table
      const propIds = (expenseByProperty as any[])
        .map((e: any) => e._id?.propertyId)
        .filter(Boolean)
        .map((id: string) => new Types.ObjectId(id));
      const propDocs = propIds.length
        ? await this.propertyDAO.aggregate([
            { $match: { _id: { $in: propIds } } },
            { $project: { _id: 1, name: 1 } },
          ])
        : [];
      const nameMap = new Map((propDocs as any[]).map((p: any) => [p._id.toString(), p.name]));
      data.expenseByProperty = (expenseByProperty as any[]).map((e: any) => ({
        ...e,
        _propertyName: nameMap.get(e._id?.propertyId?.toString()) || 'Unknown',
      }));
    }
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

  // ─── Billing cycle reset ───────────────────────────────────────────

  private async _resetUsageForBillingCycle(): Promise<void> {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const isLastDay = dayOfMonth === lastDayOfMonth;

    try {
      const matchFilter: Record<string, unknown> = {
        status: 'active',
      };

      if (isLastDay) {
        matchFilter.$expr = {
          $or: [
            { $eq: [{ $dayOfMonth: '$startDate' }, dayOfMonth] },
            { $gt: [{ $dayOfMonth: '$startDate' }, lastDayOfMonth] },
          ],
        };
      } else {
        matchFilter.$expr = { $eq: [{ $dayOfMonth: '$startDate' }, dayOfMonth] };
      }

      const modifiedCount = await this.subscriptionDAO.bulkResetUsageCounters(matchFilter, {
        'reportGenerationUsage.countThisPeriod': 0,
        'reportGenerationUsage.periodStart': new Date(),
      });

      this.log.info({ modifiedCount, dayOfMonth }, 'Report usage counters reset for billing cycle');
    } catch (error: any) {
      this.log.error({ error: error.message }, 'Failed to reset report usage counters');
    }
  }

  // ─── Quota & cooldown helpers ─────────────────────────────────────

  /** Returns remaining cooldown seconds, or 0 if not active */
  private async _getCooldownRemaining(cuid: string): Promise<number> {
    try {
      const key = `${REPORT_COOLDOWN_PREFIX}:${cuid}`;
      const ttl = await this.redisService.client.ttl(key);
      return ttl > 0 ? ttl : 0;
    } catch {
      return 0;
    }
  }

  private async _checkCooldown(cuid: string): Promise<void> {
    try {
      const key = `${REPORT_COOLDOWN_PREFIX}:${cuid}`;
      const exists = await this.redisService.client.get(key);
      if (exists) {
        throw new BadRequestError({
          message: 'Please wait before generating another report',
        });
      }
    } catch (error: any) {
      // Re-throw BadRequestError, swallow Redis failures (fail open)
      if (error.name === 'BadRequestError') throw error;
      this.log.warn({ error: error.message, cuid }, 'Redis cooldown check failed — skipping');
    }
  }

  private _setCooldown(cuid: string): void {
    const key = `${REPORT_COOLDOWN_PREFIX}:${cuid}`;
    this.redisService.client
      .set(key, '1', { EX: COOLDOWN_TTL_SECONDS })
      .catch((err) => this.log.warn({ err, cuid }, 'Failed to set report cooldown'));
  }

  /**
   * Self-healing: count actual reports created since the billing period start
   * and correct the subscription counter if it drifted (e.g., reports generated
   * before usage tracking was deployed, or counter failed to increment).
   * Returns the corrected count.
   */
  async _syncUsageCounter(cuid: string): Promise<number> {
    try {
      const subscription = await this.subscriptionDAO.findFirst({ cuid });
      if (!subscription) {
        this.log.warn({ cuid }, 'No subscription found for usage counter sync');
        return 0;
      }

      const periodStart =
        subscription.reportGenerationUsage?.periodStart ??
        subscription.startDate ??
        new Date(new Date().getFullYear(), new Date().getMonth(), 1);

      const actualCount = await this.reportDAO.countDocuments({
        cuid,
        createdAt: { $gte: new Date(periodStart) },
      });

      const trackedCount = subscription.reportGenerationUsage?.countThisPeriod ?? 0;

      this.log.info(
        { cuid, periodStart: new Date(periodStart).toISOString(), actualCount, trackedCount },
        '>>> Usage counter sync check'
      );

      if (actualCount !== trackedCount) {
        const setFields: Record<string, any> = {
          'reportGenerationUsage.countThisPeriod': actualCount,
        };
        if (!subscription.reportGenerationUsage?.periodStart) {
          setFields['reportGenerationUsage.periodStart'] = new Date(periodStart);
        }
        const modifiedCount = await this.subscriptionDAO.setUsageFields({ cuid }, setFields);
        if (modifiedCount === 0) {
          this.log.error({ cuid }, 'Usage counter sync update matched no subscription');
        } else {
          this.log.info(
            { cuid, trackedCount, actualCount },
            'Report usage counter synced (was out of date)'
          );
        }
      }

      return actualCount;
    } catch (error: any) {
      this.log.error(
        { error: error.message, stack: error.stack, cuid },
        'Failed to sync report usage counter'
      );
      return 0;
    }
  }
}
