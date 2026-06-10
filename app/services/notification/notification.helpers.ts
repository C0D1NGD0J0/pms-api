import { Types } from 'mongoose';
import { MailType } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';
import {
  ICreateNotificationRequest,
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';

import { INotificationContext } from './notification.types';
import { getFormattedNotification, NotificationMessageKey } from './notificationMessages';

export const MGMT_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN] as const;
export const ALL_STAFF_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF] as const;

/**
 * Fetch a maintenance request + user by ID, then enqueue an email.
 * Each step is isolated in its own try-catch so one failure doesn't block the other.
 */
export async function fetchRequestAndEnqueueEmail(
  ctx: INotificationContext,
  params: {
    mruid: string;
    cuid: string;
    userId: string;
    emailTemplate: string;
    emailType: MailType;
    buildData: (request: any, user: any) => object;
    errorLabel: string;
  }
): Promise<void> {
  const { mruid, cuid, userId, emailTemplate, emailType, buildData, errorLabel } = params;
  try {
    const [request, user] = await Promise.all([
      ctx.maintenanceRequestDAO.getByMruid(mruid, cuid),
      ctx.userDAO.findFirst(
        { _id: new Types.ObjectId(userId), deletedAt: null },
        { populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' } }
      ),
    ]);
    if (request && user?.email) {
      const shapedUser = {
        firstName: user?.profile?.personalInfo?.firstName || user?.email,
        lastName: user?.profile?.personalInfo?.lastName || '',
        email: user?.email,
      };
      ctx.emailQueue.addToEmailQueue(emailTemplate, {
        to: user.email,
        emailType,
        subject: '',
        data: buildData(request, shapedUser),
      });
    }
  } catch (err) {
    ctx.log.error({ err, mruid }, `Failed to enqueue ${errorLabel} email`);
  }
}

/**
 * Send the same notification to multiple individual recipients, skipping nullish values
 * and deduplicating ids that appear more than once.
 * Replaces the repeated vendor+technician pattern.
 */
export async function notifyIndividuals(
  ctx: INotificationContext,
  cuid: string,
  type: NotificationTypeEnum,
  messageKey: NotificationMessageKey,
  vars: Record<string, any>,
  recipientIds: (string | undefined | null)[],
  metadata: Record<string, any>,
  priority: NotificationPriorityEnum = NotificationPriorityEnum.MEDIUM
): Promise<void> {
  const { title, message } = getFormattedNotification(messageKey, vars);
  const seen = new Set<string>();

  for (const id of recipientIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const data: ICreateNotificationRequest = {
      cuid,
      type,
      title,
      message,
      priority,
      recipient: id,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      metadata,
    };
    await ctx.createNotification(cuid, type, data);
  }
}

/**
 * Send an announcement notification to a set of target roles.
 * Replaces the repeated pattern of: getFormattedNotification → createNotification(ANNOUNCEMENT).
 */
export async function notifyAnnouncement(
  ctx: INotificationContext,
  cuid: string,
  type: NotificationTypeEnum,
  messageKey: NotificationMessageKey,
  vars: Record<string, any>,
  targetRoles: readonly string[],
  metadata: Record<string, any>,
  priority: NotificationPriorityEnum = NotificationPriorityEnum.MEDIUM
): Promise<void> {
  const { title, message } = getFormattedNotification(messageKey, vars);
  const data: ICreateNotificationRequest = {
    cuid,
    type,
    title,
    message,
    priority,
    recipientType: RecipientTypeEnum.ANNOUNCEMENT,
    targetRoles: targetRoles as string[],
    metadata,
  };
  await ctx.createNotification(cuid, type, data);
}
