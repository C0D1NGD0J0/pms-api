import { ResourceContext } from '@interfaces/utils.interface';
import { PROPERTY_APPROVAL_ROLES, PROPERTY_STAFF_ROLES } from '@utils/constants';
import { NotificationPriorityEnum, NotificationTypeEnum } from '@interfaces/notification.interface';

import { INotificationContext } from './notification.types';
import { NotificationMessageKey } from './notificationMessages';

export async function notifyPropertyUpdate(
  ctx: INotificationContext,
  resourceInfo: { resourceName: ResourceContext; resourceUid: string; resourceId: string },
  propertyName: string,
  actorUserId: string,
  actorDisplayName: string,
  cuid: string,
  changes: Record<string, any>,
  propertyManagerId?: string
): Promise<void> {
  try {
    const messageVars = {
      propertyName,
      updatedBy: actorDisplayName,
      changes: Object.keys(changes).join(', '),
    };

    if (propertyManagerId && !ctx.isSelfNotification(actorUserId, propertyManagerId)) {
      await ctx.createNotificationFromTemplate(
        'property.updated',
        messageVars,
        propertyManagerId,
        NotificationTypeEnum.PROPERTY,
        NotificationPriorityEnum.LOW,
        cuid,
        actorUserId,
        {
          resourceName: ResourceContext.PROPERTY,
          resourceUid: resourceInfo?.resourceUid,
          resourceId: resourceInfo?.resourceId,
          metadata: { changes },
        }
      );
      ctx.log.info('Notified property manager of update', {
        propertyId: resourceInfo.resourceId,
        propertyManagerId,
        actorUserId,
      });
    }

    const supervisorId = await ctx
      .findApprovers(propertyManagerId || actorUserId, cuid)
      .then((ids) => ids[0] ?? null);
    if (supervisorId && !ctx.isSelfNotification(actorUserId, supervisorId)) {
      await ctx.createNotificationFromTemplate(
        'property.updated',
        messageVars,
        supervisorId,
        NotificationTypeEnum.PROPERTY,
        NotificationPriorityEnum.LOW,
        cuid,
        actorUserId,
        {
          resourceName: resourceInfo.resourceName,
          resourceUid: resourceInfo.resourceUid,
          resourceId: resourceInfo.resourceId,
          metadata: { changes },
        }
      );
      ctx.log.info('Notified supervisor of property update', {
        propertyId: resourceInfo.resourceId,
        supervisorId,
        actorUserId,
      });
    }
  } catch (error) {
    ctx.log.error('Failed to send property update notifications', {
      error: error instanceof Error ? error.message : 'Unknown error',
      propertyId: resourceInfo.resourceId,
      actorUserId,
      cuid,
    });
  }
}

export async function handlePropertyUpdateNotifications(
  ctx: INotificationContext,
  params: {
    userRole: string;
    updatedProperty: any;
    propertyName: string;
    actorUserId: string;
    actorDisplayName: string;
    cuid: string;
    updateData: Record<string, any>;
    propertyManagerId?: string;
    isDirectUpdate?: boolean;
    resource: { resourceId: string; resourceType: ResourceContext; resourceUid: string };
  }
): Promise<void> {
  const {
    userRole,
    updatedProperty,
    propertyName,
    actorUserId,
    actorDisplayName,
    cuid,
    updateData,
    propertyManagerId,
    isDirectUpdate = false,
    resource,
  } = params;

  try {
    if ((PROPERTY_STAFF_ROLES as string[]).includes(userRole)) {
      await notifyApprovalNeeded(
        ctx,
        { ...resource, resourceName: resource.resourceType },
        actorUserId,
        actorDisplayName,
        cuid,
        resource.resourceType,
        {
          address: updatedProperty.address?.fullAddress,
          changes: Object.keys(updateData),
        }
      );
      ctx.log.info('Sent staff update approval notification', {
        propertyId: resource.resourceId,
        actorUserId,
        userRole,
      });
    } else if ((PROPERTY_APPROVAL_ROLES as string[]).includes(userRole)) {
      await notifyPropertyUpdate(
        ctx,
        { ...resource, resourceName: ResourceContext.PROPERTY },
        propertyName,
        actorUserId,
        actorDisplayName,
        cuid,
        updateData,
        propertyManagerId
      );
      ctx.log.info('Sent admin/manager update notification', {
        propertyId: updatedProperty.pid,
        actorUserId,
        userRole,
        propertyManagerId,
        isDirectUpdate,
      });
    }
  } catch (error) {
    ctx.log.error('Failed to send property update notifications', {
      error: error instanceof Error ? error.message : 'Unknown error',
      propertyId: updatedProperty.pid,
      actorUserId,
      userRole,
    });
  }
}

