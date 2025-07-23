import fs from 'fs';
import path from 'path';
import { createLogger } from '@utils/index';

export interface TemplateMetadata {
  layout: {
    htmlLayout: string;
    textLayout: string;
  };
  supportsCustomMessage: boolean;
  optionalVariables: string[];
  requiredVariables: string[];
  templateType: string;
  description: string;
  displayName: string;
  htmlContent: string;
  textContent: string;
}

export interface TemplateListItem {
  templateType: string;
  displayName: string;
  description: string;
}

export class EmailTemplateService {
  private readonly log = createLogger('EmailTemplateService');
  private readonly templatesPath: string;
  private readonly layoutPath: string;

  constructor() {
    this.templatesPath = path.join(__dirname, '../../mailer/templates');
    this.layoutPath = path.join(this.templatesPath, 'shared');
  }

  /**
   * Get list of all available email templates
   */
  public async getTemplateList(): Promise<TemplateListItem[]> {
    try {
      const templates: TemplateListItem[] = [
        {
          templateType: 'invitation',
          displayName: 'Team Invitation',
          description: 'Invite users to join your organization',
        },
        {
          templateType: 'registration',
          displayName: 'Account Activation',
          description: 'Welcome new users and activate accounts',
        },
        {
          templateType: 'forgotPassword',
          displayName: 'Password Reset Request',
          description: 'Help users reset forgotten passwords',
        },
        {
          templateType: 'resetPassword',
          displayName: 'Password Reset Confirmation',
          description: 'Confirm password has been reset',
        },
        {
          templateType: 'accountUpdate',
          displayName: 'Account Update Notification',
          description: 'Notify users about account changes',
        },
      ];

      return templates;
    } catch (error) {
      this.log.error({ error }, 'Failed to get template list');
      throw error;
    }
  }

  /**
   * Get detailed template metadata for a specific template type
   */
  public async getTemplateMetadata(templateType: string): Promise<TemplateMetadata> {
    try {
      // Validate template type
      const validTemplates = await this.getTemplateList();
      const template = validTemplates.find((t) => t.templateType === templateType);

      if (!template) {
        throw new Error(`Template type '${templateType}' not found`);
      }

      // Read template files
      const htmlContent = await this.readTemplateFile(templateType, '');
      const textContent = await this.readTemplateFile(templateType, '.text');

      // Read layout files
      const htmlLayout = await this.readLayoutFile('html/layout.ejs');
      const textLayout = await this.readLayoutFile('text/layout.ejs');

      // Extract variables
      const allVariables = this.extractVariables(htmlContent, textContent);
      const { requiredVariables, optionalVariables } = this.categorizeVariables(allVariables);

      // Check if template supports custom message
      const supportsCustomMessage = this.checkCustomMessageSupport(htmlContent, textContent);

      return {
        templateType,
        displayName: template.displayName,
        description: template.description,
        htmlContent,
        textContent,
        layout: {
          htmlLayout,
          textLayout,
        },
        requiredVariables,
        optionalVariables,
        supportsCustomMessage,
      };
    } catch (error) {
      this.log.error({ error, templateType }, 'Failed to get template metadata');
      throw error;
    }
  }

  /**
   * Read template file content
   */
  private async readTemplateFile(templateType: string, suffix: string): Promise<string> {
    const templateDir = this.getTemplateDirectory(templateType);
    const filename = `${templateType}${suffix}.ejs`;
    const filePath = path.join(templateDir, filename);

    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      return content;
    } catch (error) {
      if (suffix === '.text') {
        // Text version is optional, return empty string
        return '';
      }
      throw new Error(`Template file not found: ${filePath}`);
    }
  }

  /**
   * Read layout file content
   */
  private async readLayoutFile(layoutFile: string): Promise<string> {
    const filePath = path.join(this.layoutPath, layoutFile);

    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      return content;
    } catch (error) {
      this.log.warn({ filePath }, 'Layout file not found, using empty layout');
      return '<%- content %>';
    }
  }

  /**
   * Get template directory based on template type
   */
  private getTemplateDirectory(templateType: string): string {
    const templateDirMap: Record<string, string> = {
      invitation: 'invitation',
      registration: 'registration',
      forgotPassword: 'forgotPassword',
      resetPassword: 'resetPassword',
      accountUpdate: 'accountUpdate',
    };

    const dirName = templateDirMap[templateType];
    if (!dirName) {
      throw new Error(`Unknown template type: ${templateType}`);
    }

    return path.join(this.templatesPath, dirName);
  }

  /**
   * Extract all variables from template content
   */
  private extractVariables(htmlContent: string, textContent: string): string[] {
    const variables = new Set<string>();

    // Match EJS output tags: <%= variable %>
    const ejsOutputPattern = /<%=\s*([^%\s]+)\s*%>/g;

    // Extract from HTML content
    let match;
    while ((match = ejsOutputPattern.exec(htmlContent)) !== null) {
      variables.add(match[1]);
    }

    // Extract from text content
    ejsOutputPattern.lastIndex = 0; // Reset regex
    while ((match = ejsOutputPattern.exec(textContent)) !== null) {
      variables.add(match[1]);
    }

    // Filter out common EJS expressions that aren't variables
    const excludePatterns = ['new Date(', 'Date(', 'content', 'year', 'appName'];

    return Array.from(variables).filter((variable) => {
      return !excludePatterns.some((pattern) => variable.includes(pattern));
    });
  }

  /**
   * Categorize variables into required and optional
   */
  private categorizeVariables(variables: string[]): {
    requiredVariables: string[];
    optionalVariables: string[];
  } {
    // Define which variables are typically optional
    const optionalVariableNames = ['customMessage', 'department', 'phoneNumber', 'bio', 'headline'];

    const requiredVariables: string[] = [];
    const optionalVariables: string[] = [];

    variables.forEach((variable) => {
      if (optionalVariableNames.includes(variable)) {
        optionalVariables.push(variable);
      } else {
        requiredVariables.push(variable);
      }
    });

    return {
      requiredVariables: requiredVariables.sort(),
      optionalVariables: optionalVariables.sort(),
    };
  }

  /**
   * Check if template supports custom message blocks
   */
  private checkCustomMessageSupport(htmlContent: string, textContent: string): boolean {
    const customMessagePattern = /<%\s*if\s*\(\s*customMessage\s*\)\s*{\s*%>/;

    return customMessagePattern.test(htmlContent) || customMessagePattern.test(textContent);
  }
}
