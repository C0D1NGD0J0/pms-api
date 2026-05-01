import Logger from 'bunyan';
import { Response } from 'express';
import { PdfQueue } from '@queues/index';
// import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { LeaseTemplateService, MediaUploadService, LeaseService } from '@services/index';

export class LeaseController {
  private readonly log: Logger;
  private readonly leaseService: LeaseService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly leaseTemplateService: LeaseTemplateService;
  private readonly pdfGeneratorQueue: PdfQueue;

  constructor({
    leaseService,
    mediaUploadService,
    leaseTemplateService,
    pdfGeneratorQueue,
  }: {
    leaseService: LeaseService;
    mediaUploadService: MediaUploadService;
    leaseTemplateService: LeaseTemplateService;
    pdfGeneratorQueue: PdfQueue;
  }) {
    this.log = createLogger('LeaseController');
    this.mediaUploadService = mediaUploadService;
    this.leaseService = leaseService;
    this.leaseTemplateService = leaseTemplateService;
    this.pdfGeneratorQueue = pdfGeneratorQueue;
  }

  createLease = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const result = await this.leaseService.createLease(cuid, req.body, req.context);

    // const uploadResult = await this.mediaUploadService.handleFiles(req, {
    //   primaryResourceId: result.data.id,
    //   uploadedBy: req.context.currentuser!.sub,
    //   resourceContext: ResourceContext.LEASE,
    // });
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: result,
    });
  };

  getFilteredLeases = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const pagination = (req.query.pagination as any) || {};
    const filter = (req.query.filter as any) || {};

    const paginationOpts = {
      page: pagination.page ? parseInt(pagination.page, 10) : 1,
      limit: pagination.limit ? parseInt(pagination.limit, 10) : 10,
      sort: pagination.order as string | undefined,
      sortBy: pagination.sortBy as string | undefined,
    };

    const filterOpts = {
      status: filter.status as any,
      search: filter.search as string | undefined,
      tenantId: filter.tenantId as string | undefined,
      unitPuid: filter.unitPuid as string | undefined,
    };

    const result = await this.leaseService.getFilteredLeases(
      cuid,
      filterOpts,
      paginationOpts,
      req.context
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getLeaseById = async (req: AppRequest, res: Response) => {
    const { luid } = req.params;
    const { meta } = req.query as { meta?: { includeFormattedData?: boolean } };
    const cxt = req.context;

    const result = await this.leaseService.getLeaseById(cxt, luid, meta?.includeFormattedData);

    res.status(httpStatusCodes.OK).json(result);
  };

  updateLease = async (req: AppRequest, res: Response) => {
    const { luid } = req.params;
    const updateData = req.body;
    const cxt = req.context;

    this.log.info(`Updating lease ${luid}`);
    const result = await this.leaseService.updateLease(cxt, luid, updateData);

    res.status(httpStatusCodes.OK).json(result);
  };

  deleteLease = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    // const { uid } = req.context.currentuser!;

    this.log.info(`Deleting lease ${leaseId} for client ${cuid}`);

    // TODO: Implement lease deletion
    // const result = await this.leaseService.deleteLease(cuid, leaseId, uid);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Delete lease not yet implemented',
    });
  };

  activateLease = async (req: AppRequest, res: Response) => {
    const { cuid, luid } = req.params;
    const result = await this.leaseService.activateLease(cuid, luid, req.context);
    res.status(httpStatusCodes.OK).json(result);
  };

  terminateLease = async (req: AppRequest, res: Response) => {
    const { cuid, luid } = req.params;
    const result = await this.leaseService.terminateLease(cuid, luid, req.body, req.context);
    res.status(httpStatusCodes.OK).json(result);
  };

  approveLease = async (req: AppRequest, res: Response) => {
    const { cuid, luid } = req.params;
    const { currentuser } = req.context;
    const { notes } = req.body;
    const result = await this.leaseService.approveLease(cuid, luid, currentuser, notes);
    res.status(httpStatusCodes.OK).json(result);
  };

  rejectLease = async (req: AppRequest, res: Response) => {
    const { cuid, luid } = req.params;
    const { currentuser } = req.context;
    const { reason } = req.body;
    const result = await this.leaseService.rejectLease(cuid, luid, currentuser, reason);
    res.status(httpStatusCodes.OK).json(result);
  };

  renewLease = async (req: AppRequest, res: Response) => {
    const { cuid, luid } = req.params;
    const renewalData = req.body;

    if (!cuid || !luid) {
      res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Client ID and Lease ID are required for lease renewal',
      });
      return;
    }

    const result = await this.leaseService.renewLease(cuid, luid, renewalData, req.context);

    res.status(httpStatusCodes.OK).json({
      success: true,
      data: result.data,
      message: 'Lease renewal successfully initiated',
    });
  };

  uploadLeaseDocument = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    this.log.info(`${cuid}, Uploading document for lease ${leaseId}`);

    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Upload lease document not yet implemented',
    });
  };

  getLeaseDocument = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    this.log.info(`${cuid}, Getting document for lease ${leaseId}`);

    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Get lease document not yet implemented',
    });
  };

  removeLeaseDocument = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    this.log.info(`${cuid}, Removing document for lease ${leaseId}`);

    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Remove lease document not yet implemented',
    });
  };

  handleSignatureAction = async (req: AppRequest, res: Response) => {
    const { action } = req.body;
    let result;

    switch (action) {
      case 'manual':
        res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
          success: false,
          message: 'Manual signing not yet implemented',
        });
        return;
      case 'cancel': {
        const { cuid: cancelCuid, luid: cancelLuid } = req.params;
        const { currentuser } = req.context;
        result = await this.leaseService.cancelSignature(cancelCuid, cancelLuid, currentuser!.sub);
        break;
      }
      case 'send':
        result = await this.leaseService.sendLeaseForSignature(req.context);
        break;
      default:
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Invalid action for signature handling',
        });
        return;
    }

    res.status(httpStatusCodes.OK).json(result);
  };

  getSignatureDetails = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    this.log.info(`${cuid}, Getting signature details for lease ${leaseId}`);

    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Get signature details not yet implemented',
    });
  };

  generateLeasePDF = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    const { templateType } = req.body;

    this.log.info(`Generating PDF for lease ${leaseId}, client ${cuid}`);

    const result = await this.leaseService.queueLeasePdfGeneration(
      leaseId,
      cuid,
      req.context,
      templateType
    );

    if (result.success) {
      res.status(httpStatusCodes.OK).json({
        success: true,
        message: 'PDF generation queued successfully',
        data: {
          jobId: result.jobId,
          status: 'queued',
        },
      });
    } else {
      res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: result.error || 'Failed to queue PDF generation',
      });
    }
  };

  getPdfJobStatus = async (req: AppRequest, res: Response) => {
    const { jobId, cuid } = req.params;

    this.log.info(`Getting PDF job status for job ${jobId}`);

    try {
      const jobStatus = await this.pdfGeneratorQueue.getJobStatus(jobId);

      if (!jobStatus.exists) {
        res.status(httpStatusCodes.NOT_FOUND).json({
          success: false,
          message: 'Job not found',
        });
        return;
      }

      // Verify the job belongs to the requesting tenant
      if ((jobStatus as any).data?.cuid && (jobStatus as any).data.cuid !== cuid) {
        res.status(httpStatusCodes.FORBIDDEN).json({
          success: false,
          message: 'Access denied',
        });
        return;
      }

      res.status(httpStatusCodes.OK).json({
        success: true,
        data: {
          jobId: jobStatus.id,
          state: jobStatus.state,
          progress: jobStatus.progress,
          result: jobStatus.result,
          completedOn: jobStatus.completedOn,
          failedReason: jobStatus.failedReason,
        },
      });
    } catch (error) {
      this.log.error({ error, jobId }, 'Failed to get job status');
      res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get job status',
      });
    }
  };

  downloadLeasePDF = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    this.log.info(`Downloading PDF for lease ${leaseId}, client ${cuid}`);

    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Download PDF not yet implemented',
    });
  };

  getExpiringLeases = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { days } = req.query;
    const daysThreshold = days ? parseInt(days as string, 10) : 30;

    this.log.info(`Getting expiring leases for client ${cuid}`);

    const result = await this.leaseService.getExpiringLeases(cuid, daysThreshold);

    res.status(httpStatusCodes.OK).json(result);
  };

  getLeaseStats = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const filters = req.query;

    this.log.info(`Getting lease statistics for client ${cuid}`);

    const result = await this.leaseService.getLeaseStats(cuid, filters);

    res.status(httpStatusCodes.OK).json(result);
  };

  previewLeaseContract = async (req: AppRequest, res: Response) => {
    const { cuid, luid } = req.params;

    const enrichedData = await this.leaseService.generateLeasePreview(cuid, luid);
    const templateType = enrichedData.templateType || 'residential-single-family';
    const html = await this.leaseTemplateService.transformAndRender(enrichedData, templateType);

    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        html,
        templateUsed: templateType,
        renderedAt: new Date().toISOString(),
      },
    });
  };

  getLeaseTemplates = async (req: AppRequest, res: Response) => {
    const allTemplates = await this.leaseTemplateService.getAvailableTemplates();
    const hasLeaseTemplates =
      req.context?.currentuser?.subscription?.entitlements?.leaseTemplates ?? false;

    const templates = hasLeaseTemplates
      ? allTemplates
      : allTemplates.filter((t) => t.templateType === 'generic');

    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        templates,
        totalCount: templates.length,
      },
    });
  };

  getRenewalFormData = async (req: AppRequest, res: Response) => {
    const { luid } = req.params;
    const cxt = req.context;

    this.log.info(`Getting renewal form data for lease ${luid}`);
    const result = await this.leaseService.getRenewalFormData(cxt, luid);

    res.status(httpStatusCodes.OK).json(result);
  };
}
