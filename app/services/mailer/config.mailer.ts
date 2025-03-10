import fs from 'fs';
import ejs from 'ejs';
import Logger from 'bunyan';
import { promisify } from 'util';
import nodemailer from 'nodemailer';
import Mail from 'nodemailer/lib/mailer';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { MailType } from '@interfaces/utils.interface';

// Promisify filesystem methods
const readFileAsync = promisify(fs.readFile);

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
        to: options.to,
        subject: options.subject || this.getDefaultSubject(mailType),
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
          recipient: options.to,
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
      default:
        throw new Error(`Unsupported mail type: ${type}`);
    }

    return template;
  }

  /**
   * Build email template from EJS files
   * @param filename Base filename for template
   * @param data Template data
   * @returns Rendered email template
   */
  private async buildTemplate(filename: string, data: EmailTemplateData): Promise<EmailTemplate> {
    try {
      const [htmlTemplate, textTemplate] = await Promise.all([
        this.renderTemplateFile(`${filename}/${filename}.ejs`, data),
        this.renderTemplateFile(`${filename}/${filename}.text.ejs`, data),
      ]);

      return {
        html: htmlTemplate,
        text: textTemplate,
      };
    } catch (error) {
      this.log.error(
        {
          error,
          filename,
        },
        'Failed to build email template'
      );
      throw error;
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
      default: defaultText,
      [MailType.SUBSCRIPTION_UPDATE]: defaultText,
      [MailType.SUBSCRIPTION_CANCEL]: defaultText,
      [MailType.USER_REGISTRATION]: defaultText,
      [MailType.PASSWORD_RESET]: 'Password Reset Request',
      [MailType.ACCOUNT_UPDATE]: 'Account recently updated.',
    };

    return subjectMap[mailType] || subjectMap.default;
  }

  /**
   * Build mail transporter based on environment
   * @returns Nodemailer transporter
   */
  private buildMailTransporter(): nodemailer.Transporter {
    const isProduction = envVariables.SERVER.ENV === 'production';

    const transportOptions = isProduction
      ? this.getGmailTransportOptions()
      : this.getMailtrapTransportOptions();

    return nodemailer.createTransport(transportOptions);
  }

  /**
   * Gmail transport options for production
   */
  private getGmailTransportOptions() {
    return {
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        type: 'login',
        user: envVariables.EMAIL.GMAIL.USERNAME,
        pass: envVariables.EMAIL.GMAIL.PASSWORD,
      },
    };
  }

  /**
   * Mailtrap transport options for development
   */
  private getMailtrapTransportOptions() {
    return {
      host: 'smtp.mailtrap.io',
      port: envVariables.EMAIL.PROVIDER_PORT,
      auth: {
        user: envVariables.EMAIL.MAILTRAP.SMTP_USERNAME,
        pass: envVariables.EMAIL.MAILTRAP.SMTP_PASSWORD,
      },
    };
  }
}
