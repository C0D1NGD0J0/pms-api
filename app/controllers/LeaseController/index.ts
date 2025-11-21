import Logger from 'bunyan';
import { Response } from 'express';
// import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { MediaUploadService, LeaseService } from '@services/index';
import { LeaseTemplateService } from '@services/lease/leaseTemplateService';
import { LeaseTemplateDataMapper } from '@services/lease/leaseTemplateDataMapper';

export class LeaseController {
  private readonly log: Logger;
  private readonly leaseService: LeaseService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly leaseTemplateService: LeaseTemplateService;
  private readonly leaseTemplateDataMapper: LeaseTemplateDataMapper;

  constructor({
    leaseService,
    mediaUploadService,
  }: {
    leaseService: LeaseService;
    mediaUploadService: MediaUploadService;
  }) {
    this.log = createLogger('LeaseController');
    this.mediaUploadService = mediaUploadService;
    this.leaseService = leaseService;
    this.leaseTemplateService = new LeaseTemplateService();
    this.leaseTemplateDataMapper = new LeaseTemplateDataMapper();
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

    this.log.info('Raw query params:', req.query);

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
    };

    const result = await this.leaseService.getFilteredLeases(cuid, filterOpts, paginationOpts);
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
    const { cuid, leaseId } = req.params;
    this.log.info(`Activating lease ${leaseId} for client ${cuid}`);

    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Activate lease not yet implemented',
    });
  };

  terminateLease = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    this.log.info(`Terminating lease ${leaseId} for client ${cuid}`);

    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Terminate lease not yet implemented',
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
    // const { cuid, leaseId } = req.params;
    // const { uid } = req.context.currentuser!;
    // const { action, signers, signedBy, provider, message, testMode } = req.body;

    // this.log.info(`Handling signature action '${action}' for lease ${leaseId}`);

    // TODO: Implement signature actions based on action type
    // switch (action) {
    //   case 'send':
    //     return await this.leaseService.sendLeaseForSignature(cuid, leaseId, signers, provider, uid);
    //   case 'manual':
    //     return await this.leaseService.markAsManualySigned(cuid, leaseId, signedBy, uid);
    //   case 'cancel':
    //     return await this.leaseService.cancelSignature(cuid, leaseId, uid);
    // }

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Signature actions not yet implemented',
    });
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
    this.log.info(`Generating PDF for lease ${leaseId}, client ${cuid}`);

    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Generate PDF not yet implemented',
    });
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
    const templateData = this.leaseTemplateDataMapper.transformForTemplate(enrichedData);
    const templateType = enrichedData.templateType || 'residential-single-family';
    const html = await this.leaseTemplateService.renderLeasePreview(templateData, templateType);

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
    const templates = await this.leaseTemplateService.getAvailableTemplates();

    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        templates,
        totalCount: templates.length,
      },
    });
  };
}
