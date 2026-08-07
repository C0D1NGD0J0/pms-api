import { Types } from 'mongoose';
import { MailType } from '@interfaces/utils.interface';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';
import type {
  InspectionScheduledPayload,
  InspectionSubmittedPayload,
  InspectionCancelledPayload,
  InspectionApprovedPayload,
  InspectionDisputedPayload,
  InspectionRejectedPayload,
  InspectionReminderPayload,
} from '@interfaces/events.interface';

import { INotificationContext } from './notification.types';

const formatType = (type: string) => type.replace(/_/g, '-');
const formatDate = (d: Date | string) => new Date(d).toLocaleDateString();

export async function handleInspectionApproved(
  ctx: INotificationContext,
  payload: InspectionApprovedPayload
): Promise<void> {
  const { cuid, iuid, tenantId, refundAmount, depositAmount } = payload;

  try {
    let message = 'Your inspection has been reviewed and approved';
    if (refundAmount !== undefined && depositAmount !== undefined) {
      message =
        refundAmount > 0
          ? `Your inspection has been approved. A refund of $${refundAmount.toLocaleString()} out of your $${depositAmount.toLocaleString()} security deposit will be processed`
          : 'Your inspection has been approved. No security deposit refund will be issued';
    }

    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Inspection Approved',
      message,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: tenantId,
      priority: NotificationPriorityEnum.MEDIUM,
      actionUrl: `/inspections/${cuid}/${iuid}`,
    });

    const tenant = await lookupUser(ctx, tenantId);
    if (tenant) {
      ctx.emailQueue.addToEmailQueue('inspectionApprovedJob', {
        to: tenant.email,
        emailType: MailType.INSPECTION_APPROVED,
        subject: '',
        data: {
          currentuser: tenant,
          refundAmount,
          depositAmount,
          hasRefund: refundAmount !== undefined && depositAmount !== undefined,
          iuid,
        },
      });
    }
  } catch (err) {
    ctx.log.error({ err, iuid, cuid }, 'Failed to handle inspection approved notification');
  }
}

export async function handleInspectionRejected(
  ctx: INotificationContext,
  payload: InspectionRejectedPayload
): Promise<void> {
  const { cuid, iuid, tenantId, inspectorUid, isFinal, reason } = payload;

  try {
    const title = isFinal ? 'Inspection Rejected' : 'Inspection Needs Revision';
    const message = isFinal
      ? `Inspection has been rejected: ${reason.substring(0, 100)}`
      : `Inspection needs revision: ${reason.substring(0, 100)}`;

    const recipients = [tenantId, inspectorUid].filter(Boolean);
    for (const recipient of recipients) {
      await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
        cuid,
        type: NotificationTypeEnum.INSPECTION,
        title,
        message,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient,
        priority: NotificationPriorityEnum.HIGH,
        actionUrl: `/inspections/${cuid}/${iuid}`,
      });
    }

    // Email the tenant about rejection
    const tenant = await lookupUser(ctx, tenantId);
    if (tenant) {
      ctx.emailQueue.addToEmailQueue('inspectionRejectedJob', {
        to: tenant.email,
        emailType: MailType.INSPECTION_REJECTED,
        subject: '',
        data: {
          currentuser: tenant,
          isFinal,
          reason,
          iuid,
        },
      });
    }
  } catch (err) {
    ctx.log.error({ err, iuid, cuid }, 'Failed to handle inspection rejected notification');
  }
}

export async function handleInspectionScheduled(
  ctx: INotificationContext,
  payload: InspectionScheduledPayload
): Promise<void> {
  const { cuid, iuid, tenantId, type, scheduledDate } = payload;
  if (!tenantId) return; // property-only inspections have no tenant to notify

  try {
    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Inspection Scheduled',
      message: `A ${formatType(type)} inspection has been scheduled for ${formatDate(scheduledDate)}`,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: tenantId,
      priority: NotificationPriorityEnum.MEDIUM,
      actionUrl: `/inspections/${cuid}/${iuid}`,
    });

    const tenant = await lookupUser(ctx, tenantId);
    if (tenant) {
      ctx.emailQueue.addToEmailQueue('inspectionScheduledJob', {
        to: tenant.email,
        emailType: MailType.INSPECTION_SCHEDULED,
        subject: '',
        data: {
          currentuser: tenant,
          inspectionType: formatType(type),
          scheduledDate: formatDate(scheduledDate),
          iuid,
        },
      });
    }
  } catch (err) {
    ctx.log.error({ err, iuid, cuid }, 'Failed to handle inspection scheduled notification');
  }
}