export async function notifyApprovalDecision(
  ctx: INotificationContext,
  resource: { resourceId: string; resourceName: string; resourceUid: string },
  approverId: string,
  cuid: string,
  decision: 'approved' | 'rejected',
  originalRequesterId: string,
  reason?: string,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    if (ctx.isSelfNotification(approverId, originalRequesterId)) {
      ctx.log.debug('Skipping self-notification for approval decision', {
        approverId,
        originalRequesterId,
      });
      return;
    }

    const messageKey: NotificationMessageKey =
      decision === 'approved' ? 'property.approved' : 'property.rejected';
    const messageVars = {
      propertyName: resource.resourceName,
      approverName: await ctx.getUserDisplayName(approverId, cuid),
      reason: reason || 'No reason provided',
    };
    const priority =
      decision === 'rejected' ? NotificationPriorityEnum.HIGH : NotificationPriorityEnum.LOW;

    await ctx.createNotificationFromTemplate(
      messageKey,
      messageVars,
      originalRequesterId,
      NotificationTypeEnum.PROPERTY,
      priority,
      cuid,
      originalRequesterId,
      {
        resourceName: ResourceContext.PROPERTY,
        resourceUid: resource.resourceUid,
        resourceId: resource.resourceId,
        metadata,
      }
    );
    ctx.log.info('Sent approval decision notification', {
      resourceId: resource.resourceId,
      decision,
      approverId,
      originalRequesterId,
    });
  } catch (error) {
    ctx.log.error('Failed to send approval decision notification', {
      error: error instanceof Error ? error.message : 'Unknown error',
      resourceId: resource.resourceId,
      approverId,
      decision,
    });
  }
}

export async function notifyPendingChangesOverridden(
  ctx: INotificationContext,
  propertyId: string,
  propertyName: string,
  adminUserId: string,
  adminName: string,
  originalRequesterId: string,
  cuid: string,
  context: { address?: string; overriddenAt: Date; overrideReason: string }
): Promise<void> {
  try {
    if (ctx.isSelfNotification(adminUserId, originalRequesterId)) {
      ctx.log.debug('Skipping self-notification for pending changes override', {
        adminUserId,
        originalRequesterId,
      });
      return;
    }

    await ctx.createNotificationFromTemplate(
      'property.pendingChangesOverridden' as NotificationMessageKey,
      {
        propertyName,
        adminName,
        overrideReason: context.overrideReason,
        address: context.address || 'N/A',
      },
      originalRequesterId,
      NotificationTypeEnum.PROPERTY,
      NotificationPriorityEnum.HIGH,
      cuid,
      originalRequesterId,
      {
        resourceName: ResourceContext.PROPERTY,
        resourceUid: propertyId,
        resourceId: propertyId,
        metadata: {
          overriddenAt: context.overriddenAt,
          overrideReason: context.overrideReason,
          address: context.address,
          adminUserId,
          adminName,
        },
      }
    );

    ctx.log.info('Staff notified of pending changes override', {
      propertyId,
      adminUserId,
      originalRequesterId,
      cuid,
    });
  } catch (error) {
    ctx.log.error('Failed to notify staff of pending changes override', {
      error: error instanceof Error ? error.message : 'Unknown error',
      propertyId,
      adminUserId,
      originalRequesterId,
    });
    throw error;
  }
}

export async function notifyApprovalNeeded(
  ctx: INotificationContext,
  resource: { resourceId: string; resourceUid: string; resourceName: string },
  requesterId: string,
  requesterDisplayName: string,
  cuid: string,
  resourceType: ResourceContext = ResourceContext.PROPERTY,
  metadata?: Record<string, any>
): Promise<void> {
  try {
    const messageVars = {
      propertyName: resource.resourceName,
      address: metadata?.address || 'N/A',
      requesterName: requesterDisplayName,
    };

    const approverIds = await ctx.findApprovers(requesterId, cuid);

    for (const approverId of approverIds) {
      if (!ctx.isSelfNotification(requesterId, approverId)) {
        await ctx.createNotificationFromTemplate(
          'property.approvalRequired',
          messageVars,
          approverId,
          NotificationTypeEnum.PROPERTY,
          NotificationPriorityEnum.HIGH,
          cuid,
          requesterId,
          {
            resourceName: resourceType,
            resourceUid: resource.resourceUid,
            resourceId: resource.resourceId,
            metadata,
          }
        );
        ctx.log.info('Sent approval needed notification', {
          resourceUid: resource.resourceUid,
          approverId,
          requesterId,
        });
      }
    }
  } catch (error) {
    ctx.log.error('Failed to send approval needed notifications', {
      error: error instanceof Error ? error.message : 'Unknown error',
      resourceUid: resource.resourceUid,
      requesterId,
      cuid,
    });
  }
}
