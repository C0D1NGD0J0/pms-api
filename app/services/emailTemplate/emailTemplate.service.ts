import fs from 'fs';
import ejs from 'ejs';
import path from 'path';
import { createLogger } from '@utils/index';
import { ROLES } from '@shared/constants/roles.constants';

import { getMockTemplateData } from './mockTemplateData';

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
  category?: string;
}

interface TemplateRegistryEntry {
  displayName: string;
  description: string;
  filename: string;
  category: string;
  subdir: string;
}

/**
 * Maps every previewable template key to its subdirectory, filename, and metadata.
 * Keys match MailType enum values for new templates,
 * plus legacy keys for backward compatibility with existing routes.
 */
const TEMPLATE_REGISTRY: Record<string, TemplateRegistryEntry> = {
  // ── Account ──────────────────────────────────────────────────
  ACCOUNT_ACTIVATION: {
    subdir: 'registration',
    filename: 'registration',
    displayName: 'Account Activation',
    description: 'Welcome new users and activate accounts',
    category: 'Account',
  },
  ACCOUNT_UPDATE: {
    subdir: 'accountUpdate',
    filename: 'accountUpdate',
    displayName: 'Account Update Notification',
    description: 'Notify users about account changes',
    category: 'Account',
  },
  ACCOUNT_DISCONNECTED: {
    subdir: 'accountDisconnected',
    filename: 'accountDisconnected',
    displayName: 'Account Disconnected',
    description: 'Notify user their account connection was removed',
    category: 'Account',
  },
  USER_CREATED: {
    subdir: 'userCreated',
    filename: 'userCreated',
    displayName: 'User Created',
    description: 'Notify newly created users with their credentials',
    category: 'Account',
  },
  FORGOT_PASSWORD: {
    subdir: 'forgotPassword',
    filename: 'forgotPassword',
    displayName: 'Password Reset Request',
    description: 'Help users reset forgotten passwords',
    category: 'Account',
  },
  PASSWORD_RESET: {
    subdir: 'resetPassword',
    filename: 'resetPassword',
    displayName: 'Password Reset Confirmation',
    description: 'Confirm password has been reset',
    category: 'Account',
  },

  // ── Invitations ──────────────────────────────────────────────
  INVITATION: {
    subdir: 'invitation',
    filename: 'invitation',
    displayName: 'General Invitation',
    description: 'General invitation template for all roles',
    category: 'Invitation',
  },
  INVITATION_STAFF: {
    subdir: 'invitation',
    filename: 'invitation-staff',
    displayName: 'Staff Invitation',
    description: 'Invite staff members to join the team',
    category: 'Invitation',
  },
  INVITATION_TENANT: {
    subdir: 'invitation',
    filename: 'invitation-tenant',
    displayName: 'Tenant Invitation',
    description: 'Invite tenants to activate their resident account',
    category: 'Invitation',
  },
  INVITATION_VENDOR: {
    subdir: 'invitation',
    filename: 'invitation-vendor',
    displayName: 'Vendor Invitation',
    description: 'Invite vendors/service providers to join',
    category: 'Invitation',
  },
  INVITATION_REMINDER: {
    subdir: 'invitation',
    filename: 'reminder',
    displayName: 'Invitation Reminder',
    description: 'Remind invitees about pending invitations',
    category: 'Invitation',
  },

  // ── Lease ────────────────────────────────────────────────────
  LEASE_ACTIVATED: {
    subdir: 'lease',
    filename: 'lease-activated',
    displayName: 'Lease Activated',
    description: 'Notify tenant their lease is now active',
    category: 'Lease',
  },
  LEASE_ADMIN_UPDATED: {
    subdir: 'lease',
    filename: 'lease-admin-updated',
    displayName: 'Lease Updated by Admin',
    description: 'Notify tenant about lease modifications',
    category: 'Lease',
  },
  LEASE_ENDING_SOON: {
    subdir: 'lease',
    filename: 'lease-ending-soon',
    displayName: 'Lease Ending Soon',
    description: 'Warn tenant their lease is expiring',
    category: 'Lease',
  },
  LEASE_TERMINATED: {
    subdir: 'lease',
    filename: 'lease-terminated',
    displayName: 'Lease Terminated',
    description: 'Notify tenant of lease termination',
    category: 'Lease',
  },
  LEASE_PAYMENT_REMINDER: {
    subdir: 'lease',
    filename: 'payment-reminder',
    displayName: 'Lease Payment Reminder',
    description: 'Remind tenant about upcoming rent payment',
    category: 'Lease',
  },

  // ── Payment ──────────────────────────────────────────────────
  PAYMENT_REQUEST_CREATED: {
    subdir: 'payment',
    filename: 'payment-request',
    displayName: 'Payment Request',
    description: 'Notify tenant of a new payment request',
    category: 'Payment',
  },
  PAYMENT_RECEIPT: {
    subdir: 'payment',
    filename: 'payment-receipt',
    displayName: 'Payment Receipt',
    description: 'Payment confirmation receipt',
    category: 'Payment',
  },
  PAYMENT_FAILED: {
    subdir: 'payment',
    filename: 'payment-failed',
    displayName: 'Payment Failed',
    description: 'Notify tenant a payment could not be processed',
    category: 'Payment',
  },
  PAD_MANDATE_CONFIRMATION: {
    subdir: 'payment',
    filename: 'pad-mandate-confirmation',
    displayName: 'PAD Mandate Confirmation',
    description: 'Confirm pre-authorized debit agreement',
    category: 'Payment',
  },
  PAD_PRE_DEBIT_NOTIFICATION: {
    subdir: 'payment',
    filename: 'pad-pre-debit-notification',
    displayName: 'PAD Pre-Debit Notification',
    description: 'Notify tenant of upcoming pre-authorized debit',
    category: 'Payment',
  },

  // ── Maintenance ──────────────────────────────────────────────
  MAINTENANCE_REQUEST_CREATED: {
    subdir: 'maintenance',
    filename: 'maintenance-request-created',
    displayName: 'Maintenance Request Created',
    description: 'Confirm a new maintenance request was submitted',
    category: 'Maintenance',
  },
  MAINTENANCE_REQUEST_ASSIGNED: {
    subdir: 'maintenance',
    filename: 'maintenance-request-assigned',
    displayName: 'Maintenance Request Assigned',
    description: 'Notify vendor of a new maintenance assignment',
    category: 'Maintenance',
  },
  MAINTENANCE_REQUEST_ACCEPTED: {
    subdir: 'maintenance',
    filename: 'maintenance-request-accepted',
    displayName: 'Maintenance Request Accepted',
    description: 'Notify tenant their request is being handled',
    category: 'Maintenance',
  },
  MAINTENANCE_REQUEST_DECLINED: {
    subdir: 'maintenance',
    filename: 'maintenance-request-declined',
    displayName: 'Maintenance Request Declined',
    description: 'Notify that a maintenance assignment was declined',
    category: 'Maintenance',
  },
  MAINTENANCE_REQUEST_COMPLETED: {
    subdir: 'maintenance',
    filename: 'maintenance-request-completed',
    displayName: 'Maintenance Request Completed',
    description: 'Notify tenant their maintenance request is complete',
    category: 'Maintenance',
  },
  MAINTENANCE_CHARGE_CREATED: {
    subdir: 'maintenance',
    filename: 'maintenance-charge-created',
    displayName: 'Maintenance Charge Created',
    description: 'Notify tenant of a maintenance charge added to their account',
    category: 'Maintenance',
  },
  MAINTENANCE_INVOICE_SUBMITTED: {
    subdir: 'maintenance',
    filename: 'maintenance-invoice-submitted',
    displayName: 'Maintenance Invoice Submitted',
    description: 'Notify admin an invoice was submitted for review',
    category: 'Maintenance',
  },
  MAINTENANCE_INVOICE_APPROVED: {
    subdir: 'maintenance',
    filename: 'maintenance-invoice-approved',
    displayName: 'Maintenance Invoice Approved',
    description: 'Notify vendor their invoice was approved',
    category: 'Maintenance',
  },
  MAINTENANCE_INVOICE_REJECTED: {
    subdir: 'maintenance',
    filename: 'maintenance-invoice-rejected',
    displayName: 'Maintenance Invoice Rejected',
    description: 'Notify vendor their invoice was rejected',
    category: 'Maintenance',
  },
  MAINTENANCE_VENDOR_PAID: {
    subdir: 'maintenance',
    filename: 'maintenance-vendor-paid',
    displayName: 'Vendor Paid',
    description: 'Notify vendor a payout was initiated',
    category: 'Maintenance',
  },
  MAINTENANCE_WORK_ORDER_SUBMITTED: {
    subdir: 'maintenance',
    filename: 'maintenance-work-order-submitted',
    displayName: 'Work Order Submitted',
    description: 'Notify admin a work order was submitted for review',
    category: 'Maintenance',
  },
  MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT: {
    subdir: 'maintenance',
    filename: 'maintenance-work-order-submitted-tenant',
    displayName: 'Work Order Submitted (Tenant)',
    description: 'Notify tenant a work order was submitted for their request',
    category: 'Maintenance',
  },
  MAINTENANCE_WORK_ORDER_APPROVED: {
    subdir: 'maintenance',
    filename: 'maintenance-work-order-approved',
    displayName: 'Work Order Approved',
    description: 'Notify vendor their work order was approved',
    category: 'Maintenance',
  },
  MAINTENANCE_WORK_ORDER_REJECTED: {
    subdir: 'maintenance',
    filename: 'maintenance-work-order-rejected',
    displayName: 'Work Order Rejected',
    description: 'Notify vendor their work order was rejected',
    category: 'Maintenance',
  },

  // ── Subscription ─────────────────────────────────────────────
  SUBSCRIPTION_RENEWAL_UPCOMING: {
    subdir: 'subscription',
    filename: 'subscription-renewal',
    displayName: 'Subscription Renewal Upcoming',
    description: 'Notify admin of upcoming subscription renewal',
    category: 'Subscription',
  },
  SUBSCRIPTION_RENEWAL_RECEIPT: {
    subdir: 'subscription',
    filename: 'subscription-renewal-receipt',
    displayName: 'Subscription Renewal Receipt',
    description: 'Subscription renewal payment receipt',
    category: 'Subscription',
  },

  // ── Guest Pass ───────────────────────────────────────────────
  GUEST_PASS_CODE: {
    subdir: 'guestPass',
    filename: 'guest-pass-code',
    displayName: 'Guest Pass Code',
    description: 'Send visitor access code to guest',
    category: 'Guest Pass',
  },
};

