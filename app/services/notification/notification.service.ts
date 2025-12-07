import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/helpers';
import { ICurrentUser } from '@interfaces/user.interface';
import { EventTypes } from '@interfaces/events.interface';
import { ResourceContext } from '@interfaces/utils.interface';
import { NotificationDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { PROPERTY_APPROVAL_ROLES, PROPERTY_STAFF_ROLES } from '@utils/constants';
import { ISuccessReturnData, IPaginationQuery } from '@interfaces/utils.interface';
import { EventEmitterService, ProfileService, UserService, SSEService } from '@services/index';
import {
  CreateNotificationWithRulesSchema,
  UpdateNotificationSchema,
} from '@shared/validations/NotificationValidation';
import {
  ICreateNotificationRequest,
  IUpdateNotificationRequest,
  NotificationPriorityEnum,
  INotificationDocument,
  INotificationFilters,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';

import { getFormattedNotification, NotificationMessageKey } from './notificationMessages';

interface IConstructor {
  emitterService: EventEmitterService;
  notificationDAO: NotificationDAO;
  profileService: ProfileService;
  userService: UserService;
  profileDAO: ProfileDAO;
  sseService: SSEService;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class NotificationService {
  private readonly notificationDAO: NotificationDAO;
  private readonly emitterService: EventEmitterService;
  private readonly userService: UserService;
  private readonly sseService: SSEService;
  private readonly profileService: ProfileService;
  private readonly profileDAO: ProfileDAO;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private readonly log: Logger;

  constructor({
    notificationDAO,
    emitterService,
    profileDAO,
    clientDAO,
    userDAO,
    userService,
    sseService,
    profileService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.sseService = sseService;
    this.profileDAO = profileDAO;
    this.userService = userService;
    this.emitterService = emitterService;
    this.profileService = profileService;
    this.notificationDAO = notificationDAO;
    this.log = createLogger('NotificationService');

    this.setupEventListeners();
  }

  async createNotification(
    cuid: string,
    notificationType: NotificationTypeEnum,
    data: ICreateNotificationRequest
  ): Promise<ISuccessReturnData<INotificationDocument>> {
    try {
      this.log.info('Creating notification', {
        type: notificationType,
        recipient: data.recipient,
        recipientType: data.recipientType,
        cuid,
      });

      if (!cuid) {
        const errorMsg = 'Client ID (cuid) is required';
        this.log.error(errorMsg);
        return {
          success: false,
          data: null as any,
          message: errorMsg,
        };
      }

      const validationResult = await CreateNotificationWithRulesSchema.safeParseAsync(data);
      if (!validationResult.success) {
        const errorMsg = 'Validation failed';
        const errors = validationResult.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');

        this.log.error(errorMsg, {
          errors: validationResult.error.issues,
          data: { type: notificationType, recipientType: data.recipientType },
        });

        return {
          success: false,
          data: null as any,
          message: `${errorMsg}: ${errors}`,
        };
      }

      const validatedData = validationResult.data;

      if (validatedData.recipientType === RecipientTypeEnum.INDIVIDUAL && validatedData.recipient) {
        const recipientId =
          typeof validatedData.recipient === 'string'
            ? validatedData.recipient
            : String(validatedData.recipient);

        const shouldSend = await this.checkUserNotificationPreferences(
          recipientId,
          cuid,
          notificationType,
          validatedData
        );

        if (!shouldSend) {
          this.log.info('Notification skipped due to user preferences', {
            userId: recipientId,
            notificationType,
            cuid,
          });

          return {
            success: true,
            data: null as any,
            message: 'Notification skipped due to user preferences',
          };
        }
      }

      const notificationToCreate: any = {
        title: validatedData.title,
        message: validatedData.message,
        type: notificationType,
        recipientType: validatedData.recipientType,
        priority: validatedData.priority,
        actionUrl: validatedData.actionUrl,
        metadata: validatedData.metadata,
        expiresAt: validatedData.expiresAt,
        targetRoles: validatedData.targetRoles,
        targetVendor: validatedData.targetVendor,
        cuid,
        isRead: false,
      };

      if (validatedData.recipient) {
        notificationToCreate.recipient =
          typeof validatedData.recipient === 'string'
            ? new Types.ObjectId(validatedData.recipient)
            : validatedData.recipient;
      }

      if (validatedData.resourceInfo) {
        notificationToCreate.resourceInfo = {
          resourceName: validatedData.resourceInfo.resourceName,
          resourceUid: validatedData.resourceInfo.resourceUid,
          resourceId:
            typeof validatedData.resourceInfo.resourceId === 'string'
              ? new Types.ObjectId(validatedData.resourceInfo.resourceId)
              : validatedData.resourceInfo.resourceId,
          displayName: validatedData.resourceInfo.displayName,
        };
      }

      const notification = await this.notificationDAO.create(notificationToCreate);

      if (!notification) {
        const errorMsg = 'Failed to create notification';
        this.log.error(errorMsg, {
          data: {
            type: notificationType,
            recipient: validatedData.recipient,
            recipientType: validatedData.recipientType,
            cuid,
          },
        });

        return {
          success: false,
          data: null as any,
          message: errorMsg,
        };
      }

      this.log.info('Notification created successfully', {
        notificationId: notification.nuid,
        type: notification.type,
        recipient: notification.recipient,
        recipientType: notification.recipientType,
        cuid: notification.cuid,
      });

      await this.publishToSSE(notification);

      return {
        success: true,
        data: notification,
        message: 'Notification created successfully',
      };
    } catch (error) {
      const errorMsg = 'Unexpected error creating notification';
      this.log.error(errorMsg, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        data: { type: notificationType, recipient: data.recipient, cuid },
      });

      return {
        success: false,
        data: null as any,
        message: errorMsg,
      };
    }
  }

  async getNotifications(
    cuid: string,
    userId: ICurrentUser['sub'],
    filters?: INotificationFilters,
    pagination?: IPaginationQuery
  ): Promise<ISuccessReturnData<{ notifications: INotificationDocument[]; total: number }>> {
    try {
      if (!userId || !cuid) {
        const errorMsg = 'User ID and Client ID (cuid) are required';
        this.log.error(errorMsg, { userId, cuid });
        return {
          success: false,
          data: null as any,
          message: errorMsg,
        };
      }

      const personalFilters: INotificationFilters = {
        ...filters,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
      };

      const targetingInfo = { roles: [], vendorId: undefined };
      const result = await this.notificationDAO.findForUser(
        userId,
        cuid,
        targetingInfo,
        personalFilters,
        pagination
      );

      return {
        success: true,
        data: {
          notifications: result.data,
          total: result.total,
        },
        message: 'Notifications retrieved successfully',
      };
    } catch (error) {
      const errorMsg = 'Unexpected error retrieving notifications';
      this.log.error(errorMsg, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId,
        cuid,
        filters,
      });

      return {
        success: false,
        data: null as any,
        message: errorMsg,
      };
    }
  }

  async getAnnouncements(
    cuid: string,
    userId: string,
    filters?: INotificationFilters,
    pagination?: IPaginationQuery
  ): Promise<ISuccessReturnData<{ notifications: INotificationDocument[]; total: number }>> {
    try {
      if (!userId || !cuid) {
        const errorMsg = 'User ID and Client ID (cuid) are required';
        this.log.error(errorMsg, { userId, cuid });
        return {
          success: false,
          data: null as any,
          message: errorMsg,
        };
      }

      const announcementFilters: INotificationFilters = {
        ...filters,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
      };

      const targetingInfo = await this.userService.getUserAnnouncementFilters(userId, cuid);

      const result = await this.notificationDAO.findForUser(
        userId,
        cuid,
        targetingInfo,
        announcementFilters,
        pagination
      );

      return {
        success: true,
        data: {
          notifications: result.data,
          total: result.total,
        },
        message: 'Announcements retrieved successfully',
      };
    } catch (error) {
      const errorMsg = 'Unexpected error retrieving announcements';
      this.log.error(errorMsg, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        userId,
        cuid,
        filters,
      });

      return {
        success: false,
        data: null as any,
        message: errorMsg,
      };
    }
  }

  async getNotificationById(
    notificationId: string,
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData<INotificationDocument>> {
    try {
      this.log.info('Getting notification by ID', {
        notificationId,
        userId,
        cuid,
      });

      if (!notificationId || !userId || !cuid) {
        const errorMsg = 'Notification ID, User ID, and Client ID (cuid) are required';
        this.log.error(errorMsg, { notificationId, userId, cuid });
        return {
          success: false,
          data: null as any,
          message: errorMsg,
        };
      }

      const notification = await this.notificationDAO.findByNuid(notificationId, cuid);

      if (!notification) {
        const errorMsg = 'Notification not found';
        this.log.warn(errorMsg, { notificationId, userId, cuid });
        return {
          success: false,
          data: null as any,
          message: errorMsg,
        };
      }

      if (
        notification.recipientType === 'individual' &&
        notification.recipient?.toString() !== userId
      ) {
        const errorMsg = 'Access denied to this notification';
        this.log.warn(errorMsg, {
          notificationId,
          userId,
          actualRecipient: notification.recipient?.toString(),
          recipientType: notification.recipientType,
        });
        return {
          success: false,
          data: null as any,
          message: errorMsg,
        };
      }

      this.log.info('Retrieved notification successfully', {
        notificationId: notification.nuid,
        type: notification.type,
        recipientType: notification.recipientType,
        userId,
        cuid,
      });

      return {
        success: true,
        data: notification,
        message: 'Notification retrieved successfully',
      };
    } catch (error) {
      const errorMsg = 'Unexpected error retrieving notification';
      this.log.error(errorMsg, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        notificationId,
        userId,
        cuid,
      });

      return {
        success: false,
        data: null as any,
        message: errorMsg,
      };
    }
  }

  async updateNotification(
    notificationId: string,
    userId: string,
    cuid: string,
    updates: IUpdateNotificationRequest
  ): Promise<ISuccessReturnData<INotificationDocument>> {
    try {
      this.log.info('Updating notification', {
        notificationId,
        userId,
        cuid,
        updates,
      });

      // Basic validation
      if (!notificationId || !userId || !cuid) {
        const errorMsg = 'Notification ID, User ID, and Client ID (cuid) are required';
        this.log.error(errorMsg, { notificationId, userId, cuid });
        return {
          success: false,
          data: null as any,
          message: errorMsg,
        };
      }

      // Validate updates with Zod schema
      const validationResult = await UpdateNotificationSchema.safeParseAsync(updates);
      if (!validationResult.success) {
        const errorMsg = 'Validation failed';
        const errors = validationResult.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');

        this.log.error(errorMsg, {
          errors: validationResult.error.issues,
          updates,
        });

        return {
          success: false,
          data: null as any,
          message: `${errorMsg}: ${errors}`,
        };
      }

      // First, check if notification exists and user has access
      const existingNotification = await this.notificationDAO.findByNuid(notificationId, cuid);

      if (!existingNotification) {
        const errorMsg = 'Notification not found';
        this.log.warn(errorMsg, { notificationId, userId, cuid });
        return {
          success: false,
          data: null as any,
          message: errorMsg,
        };
      }

      // Check access permissions
      if (
        existingNotification.recipientType === 'individual' &&
        existingNotification.recipient?.toString() !== userId
      ) {
        const errorMsg = 'Access denied to update this notification';
        this.log.warn(errorMsg, {
          notificationId,
          userId,
          actualRecipient: existingNotification.recipient?.toString(),
          recipientType: existingNotification.recipientType,
        });
        return {
          success: false,
          data: null as any,
          message: errorMsg,
        };
      }

      // Update notification
      const updatedNotification = await this.notificationDAO.updateById(
        existingNotification._id.toString(),
        validationResult.data
      );

      if (!updatedNotification) {
        const errorMsg = 'Failed to update notification';
        this.log.error(errorMsg, { notificationId, userId, cuid, updates });
        return {
          success: false,
          data: null as any,
          message: errorMsg,
        };
      }

      this.log.info('Notification updated successfully', {
        notificationId: updatedNotification.nuid,
        userId,
        cuid,
        changes: Object.keys(validationResult.data),
      });

      return {
        success: true,
        data: updatedNotification,
        message: 'Notification updated successfully',
      };
    } catch (error) {
      const errorMsg = 'Unexpected error updating notification';
      this.log.error(errorMsg, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        notificationId,
        userId,
        cuid,
        updates,
      });

      return {
        success: false,
        data: null as any,
        message: errorMsg,
      };
    }
  }

  async deleteNotification(
    notificationId: string,
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData<boolean>> {
    try {
      this.log.info('Deleting notification', {
        notificationId,
        userId,
        cuid,
      });

      // Basic validation
      if (!notificationId || !userId || !cuid) {
        const errorMsg = 'Notification ID, User ID, and Client ID (cuid) are required';
        this.log.error(errorMsg, { notificationId, userId, cuid });
        return {
          success: false,
          data: false,
          message: errorMsg,
        };
      }

      // First, check if notification exists and user has access
      const existingNotification = await this.notificationDAO.findByNuid(notificationId, cuid);

      if (!existingNotification) {
        const errorMsg = 'Notification not found';
        this.log.warn(errorMsg, { notificationId, userId, cuid });
        return {
          success: false,
          data: false,
          message: errorMsg,
        };
      }

      // Check access permissions
      if (
        existingNotification.recipientType === 'individual' &&
        existingNotification.recipient?.toString() !== userId
      ) {
        const errorMsg = 'Access denied to delete this notification';
        this.log.warn(errorMsg, {
          notificationId,
          userId,
          actualRecipient: existingNotification.recipient?.toString(),
          recipientType: existingNotification.recipientType,
        });
        return {
          success: false,
          data: false,
          message: errorMsg,
        };
      }

      // Delete notification
      const deleted = await this.notificationDAO.deleteByNuid(notificationId, cuid);

      if (!deleted) {
        const errorMsg = 'Failed to delete notification';
        this.log.error(errorMsg, { notificationId, userId, cuid });
        return {
          success: false,
          data: false,
          message: errorMsg,
        };
      }

      this.log.info('Notification deleted successfully', {
        notificationId,
        userId,
        cuid,
        type: existingNotification.type,
        recipientType: existingNotification.recipientType,
      });

      return {
        success: true,
        data: true,
        message: 'Notification deleted successfully',
      };
    } catch (error) {
      const errorMsg = 'Unexpected error deleting notification';
      this.log.error(errorMsg, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        notificationId,
        userId,
        cuid,
      });

      return {
        success: false,
        data: false,
        message: errorMsg,
      };
    }
  }

  /**
   * Notify about property updates - sends to property manager and supervisor if needed
   */
  async notifyPropertyUpdate(
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

      // If property manager exists and it's not the actor, notify them
      if (propertyManagerId && !this.isSelfNotification(actorUserId, propertyManagerId)) {
        await this.createNotificationFromTemplate(
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

        this.log.info('Notified property manager of update', {
          propertyId: resourceInfo.resourceId,
          propertyManagerId,
          actorUserId,
        });
      }

      // Find supervisor if property manager needs approval
      const supervisorId = await this.findUserSupervisor(propertyManagerId || actorUserId, cuid);
      if (supervisorId && !this.isSelfNotification(actorUserId, supervisorId)) {
        await this.createNotificationFromTemplate(
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

        this.log.info('Notified supervisor of property update', {
          propertyId: resourceInfo.resourceId,
          supervisorId,
          actorUserId,
        });
      }
    } catch (error) {
      this.log.error('Failed to send property update notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        propertyId: resourceInfo.resourceId,
        actorUserId,
        cuid,
      });
    }
  }

  /**
   * Notify about approval needed - sends to appropriate approvers
   */
  async notifyApprovalNeeded(
    resource: {
      resourceId: string;
      resourceUid: string;
      resourceName: string;
    },
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

      // Find supervisor who can approve
      const approverIds = await this.findApprovers(requesterId, cuid);

      for (const approverId of approverIds) {
        if (!this.isSelfNotification(requesterId, approverId)) {
          await this.createNotificationFromTemplate(
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

          this.log.info('Sent approval needed notification', {
            resourceUid: resource.resourceUid,
            approverId,
            requesterId,
          });
        }
      }
    } catch (error) {
      this.log.error('Failed to send approval needed notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        resourceUid: resource.resourceUid,
        requesterId,
        cuid,
      });
    }
  }

  /**
   * Notify about approval decision (approved/rejected)
   */
  async notifyApprovalDecision(
    resource: {
      resourceId: string;
      resourceName: string;
      resourceUid: string;
    },
    approverId: string,
    cuid: string,
    decision: 'approved' | 'rejected',
    originalRequesterId: string,
    reason?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      if (this.isSelfNotification(approverId, originalRequesterId)) {
        this.log.debug('Skipping self-notification for approval decision', {
          approverId,
          originalRequesterId,
        });
        return;
      }

      const messageKey = decision === 'approved' ? 'property.approved' : 'property.rejected';
      const messageVars = {
        propertyName: resource.resourceName,
        approverName: await this.getUserDisplayName(approverId, cuid),
        reason: reason || 'No reason provided',
      };

      const priority =
        decision === 'rejected' ? NotificationPriorityEnum.HIGH : NotificationPriorityEnum.LOW;

      await this.createNotificationFromTemplate(
        messageKey as NotificationMessageKey,
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

      this.log.info('Sent approval decision notification', {
        resourceId: resource.resourceId,
        decision,
        approverId,
        originalRequesterId,
      });
    } catch (error) {
      this.log.error('Failed to send approval decision notification', {
        error: error instanceof Error ? error.message : 'Unknown error',
        resourceId: resource.resourceId,
        approverId,
        decision,
      });
    }
  }

  /**
   * Handle property update notifications based on user role and context
   * This method consolidates all notification logic for property updates
   */
  async handlePropertyUpdateNotifications(params: {
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
  }): Promise<void> {
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
        await this.notifyApprovalNeeded(
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

        this.log.info('Sent staff update approval notification', {
          propertyId: resource.resourceId,
          actorUserId,
          userRole,
        });
      } else if ((PROPERTY_APPROVAL_ROLES as string[]).includes(userRole)) {
        // Admin/Manager update - notify property manager if exists
        await this.notifyPropertyUpdate(
          { ...resource, resourceName: ResourceContext.PROPERTY },
          propertyName,
          actorUserId,
          actorDisplayName,
          cuid,
          updateData,
          propertyManagerId
        );

        this.log.info('Sent admin/manager update notification', {
          propertyId: updatedProperty.pid,
          actorUserId,
          userRole,
          propertyManagerId,
          isDirectUpdate,
        });
      }
    } catch (error) {
      this.log.error('Failed to send property update notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        propertyId: updatedProperty.pid,
        actorUserId,
        userRole,
      });
    }
  }

  /**
   * Notify staff when their pending changes are overridden by admin
   */
  async notifyPendingChangesOverridden(
    propertyId: string,
    propertyName: string,
    adminUserId: string,
    adminName: string,
    originalRequesterId: string,
    cuid: string,
    context: {
      address?: string;
      overriddenAt: Date;
      overrideReason: string;
    }
  ): Promise<void> {
    try {
      // Don't notify if admin is overriding their own changes
      if (this.isSelfNotification(adminUserId, originalRequesterId)) {
        this.log.debug('Skipping self-notification for pending changes override', {
          adminUserId,
          originalRequesterId,
        });
        return;
      }

      const messageVars = {
        propertyName,
        adminName,
        overrideReason: context.overrideReason,
        address: context.address || 'N/A',
      };

      await this.createNotificationFromTemplate(
        'property.pendingChangesOverridden' as NotificationMessageKey,
        messageVars,
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

      this.log.info('Staff notified of pending changes override', {
        propertyId,
        adminUserId,
        originalRequesterId,
        cuid,
      });
    } catch (error) {
      this.log.error('Failed to notify staff of pending changes override', {
        error: error instanceof Error ? error.message : 'Unknown error',
        propertyId,
        adminUserId,
        originalRequesterId,
      });
      throw error;
    }
  }

  /**
   * Notify relevant parties when lease is sent for e-signature
   */
  async notifyLeaseESignatureSent(params: {
    leaseNumber: string;
    leaseName: string;
    tenantId: string;
    propertyManagerId: string;
    envelopeId: string;
    actorId: string;
    cuid: string;
    resource: { resourceId: string; resourceUid: string; resourceType: ResourceContext };
  }): Promise<void> {
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
      // Notify property manager/landlord
      await this.createNotification(cuid, NotificationTypeEnum.LEASE, {
        type: NotificationTypeEnum.LEASE,
        priority: NotificationPriorityEnum.MEDIUM,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: propertyManagerId,
        author: actorId,
        title: 'Lease Sent for Signature',
        message: `${leaseName} has been sent for e-signature.`,
        metadata: {
          leaseNumber,
          envelopeId,
          action: 'lease_esignature_sent',
        },
        resourceInfo: {
          resourceId: resource.resourceId,
          resourceUid: resource.resourceUid,
          resourceName: resource.resourceType,
        },
        cuid,
      });

      // Notify tenant
      await this.createNotification(cuid, NotificationTypeEnum.LEASE, {
        type: NotificationTypeEnum.LEASE,
        priority: NotificationPriorityEnum.HIGH,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: tenantId,
        author: actorId,
        title: 'Please Sign Your Lease',
        message: `${leaseName} is ready for your signature. Please check your email for the signing link.`,
        metadata: {
          leaseNumber,
          envelopeId,
          action: 'lease_esignature_sent',
        },
        resourceInfo: {
          resourceId: resource.resourceId,
          resourceUid: resource.resourceUid,
          resourceName: resource.resourceType,
        },
        cuid,
      });

      this.log.info('Lease e-signature sent notifications created', {
        leaseNumber,
        tenantId,
        propertyManagerId,
        envelopeId,
      });
    } catch (error) {
      this.log.error('Failed to send lease e-signature sent notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        leaseNumber,
        envelopeId,
      });
    }
  }

  /**
   * Notify property manager when lease e-signature request fails
   */
  async notifyLeaseESignatureFailed(params: {
    leaseNumber: string;
    error: string;
    propertyManagerId: string;
    actorId: string;
    cuid: string;
    resource: { resourceId: string; resourceUid: string; resourceType: ResourceContext };
  }): Promise<void> {
    const { leaseNumber, error, propertyManagerId, actorId, cuid, resource } = params;

    try {
      await this.createNotification(cuid, NotificationTypeEnum.LEASE, {
        type: NotificationTypeEnum.LEASE,
        priority: NotificationPriorityEnum.HIGH,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: propertyManagerId,
        author: actorId,
        title: 'Failed to Send Lease for Signature',
        message: `Failed to send ${leaseNumber} for e-signature: ${error}`,
        metadata: {
          leaseNumber,
          error,
          action: 'lease_esignature_failed',
        },
        resourceInfo: {
          resourceId: resource.resourceId,
          resourceUid: resource.resourceUid,
          resourceName: resource.resourceType,
        },
        cuid,
      });

      this.log.info('Lease e-signature failed notification created', {
        leaseNumber,
        propertyManagerId,
        error,
      });
    } catch (notificationError) {
      this.log.error('Failed to send lease e-signature failed notification', {
        error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
        leaseNumber,
      });
    }
  }

  /**
   * Find user's supervisor - delegates to UserService
   */
  async findUserSupervisor(userId: string, cuid: string): Promise<string | null> {
    return this.userService.getUserSupervisor(userId, cuid);
  }

  /**
   * Find users who can approve - implements selective role-based notification logic
   * Priority: (1) Direct supervisor, (2) Client accountAdmin as fallback
   * Includes deduplication logic to prevent duplicate notifications
   */
  private async findApprovers(userId: string, cuid: string): Promise<string[]> {
    try {
      const approvers: string[] = [];

      // find direct supervisor
      const supervisorId = await this.findUserSupervisor(userId, cuid);
      if (supervisorId && !this.isSelfNotification(userId, supervisorId)) {
        approvers.push(supervisorId);
        this.log.info('Found direct supervisor for approval', {
          userId,
          supervisorId,
          cuid,
        });
      }

      // opt b: find client's accountAdmin as fallback (only if no supervisor found)
      if (approvers.length === 0) {
        const accountAdminId = await this.getClientAccountAdmin(cuid);
        if (accountAdminId && !this.isSelfNotification(userId, accountAdminId)) {
          approvers.push(accountAdminId);
          this.log.info('Using client accountAdmin as fallback approver', {
            userId,
            accountAdminId,
            cuid,
          });
        }
      } else {
        // opt c: add accountAdmin as secondary approver only if different from supervisor
        const accountAdminId = await this.getClientAccountAdmin(cuid);
        if (
          accountAdminId &&
          !this.isSelfNotification(userId, accountAdminId) &&
          !approvers.includes(accountAdminId)
        ) {
          approvers.push(accountAdminId);
          this.log.info('Added client accountAdmin as secondary approver', {
            userId,
            supervisorId,
            accountAdminId,
            cuid,
          });
        }
      }

      this.log.info('Final approvers list - selective notification logic', {
        userId,
        cuid,
        approversCount: approvers.length,
        approvers: approvers,
        method: 'selective role-based',
      });

      return approvers;
    } catch (error) {
      this.log.error('Failed to find approvers', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        cuid,
      });
      return [];
    }
  }

  /**
   * Get client's accountAdmin user ID
   */
  private async getClientAccountAdmin(cuid: string): Promise<string | null> {
    try {
      const client = await this.clientDAO.findFirst({ cuid });
      if (!client || !client.accountAdmin) {
        this.log.warn('Client not found or no accountAdmin configured', { cuid });
        return null;
      }

      // Handle both ObjectId and populated document cases
      const accountAdminId =
        typeof client.accountAdmin === 'object' && client.accountAdmin._id
          ? client.accountAdmin._id.toString()
          : client.accountAdmin.toString();

      // Validate that the accountAdmin user exists and belongs to this client
      const accountAdmin = await this.userDAO.findFirst({
        _id: new Types.ObjectId(accountAdminId),
        'cuids.cuid': cuid,
      });

      if (!accountAdmin) {
        this.log.warn('Account admin user not found or not connected to client', {
          cuid,
          accountAdminId,
        });
        return null;
      }

      return accountAdminId;
    } catch (error) {
      this.log.error('Failed to get client account admin', {
        error: error instanceof Error ? error.message : 'Unknown error',
        cuid,
      });
      return null;
    }
  }

  /**
   * Get user display name for notifications - delegates to UserService
   */
  private async getUserDisplayName(userId: string, cuid: string): Promise<string> {
    return this.userService.getUserDisplayName(userId, cuid);
  }

  /**
   * Check if notification would be a self-notification
   */
  private isSelfNotification(actorUserId: string, recipientUserId: string): boolean {
    const isSelf = actorUserId === recipientUserId;
    if (isSelf) {
      this.log.debug('Prevented self-notification', { actorUserId, recipientUserId });
    }
    return isSelf;
  }

  /**
   * Create notification using message template
   */
  public async createNotificationFromTemplate(
    messageKey: NotificationMessageKey,
    variables: Record<string, any>,
    recipientId: string,
    type: NotificationTypeEnum,
    priority: NotificationPriorityEnum,
    cuid: string,
    authorId: string,
    resourceInfo?: {
      resourceName: ResourceContext;
      resourceUid: string;
      resourceId: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const { title, message } = getFormattedNotification(messageKey, variables);

    const notificationData: ICreateNotificationRequest = {
      title,
      message,
      type,
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient: recipientId,
      priority,
      cuid,
      metadata: resourceInfo?.metadata,
      author: authorId,
    };

    if (resourceInfo) {
      notificationData.resourceInfo = {
        resourceName: resourceInfo.resourceName,
        resourceUid: resourceInfo.resourceUid,
        resourceId: resourceInfo.resourceId,
      };
    }

    await this.createNotification(cuid, type, notificationData);
  }

  /**
   * Mark notification as read
   */
  async markAsRead(
    notificationId: string,
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData<INotificationDocument>> {
    try {
      this.log.info('Marking notification as read', {
        notificationId,
        userId,
        cuid,
      });

      const result = await this.updateNotification(notificationId, userId, cuid, {
        isRead: true,
        readAt: new Date(),
      });

      if (result.success) {
        this.log.info('Notification marked as read successfully', {
          notificationId,
          userId,
          cuid,
        });
      }

      return result;
    } catch (error) {
      const errorMsg = 'Unexpected error marking notification as read';
      this.log.error(errorMsg, {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        notificationId,
        userId,
        cuid,
      });

      return {
        success: false,
        data: null as any,
        message: errorMsg,
      };
    }
  }

  private async publishToSSE(notification: INotificationDocument): Promise<void> {
    try {
      // Check user preferences for individual notifications
      if (notification.recipientType === 'individual' && notification.recipient) {
        const shouldSend = await this.checkUserNotificationPreferences(
          notification.recipient.toString(),
          notification.cuid,
          notification.type,
          notification
        );

        if (!shouldSend) {
          this.log.debug('Skipping SSE publish due to user preferences', {
            nuid: notification.nuid,
            recipientId: notification.recipient,
            cuid: notification.cuid,
          });
          return;
        }
      }

      if (notification.recipientType === 'individual' && notification.recipient) {
        const notificationData = notification.toObject ? notification.toObject() : notification;
        const ssePayload = {
          notifications: [notificationData],
          total: 1,
          isInitial: false, // Flag to indicate this is a new notification, not initial data
        };

        await this.sseService.sendToUser(
          notification.recipient.toString(),
          notification.cuid,
          ssePayload,
          'my-notifications'
        );
      } else if (notification.recipientType === 'announcement') {
        const notificationData = notification.toObject ? notification.toObject() : notification;
        const ssePayload = {
          notifications: [notificationData],
          total: 1,
          isInitial: false,
        };

        await this.sseService.broadcastToClient(notification.cuid, ssePayload, 'announcements');
      }
    } catch (error) {
      this.log.error('Failed to publish notification to SSE', {
        error: error instanceof Error ? error.message : 'Unknown error',
        nuid: notification.nuid,
        recipientType: notification.recipientType,
      });
    }
  }

  private async checkUserNotificationPreferences(
    userId: string,
    cuid: string,
    notificationType: NotificationTypeEnum,
    _notificationData: any
  ): Promise<boolean> {
    try {
      const preferencesResult = await this.profileService.getUserNotificationPreferences(
        userId,
        cuid
      );

      if (!preferencesResult.success || !preferencesResult.data) {
        this.log.warn('Could not get user preferences, allowing notification', { userId, cuid });
        return true; // Allow by default if preferences can't be retrieved
      }

      const preferences = preferencesResult.data;

      if (!preferences.inAppNotifications) {
        this.log.debug('In-app notifications disabled for user', { userId, cuid });
        return false;
      }

      const typeToPreferenceMap: Record<NotificationTypeEnum, keyof typeof preferences> = {
        [NotificationTypeEnum.ANNOUNCEMENT]: 'announcements',
        [NotificationTypeEnum.MAINTENANCE]: 'maintenance',
        [NotificationTypeEnum.LEASE]: 'system', // Map LEASE to system notifications
        [NotificationTypeEnum.PROPERTY]: 'propertyUpdates',
        [NotificationTypeEnum.MESSAGE]: 'messages',
        [NotificationTypeEnum.COMMENT]: 'comments',
        [NotificationTypeEnum.PAYMENT]: 'payments',
        [NotificationTypeEnum.SYSTEM]: 'system',
        [NotificationTypeEnum.TASK]: 'system', // Map TASK to system notifications
        [NotificationTypeEnum.USER]: 'system', // Map USER to system notifications
        [NotificationTypeEnum.SUCCESS]: 'system', // Map SUCCESS to system notifications
        [NotificationTypeEnum.ERROR]: 'system', // Map ERROR to system notifications
        [NotificationTypeEnum.INFO]: 'system', // Map INFO to system notifications
      };

      const preferenceField = typeToPreferenceMap[notificationType];

      if (!preferenceField) {
        this.log.warn('Unknown notification type, allowing by default', {
          notificationType,
          userId,
          cuid,
        });
        return true; // Allow unknown types by default
      }

      const isAllowed = preferences[preferenceField] as boolean;

      this.log.debug('User preference check completed', {
        userId,
        cuid,
        notificationType,
        preferenceField,
        isAllowed,
      });

      return isAllowed;
    } catch (error) {
      this.log.error('Error checking user notification preferences, allowing by default', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        cuid,
        notificationType,
      });
      return true; // Allow by default on error
    }
  }

  private setupEventListeners(): void {
    this.emitterService.on(
      EventTypes.LEASE_ESIGNATURE_COMPLETED,
      this.handleLeaseActivated.bind(this)
    );

    this.log.info('Notification service event listeners initialized');
  }

  private async handleLeaseActivated(payload: any): Promise<void> {
    try {
      const { leaseId, luid, cuid, tenantId, propertyManagerId } = payload;

      this.log.info('Sending lease activation notifications', {
        leaseId,
        luid,
      });

      await this.createNotification(cuid, NotificationTypeEnum.LEASE, {
        cuid,
        type: NotificationTypeEnum.LEASE,
        recipient: tenantId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.HIGH,
        title: 'Lease Activated',
        message: `Your lease ${luid} has been fully signed and is now active.`,
        metadata: {
          leaseId,
          luid,
        },
      });

      await this.createNotification(cuid, NotificationTypeEnum.LEASE, {
        cuid,
        type: NotificationTypeEnum.LEASE,
        recipient: propertyManagerId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.MEDIUM,
        title: 'Lease Activated',
        message: `Lease ${luid} has been fully signed and activated.`,
        metadata: {
          leaseId,
          luid,
        },
      });

      this.log.info('Lease activation notifications sent', {
        leaseId,
        luid,
      });
    } catch (error) {
      this.log.error('Error sending lease activation notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload,
      });
    }
  }

  async destroy(): Promise<void> {}
}
