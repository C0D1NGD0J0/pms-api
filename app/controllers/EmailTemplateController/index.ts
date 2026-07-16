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
  public getTemplateList = async (req: AppRequest, res: Response): Promise<Response> => {
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
  };

  /**
   * Get detailed template metadata for a specific template type
   * GET /api/email-templates/:templateType
   */
  public getTemplateMetadata = async (req: AppRequest, res: Response): Promise<Response> => {
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
  };

  /**
   * Render template with provided data and return fully rendered HTML
   * POST /api/email-templates/:templateType/render
   */
  public renderTemplate = async (req: AppRequest, res: Response): Promise<Response> => {
    try {
      const { templateType } = req.params;
      const templateVariables = req.body;

      const renderedHtml = await this.emailTemplateService.renderTemplate(
        templateType,
        templateVariables
      );

      const response: ISuccessReturnData = {
        success: true,
        message: 'Template rendered successfully',
        data: {
          renderedHtml,
          templateType,
        },
      };

      return res.status(200).json(response);
    } catch (error) {
      const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 500;

      const response: ISuccessReturnData = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to render template',
        data: null,
      };

      return res.status(statusCode).json(response);
    }
  };

  /**
   * Preview a template with mock data — returns rendered HTML in JSON response.
   * GET /admin/dev/email-templates/:templateType/preview
   */
  public previewTemplate = async (req: AppRequest, res: Response): Promise<Response> => {
    try {
      const { templateType } = req.params;
      const renderedHtml = await this.emailTemplateService.renderPreview(templateType);

      const response: ISuccessReturnData = {
        success: true,
        message: 'Template preview rendered successfully',
        data: {
          renderedHtml,
          templateType,
        },
      };

      return res.status(200).json(response);
    } catch (error) {
      const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 500;

      const response: ISuccessReturnData = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to preview template',
        data: null,
      };

      return res.status(statusCode).json(response);
    }
  };
}
