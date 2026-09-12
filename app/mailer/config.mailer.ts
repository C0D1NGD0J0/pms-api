import ejs from 'ejs';
import Logger from 'bunyan';
import { Resend } from 'resend';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { MailType } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';
import nodemailer, { SendMailOptions, Transporter } from 'nodemailer';

export interface HeroConfig {
  subtitle?: string;
  title: string;
  icon: string;
}

interface MailOptions extends SendMailOptions {
  data: EmailTemplateData;
}

interface EmailTemplate {
  html: string;
  text: string;
}

interface EmailTemplateData {
  [key: string]: any;
}

export const TEMPLATE_HERO_CONFIG: Record<string, HeroConfig> = {
  // Account / Auth
  [MailType.ACCOUNT_ACTIVATION]: {
    icon: '&#x1F6E1;',
    title: 'Activate Your Account',
    subtitle: "You're one step away from getting started",
  },
  [MailType.FORGOT_PASSWORD]: {
    icon: '&#x1F6E1;',
    title: 'Reset Your Password',
    subtitle: 'Secure your account',
  },
  [MailType.PASSWORD_RESET]: {
    icon: '&#x1F6E1;',
    title: 'Password Updated',
    subtitle: 'Your password has been changed',
  },
  [MailType.USER_CREATED]: {
    icon: '&#x1F6E1;',
    title: 'Welcome to PropertyDesk',
    subtitle: 'Your account is ready',
  },
  [MailType.ACCOUNT_UPDATE]: {
    icon: '&#x1F6E1;',
    title: 'Account Updated',
    subtitle: 'Changes to your account',
  },
  [MailType.ACCOUNT_DISCONNECTED]: {
    icon: '&#x1F6E1;',
    title: 'Account Disconnected',
    subtitle: 'Your connection has been removed',
  },

  // Invitation
  [MailType.INVITATION]: {
    icon: '&#x2709;',
    title: "You've Been Invited!",
    subtitle: 'Join your team on PropertyDesk',
  },
  [MailType.INVITATION_REMINDER]: {
    icon: '&#x2709;',
    title: 'Invitation Reminder',
    subtitle: 'Your invitation is still active',
  },

  // Lease
  [MailType.LEASE_ACTIVATED]: {
    icon: '&#x1F511;',
    title: 'Lease Activated',
    subtitle: 'Your lease is now active',
  },
  [MailType.LEASE_ADMIN_UPDATED]: {
    icon: '&#x1F511;',
    title: 'Lease Updated',
    subtitle: 'Changes to your lease',
  },
  [MailType.LEASE_ENDING_SOON]: {
    icon: '&#x1F511;',
    title: 'Lease Ending Soon',
    subtitle: 'Action required before your lease expires',
  },
  [MailType.LEASE_TERMINATED]: {
    icon: '&#x1F511;',
    title: 'Lease Terminated',
    subtitle: 'Your lease has been ended',
  },
  [MailType.LEASE_EXPIRED]: {
    icon: '&#x1F511;',
    title: 'Lease Expired',
    subtitle: 'Your lease has reached its end date',
  },
  [MailType.LEASE_PAYMENT_REMINDER]: {
    icon: '&#x1F511;',
    title: 'Payment Reminder',
    subtitle: 'Your rent payment is due',
  },

  // Payment
  [MailType.PAYMENT_REQUEST_CREATED]: {
    icon: '&#x1F4B3;',
    title: 'Payment Request',
    subtitle: 'A new payment has been requested',
  },
  [MailType.PAYMENT_RECEIPT]: {
    icon: '&#x1F4B3;',
    title: 'Payment Receipt',
    subtitle: 'Transaction confirmed',
  },
  [MailType.PAYMENT_FAILED]: {
    icon: '&#x1F4B3;',
    title: 'Payment Failed',
    subtitle: 'Your payment could not be processed',
  },
  [MailType.PAD_MANDATE_CONFIRMATION]: {
    icon: '&#x1F4B3;',
    title: 'PAD Agreement Confirmed',
    subtitle: 'Pre-authorized debit setup complete',
  },
  [MailType.PAD_PRE_DEBIT_NOTIFICATION]: {
    icon: '&#x1F4B3;',
    title: 'Upcoming Debit',
    subtitle: 'Pre-authorized debit notification',
  },

  // Maintenance
  [MailType.MAINTENANCE_REQUEST_CREATED]: {
    icon: '&#x1F527;',
    title: 'Request Submitted',
    subtitle: 'Maintenance request received',
  },
  [MailType.MAINTENANCE_REQUEST_ASSIGNED]: {
    icon: '&#x1F527;',
    title: 'Request Assigned',
    subtitle: 'A vendor has been assigned',
  },
  [MailType.MAINTENANCE_REQUEST_ACCEPTED]: {
    icon: '&#x1F527;',
    title: 'Request Accepted',
    subtitle: 'Your request is being handled',
  },
  [MailType.MAINTENANCE_REQUEST_DECLINED]: {
    icon: '&#x1F527;',
    title: 'Assignment Declined',
    subtitle: 'Vendor declined the assignment',
  },
  [MailType.MAINTENANCE_REQUEST_COMPLETED]: {
    icon: '&#x1F527;',
    title: 'Request Completed',
    subtitle: 'Maintenance work is done',
  },
  [MailType.MAINTENANCE_CHARGE_CREATED]: {
    icon: '&#x1F527;',
    title: 'Maintenance Charge',
    subtitle: 'A charge has been added to your account',
  },
  [MailType.MAINTENANCE_INVOICE_SUBMITTED]: {
    icon: '&#x1F527;',
    title: 'Invoice Submitted',
    subtitle: 'Review required',
  },
  [MailType.MAINTENANCE_INVOICE_APPROVED]: {
    icon: '&#x1F527;',
    title: 'Invoice Approved',
    subtitle: 'Payment will be processed',
  },
  [MailType.MAINTENANCE_INVOICE_REJECTED]: {
    icon: '&#x1F527;',
    title: 'Invoice Rejected',
    subtitle: 'Revision required',
  },
  [MailType.MAINTENANCE_VENDOR_PAID]: {
    icon: '&#x1F527;',
    title: 'Payout Initiated',
    subtitle: 'Payment for your service',
  },
  [MailType.MAINTENANCE_WORK_ORDER_SUBMITTED]: {
    icon: '&#x1F527;',
    title: 'Work Order Submitted',
    subtitle: 'Review required',
  },
  [MailType.MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT]: {
    icon: '&#x1F527;',
    title: 'Work Order Submitted',
    subtitle: 'For your maintenance request',
  },
  [MailType.MAINTENANCE_WORK_ORDER_APPROVED]: {
    icon: '&#x1F527;',
    title: 'Work Order Approved',
    subtitle: 'Proceed with the job',
  },
  [MailType.MAINTENANCE_WORK_ORDER_REJECTED]: {
    icon: '&#x1F527;',
    title: 'Work Order Rejected',
    subtitle: 'Revision required',
  },

  // Inspection
  [MailType.INSPECTION_SCHEDULED]: {
    icon: '&#x1F4CB;',
    title: 'Inspection Scheduled',
    subtitle: 'A property inspection has been planned',
  },
  [MailType.INSPECTION_SUBMITTED]: {
    icon: '&#x1F4CB;',
    title: 'Inspection Submitted',
    subtitle: 'Report ready for review',
  },
  [MailType.INSPECTION_APPROVED]: {
    icon: '&#x1F4CB;',
    title: 'Inspection Approved',
    subtitle: 'Report has been accepted',
  },
  [MailType.INSPECTION_REJECTED]: {
    icon: '&#x1F4CB;',
    title: 'Inspection Rejected',
    subtitle: 'Action required',
  },
  [MailType.INSPECTION_CANCELLED]: {
    icon: '&#x1F4CB;',
    title: 'Inspection Cancelled',
    subtitle: 'The inspection has been cancelled',
  },

  // Subscription
  [MailType.SUBSCRIPTION_RENEWAL_UPCOMING]: {
    icon: '&#x2B50;',
    title: 'Renewal Upcoming',
    subtitle: 'Your subscription is renewing soon',
  },
  [MailType.SUBSCRIPTION_RENEWAL_RECEIPT]: {
    icon: '&#x2B50;',
    title: 'Renewal Receipt',
    subtitle: 'Subscription renewed successfully',
  },
  [MailType.COMPANY_CLOSURE_OWNER]: {
    icon: '&#x2B50;',
    title: 'Account Closure',
    subtitle: 'Your account has been closed',
  },
  [MailType.COMPANY_CLOSURE_STAFF]: {
    icon: '&#x2B50;',
    title: 'Account Closure Notice',
    subtitle: 'An account you belong to has been closed',
  },
  [MailType.COMPANY_CLOSURE_TENANT]: {
    icon: '&#x2B50;',
    title: 'Account Closure Notice',
    subtitle: 'An account you belong to has been closed',
  },
  [MailType.COMPANY_CLOSURE_VENDOR]: {
    icon: '&#x2B50;',
    title: 'Service Disconnection',
    subtitle: 'A service connection has been removed',
  },

  // Guest Pass
  [MailType.GUEST_PASS_CODE]: {
    icon: '&#x1F3AB;',
    title: 'Visitor Access Code',
    subtitle: 'Your guest pass is ready',
  },

  // Report
  [MailType.REPORT_READY]: {
    icon: '&#x1F4CA;',
    title: 'Report Ready',
    subtitle: 'Your property report is available',
  },
};

