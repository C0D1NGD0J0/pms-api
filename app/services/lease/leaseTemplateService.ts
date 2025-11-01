import fs from 'fs';
import ejs from 'ejs';
import path from 'path';
import { createLogger } from '@utils/index';

export interface LeaseTemplateMetadata {
  requiredVariables: string[];
  optionalVariables: string[];
  templateType: string;
  displayName: string;
  description: string;
  category: string;
  fileName: string;
  version: string;
}

export interface LeaseTemplateConfig {
  templates: LeaseTemplateMetadata[];
}

export class LeaseTemplateService {
  private readonly log = createLogger('LeaseTemplateService');
  private readonly templatesPath: string;

  constructor() {
    this.templatesPath = path.join(__dirname, '../../templates/lease');
  }

  /**
   * Load the template configuration file
   */
  private async loadTemplateConfig(): Promise<LeaseTemplateConfig> {
    const configPath = path.join(this.templatesPath, 'template-config.json');
    const configContent = await fs.promises.readFile(configPath, 'utf8');
    return JSON.parse(configContent);
  }

  /**
   * Get metadata for a specific lease template
   */
  public async getTemplateMetadata(
    templateType: string = 'residential-single-family'
  ): Promise<LeaseTemplateMetadata> {
    try {
      const config = await this.loadTemplateConfig();
      const template = config.templates.find((t) => t.templateType === templateType);

      if (!template) {
        throw new Error(`Template type '${templateType}' not found`);
      }

      return template;
    } catch (error) {
      this.log.error({ error, templateType }, 'Failed to get template metadata');
      throw new Error(
        `Failed to get template metadata: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Render lease template with provided data and return HTML string
   *
   * @param templateData - Object containing all template variables
   * @param templateType - Type of template to render (default: 'residential-single-family')
   * @returns Rendered HTML string
   */
  public async renderLeasePreview(
    templateData: Record<string, any>,
    templateType: string = 'residential-single-family'
  ): Promise<string> {
    try {
      // Validate template type
      const metadata = await this.getTemplateMetadata(templateType);

      // Validate required variables
      this.validateRequiredVariables(templateData, metadata.requiredVariables);

      // Build template file path using fileName from metadata
      const templatePath = path.join(this.templatesPath, metadata.fileName);

      // Security: Prevent path traversal
      const resolvedTemplatePath = path.resolve(templatePath);
      const resolvedTemplatesDir = path.resolve(this.templatesPath);
      if (
        !resolvedTemplatePath.startsWith(resolvedTemplatesDir + path.sep) &&
        resolvedTemplatePath !== resolvedTemplatesDir
      ) {
        throw new Error('Invalid template path - potential path traversal detected');
      }

      // Check if template file exists
      try {
        await fs.promises.access(resolvedTemplatePath, fs.constants.R_OK);
      } catch {
        throw new Error(`Template file not found: ${metadata.fileName}`);
      }

      // Read template content
      const templateContent = await fs.promises.readFile(resolvedTemplatePath, 'utf8');

      // Render template with data
      const renderedHtml = await ejs.render(templateContent, templateData, {
        filename: resolvedTemplatePath,
        async: true,
      });

      this.log.info({ templateType }, 'Successfully rendered lease template');

      return renderedHtml;
    } catch (error) {
      this.log.error({ error, templateType }, 'Failed to render lease template');
      throw new Error(
        `Failed to render lease template: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Validate that all required variables are present in template data
   */
  private validateRequiredVariables(
    templateData: Record<string, any>,
    requiredVariables: string[]
  ): void {
    const missingVariables: string[] = [];

    requiredVariables.forEach((varName) => {
      if (
        templateData[varName] === undefined ||
        templateData[varName] === null ||
        templateData[varName] === ''
      ) {
        missingVariables.push(varName);
      }
    });

    if (missingVariables.length > 0) {
      throw new Error(`Missing required template variables: ${missingVariables.join(', ')}`);
    }
  }

  /**
   * Get list of all available lease templates
   */
  public async getAvailableTemplates(): Promise<
    Array<{
      templateType: string;
      displayName: string;
      description: string;
      category: string;
    }>
  > {
    try {
      const config = await this.loadTemplateConfig();

      return config.templates.map((template) => ({
        templateType: template.templateType,
        displayName: template.displayName,
        description: template.description,
        category: template.category,
      }));
    } catch (error) {
      this.log.error({ error }, 'Failed to get available templates');
      return [];
    }
  }
}
