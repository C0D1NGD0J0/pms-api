import { t } from '@shared/languages';

export const NotificationMessages = {
  property: {
    approvalRequired: {
      title: 'Property Approval Required',
      message: '{{propertyName}} at {{address}} requires your approval',
    },
    approved: {
      title: 'Property Approved',
      message: '{{propertyName}} update has been approved by {{approverName}}',
    },
    rejected: {
      title: 'Property Rejected',
      message: '{{propertyName}} update was rejected. Reason: {{reason}}',
    },
    updated: {
      title: 'Property Updated',
      message: '{{propertyName}} has been updated by {{updatedBy}}',
    },
    statusChanged: {
      title: 'Property Status Changed',
      message: '{{propertyName}} status changed to {{newStatus}}',
    },
    pendingChanges: {
      title: 'Property Changes Submitted',
      message: 'Changes to {{propertyName}} have been submitted for approval',
    },
  },

  task: {
    completed: {
      title: 'Task Completed',
      message: 'Your {{taskType}} task has finished processing successfully',
    },
    failed: {
      title: 'Task Failed',
      message: 'Your {{taskType}} task failed: {{errorMessage}}',
    },
    csvImportCompleted: {
      title: 'CSV Import Completed',
      message:
        'Your {{entityType}} CSV import completed. {{successCount}} items processed successfully',
    },
    csvImportFailed: {
      title: 'CSV Import Failed',
      message: 'Your {{entityType}} CSV import failed: {{errorMessage}}',
    },
  },

  user: {
    invitation: {
      received: {
        title: 'New Invitation',
        message: "You've been invited to join {{companyName}} as {{role}}",
      },
      reminder: {
        title: 'Invitation Reminder',
        message: 'Reminder: Your invitation to join {{companyName}} expires soon',
      },
    },
    accountUpdated: {
      title: 'Account Updated',
      message: 'Your account information has been updated by {{updatedBy}}',
    },
  },

  system: {
    maintenance: {
      title: 'System Maintenance',
      message: 'Scheduled maintenance on {{date}} from {{startTime}} to {{endTime}}',
    },
    announcement: {
      title: '{{title}}',
      message: '{{message}}',
    },
    serverUpdate: {
      title: 'System Update',
      message: 'The system will be updated on {{date}}. Expected downtime: {{duration}}',
    },
  },

  vendor: {
    connected: {
      title: 'Vendor Connected',
      message: '{{vendorName}} has been connected to your account',
    },
    disconnected: {
      title: 'Vendor Disconnected',
      message: '{{vendorName}} has been disconnected from your account',
    },
  },

  payment: {
    disputeCreated: {
      title: 'Payment Dispute Opened',
      message:
        'A dispute of {{amount}} was filed for invoice {{invoiceNumber}}. The transfer has been reversed pending resolution.',
    },
    disputeWon: {
      title: 'Dispute Resolved — Funds Returned',
      message:
        'The dispute for invoice {{invoiceNumber}} was resolved in your favor. {{amount}} has been re-transferred to your account.',
    },
    payoutAccountVerified: {
      title: 'Payout Account Verified',
      message:
        'Your payout account has been verified. You can now receive rent payments directly to your bank account.',
    },
    requested: {
      title: 'Payment Request Received',
      message:
        'A payment of {{amount}} is due on {{dueDate}}. Pay early or your linked bank account will be automatically charged on the due date.',
    },
    succeeded: {
      title: 'Payment Received',
      message: 'A payment of {{amount}} has been successfully processed',
    },
    overdue: {
      title: 'Rent Payment Overdue',
      message: 'A rent payment of {{amount}} due on {{dueDate}} is now overdue',
    },
    failed: {
      title: 'Payment Failed',
      message:
        'A payment of {{amount}} could not be processed — please review and follow up with the tenant',
    },
    failedTenant: {
      title: 'Payment Could Not Be Processed',
      message:
        'Your payment of {{amount}} could not be processed. Please use the payment link provided or add a card to complete your payment.',
    },
    overdueTenant: {
      title: 'Rent Payment Overdue',
      message:
        'Your rent payment of {{amount}} was due on {{dueDate}} and is now overdue. Please make your payment as soon as possible to avoid late fees.',
    },
    refunded: {
      title: 'Payment Refunded',
      message: 'A refund of {{amount}} has been issued',
    },
    cancelled: {
      title: 'Payment Cancelled',
      message: 'A payment of {{amount}} has been cancelled by your property manager.',
    },
    payoutFailed: {
      title: 'Vendor Payout Failed',
      message: 'A payout of {{amount}} to a vendor bank account failed. Reason: {{reason}}',
    },
    payoutPaid: {
      title: 'Vendor Payout Completed',
      message: 'A payout of {{amount}} has been successfully deposited to the vendor bank account',
    },
    invoiceOverdue: {
      title: 'Invoice Overdue',
      message: 'A rent invoice of {{amount}} is overdue',
    },
    subscriptionRenewalUpcoming: {
      title: 'Subscription Renewal Upcoming',
      message:
        'Your {{planName}} plan renews on {{renewalDate}} — {{amount}} will be charged to your payment method on file.',
    },
  },

  maintenance: {
    requestCreated: {
      title: 'New Maintenance Request',
      message: 'A new {{priority}} priority request "{{title}}" has been submitted',
    },
    requestAssigned: {
      title: 'Request Assigned',
      message: 'Maintenance request {{mruid}} has been assigned to a vendor',
    },
    requestAssignedVendor: {
      title: 'New Job Assigned',
      message: 'You have been assigned maintenance request {{mruid}}',
    },
    requestAccepted: {
      title: 'Vendor Accepted Request',
      message: 'A vendor has accepted maintenance request {{mruid}}',
    },
    requestAcceptedTenant: {
      title: 'Your Request is Being Handled',
      message: 'A vendor has accepted your maintenance request {{mruid}}',
    },
    requestDeclined: {
      title: 'Vendor Declined Request',
      message: 'A vendor has declined maintenance request {{mruid}}',
    },
    workDone: {
      title: 'Work Marked as Done',
      message: 'Vendor has marked work complete on request {{mruid}} — awaiting invoice',
    },
    workDoneTenant: {
      title: 'Work Complete on Your Request',
      message: 'Work has been completed on your maintenance request {{mruid}}',
    },
    requestCompleted: {
      title: 'Maintenance Request Completed',
      message: 'Maintenance request {{mruid}} has been marked as completed',
    },
    requestCancelled: {
      title: 'Maintenance Request Cancelled',
      message: 'Maintenance request {{mruid}} has been cancelled',
    },
    requestUpdatedByTenant: {
      title: 'Tenant Updated Service Request',
      message: 'A tenant has updated the details of maintenance request {{mruid}}',
    },
    invoiceSubmitted: {
      title: 'Invoice Submitted for Approval',
      message: 'A vendor has submitted an invoice of {{amount}} for request {{mruid}}',
    },
    invoiceApproved: {
      title: 'Invoice Approved',
      message: 'Your invoice for request {{mruid}} has been approved',
    },
    invoiceApprovedTenant: {
      title: 'Service Request Update',
      message:
        'The invoice for your maintenance request {{mruid}} has been approved and work is being finalized.',
    },
    invoiceBillableNotice: {
      title: 'Maintenance Charge Pending',
      message:
        'A maintenance invoice of {{amount}} for request {{mruid}} has been approved and will be charged to your account.',
    },
    chargeCreated: {
      title: 'Maintenance Charge Added',
      message:
        'A maintenance charge of {{amount}} has been added to your account for request {{mruid}}. Due {{dueDate}} — pay now to avoid auto-debit.',
    },
    vendorPaid: {
      title: 'Payout Received',
      message:
        'A payout of {{amount}} has been initiated for service request {{mruid}}. Funds will arrive per your payout schedule.',
    },
    invoiceRejected: {
      title: 'Invoice Rejected',
      message: 'Your invoice for request {{mruid}} was rejected',
    },
    workOrderSubmitted: {
      title: 'Work Order Submitted',
      message: 'A work order has been submitted for maintenance request {{mruid}}',
    },
    workOrderApproved: {
      title: 'Work Order Approved',
      message: 'Your work order for request {{mruid}} has been approved — proceed with the job',
    },
    workOrderRejected: {
      title: 'Work Order Rejected',
      message: 'Your work order for request {{mruid}} was rejected',
    },
    chargePaid: {
      title: 'Tenant Payment Received',
      message:
        'Tenant payment of {{amount}} for maintenance request {{mruid}} has been received. Funds will be available for vendor payout in 1–2 business days.',
    },
    fundsAvailable: {
      title: 'Funds Ready for Vendor Payout',
      message:
        'Payment for maintenance request {{mruid}} has settled. The vendor will be paid automatically in 5 days if no action is taken.',
    },
    autoVendorPaid: {
      title: 'Vendor Paid Automatically',
      message:
        '{{vendorName}} was automatically paid ${{amount}} for maintenance request {{mruid}}. The 5-day review period elapsed without manual action.',
    },
  },

  lease: {
    pdfGenerationStarted: {
      title: 'Lease PDF Generation Started',
      message: "Generating PDF for lease {{leaseNumber}}. You will be notified when it's ready.",
    },
    pdfGenerated: {
      title: 'Lease PDF Ready',
      message:
        'PDF for lease {{leaseNumber}} has been generated and is now available for download.',
    },
    pdfGenerationFailed: {
      title: 'Lease PDF Generation Failed',
      message: 'Failed to generate PDF for lease {{leaseNumber}}: {{errorMessage}}',
    },
    adminUpdated: {
      title: 'Your Lease Has Been Updated',
      message:
        'Administrative details on your lease {{leaseNumber}} have been updated by your property manager. Please log in to review the current terms.',
    },
  },

  sms: {
    quotaWarning: {
      title: 'SMS Quota Warning',
      message:
        'Your SMS usage has reached {{percentUsed}}% of your monthly quota ({{used}}/{{limit}}). Consider upgrading your plan for more SMS capacity.',
    },
    quotaExhausted: {
      title: 'SMS Quota Exhausted',
      message:
        'Your monthly SMS quota has been fully used ({{limit}}/{{limit}}). SMS sending is paused until your next billing cycle.',
    },
  },

  guestPass: {
    created: {
      title: 'New Visitor Expected',
      message: '{{visitorName}} is expected at {{propertyName}}',
    },
    validated: {
      title: 'Visitor Arrived',
      message: '{{visitorName}} has checked in at {{propertyName}}',
    },
    revoked: {
      title: 'Guest Pass Revoked',
      message: 'A guest pass for {{visitorName}} at {{propertyName}} has been cancelled',
    },
  },
} as const;

