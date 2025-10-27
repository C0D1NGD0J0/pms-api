import ejs from 'ejs';
import Logger from 'bunyan';
import nodemailer from 'nodemailer';
import Mail from 'nodemailer/lib/mailer';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { MailType } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';

interface MailOptions extends Mail.Options {
  data: EmailTemplateData;
}

interface EmailTemplate {
  html: string;
  text: string;
}

interface EmailTemplateData {
  [key: string]: any;
}

export class MailService {
  private readonly transporter: nodemailer.Transporter;
  private readonly log: Logger;
  private readonly templateCache: Map<string, EmailTemplate> = new Map();

  constructor() {
    this.log = createLogger('MailerService');
    this.transporter = this.buildMailTransporter();
  }

  /**
   * Send an email with a specific template
   * @param data Mail data including recipient
   * @param mailType Type of email to send
   * @returns Promise resolving when email is sent
   */
  async sendMail(data: MailOptions, mailType: MailType): Promise<void> {
    try {
      const { html, text } = await this.getEmailTemplate(data.data, mailType);

      const mailOptions: Mail.Options = {
        from: envVariables.EMAIL.APP_EMAIL_ADDRESS,
        to: data.to,
        subject: data.subject || this.getDefaultSubject(mailType),
        html: await this.renderLayoutTemplate(html, {
          appName: envVariables.APP_NAME,
          year: new Date().getFullYear(),
        }),
        text: await this.renderLayoutTemplate(text, {
          appName: envVariables.APP_NAME,
          year: new Date().getFullYear(),
        }),
      };

      await this.transporter.sendMail(mailOptions);
      this.log.info(`Email sent: ${mailType} mail.`);
    } catch (error) {
      this.log.error(
        {
          error,
          mailType,
          recipient: data.to,
        },
        'Failed to send email'
      );
      throw error;
    }
  }

  /**
   * Retrieve email template with caching
   * @param emailData Template data
   * @param type Mail type
   * @returns Rendered email template
   */
  private async getEmailTemplate(
    emailData: EmailTemplateData,
    type: MailType
  ): Promise<EmailTemplate> {
    emailData = {
      ...emailData,
      year: new Date().getFullYear(),
    };

    let template: EmailTemplate;

    switch (type) {
      case MailType.INVITATION_REMINDER:
        template = await this.buildTemplate('reminder', emailData, 'invitation');
        break;
      case MailType.ACCOUNT_ACTIVATION:
        template = await this.buildTemplate('registration', emailData);
        break;
      case MailType.FORGOT_PASSWORD:
        template = await this.buildTemplate('forgotPassword', emailData);
        break;
      case MailType.PASSWORD_RESET:
        template = await this.buildTemplate('resetPassword', emailData);
        break;
      case MailType.ACCOUNT_UPDATE:
        template = await this.buildTemplate('accountUpdate', emailData);
        break;
      case MailType.USER_CREATED:
        template = await this.buildTemplate('userCreated', emailData);
        break;
      case MailType.INVITATION: {
        // Select template based on user role
        const role = emailData.role;
        let templateName = 'invitation'; // fallback to generic template

        if (role === ROLES.VENDOR) {
          templateName = 'invitation-vendor';
        } else if (role === ROLES.TENANT) {
          templateName = 'invitation-tenant';
        } else {
          templateName = 'invitation-staff';
        }

        template = await this.buildTemplate(templateName, emailData, 'invitation');
        break;
      }
      default:
        throw new Error(`Unsupported mail type: ${type}`);
    }

    return template;
  }

