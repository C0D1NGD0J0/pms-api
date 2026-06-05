import { ResourceContext } from '@interfaces/utils.interface';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';

import { INotificationContext } from './notification.types';

// ── System error content ────────────────────────────────────────────────────

const SYSTEM_ERROR_MESSAGES: Record<
  string,
  { title: string; message: (id: string, err: string) => string }
> = {
  auto_renewal_failed: {
    title: 'Auto-Renewal Creation Failed',
    message: (id, err) =>
      `Failed to create auto-renewal for lease ${id}. Manual action required. Error: ${err}`,
  },
  auto_send_failed: {
    title: 'Failed to Send Renewal for Signature',
    message: (id, err) => `Auto-send failed for renewal ${id}. Please send manually. Error: ${err}`,
  },
  expired_lease_processing_failed: {
    title: 'Error Processing Expired Lease',
    message: (id, err) =>
      `Failed to mark lease ${id} as expired. Manual review required. Error: ${err}`,
  },
  general: {
    title: 'System Error',
    message: (id, err) => `An error occurred with ${id}: ${err}`,
  },
};

export function getLeaseLifecycleNotificationContent(
  eventType: string,
  lease: any,
  recipientRole: 'tenant' | 'manager' | 'creator',
  customMessage?: { title?: string; message?: string }
): { title: string; message: string; priority: NotificationPriorityEnum } {
  if (customMessage?.title && customMessage?.message) {
    return {
      title: customMessage.title,
      message: customMessage.message,
      priority: NotificationPriorityEnum.MEDIUM,
    };
  }

  const messages: Record<string, Record<string, any>> = {
    renewal_created: {
      tenant: {
        title: 'Lease Renewal Prepared',
        message: `Your lease renewal for ${lease.propertyAddress} is being prepared. You'll receive it for signature soon.`,
        priority: NotificationPriorityEnum.MEDIUM,
      },
      manager: {
        title: 'Lease Renewal Created',
        message: `Auto-renewal created for lease ${lease.leaseNumber}. Please review and approve.`,
        priority: NotificationPriorityEnum.HIGH,
      },
      creator: {
        title: 'Lease Renewal Pending Approval',
        message: `Auto-renewal for lease ${lease.leaseNumber} requires your approval.`,
        priority: NotificationPriorityEnum.HIGH,
      },
    },
    renewal_approved: {
      tenant: {
        title: 'Lease Renewal Approved',
        message: "Your lease renewal has been approved. You'll receive it for signature soon.",
        priority: NotificationPriorityEnum.MEDIUM,
      },
      manager: {
        title: 'Lease Renewal Approved',
        message: `Renewal for lease ${lease.leaseNumber} approved and ready for signature.`,
        priority: NotificationPriorityEnum.LOW,
      },
    },
    expiring: {
      tenant: {
        title: 'Lease Expiring Soon',
        message: `Your lease for ${lease.propertyAddress} expires on ${lease.endDate.toLocaleDateString()}. Please contact your property manager.`,
        priority: NotificationPriorityEnum.HIGH,
      },
      manager: {
        title: 'Lease Expiring Soon',
        message: `Lease ${lease.leaseNumber} expires on ${lease.endDate.toLocaleDateString()}.`,
        priority: NotificationPriorityEnum.MEDIUM,
      },
    },
    expired: {
      tenant: {
        title: 'Lease Expired',
        message: `Your lease for ${lease.propertyAddress} has expired. Please contact your property manager immediately.`,
        priority: NotificationPriorityEnum.URGENT,
      },
      manager: {
        title: 'Tenant Lease Expired',
        message: `Lease ${lease.leaseNumber} has expired. Property unit is now available.`,
        priority: NotificationPriorityEnum.HIGH,
      },
    },
    completed: {
      tenant: {
        title: 'Lease Renewed Successfully',
        message: 'Your previous lease has been completed. Your new lease is now active.',
        priority: NotificationPriorityEnum.LOW,
      },
      manager: {
        title: 'Lease Transitioned to Renewal',
        message: `Lease ${lease.leaseNumber} completed. Tenant transitioned to new lease.`,
        priority: NotificationPriorityEnum.LOW,
      },
    },
    renewal_incomplete: {
      tenant: {
        title: 'URGENT: Lease Expired - Renewal Incomplete',
        message: 'Your lease expired but your renewal is not complete. Immediate action required.',
        priority: NotificationPriorityEnum.URGENT,
      },
      manager: {
        title: 'URGENT: Lease Expired - Renewal Incomplete',
        message: `Lease ${lease.leaseNumber} expired with incomplete renewal. Property unit released.`,
        priority: NotificationPriorityEnum.URGENT,
      },
    },
  };

  return (
    messages[eventType]?.[recipientRole] ?? {
      title: 'Lease Update',
      message: `Update regarding lease ${lease.leaseNumber}`,
      priority: NotificationPriorityEnum.MEDIUM,
    }
  );
}

