import { Types } from 'mongoose';
import { MailType } from '@interfaces/utils.interface';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';
import type {
  InspectionAIAnalyzedPayload,
  InspectionScheduledPayload,
  InspectionSubmittedPayload,
  InspectionCancelledPayload,
  InspectionReviewedPayload,
  InspectionApprovedPayload,
  InspectionDisputedPayload,
  InspectionRejectedPayload,
  InspectionReminderPayload,
} from '@interfaces/events.interface';

import { INotificationContext } from './notification.types';

const formatType = (type: string) => type.replace(/_/g, '-');
const formatDate = (d: Date | string) => new Date(d).toLocaleDateString();
const formatMoney = (cents: number, currency = 'USD') =>
  (cents / 100).toLocaleString(undefined, { style: 'currency', currency });

export async function handleInspectionApproved(
  ctx: INotificationContext,
  payload: InspectionApprovedPayload
): Promise<void> {
  const {
    cuid,
    iuid,
    tenantId,
    inspectorUid,
    refundAmount,
    depositAmount,
    currency = 'USD',
  } = payload;

  try {
    // Notify the inspector/PM so their view refreshes
    if (inspectorUid) {
      const inspectorId = await resolveToObjectId(ctx, inspectorUid);
      await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
        cuid,
        type: NotificationTypeEnum.INSPECTION,
        title: 'Inspection Approved',
        message: 'An inspection has been approved and finalized',
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: inspectorId,
        priority: NotificationPriorityEnum.MEDIUM,
        actionUrl: `/inspections/${cuid}/${iuid}`,
      });
    }

    let message = 'Your inspection has been reviewed and approved';
    if (refundAmount !== undefined && depositAmount !== undefined) {
      message =
        refundAmount > 0
          ? `Your inspection has been approved. A refund of ${formatMoney(refundAmount, currency)} out of your ${formatMoney(depositAmount, currency)} security deposit will be processed`
          : 'Your inspection has been approved. No security deposit refund will be issued';
    }

    const tenant = await lookupUser(ctx, tenantId);
    const actionUrl = tenant?.uid
      ? tenantActionUrl(cuid, tenant.uid, iuid)
      : `/inspections/${cuid}/${iuid}`;

    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Inspection Approved',
      message,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: tenantId,
      priority: NotificationPriorityEnum.MEDIUM,
      actionUrl,
    });

    if (tenant && (await ctx.shouldSendEmail(tenant._id, cuid, NotificationTypeEnum.INSPECTION))) {
      ctx.emailQueue.addToEmailQueue('inspectionApprovedJob', {
        to: tenant.email,
        emailType: MailType.INSPECTION_APPROVED,
        subject: '',
        data: {
          currentuser: tenant,
          refundAmount,
          depositAmount,
          currency,
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

    const tenant = await lookupUser(ctx, tenantId);
    const tenantUrl = tenant?.uid
      ? tenantActionUrl(cuid, tenant.uid, iuid)
      : `/inspections/${cuid}/${iuid}`;
    const pmUrl = `/inspections/${cuid}/${iuid}`;

    // Notify tenant
    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title,
      message,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: tenantId,
      priority: NotificationPriorityEnum.HIGH,
      actionUrl: tenantUrl,
    });

    // Notify inspector
    const inspectorId = await resolveToObjectId(ctx, inspectorUid);
    if (inspectorId) {
      await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
        cuid,
        type: NotificationTypeEnum.INSPECTION,
        title,
        message,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: inspectorId,
        priority: NotificationPriorityEnum.HIGH,
        actionUrl: pmUrl,
      });
    }

    // Email the tenant about rejection
    if (tenant && (await ctx.shouldSendEmail(tenant._id, cuid, NotificationTypeEnum.INSPECTION))) {
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
    const tenant = await lookupUser(ctx, tenantId);
    const actionUrl = tenant?.uid
      ? tenantActionUrl(cuid, tenant.uid, iuid)
      : `/inspections/${cuid}/${iuid}`;

    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Inspection Scheduled',
      message: `A ${formatType(type)} inspection has been scheduled for ${formatDate(scheduledDate)}`,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: tenantId,
      priority: NotificationPriorityEnum.MEDIUM,
      actionUrl,
    });

    if (tenant && (await ctx.shouldSendEmail(tenant._id, cuid, NotificationTypeEnum.INSPECTION))) {
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
    const inspectorId = await resolveToObjectId(ctx, inspectorUid);

    // Notify the inspector/manager that the report is ready for review
    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Inspection Report Submitted',
      message: `A ${formatType(type)} inspection report has been submitted for review`,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: inspectorId,
      priority: NotificationPriorityEnum.MEDIUM,
      actionUrl: `/inspections/${cuid}/${iuid}`,
    });

    const inspector = await lookupUser(ctx, inspectorUid);
    if (
      inspector &&
      (await ctx.shouldSendEmail(inspector._id, cuid, NotificationTypeEnum.INSPECTION))
    ) {
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
    const tenant = await lookupUser(ctx, tenantId);
    const actionUrl = tenant?.uid
      ? tenantActionUrl(cuid, tenant.uid, iuid)
      : `/inspections/${cuid}/${iuid}`;

    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Inspection Cancelled',
      message: 'A scheduled inspection has been cancelled',
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: tenantId,
      priority: NotificationPriorityEnum.LOW,
      actionUrl,
    });

    if (tenant && (await ctx.shouldSendEmail(tenant._id, cuid, NotificationTypeEnum.INSPECTION))) {
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
    const tenant = await lookupUser(ctx, tenantId);
    let actionUrl: string;
    if (iuid && tenant?.uid) {
      actionUrl = tenantActionUrl(cuid, tenant.uid, iuid);
    } else if (luid && tenant?.uid) {
      actionUrl = `/tenants/${cuid}/${tenant.uid}/lease/${luid}`;
    } else if (tenant?.uid) {
      actionUrl = `/tenants/${cuid}/${tenant.uid}/inspections`;
    } else {
      actionUrl = `/inspections/${cuid}`;
    }

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

export async function handleInspectionAIAnalyzed(
  ctx: INotificationContext,
  payload: InspectionAIAnalyzedPayload
): Promise<void> {
  const { cuid, iuid, riskFlagCount } = payload;

  try {
    const riskNote =
      riskFlagCount > 0
        ? `${riskFlagCount} risk flag${riskFlagCount > 1 ? 's' : ''} detected`
        : 'No risk flags detected';

    // Notify approvers (PM / account admin) that AI analysis is ready
    const approvers = await ctx.findApprovers('system', cuid);
    for (const approverId of approvers) {
      await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
        cuid,
        type: NotificationTypeEnum.INSPECTION,
        title: 'AI Analysis Complete',
        message: `AI analysis for inspection is ready. ${riskNote}`,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: approverId,
        priority: riskFlagCount > 0 ? NotificationPriorityEnum.HIGH : NotificationPriorityEnum.LOW,
        actionUrl: `/inspections/${cuid}/${iuid}`,
      });
    }
  } catch (err) {
    ctx.log.error({ err, iuid, cuid }, 'Failed to handle inspection AI analyzed notification');
  }
}