/**
 * Type-safe message key type for autocomplete support
 */
export type NotificationMessageKey =
  | 'property.approvalRequired'
  | 'property.approved'
  | 'property.rejected'
  | 'property.updated'
  | 'property.statusChanged'
  | 'property.pendingChanges'
  | 'task.completed'
  | 'task.failed'
  | 'task.csvImportCompleted'
  | 'task.csvImportFailed'
  | 'user.invitation.received'
  | 'user.invitation.reminder'
  | 'user.accountUpdated'
  | 'system.maintenance'
  | 'system.announcement'
  | 'system.serverUpdate'
  | 'vendor.connected'
  | 'vendor.disconnected'
  | 'maintenance.requestCreated'
  | 'maintenance.requestAssigned'
  | 'maintenance.requestAssignedVendor'
  | 'maintenance.requestAccepted'
  | 'maintenance.requestAcceptedTenant'
  | 'maintenance.requestDeclined'
  | 'maintenance.workDone'
  | 'maintenance.workDoneTenant'
  | 'maintenance.requestCompleted'
  | 'maintenance.requestCancelled'
  | 'maintenance.invoiceSubmitted'
  | 'maintenance.invoiceApproved'
  | 'maintenance.invoiceApprovedTenant'
  | 'maintenance.invoiceBillableNotice'
  | 'maintenance.chargeCreated'
  | 'maintenance.invoiceRejected'
  | 'maintenance.vendorPaid'
  | 'maintenance.workOrderSubmitted'
  | 'maintenance.workOrderApproved'
  | 'maintenance.workOrderRejected'
  | 'maintenance.vendorScheduledVisit'
  | 'maintenance.chargePaid'
  | 'maintenance.fundsAvailable'
  | 'maintenance.autoVendorPaid'
  | 'lease.pdfGenerationStarted'
  | 'lease.pdfGenerated'
  | 'lease.pdfGenerationFailed'
  | 'lease.adminUpdated'
  | 'payment.disputeCreated'
  | 'payment.disputeWon'
  | 'payment.payoutAccountVerified'
  | 'payment.requested'
  | 'payment.succeeded'
  | 'payment.overdue'
  | 'payment.failed'
  | 'payment.refunded'
  | 'payment.cancelled'
  | 'payment.payoutFailed'
  | 'payment.payoutPaid'
  | 'payment.invoiceOverdue'
  | 'payment.subscriptionRenewalUpcoming'
  | 'payment.failedTenant'
  | 'payment.overdueTenant'
  | 'sms.quotaWarning'
  | 'sms.quotaExhausted'
  | 'guestPass.created'
  | 'guestPass.validated'
  | 'guestPass.revoked';

