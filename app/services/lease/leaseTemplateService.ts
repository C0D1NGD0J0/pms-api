import fs from 'fs';
import ejs from 'ejs';
import path from 'path';
import { createLogger, MoneyUtils } from '@utils/index';
import { LeasePreviewData } from '@interfaces/lease.interface';

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
   * Transform and render lease template with provided preview data
   * Combines data transformation and rendering in one step
   *
   * @param previewData - Lease preview data from database
   * @param templateType - Type of template to render
   * @returns Rendered HTML string
   */
  public async transformAndRender(
    previewData: LeasePreviewData & any,
    templateType: string = 'residential-single-family'
  ): Promise<string> {
    try {
      // Transform data for template
      const templateData = this.transformForTemplate(previewData);

      // Render template
      return await this.renderLeasePreview(templateData, templateType);
    } catch (error) {
      this.log.error({ error, templateType }, 'Failed to transform and render lease template');
      throw new Error(
        `Failed to transform and render lease template: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Transform lease preview data for template rendering
   * Uses MoneyUtils for currency formatting
   */
  public transformForTemplate(previewData: LeasePreviewData & any): Record<string, any> {
    try {
      const templateData: Record<string, any> = {
        leaseNumber: previewData.leaseNumber || 'LEASE-DRAFT',
        currentDate: this.formatDate(previewData.currentDate || new Date().toISOString()),
        jurisdiction: previewData.jurisdiction || 'State/Province',
        signedDate: previewData.signedDate ? this.formatDate(previewData.signedDate) : null,

        // Landlord Information
        landlordName: previewData.landlordName || '[Landlord Name]',
        landlordAddress: previewData.landlordAddress || '[Landlord Address]',
        landlordEmail: previewData.landlordEmail || '[Landlord Email]',
        landlordPhone: previewData.landlordPhone || '[Landlord Phone]',

        // Tenant Information
        tenantName: previewData.tenantName || '[Tenant Name]',
        tenantEmail: previewData.tenantEmail || '[Tenant Email]',
        tenantPhone: previewData.tenantPhone || '[Tenant Phone]',
        coTenants: previewData.coTenants || [],

        // Property Information
        propertyAddress: previewData.propertyAddress || '[Property Address]',
        propertyName: previewData.propertyName || null,
        propertyType: previewData.propertyType || null,
        unitNumber: previewData.unitNumber || null,

        // Ownership and Management Company Info
        isExternalOwner: previewData.isExternalOwner || false,
        managementCompanyName: previewData.managementCompanyName || null,
        managementCompanyAddress: previewData.managementCompanyAddress || null,
        managementCompanyEmail: previewData.managementCompanyEmail || null,
        managementCompanyPhone: previewData.managementCompanyPhone || null,

        // Ownership Context (for template logic)
        hasUnitOwner: previewData.hasUnitOwner || false,
        isMultiUnit: previewData.isMultiUnit || false,
        ownershipType: previewData.ownershipType || 'company_owned',
        isUnitLease: !!(previewData.unitNumber && previewData.isMultiUnit),

        // Lease Terms - Use MoneyUtils.formatCurrency for consistency
        leaseType: previewData.leaseType || 'Fixed Term Residential Lease',
        startDate: this.formatDate(previewData.startDate),
        endDate: this.formatDate(previewData.endDate),
        monthlyRent: MoneyUtils.formatCurrency(previewData.monthlyRent, previewData.currency),
        securityDeposit: MoneyUtils.formatCurrency(
          previewData.securityDeposit,
          previewData.currency
        ),
        rentDueDayOrdinal: this.getOrdinalSuffix(previewData.rentDueDay || 1),

        // Additional Provisions
        petPolicy: this.transformPetPolicy(previewData.petPolicy, previewData.currency),
        renewalOptions: previewData.renewalOptions || null,
        legalTerms: previewData.legalTerms || null,
        utilitiesIncluded: this.transformArrayToString(previewData.utilitiesIncluded),

        // Signature Information
        signingMethod: previewData.signingMethod || 'manual',
        landlordSignatureUrl: previewData.landlordSignatureUrl || null,
        tenantSignatureUrl: previewData.tenantSignatureUrl || null,
        requiresNotarization: previewData.requiresNotarization || false,
      };

      this.log.info('Successfully transformed lease preview data for template');
      return templateData;
    } catch (error) {
      this.log.error({ error }, 'Failed to transform lease preview data');
      throw new Error(
        `Failed to transform data: ${error instanceof Error ? error.message : 'Unknown error'}`
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

  // ====================================================================
  // PRIVATE UTILITY METHODS
  // ====================================================================

  private formatDate(date: string | Date | undefined): string {
    if (!date) {
      return new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }

    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return '[Invalid Date]';
    }
  }

  private getOrdinalSuffix(day: number): string {
    const j = day % 10;
    const k = day % 100;

    if (j === 1 && k !== 11) {
      return `${day}st`;
    }
    if (j === 2 && k !== 12) {
      return `${day}nd`;
    }
    if (j === 3 && k !== 13) {
      return `${day}rd`;
    }
    return `${day}th`;
  }

  private transformPetPolicy(petPolicy: LeasePreviewData['petPolicy'], currency?: string): any {
    if (!petPolicy || !petPolicy.allowed) {
      return null;
    }

    return {
      allowed: true,
      maxPets: petPolicy.maxPets || 1,
      types: this.transformArrayToString(petPolicy.types) || 'Pets',
      deposit: MoneyUtils.formatCurrency(petPolicy.deposit, currency),
    };
  }

  private transformArrayToString(value: string | string[] | undefined): string | null {
    if (!value) {
      return null;
    }

    if (Array.isArray(value)) {
      return value.length > 0 ? value.join(', ') : null;
    }

    return value;
  }
}
