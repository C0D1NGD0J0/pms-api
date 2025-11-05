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
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Create lease not yet implemented',
    });
  };

  getFilteredLeases = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Get filtered leases not yet implemented',
    });
  };

  getLeaseById = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Get lease by ID not yet implemented',
    });
  };

  updateLease = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Update lease not yet implemented',
    });
  };

  deleteLease = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Delete lease not yet implemented',
    });
  };

  activateLease = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Activate lease not yet implemented',
    });
  };

  terminateLease = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Terminate lease not yet implemented',
    });
  };

  uploadLeaseDocument = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Upload lease document not yet implemented',
    });
  };

  getLeaseDocument = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Get lease document not yet implemented',
    });
  };

  removeLeaseDocument = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Remove lease document not yet implemented',
    });
  };

  handleSignatureAction = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Signature actions not yet implemented',
    });
  };

  getSignatureDetails = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Get signature details not yet implemented',
    });
  };

  generateLeasePDF = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Generate PDF not yet implemented',
    });
  };

  previewLeaseHTML = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Preview lease HTML not yet implemented',
    });
  };

  downloadLeasePDF = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Download PDF not yet implemented',
    });
  };

  getExpiringLeases = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Get expiring leases not yet implemented',
    });
  };

  getLeaseStats = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Get lease stats not yet implemented',
    });
  };

  exportLeases = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Export leases not yet implemented',
    });
  };

  previewLease = async (req: AppRequest, res: Response) => {
    res.status(httpStatusCodes.NOT_IMPLEMENTED).json({
      success: false,
      message: 'Preview lease not yet implemented',
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
