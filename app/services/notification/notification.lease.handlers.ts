import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';

import { INotificationContext } from './notification.types';

export async function handleLeaseActivated(ctx: INotificationContext, payload: any): Promise<void> {
  try {
    const { leaseId, luid, cuid, tenantId, propertyManagerId } = payload;

    await ctx.createNotification(cuid, NotificationTypeEnum.LEASE, {
      cuid,
      type: NotificationTypeEnum.LEASE,
      recipient: tenantId,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      priority: NotificationPriorityEnum.HIGH,
      title: 'Lease Activated',
      message: `Your lease ${luid} has been fully signed and is now active.`,
      metadata: { leaseId, luid },
    });

    await ctx.createNotification(cuid, NotificationTypeEnum.LEASE, {
      cuid,
      type: NotificationTypeEnum.LEASE,
      recipient: propertyManagerId,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      priority: NotificationPriorityEnum.MEDIUM,
      title: 'Lease Activated',
      message: `Lease ${luid} has been fully signed and activated.`,
      metadata: { leaseId, luid },
    });
  } catch (error) {
    ctx.log.error('Error sending lease activation notifications', { error, payload });
  }
}