// ── Lease lifecycle content ─────────────────────────────────────────────────

export async function notifyLeaseLifecycleEvent(
  ctx: INotificationContext,
  params: {
    eventType:
      | 'renewal_created'
      | 'renewal_approved'
      | 'expiring'
      | 'expired'
      | 'completed'
      | 'renewal_incomplete';
    lease: {
      luid: string;
      leaseNumber: string;
      cuid: string;
      tenantId: string;
      propertyAddress: string;
      endDate: Date;
      startDate?: Date;
    };
    recipients: {
      tenant?: boolean;
      propertyManager?: string;
      createdBy?: string;
    };
    metadata?: Record<string, any>;
    customMessage?: { title?: string; message?: string };
  }
): Promise<void> {
  const { eventType, lease, recipients, metadata = {}, customMessage } = params;

  try {
    const baseMetadata = {
      leaseId: lease.luid,
      leaseNumber: lease.leaseNumber,
      propertyAddress: lease.propertyAddress,
      endDate: lease.endDate.toISOString(),
      eventType,
      ...metadata,
    };

    if (recipients.tenant) {
      const n = getLeaseLifecycleNotificationContent(eventType, lease, 'tenant', customMessage);
      await ctx.createNotification(lease.cuid, NotificationTypeEnum.LEASE, {
        type: NotificationTypeEnum.LEASE,
        priority: n.priority,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: lease.tenantId,
        title: n.title,
        message: n.message,
        metadata: { ...baseMetadata, recipientRole: 'tenant' },
        cuid: lease.cuid,
      });
    }

    if (recipients.createdBy) {
      const n = getLeaseLifecycleNotificationContent(eventType, lease, 'creator', customMessage);
      await ctx.createNotification(lease.cuid, NotificationTypeEnum.LEASE, {
        type: NotificationTypeEnum.LEASE,
        priority: n.priority,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: recipients.createdBy,
        title: n.title,
        message: n.message,
        metadata: { ...baseMetadata, recipientRole: 'creator' },
        cuid: lease.cuid,
      });
    }

    if (recipients.propertyManager && recipients.propertyManager !== recipients.createdBy) {
      const n = getLeaseLifecycleNotificationContent(eventType, lease, 'manager', customMessage);
      await ctx.createNotification(lease.cuid, NotificationTypeEnum.LEASE, {
        type: NotificationTypeEnum.LEASE,
        priority: n.priority,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: recipients.propertyManager,
        title: n.title,
        message: n.message,
        metadata: { ...baseMetadata, recipientRole: 'manager' },
        cuid: lease.cuid,
      });
    }

    ctx.log.info(`Lease lifecycle event notifications sent: ${eventType}`, {
      leaseNumber: lease.leaseNumber,
      eventType,
      recipients,
    });
  } catch (error) {
    ctx.log.error('Failed to send lease lifecycle event notifications', {
      error: error instanceof Error ? error.message : 'Unknown error',
      eventType,
      leaseNumber: lease.leaseNumber,
    });
  }
}

// ── Public notification functions ───────────────────────────────────────────

