import { Response } from 'express';
import { EmailTemplateService } from '@services/emailTemplate';
import { ISuccessReturnData, AppRequest } from '@interfaces/utils.interface';

export class EmailTemplateController {
  private emailTemplateService: EmailTemplateService;

  constructor() {
    this.emailTemplateService = new EmailTemplateService();
  }

  /**
   * Get list of all available email templates
   * GET /api/email-templates
   */
  public async getTemplateList(req: AppRequest, res: Response): Promise<Response> {
    try {
      const templates = await this.emailTemplateService.getTemplateList();

      const response: ISuccessReturnData = {
        success: true,
        message: 'Email templates retrieved successfully',
        data: templates,
      };

      return res.status(200).json(response);
    } catch (error) {
      const response: ISuccessReturnData = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve email templates',
        data: null,
      };

      return res.status(500).json(response);
    }
  }

  /**
   * Get detailed template metadata for a specific template type
   * GET /api/email-templates/:templateType
   */
  public async getTemplateMetadata(req: AppRequest, res: Response): Promise<Response> {
    try {
      const { templateType } = req.params;

      const templateMetadata = await this.emailTemplateService.getTemplateMetadata(templateType);

      const response: ISuccessReturnData = {
        success: true,
        message: 'Template metadata retrieved successfully',
        data: templateMetadata,
      };

      return res.status(200).json(response);
    } catch (error) {
      const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 500;

      const response: ISuccessReturnData = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve template metadata',
        data: null,
      };

      return res.status(statusCode).json(response);
    }
  }
}
