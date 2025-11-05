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
    // const filters = req.query;

    this.log.info(`Getting filtered leases for client ${cuid}`);

    // TODO: Implement filtered leases retrieval
    // const result = await this.leaseService.getFilteredLeases(cuid, filters);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Get filtered leases not yet implemented',
    });
  };

  getLeaseById = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;

    this.log.info(`Getting lease ${leaseId} for client ${cuid}`);

    // TODO: Implement get lease by ID
    // const result = await this.leaseService.getLeaseById(cuid, leaseId);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Get lease by ID not yet implemented',
    });
  };

  updateLease = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    // const { uid } = req.context.currentuser!;
    // const updateData = req.body;

    this.log.info(`Updating lease ${leaseId} for client ${cuid}`);

    // TODO: Implement lease update
    // const result = await this.leaseService.updateLease(cuid, leaseId, updateData, uid);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Update lease not yet implemented',
    });
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
    // const { uid } = req.context.currentuser!;
    // const { moveInDate, signedDate, notes } = req.body;

    this.log.info(`Activating lease ${leaseId} for client ${cuid}`);

    // TODO: Implement lease activation
    // const result = await this.leaseService.activateLease(cuid, leaseId, { moveInDate, signedDate, notes }, uid);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Activate lease not yet implemented',
    });
  };

  terminateLease = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    // const { uid } = req.context.currentuser!;
    // const terminationData = req.body;

    this.log.info(`Terminating lease ${leaseId} for client ${cuid}`);

    // TODO: Implement lease termination
    // const result = await this.leaseService.terminateLease(cuid, leaseId, terminationData, uid);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Terminate lease not yet implemented',
    });
  };

  uploadLeaseDocument = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    // const { uid } = req.context.currentuser!;
    // const file = req.files?.document?.[0];

    this.log.info(`${cuid}, Uploading document for lease ${leaseId}`);

    // TODO: Implement document upload
    // const result = await this.leaseService.uploadLeaseDocument(cuid, leaseId, file, uid);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Upload lease document not yet implemented',
    });
  };

  getLeaseDocument = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;

    this.log.info(`${cuid}, Getting document for lease ${leaseId}`);

    // TODO: Implement get document
    // const result = await this.leaseService.getLeaseDocumentUrl(cuid, leaseId);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Get lease document not yet implemented',
    });
  };

  removeLeaseDocument = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    // const { uid } = req.context.currentuser!;

    this.log.info(`${cuid}, Removing document for lease ${leaseId}`);

    // TODO: Implement document removal
    // const result = await this.leaseService.removeLeaseDocument(cuid, leaseId, uid);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
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

    // TODO: Implement get signature details
    // const result = await this.leaseService.getSignatureDetails(cuid, leaseId);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Get signature details not yet implemented',
    });
  };

  generateLeasePDF = async (req: AppRequest, res: Response) => {
    const { cuid, leaseId } = req.params;
    // const { uid } = req.context.currentuser!;

    this.log.info(`${cuid}, Generating PDF for lease ${leaseId}`);

    // TODO: Implement PDF generation
    // const result = await this.leaseService.generateLeasePDF(cuid, leaseId, uid);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Generate PDF not yet implemented',
    });
  };

  downloadLeasePDF = async (req: AppRequest, res: Response) => {
    const { leaseId } = req.params;

    this.log.info(`Downloading PDF for lease ${leaseId}`);

    // TODO: Implement PDF download
    // const result = await this.leaseService.downloadLeasePDF(cuid, leaseId);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Download PDF not yet implemented',
    });
  };

  getExpiringLeases = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    // const { daysThreshold = 30 } = req.query;

    this.log.info(`Getting expiring leases for client ${cuid}`);

    // TODO: Implement get expiring leases
    // const result = await this.leaseService.getExpiringLeases(cuid, Number(daysThreshold));

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Get expiring leases not yet implemented',
    });
  };

  getLeaseStats = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    // const filters = req.query;

    this.log.info(`Getting lease statistics for client ${cuid}`);

    // TODO: Implement get lease stats
    // const result = await this.leaseService.getLeaseStats(cuid, filters);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Get lease stats not yet implemented',
    });
  };

  exportLeases = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const { format = 'csv' } = req.query;

    this.log.info(`Exporting leases for client ${cuid} as ${format}`);

    // TODO: Implement lease export
    // const result = await this.leaseService.exportLeases(cuid, format);

    res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
      success: false,
      message: 'Export leases not yet implemented',
    });
  };

  previewLease = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const previewData = req.body;
    const templateType = previewData.templateType || 'residential-single-family';

    const enrichedData = await this.leaseService.generateLeasePreview(cuid, previewData);
    const templateData = this.leaseTemplateDataMapper.transformForTemplate(enrichedData);
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
    const { cuid } = req.params;

    this.log.info(`Getting available lease templates for client ${cuid}`);

    try {
      const templates = await this.leaseTemplateService.getAvailableTemplates();

      res.status(httpStatusCodes.OK).json({
        success: true,
        data: {
          templates,
          totalCount: templates.length,
        },
      });
    } catch (error) {
      this.log.error({ error, cuid }, 'Failed to get lease templates');

      res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to get lease templates',
      });
    }
  };
}