export async function notifyLeaseESignatureSent(
  ctx: INotificationContext,
  params: {
    leaseNumber: string;
    leaseName: string;
    tenantId: string;
    propertyManagerId: string;
    envelopeId: string;
    actorId: string;
    cuid: string;
    resource: { resourceId: string; resourceUid: string; resourceType: ResourceContext };
  }
): Promise<void> {
  const {
    leaseNumber,
    leaseName,
    tenantId,
    propertyManagerId,
    envelopeId,
    actorId,
    cuid,
    resource,
  } = params;
  try {
    await ctx.createNotification(cuid, NotificationTypeEnum.LEASE, {
      type: NotificationTypeEnum.LEASE,
      priority: NotificationPriorityEnum.MEDIUM,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: propertyManagerId,
      author: actorId,
      title: 'Lease Sent for Signature',
      message: `${leaseName} has been sent for e-signature.`,
      metadata: { leaseNumber, envelopeId, action: 'lease_esignature_sent' },
      resourceInfo: {
        resourceId: resource.resourceId,
        resourceUid: resource.resourceUid,
        resourceName: resource.resourceType,
      },
      cuid,
    });

    await ctx.createNotification(cuid, NotificationTypeEnum.LEASE, {
      type: NotificationTypeEnum.LEASE,
      priority: NotificationPriorityEnum.HIGH,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: tenantId,
      author: actorId,
      title: 'Please Sign Your Lease',
      message: `${leaseName} is ready for your signature. Please check your email for the signing link.`,
      metadata: { leaseNumber, envelopeId, action: 'lease_esignature_sent' },
      resourceInfo: {
        resourceId: resource.resourceId,
        resourceUid: resource.resourceUid,
        resourceName: resource.resourceType,
      },
      cuid,
    });

    ctx.log.info('Lease e-signature sent notifications created', {
      leaseNumber,
      tenantId,
      propertyManagerId,
      envelopeId,
    });
  } catch (error) {
    ctx.log.error('Failed to send lease e-signature sent notifications', {
      error: error instanceof Error ? error.message : 'Unknown error',
      leaseNumber,
      envelopeId,
    });
  }
}

export async function notifySystemError(
  ctx: INotificationContext,
  params: {
    cuid: string;
    recipientIds: string[];
    errorType:
      | 'auto_renewal_failed'
      | 'auto_send_failed'
      | 'expired_lease_processing_failed'
      | 'general';
    resourceType: 'lease' | 'property' | 'system';
    resourceIdentifier: string;
    errorMessage: string;
    metadata?: Record<string, any>;
  }
): Promise<void> {
  const {
    cuid,
    recipientIds,
    errorType,
    resourceType,
    resourceIdentifier,
    errorMessage,
    metadata = {},
  } = params;

  try {
    const content = getSystemErrorContent(errorType, resourceIdentifier, errorMessage);

    for (const recipientId of recipientIds) {
      await ctx.createNotification(cuid, NotificationTypeEnum.SYSTEM, {
        type: NotificationTypeEnum.SYSTEM,
        priority: NotificationPriorityEnum.HIGH,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: recipientId,
        title: content.title,
        message: content.message,
        metadata: {
          errorType,
          resourceType,
          resourceIdentifier,
          error: errorMessage,
          actionRequired: true,
          ...metadata,
        },
        cuid,
      });
    }

    ctx.log.info('System error notifications sent', {
      errorType,
      resourceIdentifier,
      recipientCount: recipientIds.length,
    });
  } catch (error) {
    ctx.log.error('Failed to send system error notifications', {
      error: error instanceof Error ? error.message : 'Unknown error',
      errorType,
      resourceIdentifier,
    });
  }
}

export async function notifyLeaseESignatureFailed(
  ctx: INotificationContext,
  params: {
    leaseNumber: string;
    error: string;
    propertyManagerId: string;
    actorId: string;
    cuid: string;
    resource: { resourceId: string; resourceUid: string; resourceType: ResourceContext };
  }
): Promise<void> {
  const { leaseNumber, error, propertyManagerId, actorId, cuid, resource } = params;
  try {
    await ctx.createNotification(cuid, NotificationTypeEnum.LEASE, {
      type: NotificationTypeEnum.LEASE,
      priority: NotificationPriorityEnum.HIGH,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: propertyManagerId,
      author: actorId,
      title: 'Failed to Send Lease for Signature',
      message: `Failed to send ${leaseNumber} for e-signature: ${error}`,
      metadata: { leaseNumber, error, action: 'lease_esignature_failed' },
      resourceInfo: {
        resourceId: resource.resourceId,
        resourceUid: resource.resourceUid,
        resourceName: resource.resourceType,
      },
      cuid,
    });
    ctx.log.info('Lease e-signature failed notification created', {
      leaseNumber,
      propertyManagerId,
      error,
    });
  } catch (notificationError) {
    ctx.log.error('Failed to send lease e-signature failed notification', {
      error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
      leaseNumber,
    });
  }
}

function getSystemErrorContent(
  errorType: string,
  resourceIdentifier: string,
  errorMessage: string
): { title: string; message: string } {
  const entry = SYSTEM_ERROR_MESSAGES[errorType] ?? SYSTEM_ERROR_MESSAGES.general;
  return { title: entry.title, message: entry.message(resourceIdentifier, errorMessage) };
}