/**
 * Legacy key map for backward compatibility with existing email-template routes.
 * Maps old templateType keys (used in existing routes) → registry keys.
 */
const LEGACY_KEY_MAP: Record<string, string> = {
  invitation: 'INVITATION',
  'invitation-vendor': 'INVITATION_VENDOR',
  'invitation-tenant': 'INVITATION_TENANT',
  'invitation-staff': 'INVITATION_STAFF',
  registration: 'ACCOUNT_ACTIVATION',
  forgotPassword: 'FORGOT_PASSWORD',
  resetPassword: 'PASSWORD_RESET',
  accountUpdate: 'ACCOUNT_UPDATE',
};

export class EmailTemplateService {
  private readonly log = createLogger('EmailTemplateService');
  private readonly templatesPath: string;
  private readonly layoutPath: string;

  constructor() {
    this.templatesPath = path.join(__dirname, '../../mailer/templates');
    this.layoutPath = path.join(this.templatesPath, 'shared');
  }

  /**
   * Resolve a template key (either MailType or legacy key) to a registry entry.
   */
  private resolveEntry(templateType: string): TemplateRegistryEntry | null {
    // Try direct match first, then legacy map
    return (
      TEMPLATE_REGISTRY[templateType] || TEMPLATE_REGISTRY[LEGACY_KEY_MAP[templateType]] || null
    );
  }