  /**
   * Build email template from EJS files
   * @param filename Base filename for template
   * @param data Template data
   * @param subdir Optional subdirectory for template
   * @returns Rendered email template
   */
  private async buildTemplate(
    filename: string,
    data: EmailTemplateData,
    subdir?: string
  ): Promise<EmailTemplate> {
    const templateData = {
      ...data,
      ROLES,
    };
    const basePath = subdir ? `${subdir}` : filename;
    const templatePath = (type: string) => `${basePath}/${filename}${type}.ejs`;

    const renderSafely = async (path: string): Promise<string> => {
      try {
        return await this.renderTemplateFile(path, templateData);
      } catch (err) {
        this.log.debug(`Template not found: ${path}`);
        return '';
      }
    };

    try {
      const [html, text] = await Promise.all([
        renderSafely(templatePath('')),
        renderSafely(templatePath('.text')),
      ]);

      if (!html && !text) {
        this.log.warn({ filename }, 'No templates found for this email type');
      }

      return { html, text };
    } catch (error) {
      this.log.error({ error, filename }, 'Unexpected error building email template');
      return { html: '', text: '' };
    }
  }

  /**
   * Render a template file with EJS
   * @param relativePath Path to template file
   * @param data Template data
   * @returns Rendered template
   */
  private async renderTemplateFile(relativePath: string, data: EmailTemplateData): Promise<string> {
    const fullPath = `${__dirname}/templates/${relativePath}`;
    return ejs.renderFile(fullPath, data);
  }

  /**
   * Render layout template
   * @param content Main template content
   * @param layoutData Layout data
   * @returns Fully rendered template
   */
  private async renderLayoutTemplate(
    content: string,
    layoutData: Record<string, any>
  ): Promise<string> {
    return ejs.renderFile(`${__dirname}/templates/shared/html/layout.ejs`, {
      ...layoutData,
      content,
    });
  }

  /**
   * Get default subject based on mail type
   * @param mailType Type of email
   * @returns Default subject line
   */
  private getDefaultSubject(mailType: MailType): string {
    const defaultText = 'Notification from Property Management System';

    const subjectMap: Record<MailType | 'default', string> = {
      [MailType.ACCOUNT_ACTIVATION]: 'Activate Your Account',
      [MailType.FORGOT_PASSWORD]: 'Reset Your Password',
      [MailType.INVITATION]: "You've Been Invited to Join Our Team",
      [MailType.INVITATION_REMINDER]: 'Reminder: Your Invitation is Still Active',
      [MailType.USER_CREATED]: 'Your Account Has Been Created',
      default: defaultText,
      [MailType.SUBSCRIPTION_UPDATE]: defaultText,
      [MailType.SUBSCRIPTION_CANCEL]: defaultText,
      [MailType.USER_REGISTRATION]: defaultText,
      [MailType.PASSWORD_RESET]: 'Password Reset Request',
      [MailType.ACCOUNT_UPDATE]: 'Account recently updated.',
      [MailType.LEASE_APPLICATION_UPDATE]: 'Lease Application Update',
      [MailType.LEASE_SIGNOFF_REQUEST]: 'Lease Sign-off Request',
    };

    return subjectMap[mailType] || subjectMap.default;
  }

  /**
   * Build mail transporter based on environment
   * @returns Nodemailer transporter
   */
  private buildMailTransporter(): nodemailer.Transporter {
    return nodemailer.createTransport(this.getEnvironmentTransportOptions());
  }

  private getEnvironmentTransportOptions() {
    const isProduction = envVariables.SERVER.ENV === 'production';
    if (isProduction) {
      return {
        service: envVariables.EMAIL.PROD.PROVIDER,
        host: envVariables.EMAIL.PROD.PROVIDER_HOST,
        port: envVariables.EMAIL.PROD.PROVIDER_PORT,
        secure: true,
        auth: {
          user: envVariables.EMAIL.PROD.PROVIDER_USERNAME,
          pass: envVariables.EMAIL.PROD.PROVIDER_PASSWORD,
        },
      };
    } else {
      return {
        host: envVariables.EMAIL.DEV.PROVIDER_HOST,
        port: envVariables.EMAIL.DEV.PROVIDER_PORT,
        auth: {
          user: envVariables.EMAIL.DEV.PROVIDER_USERNAME,
          pass: envVariables.EMAIL.DEV.PROVIDER_PASSWORD,
        },
      };
    }
  }
}
