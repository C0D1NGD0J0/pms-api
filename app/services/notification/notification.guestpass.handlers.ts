import { Types } from 'mongoose';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';
import {
  GuestPassValidatedPayload,
  GuestPassCreatedPayload,
  GuestPassRevokedPayload,
  GuestPassExpiredPayload,
} from '@interfaces/events.interface';

import { INotificationContext } from './notification.types';
import { notifyAnnouncement } from './notification.helpers';

const SECURITY_DEPARTMENTS = ['security'] as const;
const STAFF_ROLES = ['staff'] as const;

export async function handleGuestPassCreated(
  ctx: INotificationContext,
  payload: GuestPassCreatedPayload
): Promise<void> {
  const { cuid, vpuid, visitorName, propertyId } = payload;

  try {
    const property = await ctx.propertyDAO.findFirst({
      _id: new Types.ObjectId(propertyId),
      cuid,
    });
    const propertyName = property?.name || 'Property';

    // Notify security staff assigned to this property
    const assignedStaff = property?.assignedStaff || [];
    const securityStaffIds: string[] = [];

    if (assignedStaff.length > 0) {
      // Filter to security department only
      const profiles = await Promise.all(
        assignedStaff.map((userId: any) =>
          ctx.userDAO.findFirst(
            { _id: userId, deletedAt: null },
            { populate: { path: 'profile', select: 'employeeInfo.department' } }
          )
        )
      );

      for (const user of profiles) {
        if ((user as any)?.profile?.employeeInfo?.department === 'security') {
          securityStaffIds.push(user!._id.toString());
        }
      }
    }

    if (securityStaffIds.length > 0) {
      // Notify specific assigned security staff
      for (const staffId of securityStaffIds) {
        await ctx.createNotification(cuid, NotificationTypeEnum.GUESTPASS, {
          cuid,
          type: NotificationTypeEnum.GUESTPASS,
          title: 'New Visitor Expected',
          message: `${visitorName} visiting ${propertyName}`,
          priority: NotificationPriorityEnum.HIGH,
          recipient: staffId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          metadata: {
            vpuid,
            propertyId,
            visitorName,
            targetDepartment: 'security',
          },
        });
      }
    } else {
      // Fallback: broadcast to all security staff in cuid
      await notifyAnnouncement(
        ctx,
        cuid,
        NotificationTypeEnum.GUESTPASS,
        'guestPass.created' as any,
        { visitorName, propertyName },
        STAFF_ROLES,
        { vpuid, propertyId, visitorName, targetDepartment: 'security' },
        NotificationPriorityEnum.HIGH,
        SECURITY_DEPARTMENTS
      );
    }

    // SSE broadcast for real-time UI updates
    ctx.sseService.broadcastToClient(
      cuid,
      {
        vpuid,
        visitorName,
        propertyName,
        propertyId,
      },
      'guest-pass-created',
      undefined,
      ['staff']
    );
  } catch (err) {
    ctx.log.error({ err, vpuid, cuid }, 'Failed to handle guest pass created notification');
  }
}

export async function handleGuestPassRevoked(
  ctx: INotificationContext,
  payload: GuestPassRevokedPayload
): Promise<void> {
  const { cuid, vpuid, revokedBy } = payload;

  try {
    const pass = await ctx.guestPassDAO.findFirst({ vpuid, cuid });
    if (!pass) return;

    const property = await ctx.propertyDAO.findFirst({ _id: pass.propertyId, cuid });
    const propertyName = property?.name || 'Property';

    const assignedStaff = property?.assignedStaff || [];
    const securityStaffIds: string[] = [];

    if (assignedStaff.length > 0) {
      const profiles = await Promise.all(
        assignedStaff.map((userId: any) =>
          ctx.userDAO.findFirst(
            { _id: userId, deletedAt: null },
            { populate: { path: 'profile', select: 'employeeInfo.department' } }
          )
        )
      );

      for (const user of profiles) {
        if ((user as any)?.profile?.employeeInfo?.department === 'security') {
          securityStaffIds.push(user!._id.toString());
        }
      }
    }

    if (securityStaffIds.length > 0) {
      for (const staffId of securityStaffIds) {
        if (ctx.isSelfNotification(revokedBy, staffId)) continue;

        await ctx.createNotification(cuid, NotificationTypeEnum.GUESTPASS, {
          cuid,
          type: NotificationTypeEnum.GUESTPASS,
          title: 'Guest Pass Revoked',
          message: `Pass for ${pass.visitorInfo.name} at ${propertyName} has been cancelled`,
          priority: NotificationPriorityEnum.MEDIUM,
          recipient: staffId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          metadata: { vpuid, propertyId: pass.propertyId.toString(), revokedBy },
        });
      }
    } else {
      await notifyAnnouncement(
        ctx,
        cuid,
        NotificationTypeEnum.GUESTPASS,
        'guestPass.revoked' as any,
        { visitorName: pass.visitorInfo.name, propertyName },
        STAFF_ROLES,
        { vpuid, propertyId: pass.propertyId.toString(), revokedBy, targetDepartment: 'security' },
        NotificationPriorityEnum.MEDIUM,
        SECURITY_DEPARTMENTS
      );
    }

    ctx.log.info({ cuid, vpuid, revokedBy }, 'Guest pass revoked notification sent');
  } catch (err) {
    ctx.log.error({ err, vpuid, cuid }, 'Failed to handle guest pass revoked notification');
  }
}

export async function handleGuestPassValidated(
  ctx: INotificationContext,
  payload: GuestPassValidatedPayload
): Promise<void> {
  const { cuid, vpuid, validatedBy } = payload;

  try {
    const pass = await ctx.guestPassDAO.findFirst({ vpuid, cuid });
    if (!pass) return;

    const creatorId = pass.createdBy.toString();
    if (ctx.isSelfNotification(validatedBy, creatorId)) return;

    const property = await ctx.propertyDAO.findFirst({ _id: pass.propertyId, cuid });
    const propertyName = property?.name || 'Property';
    const validatorName = await ctx.getUserDisplayName(validatedBy, cuid);

    await ctx.createNotification(cuid, NotificationTypeEnum.GUESTPASS, {
      cuid,
      type: NotificationTypeEnum.GUESTPASS,
      title: 'Visitor Arrived',
      message: `${pass.visitorInfo.name} has checked in at ${propertyName}. Verified by ${validatorName}.`,
      priority: NotificationPriorityEnum.MEDIUM,
      recipient: creatorId,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      metadata: { vpuid, propertyId: pass.propertyId.toString(), validatedBy },
    });

    ctx.log.info({ cuid, vpuid, validatedBy, creatorId }, 'Guest pass validated notification sent');
  } catch (err) {
    ctx.log.error({ err, vpuid, cuid }, 'Failed to handle guest pass validated notification');
  }
}

export async function handleGuestPassExpired(
  ctx: INotificationContext,
  payload: GuestPassExpiredPayload
): Promise<void> {
  const { count } = payload;

  try {
    ctx.log.info({ count }, 'Guest passes expired — batch notification');
    // No user-facing notification needed for expiry — it's a background cleanup.
    // If needed in future, iterate passes and notify creators.
  } catch (err) {
    ctx.log.error({ err, count }, 'Failed to handle guest pass expired notification');
  }
}