  /**
   * Get list of all available email templates grouped by category.
   */
  public async getTemplateList(): Promise<TemplateListItem[]> {
    return Object.entries(TEMPLATE_REGISTRY).map(([key, entry]) => ({
      templateType: key,
      displayName: entry.displayName,
      description: entry.description,
      category: entry.category,
    }));
  }

  /**
   * Get detailed template metadata for a specific template type.
   */
  public async getTemplateMetadata(templateType: string): Promise<TemplateMetadata> {
    try {
      const entry = this.resolveEntry(templateType);
      if (!entry) {
        throw new Error(`Template type '${templateType}' not found`);
      }

      const templateDir = path.join(this.templatesPath, entry.subdir);
      const htmlContent = await this.readFile(path.join(templateDir, `${entry.filename}.ejs`));
      const textContent = await this.readFile(
        path.join(templateDir, `${entry.filename}.text.ejs`),
        true
      );

      const htmlLayout = await this.readLayoutFile('html/layout.ejs');
      const textLayout = await this.readLayoutFile('text/layout.ejs');

      const allVariables = this.extractVariables(htmlContent, textContent);
      const { requiredVariables, optionalVariables } = this.categorizeVariables(allVariables);
      const supportsCustomMessage = this.checkCustomMessageSupport(htmlContent, textContent);

      return {
        templateType,
        displayName: entry.displayName,
        description: entry.description,
        htmlContent,
        textContent,
        layout: { htmlLayout, textLayout },
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
   * Render template with provided variables and return fully rendered HTML.
   * Supports both legacy keys and MailType keys.
   */
  public async renderTemplate(
    templateType: string,
    variables: Record<string, any>
  ): Promise<string> {
    try {
      const entry = this.resolveEntry(templateType);
      if (!entry) {
        throw new Error(`Template type '${templateType}' not found`);
      }

      const templateDir = path.join(this.templatesPath, entry.subdir);
      const layoutPath = path.join(this.layoutPath, 'html/layout.ejs');
      const templateFilePath = path.join(templateDir, `${entry.filename}.ejs`);

      // Path traversal guard
      const resolvedTemplatePath = path.resolve(templateFilePath);
      const resolvedTemplatesRoot = path.resolve(this.templatesPath);
      if (!resolvedTemplatePath.startsWith(resolvedTemplatesRoot + path.sep)) {
        throw new Error('Invalid template path');
      }

      const ejsOptions = {
        views: [templateDir, path.join(this.layoutPath, 'html')],
        filename: templateFilePath,
      };

      const templateVariables = {
        ...variables,
        ROLES,
        appName: variables.appName || 'PropertyDesk',
        year: new Date().getFullYear(),
      };

      let layoutContent: string;
      try {
        layoutContent = await fs.promises.readFile(layoutPath, 'utf8');
      } catch {
        layoutContent =
          '<!DOCTYPE html><html><head><title>Email</title></head><body><%- content %></body></html>';
      }

      const templateContent = await fs.promises.readFile(resolvedTemplatePath, 'utf8');

      const renderedContent = await ejs.render(templateContent, templateVariables, ejsOptions);

      const finalHtml = await ejs.render(
        layoutContent,
        { ...templateVariables, content: renderedContent },
        { views: [path.join(this.layoutPath, 'html')] }
      );

      return finalHtml;
    } catch (error) {
      this.log.error({ error, templateType, variables }, 'Failed to render template');
      throw new Error(
        `Failed to render template '${templateType}': ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Render a template preview using mock data. Returns raw HTML.
   */
  public async renderPreview(templateType: string): Promise<string> {
    const entry = this.resolveEntry(templateType);
    if (!entry) {
      throw new Error(`Template type '${templateType}' not found`);
    }

    const mockData = getMockTemplateData(templateType);
    return this.renderTemplate(templateType, mockData);
  }

  // ── Private helpers ──────────────────────────────────────────

  private async readFile(filePath: string, optional = false): Promise<string> {
    try {
      return await fs.promises.readFile(filePath, 'utf8');
    } catch {
      if (optional) return '';
      throw new Error(`Template file not found: ${filePath}`);
    }
  }

  private async readLayoutFile(layoutFile: string): Promise<string> {
    const filePath = path.join(this.layoutPath, layoutFile);
    try {
      return await fs.promises.readFile(filePath, 'utf8');
    } catch {
      this.log.warn({ filePath }, 'Layout file not found, using empty layout');
      return '<%- content %>';
    }
  }

  private extractVariables(htmlContent: string, textContent: string): string[] {
    const variables = new Set<string>();
    const ejsOutputPattern = /<%=\s*([^%\s]+)\s*%>/g;

    let match;
    while ((match = ejsOutputPattern.exec(htmlContent)) !== null) {
      variables.add(match[1]);
    }

    ejsOutputPattern.lastIndex = 0;
    while ((match = ejsOutputPattern.exec(textContent)) !== null) {
      variables.add(match[1]);
    }

    const excludePatterns = ['new Date(', 'Date(', 'content', 'year', 'appName'];
    return Array.from(variables).filter((variable) => {
      return !excludePatterns.some((pattern) => variable.includes(pattern));
    });
  }

  private categorizeVariables(variables: string[]): {
    requiredVariables: string[];
    optionalVariables: string[];
  } {
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

  private checkCustomMessageSupport(htmlContent: string, textContent: string): boolean {
    const customMessagePattern = /<%\s*if\s*\(\s*customMessage\s*\)\s*{\s*%>/;
    return customMessagePattern.test(htmlContent) || customMessagePattern.test(textContent);
  }
}