export async function handleInspectionReviewed(
  ctx: INotificationContext,
  payload: InspectionReviewedPayload
): Promise<void> {
  const { cuid, iuid, tenantId, type } = payload;
  if (!tenantId) return;

  try {
    const tenant = await lookupUser(ctx, tenantId);
    const actionUrl = tenant?.uid
      ? tenantActionUrl(cuid, tenant.uid, iuid)
      : `/inspections/${cuid}/${iuid}`;

    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Inspection Review Complete',
      message: `Your property manager has reviewed your ${formatType(type)} inspection. Please review the findings and submit your response.`,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: tenantId,
      priority: NotificationPriorityEnum.HIGH,
      actionUrl,
    });
  } catch (err) {
    ctx.log.error({ err, iuid, cuid }, 'Failed to handle inspection reviewed notification');
  }
}

export async function handleInspectionDisputed(
  ctx: INotificationContext,
  payload: InspectionDisputedPayload
): Promise<void> {
  const { cuid, iuid, inspectorUid, disputeNotes } = payload;

  try {
    const inspectorId = await resolveToObjectId(ctx, inspectorUid);

    await ctx.createNotification(cuid, NotificationTypeEnum.INSPECTION, {
      cuid,
      type: NotificationTypeEnum.INSPECTION,
      title: 'Inspection Disputed',
      message: `Tenant has disputed the inspection: ${disputeNotes.substring(0, 100)}`,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: inspectorId,
      priority: NotificationPriorityEnum.HIGH,
      actionUrl: `/inspections/${cuid}/${iuid}`,
    });
  } catch (err) {
    ctx.log.error({ err, iuid, cuid }, 'Failed to handle inspection disputed notification');
  }
}

async function lookupUser(ctx: INotificationContext, userId: string) {
  try {
    const isObjectId =
      Types.ObjectId.isValid(userId) && String(new Types.ObjectId(userId)) === userId;
    const filter = isObjectId
      ? { _id: new Types.ObjectId(userId), deletedAt: null }
      : { uid: userId, deletedAt: null };

    const user = await ctx.userDAO.findFirst(filter, {
      populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' },
    });
    if (!user?.email) return null;
    return {
      _id: user._id.toString(),
      uid: user.uid,
      firstName: user?.profile?.personalInfo?.firstName || user.email,
      lastName: user?.profile?.personalInfo?.lastName || '',
      email: user.email,
    };
  } catch (err) {
    ctx.log.warn({ err, userId }, 'lookupUser: failed to fetch user for email notification');
    return null;
  }
}

/**
 * Resolves a uid string to a MongoDB _id string.
 * If the input is already a valid ObjectId, returns it as-is.
 */
async function resolveToObjectId(ctx: INotificationContext, uidOrId: string): Promise<string> {
  if (Types.ObjectId.isValid(uidOrId) && String(new Types.ObjectId(uidOrId)) === uidOrId) {
    return uidOrId;
  }
  const user = await ctx.userDAO.findFirst({ uid: uidOrId, deletedAt: null });
  return user?._id?.toString() ?? uidOrId;
}

function tenantActionUrl(cuid: string, uid: string, iuid: string): string {
  return `/tenants/${cuid}/${uid}/inspections/${iuid}`;
}