/**
 * Helper function to get formatted notification message by key.
 * Resolves strings via i18n (t()) so they respect the current language.
 * Falls back to the hardcoded NotificationMessages template if the i18n key is missing.
 * @param key - Message key in dot notation (e.g., 'maintenance.requestCreated')
 * @param variables - Variables for interpolation
 * @returns Formatted message in the current language
 */
export function getFormattedNotification(
  key: string,
  variables: Record<string, any>
): { title: string; message: string } {
  const i18nParams = Object.fromEntries(
    Object.entries(variables).map(([k, v]) => [k, v?.toString() ?? ''])
  );

  const titleKey = `notifications.${key}.title`;
  const messageKey = `notifications.${key}.message`;

  const titleResult = t(titleKey, i18nParams);
  const messageResult = t(messageKey, i18nParams);

  // t() returns the key itself when the translation is missing — fall back to hardcoded template
  if (titleResult === titleKey || messageResult === messageKey) {
    const template = getNotificationTemplate(key);
    if (!template) {
      return {
        title: 'Notification',
        message: `Notification template '${key}' not found`,
      };
    }
    return formatNotificationMessage(template, variables);
  }

  return { title: titleResult, message: messageResult };
}

/**
 * Get notification message template by dot notation key
 * @param key - Dot notation key (e.g., 'property.approved')
 * @returns Message template or null if not found
 */
export function getNotificationTemplate(key: string): { title: string; message: string } | null {
  const keys = key.split('.');
  let current: any = NotificationMessages;

  for (const k of keys) {
    if (current && typeof current === 'object' && k in current) {
      current = current[k];
    } else {
      return null;
    }
  }

  if (current && typeof current === 'object' && 'title' in current && 'message' in current) {
    return current as { title: string; message: string };
  }

  return null;
}

/**
 * Simple variable substitution function for notification messages
 * @param template - Message template with title and message
 * @param variables - Variables to substitute in the template
 * @returns Formatted notification with substituted variables
 */
export function formatNotificationMessage(
  template: { title: string; message: string },
  variables: Record<string, any>
): { title: string; message: string } {
  const title = template.title.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => variables[key]?.toString() || `{{${key}}}`
  );

  const message = template.message.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => variables[key]?.toString() || `{{${key}}}`
  );

  return { title, message };
}