export class MailService {
  private readonly transporter: Transporter;
  private readonly resendClient: Resend;
  private readonly log: Logger;
  private readonly templateCache: Map<string, EmailTemplate> = new Map();

  constructor() {
    this.log = createLogger('MailerService');
    this.transporter = this.buildMailTransporter();
    this.resendClient = new Resend(envVariables.EMAIL.PROD.PROVIDER_PASSWORD);
  }

  async sendMail(data: MailOptions, mailType: MailType): Promise<void> {
    try {
      const { html, text } = await this.getEmailTemplate(data.data, mailType);
      const frontendUrl = envVariables.FRONTEND?.URL || '';
      const preferencesUrl = frontendUrl ? `${frontendUrl}/profile/settings` : '';
      const heroConfig = TEMPLATE_HERO_CONFIG[mailType] || { icon: '&#x1F3E0;', title: '' };
      const layoutData = {
        appName: envVariables.APP_NAME,
        year: new Date().getFullYear(),
        preferencesUrl,
        icon: heroConfig.icon,
        title: heroConfig.title,
        subtitle: heroConfig.subtitle || '',
      };
      const renderedHtml = await this.renderLayoutTemplate(html, layoutData);
      const renderedText = await this.renderLayoutTemplate(text, layoutData);

      if (envVariables.SERVER.ENV === 'production') {
        const unsubscribeHeader = preferencesUrl
          ? `<${preferencesUrl}>, <mailto:${envVariables.EMAIL.APP_EMAIL_ADDRESS}?subject=unsubscribe>`
          : undefined;

        const { error } = await this.resendClient.emails.send({
          from: envVariables.EMAIL.APP_EMAIL_ADDRESS,
          to: data.to as string | string[],
          subject: data.subject || this.getDefaultSubject(mailType),
          html: renderedHtml,
          text: renderedText || undefined,
          headers: unsubscribeHeader
            ? {
                'List-Unsubscribe': unsubscribeHeader,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              }
            : undefined,
        });

        if (error) {
          throw new Error(`Resend API error: ${error.message}`);
        }
      } else {
        await this.transporter.sendMail({
          from: envVariables.EMAIL.APP_EMAIL_ADDRESS,
          to: data.to,
          subject: data.subject || this.getDefaultSubject(mailType),
          html: renderedHtml,
          text: renderedText,
          ...(preferencesUrl
            ? {
                headers: {
                  'List-Unsubscribe': `<${preferencesUrl}>, <mailto:${envVariables.EMAIL.APP_EMAIL_ADDRESS}?subject=unsubscribe>`,
                  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                },
              }
            : {}),
        });
      }

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
      case MailType.MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT:
        template = await this.buildTemplate(
          'maintenance-work-order-submitted-tenant',
          emailData,
          'maintenance'
        );
        break;
      case MailType.MAINTENANCE_WORK_ORDER_SUBMITTED:
        template = await this.buildTemplate(
          'maintenance-work-order-submitted',
          emailData,
          'maintenance'
        );
        break;
      case MailType.MAINTENANCE_WORK_ORDER_APPROVED:
        template = await this.buildTemplate(
          'maintenance-work-order-approved',
          emailData,
          'maintenance'
        );
        break;
      case MailType.MAINTENANCE_WORK_ORDER_REJECTED:
        template = await this.buildTemplate(
          'maintenance-work-order-rejected',
          emailData,
          'maintenance'
        );
        break;
      case MailType.MAINTENANCE_INVOICE_SUBMITTED:
        template = await this.buildTemplate(
          'maintenance-invoice-submitted',
          emailData,
          'maintenance'
        );
        break;
      case MailType.MAINTENANCE_REQUEST_COMPLETED:
        template = await this.buildTemplate(
          'maintenance-request-completed',
          emailData,
          'maintenance'
        );
        break;
      case MailType.SUBSCRIPTION_RENEWAL_UPCOMING:
        template = await this.buildTemplate('subscription-renewal', emailData, 'subscription');
        break;
      case MailType.SUBSCRIPTION_RENEWAL_RECEIPT:
        template = await this.buildTemplate(
          'subscription-renewal-receipt',
          emailData,
          'subscription'
        );
        break;
      case MailType.MAINTENANCE_REQUEST_ASSIGNED:
        template = await this.buildTemplate(
          'maintenance-request-assigned',
          emailData,
          'maintenance'
        );
        break;
      case MailType.MAINTENANCE_REQUEST_DECLINED:
        template = await this.buildTemplate(
          'maintenance-request-declined',
          emailData,
          'maintenance'
        );
        break;
      case MailType.MAINTENANCE_INVOICE_APPROVED:
        template = await this.buildTemplate(
          'maintenance-invoice-approved',
          emailData,
          'maintenance'
        );
        break;
      case MailType.MAINTENANCE_INVOICE_REJECTED:
        template = await this.buildTemplate(
          'maintenance-invoice-rejected',
          emailData,
          'maintenance'
        );
        break;
      case MailType.MAINTENANCE_REQUEST_ACCEPTED:
        template = await this.buildTemplate(
          'maintenance-request-accepted',
          emailData,
          'maintenance'
        );
        break;
      case MailType.MAINTENANCE_REQUEST_CREATED:
        template = await this.buildTemplate(
          'maintenance-request-created',
          emailData,
          'maintenance'
        );
        break;
      case MailType.MAINTENANCE_CHARGE_CREATED:
        template = await this.buildTemplate('maintenance-charge-created', emailData, 'maintenance');
        break;
      case MailType.PAD_PRE_DEBIT_NOTIFICATION:
        template = await this.buildTemplate('pad-pre-debit-notification', emailData, 'payment');
        break;
      case MailType.PAD_MANDATE_CONFIRMATION:
        template = await this.buildTemplate('pad-mandate-confirmation', emailData, 'payment');
        break;
      case MailType.MAINTENANCE_VENDOR_PAID:
        template = await this.buildTemplate('maintenance-vendor-paid', emailData, 'maintenance');
        break;
      case MailType.PAYMENT_REQUEST_CREATED:
        template = await this.buildTemplate('payment-request', emailData, 'payment');
        break;
      case MailType.COMPANY_CLOSURE_VENDOR:
        template = await this.buildTemplate('company-closure-vendor', emailData, 'subscription');
        break;
      case MailType.LEASE_PAYMENT_REMINDER:
        template = await this.buildTemplate('payment-reminder', emailData, 'lease');
        break;
      case MailType.COMPANY_CLOSURE_TENANT:
        template = await this.buildTemplate('company-closure-tenant', emailData, 'subscription');
        break;
      case MailType.COMPANY_CLOSURE_STAFF:
        template = await this.buildTemplate('company-closure-staff', emailData, 'subscription');
        break;
      case MailType.COMPANY_CLOSURE_OWNER:
        template = await this.buildTemplate('company-closure-owner', emailData, 'subscription');
        break;
      case MailType.ACCOUNT_DISCONNECTED:
        template = await this.buildTemplate(
          'accountDisconnected',
          emailData,
          'accountDisconnected'
        );
        break;
      case MailType.INSPECTION_SCHEDULED:
        template = await this.buildTemplate('inspection-scheduled', emailData, 'inspection');
        break;
      case MailType.INSPECTION_SUBMITTED:
        template = await this.buildTemplate('inspection-submitted', emailData, 'inspection');
        break;
      case MailType.INSPECTION_CANCELLED:
        template = await this.buildTemplate('inspection-cancelled', emailData, 'inspection');
        break;
      case MailType.INVITATION_REMINDER:
        template = await this.buildTemplate('reminder', emailData, 'invitation');
        break;
      case MailType.LEASE_ADMIN_UPDATED:
        template = await this.buildTemplate('lease-admin-updated', emailData, 'lease');
        break;
      case MailType.INSPECTION_APPROVED:
        template = await this.buildTemplate('inspection-approved', emailData, 'inspection');
        break;
      case MailType.INSPECTION_REJECTED:
        template = await this.buildTemplate('inspection-rejected', emailData, 'inspection');
        break;
      case MailType.ACCOUNT_ACTIVATION:
        template = await this.buildTemplate('registration', emailData);
        break;
      case MailType.LEASE_ENDING_SOON:
        template = await this.buildTemplate('lease-ending-soon', emailData, 'lease');
        break;
      case MailType.LEASE_TERMINATED:
        template = await this.buildTemplate('lease-terminated', emailData, 'lease');
        break;
      case MailType.PAYMENT_RECEIPT:
        template = await this.buildTemplate('payment-receipt', emailData, 'payment');
        break;
      case MailType.FORGOT_PASSWORD:
        template = await this.buildTemplate('forgotPassword', emailData);
        break;
      case MailType.LEASE_ACTIVATED:
        template = await this.buildTemplate('lease-activated', emailData, 'lease');
        break;
      case MailType.GUEST_PASS_CODE:
        template = await this.buildTemplate('guest-pass-code', emailData, 'guestPass');
        break;
      case MailType.PAYMENT_FAILED:
        template = await this.buildTemplate('payment-failed', emailData, 'payment');
        break;
      case MailType.PASSWORD_RESET:
        template = await this.buildTemplate('resetPassword', emailData);
        break;
      case MailType.ACCOUNT_UPDATE:
        template = await this.buildTemplate('accountUpdate', emailData);
        break;
      case MailType.LEASE_EXPIRED:
        template = await this.buildTemplate('lease-expired', emailData, 'lease');
        break;
      case MailType.USER_CREATED:
        template = await this.buildTemplate('userCreated', emailData);
        break;
      case MailType.REPORT_READY:
        template = await this.buildTemplate('report-ready', emailData, 'report');
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
      } catch (err: any) {
        // Distinguish between missing template (expected for .text variants) and render errors (bugs)
        if (err.code === 'ENOENT') {
          this.log.debug(`Template file not found (optional): ${path}`);
        } else {
          this.log.error(
            { error: err.message, path, dataKeys: Object.keys(templateData) },
            `Email template render failed: ${path}`
          );
        }
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

  private async renderTemplateFile(relativePath: string, data: EmailTemplateData): Promise<string> {
    const fullPath = `${__dirname}/templates/${relativePath}`;
    return ejs.renderFile(fullPath, data);
  }

  private async renderLayoutTemplate(
    content: string,
    layoutData: Record<string, any>
  ): Promise<string> {
    return ejs.renderFile(`${__dirname}/templates/shared/html/layout.ejs`, {
      ...layoutData,
      content,
    });
  }

  private getDefaultSubject(mailType: MailType): string {
    const defaultText = 'Notification from PropertyDesk';

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
      [MailType.LEASE_ACTIVATED]: 'Your Lease is Now Active!',
      [MailType.LEASE_TERMINATED]: 'Lease Termination Notice',
      [MailType.LEASE_EXPIRED]: 'Your Lease Has Expired',
      [MailType.PAYMENT_REQUEST_CREATED]: 'New Payment Request',
      [MailType.LEASE_PAYMENT_REMINDER]: 'Rent Payment Reminder',
      [MailType.LEASE_ADMIN_UPDATED]: 'Your Lease Has Been Updated',
      [MailType.LEASE_ENDING_SOON]: 'Your Lease is Ending Soon',
      [MailType.ACCOUNT_DISCONNECTED]: 'Your Account Connection Has Been Removed',
      [MailType.MAINTENANCE_REQUEST_CREATED]: 'Maintenance Request Submitted',
      [MailType.MAINTENANCE_REQUEST_ASSIGNED]: 'Maintenance Request Assigned',
      [MailType.MAINTENANCE_REQUEST_DECLINED]: 'Maintenance Request Assignment Declined',
      [MailType.MAINTENANCE_CHARGE_CREATED]: 'Maintenance Charge Added to Your Account',
      [MailType.MAINTENANCE_INVOICE_SUBMITTED]: 'Invoice Submitted for Review',
      [MailType.MAINTENANCE_INVOICE_APPROVED]: 'Invoice Approved',
      [MailType.MAINTENANCE_INVOICE_REJECTED]: 'Invoice Rejected',
      [MailType.MAINTENANCE_VENDOR_PAID]: 'Payout Initiated for Your Service',
      [MailType.MAINTENANCE_WORK_ORDER_SUBMITTED]: 'Work Order Submitted — Review Required',
      [MailType.MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT]: 'Work Order Submitted for Your Request',
      [MailType.MAINTENANCE_WORK_ORDER_APPROVED]: 'Work Order Approved — Proceed with Job',
      [MailType.MAINTENANCE_WORK_ORDER_REJECTED]: 'Work Order Rejected — Revision Required',
      [MailType.MAINTENANCE_REQUEST_ACCEPTED]: 'Your Maintenance Request is Being Handled',
      [MailType.MAINTENANCE_REQUEST_COMPLETED]: 'Your Maintenance Request Has Been Completed',
      [MailType.PAYMENT_RECEIPT]: 'Payment Receipt',
      [MailType.PAYMENT_FAILED]: 'Payment Could Not Be Processed',
      [MailType.PAD_MANDATE_CONFIRMATION]: 'Pre-Authorized Debit Agreement Confirmation',
      [MailType.PAD_PRE_DEBIT_NOTIFICATION]: 'Upcoming Pre-Authorized Debit Notification',
      [MailType.SUBSCRIPTION_RENEWAL_RECEIPT]: 'Subscription Renewal Receipt',
      [MailType.SUBSCRIPTION_RENEWAL_UPCOMING]: 'Upcoming Subscription Renewal',
      [MailType.GUEST_PASS_CODE]: 'Your Visitor Access Code',
      [MailType.INSPECTION_SCHEDULED]: 'Inspection Scheduled',
      [MailType.INSPECTION_SUBMITTED]: 'Inspection Report Submitted',
      [MailType.INSPECTION_APPROVED]: 'Inspection Approved',
      [MailType.INSPECTION_REJECTED]: 'Inspection Report — Action Required',
      [MailType.INSPECTION_CANCELLED]: 'Inspection Cancelled',
      [MailType.COMPANY_CLOSURE_STAFF]: 'Account Closure Notice',
      [MailType.COMPANY_CLOSURE_VENDOR]: 'Service Disconnection Notice',
      [MailType.COMPANY_CLOSURE_TENANT]: 'Account Closure Notice',
      [MailType.COMPANY_CLOSURE_OWNER]: 'Account Closure Confirmation',
      [MailType.REPORT_READY]: 'Your Property Report is Ready',
    };

    return subjectMap[mailType] || subjectMap.default;
  }

  /**
   * Build mail transporter based on environment
   * @returns Nodemailer transporter
   */
  private buildMailTransporter(): Transporter {
    return nodemailer.createTransport(this.getEnvironmentTransportOptions());
  }

  private getEnvironmentTransportOptions() {
    const isProduction = envVariables.SERVER.ENV === 'production';
    // Timeouts prevent nodemailer from hanging indefinitely when SMTP is unreachable
    const timeouts = {
      connectionTimeout: 10000, // 10s to establish connection
      greetingTimeout: 10000, // 10s for SMTP greeting
      socketTimeout: 30000, // 30s for socket inactivity
    };

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
        ...timeouts,
      };
    } else {
      return {
        host: envVariables.EMAIL.DEV.PROVIDER_HOST,
        port: envVariables.EMAIL.DEV.PROVIDER_PORT,
        auth: {
          user: envVariables.EMAIL.DEV.PROVIDER_USERNAME,
          pass: envVariables.EMAIL.DEV.PROVIDER_PASSWORD,
        },
        ...timeouts,
      };
    }
  }
}
