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
    succeeded: {
      title: 'Payment Received',
      message: 'A payment of {{amount}} has been successfully processed',
    },
    failed: {
      title: 'Payment Failed',
      message: 'A payment of {{amount}} could not be processed',
    },
    refunded: {
      title: 'Payment Refunded',
      message: 'A refund of {{amount}} has been issued',
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
    requestCompleted: {
      title: 'Maintenance Request Completed',
      message: 'Maintenance request {{mruid}} has been marked as completed',
    },
    requestCancelled: {
      title: 'Maintenance Request Cancelled',
      message: 'Maintenance request {{mruid}} has been cancelled',
    },
    invoiceSubmitted: {
      title: 'Invoice Submitted for Approval',
      message: 'A vendor has submitted an invoice of {{amount}} for request {{mruid}}',
    },
    invoiceApproved: {
      title: 'Invoice Approved',
      message: 'Your invoice for request {{mruid}} has been approved',
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
  | 'maintenance.requestCompleted'
  | 'maintenance.requestCancelled'
  | 'maintenance.invoiceSubmitted'
  | 'maintenance.invoiceApproved'
  | 'maintenance.invoiceRejected'
  | 'maintenance.workOrderSubmitted'
  | 'maintenance.workOrderApproved'
  | 'maintenance.workOrderRejected'
  | 'lease.pdfGenerationStarted'
  | 'lease.pdfGenerated'
  | 'lease.pdfGenerationFailed'
  | 'payment.disputeCreated'
  | 'payment.disputeWon'
  | 'payment.payoutAccountVerified'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.refunded';

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

/**
 * Helper function to get formatted notification message by key
 * @param key - Message key in dot notation
 * @param variables - Variables for substitution
 * @returns Formatted message or fallback message if template not found
 */
export function getFormattedNotification(
  key: string,
  variables: Record<string, any>
): { title: string; message: string } {
  const template = getNotificationTemplate(key);

  if (!template) {
    return {
      title: 'Notification',
      message: `Notification template '${key}' not found`,
    };
  }

  return formatNotificationMessage(template, variables);
}