export async function handleInspectionSubmitted(
  ctx: INotificationContext,
  payload: InspectionSubmittedPayload
): Promise<void> {
  const { cuid, iuid, inspectorUid, type } = payload;

  try {
    // Notify the inspector/manager that the report is ready for review
    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Inspection Report Submitted',
      message: `A ${formatType(type)} inspection report has been submitted for review`,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: inspectorUid,
      priority: NotificationPriorityEnum.MEDIUM,
      actionUrl: `/inspections/${cuid}/${iuid}`,
    });

    const inspector = await lookupUser(ctx, inspectorUid);
    if (inspector) {
      ctx.emailQueue.addToEmailQueue('inspectionSubmittedJob', {
        to: inspector.email,
        emailType: MailType.INSPECTION_SUBMITTED,
        subject: '',
        data: {
          currentuser: inspector,
          inspectionType: formatType(type),
          iuid,
        },
      });
    }
  } catch (err) {
    ctx.log.error({ err, iuid, cuid }, 'Failed to handle inspection submitted notification');
  }
}

export async function handleInspectionCancelled(
  ctx: INotificationContext,
  payload: InspectionCancelledPayload
): Promise<void> {
  const { cuid, iuid, tenantId } = payload;
  if (!tenantId) return; // property-only inspections have no tenant to notify

  try {
    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Inspection Cancelled',
      message: 'A scheduled inspection has been cancelled',
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: tenantId,
      priority: NotificationPriorityEnum.LOW,
      actionUrl: `/inspections/${cuid}/${iuid}`,
    });

    const tenant = await lookupUser(ctx, tenantId);
    if (tenant) {
      ctx.emailQueue.addToEmailQueue('inspectionCancelledJob', {
        to: tenant.email,
        emailType: MailType.INSPECTION_CANCELLED,
        subject: '',
        data: { currentuser: tenant, iuid },
      });
    }
  } catch (err) {
    ctx.log.error({ err, iuid, cuid }, 'Failed to handle inspection cancelled notification');
  }
}

export async function handleInspectionReminder(
  ctx: INotificationContext,
  payload: InspectionReminderPayload
): Promise<void> {
  const { cuid, iuid, luid, tenantId, type, scheduledDate } = payload;

  try {
    const actionUrl = iuid
      ? `/inspections/${cuid}/${iuid}`
      : luid
        ? `/leases/${cuid}/${luid}`
        : `/inspections/${cuid}`;

    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Move-Out Inspection Reminder',
      message: `Reminder: a ${formatType(type)} inspection should be scheduled before ${formatDate(scheduledDate)}`,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: tenantId,
      priority: NotificationPriorityEnum.MEDIUM,
      actionUrl,
    });
  } catch (err) {
    ctx.log.error({ err, iuid, cuid }, 'Failed to handle inspection reminder notification');
  }
}

export async function handleInspectionDisputed(
  ctx: INotificationContext,
  payload: InspectionDisputedPayload
): Promise<void> {
  const { cuid, iuid, inspectorUid, disputeNotes } = payload;

  try {
    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Inspection Disputed',
      message: `Tenant has disputed the inspection: ${disputeNotes.substring(0, 100)}`,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: inspectorUid,
      priority: NotificationPriorityEnum.HIGH,
      actionUrl: `/inspections/${cuid}/${iuid}`,
    });
  } catch (err) {
    ctx.log.error({ err, iuid, cuid }, 'Failed to handle inspection disputed notification');
  }
}

async function lookupUser(ctx: INotificationContext, userId: string) {
  try {
    const user = await ctx.userDAO.findFirst(
      { _id: new Types.ObjectId(userId), deletedAt: null },
      { populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' } }
    );
    if (!user?.email) return null;
    return {
      firstName: user?.profile?.personalInfo?.firstName || user.email,
      lastName: user?.profile?.personalInfo?.lastName || '',
      email: user.email,
    };
  } catch (err) {
    ctx.log.warn({ err, userId }, 'lookupUser: failed to fetch user for email notification');
    return null;
  }
}
