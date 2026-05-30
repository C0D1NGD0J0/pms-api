import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/helpers';
import { MoneyUtils } from '@utils/money.utils';
import { EmailQueue } from '@queues/email.queue';
import { NotificationCache } from '@caching/index';
import { ICurrentUser } from '@interfaces/user.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { PROPERTY_APPROVAL_ROLES, PROPERTY_STAFF_ROLES } from '@utils/constants';
import { NotificationDAO, PropertyDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { EventEmitterService, ProfileService, UserService, SSEService } from '@services/index';
import {
  ISuccessReturnData,
  IPaginationQuery,
  ResourceContext,
  MailType,
} from '@interfaces/utils.interface';
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
import {
  MaintenanceWorkOrderSubmittedPayload,
  MaintenanceAITriageCompletedPayload,
  MaintenanceWorkOrderApprovedPayload,
  MaintenanceWorkOrderRejectedPayload,
  MaintenanceRequestCompletedPayload,
  MaintenanceRequestCancelledPayload,
  MaintenanceInvoiceSubmittedPayload,
  PaymentMethodSetupCompletedPayload,
  SubscriptionRenewalUpcomingPayload,
  MaintenanceRequestWorkDonePayload,
  MaintenanceRequestAssignedPayload,
  MaintenanceRequestAcceptedPayload,
  MaintenanceRequestDeclinedPayload,
  MaintenanceInvoiceApprovedPayload,
  MaintenanceInvoiceRejectedPayload,
  MaintenanceRequestUpdatedPayload,
  MaintenanceRequestCreatedPayload,
  MaintenanceFundsAvailablePayload,
  MaintenanceChargeCreatedPayload,
  MaintenanceChargePaidPayload,
  PaymentRequestCreatedPayload,
  PaymentCancelledPayload,
  PaymentSucceededPayload,
  PaymentRefundedPayload,
  PaymentOverduePayload,
  InvoiceOverduePayload,
  PaymentFailedPayload,
  PayoutFailedPayload,
  PayoutPaidPayload,
  EventTypes,
} from '@interfaces/events.interface';

import { getFormattedNotification, NotificationMessageKey } from './notificationMessages';

const normalizeWorkOrderForEmail = (workOrder: any) => {
  if (!workOrder) return workOrder;
  const scope = typeof workOrder.scope === 'object' ? workOrder.scope.text : workOrder.scope;
  return { ...workOrder, scope };
};

interface IConstructor {
  maintenanceRequestDAO: MaintenanceRequestDAO;
  notificationCache: NotificationCache;
  emitterService: EventEmitterService;
  notificationDAO: NotificationDAO;
  profileService: ProfileService;
  userService: UserService;
  propertyDAO: PropertyDAO;
  emailQueue: EmailQueue;
  profileDAO: ProfileDAO;
  sseService: SSEService;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class NotificationService {
  private readonly notificationDAO: NotificationDAO;
  private readonly notificationCache: NotificationCache;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;
  private readonly emitterService: EventEmitterService;
  private readonly userService: UserService;
  private readonly sseService: SSEService;
  private readonly profileService: ProfileService;
  private readonly profileDAO: ProfileDAO;
  private readonly clientDAO: ClientDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly emailQueue: EmailQueue;
  private readonly userDAO: UserDAO;
  private readonly log: Logger;

  constructor({
    notificationDAO,
    notificationCache,
    maintenanceRequestDAO,
    emitterService,
    profileDAO,
    clientDAO,
    propertyDAO,
    emailQueue,
    userDAO,
    userService,
    sseService,
    profileService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.propertyDAO = propertyDAO;
    this.sseService = sseService;
    this.emailQueue = emailQueue;
    this.profileDAO = profileDAO;
    this.userService = userService;
    this.emitterService = emitterService;
    this.profileService = profileService;
    this.notificationDAO = notificationDAO;
    this.notificationCache = notificationCache;
    this.maintenanceRequestDAO = maintenanceRequestDAO;
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
          this.log.info(
            'Notification display skipped due to user preferences — sending data-refresh signal',
            {
              userId: recipientId,
              notificationType,
              cuid,
            }
          );

          // Don't create a notification document (avoids polluting the bell list),
          // but still push a lightweight SSE signal so the client can invalidate
          // stale queries even when the user has disabled in-app notifications.
          await this.sseService.sendToUser(
            recipientId,
            cuid,
            {
              notifications: [],
              total: 0,
              isInitial: false,
              shouldDisplay: false,
              dataRefreshType: notificationType,
            },
            'my-notifications'
          );

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

      const unreadNuids = result.data.filter((n) => !n.isRead).map((n) => n.nuid);
      if (unreadNuids.length > 0) {
        const readSet = await this.notificationCache.getReadAnnouncementNuids(
          cuid,
          unreadNuids,
          userId
        );
        for (const notif of result.data) {
          if (readSet.has(notif.nuid)) {
            (notif as any).isRead = true;
          }
        }
      }

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
   * Notify about lease lifecycle events (renewal, expiry, completion, etc.)
   * Flexible method for various lease state transitions
   */
  async notifyLeaseLifecycleEvent(params: {
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
      propertyManager?: string; // managerId
      createdBy?: string; // lease creator
    };
    metadata?: Record<string, any>;
    customMessage?: { title?: string; message?: string };
  }): Promise<void> {
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

      // Notify tenant
      if (recipients.tenant) {
        const tenantNotification = this.getLeaseLifecycleNotificationContent(
          eventType,
          lease,
          'tenant',
          customMessage
        );

        await this.createNotification(lease.cuid, NotificationTypeEnum.LEASE, {
          type: NotificationTypeEnum.LEASE,
          priority: tenantNotification.priority,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: lease.tenantId,
          title: tenantNotification.title,
          message: tenantNotification.message,
          metadata: {
            ...baseMetadata,
            recipientRole: 'tenant',
          },
          cuid: lease.cuid,
        });
      }

      // Notify lease creator (admin/staff/manager who created the lease)
      if (recipients.createdBy) {
        const creatorNotification = this.getLeaseLifecycleNotificationContent(
          eventType,
          lease,
          'creator',
          customMessage
        );

        await this.createNotification(lease.cuid, NotificationTypeEnum.LEASE, {
          type: NotificationTypeEnum.LEASE,
          priority: creatorNotification.priority,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: recipients.createdBy,
          title: creatorNotification.title,
          message: creatorNotification.message,
          metadata: {
            ...baseMetadata,
            recipientRole: 'creator',
          },
          cuid: lease.cuid,
        });
      }

      // Notify property manager (only if different from creator)
      if (recipients.propertyManager && recipients.propertyManager !== recipients.createdBy) {
        const managerNotification = this.getLeaseLifecycleNotificationContent(
          eventType,
          lease,
          'manager',
          customMessage
        );

        await this.createNotification(lease.cuid, NotificationTypeEnum.LEASE, {
          type: NotificationTypeEnum.LEASE,
          priority: managerNotification.priority,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: recipients.propertyManager,
          title: managerNotification.title,
          message: managerNotification.message,
          metadata: {
            ...baseMetadata,
            recipientRole: 'manager',
          },
          cuid: lease.cuid,
        });
      }

      this.log.info(`Lease lifecycle event notifications sent: ${eventType}`, {
        leaseNumber: lease.leaseNumber,
        eventType,
        recipients,
      });
    } catch (error) {
      this.log.error('Failed to send lease lifecycle event notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        eventType,
        leaseNumber: lease.leaseNumber,
      });
    }
  }

  /**
   * Generate notification content based on event type and recipient role
   */
  private getLeaseLifecycleNotificationContent(
    eventType: string,
    lease: any,
    recipientRole: 'tenant' | 'manager' | 'creator',
    customMessage?: { title?: string; message?: string }
  ): { title: string; message: string; priority: NotificationPriorityEnum } {
    // Use custom message if provided
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
          message:
            'Your lease expired but your renewal is not complete. Immediate action required.',
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
      messages[eventType]?.[recipientRole] || {
        title: 'Lease Update',
        message: `Update regarding lease ${lease.leaseNumber}`,
        priority: NotificationPriorityEnum.MEDIUM,
      }
    );
  }

  /**
   * Notify about system/cron errors
   * Generic method for failed auto-renewals, auto-sends, etc.
   */
  async notifySystemError(params: {
    cuid: string;
    recipientIds: string[]; // Admin/manager IDs
    errorType:
      | 'auto_renewal_failed'
      | 'auto_send_failed'
      | 'expired_lease_processing_failed'
      | 'general';
    resourceType: 'lease' | 'property' | 'system';
    resourceIdentifier: string; // lease number, property ID, etc.
    errorMessage: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
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
      const notificationContent = this.getSystemErrorNotificationContent(
        errorType,
        resourceIdentifier,
        errorMessage
      );

      for (const recipientId of recipientIds) {
        await this.createNotification(cuid, NotificationTypeEnum.SYSTEM, {
          type: NotificationTypeEnum.SYSTEM,
          priority: NotificationPriorityEnum.HIGH,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: recipientId,
          title: notificationContent.title,
          message: notificationContent.message,
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

      this.log.info('System error notifications sent', {
        errorType,
        resourceIdentifier,
        recipientCount: recipientIds.length,
      });
    } catch (error) {
      this.log.error('Failed to send system error notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType,
        resourceIdentifier,
      });
    }
  }

  /**
   * Generate system error notification content
   */
  private getSystemErrorNotificationContent(
    errorType: string,
    resourceIdentifier: string,
    errorMessage: string
  ): { title: string; message: string } {
    const messages: Record<string, { title: string; message: string }> = {
      auto_renewal_failed: {
        title: 'Auto-Renewal Creation Failed',
        message: `Failed to create auto-renewal for lease ${resourceIdentifier}. Manual action required. Error: ${errorMessage}`,
      },
      auto_send_failed: {
        title: 'Failed to Send Renewal for Signature',
        message: `Auto-send failed for renewal ${resourceIdentifier}. Please send manually. Error: ${errorMessage}`,
      },
      expired_lease_processing_failed: {
        title: 'Error Processing Expired Lease',
        message: `Failed to mark lease ${resourceIdentifier} as expired. Manual review required. Error: ${errorMessage}`,
      },
      general: {
        title: 'System Error',
        message: `An error occurred with ${resourceIdentifier}: ${errorMessage}`,
      },
    };

    return messages[errorType] || messages.general;
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
      const notification = await this.notificationDAO.findByNuid(notificationId, cuid);
      if (!notification) {
        return { success: false, data: null as any, message: 'Notification not found' };
      }

      if (notification.recipientType === 'announcement') {
        await this.notificationCache.markAnnouncementsRead(cuid, [notificationId], userId);
        return { success: true, data: notification };
      }

      const result = await this.updateNotification(notificationId, userId, cuid, {
        isRead: true,
        readAt: new Date(),
      });

      return result;
    } catch (error) {
      this.log.error('Error marking notification as read', {
        error: error instanceof Error ? error.message : 'Unknown error',
        notificationId,
        userId,
        cuid,
      });

      return {
        success: false,
        data: null as any,
        message: 'Failed to mark notification as read',
      };
    }
  }

  async markAllAsRead(
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData<{ modifiedCount: number }>> {
    try {
      const individualResult = await this.notificationDAO.updateMany(
        { recipientType: 'individual', recipient: userId, cuid, isRead: false },
        { $set: { isRead: true, readAt: new Date() } }
      );

      const announcementResult = await this.notificationDAO.list(
        { recipientType: 'announcement', cuid, isRead: false },
        { projection: 'nuid', limit: 100 }
      );
      const unreadAnnouncements = announcementResult.items || [];

      if (unreadAnnouncements.length > 0) {
        const nuids = unreadAnnouncements.map((a: any) => a.nuid);
        await this.notificationCache.markAnnouncementsRead(cuid, nuids, userId);
      }

      return {
        success: true,
        data: { modifiedCount: individualResult.modifiedCount + unreadAnnouncements.length },
      };
    } catch (error) {
      this.log.error('Error marking all notifications as read', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        cuid,
      });

      return {
        success: false,
        data: { modifiedCount: 0 },
        message: 'Failed to mark all notifications as read',
      };
    }
  }

  /**
   * Check if a notification has already been sent
   * Used to prevent duplicate notifications (e.g., lease expiry reminders)
   * TODO: Consider introducing a stage-based notification check method for more granular control.
   */
  async hasNotificationBeenSent(
    leaseId: string,
    daysThreshold: number,
    notificationType: NotificationTypeEnum
  ): Promise<boolean> {
    try {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const notification = await this.notificationDAO.findFirst({
        'metadata.leaseId': leaseId,
        'metadata.daysThreshold': daysThreshold,
        type: notificationType,
        createdAt: { $gte: twoDaysAgo },
      });

      const exists = !!notification;
      return exists;
    } catch (error) {
      this.log.error('Error checking if notification was sent', {
        error: error instanceof Error ? error.message : 'Unknown error',
        leaseId,
        daysThreshold,
        notificationType,
      });
      return false;
    }
  }

  /**
   * Check if lease expiry notification has already been sent for a specific threshold
   * Used to prevent duplicate expiry notices (e.g., sending 30-day notice twice)
   * Checks entire notification history (no time window restriction)
   * @param leaseId - MongoDB ObjectId string of the lease
   */
  async hasLeaseExpiryNoticeBeenSent(
    leaseId: string | Types.ObjectId,
    expiryThreshold: string,
    notificationType: NotificationTypeEnum
  ): Promise<boolean> {
    try {
      const leaseIdStr = leaseId.toString();
      const notification = await this.notificationDAO.findFirst({
        'metadata.leaseId': leaseIdStr,
        'metadata.leaseExpiryThreshold': expiryThreshold,
        type: notificationType,
      });

      const exists = !!notification;
      return exists;
    } catch (error) {
      this.log.error('Error checking if lease expiry notification was sent', {
        error: error instanceof Error ? error.message : 'Unknown error',
        leaseId: leaseId.toString(),
        expiryThreshold,
        notificationType,
      });
      return false;
    }
  }

  private async publishToSSE(notification: INotificationDocument): Promise<void> {
    try {
      if (notification.recipientType === 'individual' && notification.recipient) {
        const notificationData = notification.toObject ? notification.toObject() : notification;

        // Determine whether the client should display this notification in the UI.
        // We always send the SSE event so that data-refresh domain events (query
        // invalidation) fire even when the user has disabled in-app notifications.
        const shouldDisplay = await this.checkUserNotificationPreferences(
          notification.recipient.toString(),
          notification.cuid,
          notification.type,
          notification
        );

        const ssePayload = {
          notifications: [notificationData],
          total: 1,
          isInitial: false, // Flag to indicate this is a new notification, not initial data
          shouldDisplay, // Client uses this to decide whether to show badge/list/toast
        };

        const eventId =
          notification.createdAt instanceof Date
            ? notification.createdAt.toISOString()
            : new Date().toISOString();

        await this.sseService.sendToUser(
          notification.recipient.toString(),
          notification.cuid,
          ssePayload,
          'my-notifications',
          eventId
        );
      } else if (notification.recipientType === 'announcement') {
        const notificationData = notification.toObject ? notification.toObject() : notification;
        const ssePayload = {
          notifications: [notificationData],
          total: 1,
          isInitial: false,
        };

        const eventId =
          notification.createdAt instanceof Date
            ? notification.createdAt.toISOString()
            : new Date().toISOString();

        await this.sseService.broadcastToClient(
          notification.cuid,
          ssePayload,
          'announcements',
          eventId,
          notification.targetRoles
        );
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

      // Treat undefined as true — field may be absent on profiles created before
      // the preference was added to the schema, and the schema default is true.
      const rawValue = preferences[preferenceField];
      const isAllowed = rawValue === undefined ? true : (rawValue as boolean);

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

    // Maintenance request events
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_CREATED, this.handleMRCreated.bind(this));
    this.emitterService.on(
      EventTypes.MAINTENANCE_REQUEST_ASSIGNED,
      this.handleMRAssigned.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_REQUEST_ACCEPTED,
      this.handleMRAccepted.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_REQUEST_DECLINED,
      this.handleMRDeclined.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_REQUEST_WORK_DONE,
      this.handleMRWorkDone.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_REQUEST_COMPLETED,
      this.handleMRCompleted.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_REQUEST_CANCELLED,
      this.handleMRCancelled.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_REQUEST_UPDATED,
      this.handleMRUpdatedByTenant.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_INVOICE_SUBMITTED,
      this.handleInvoiceSubmitted.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_INVOICE_APPROVED,
      this.handleInvoiceApproved.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_CHARGE_CREATED,
      this.handleMaintenanceChargeCreated.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_INVOICE_REJECTED,
      this.handleInvoiceRejected.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_CHARGE_PAID,
      this.handleMaintenanceChargePaid.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_FUNDS_AVAILABLE,
      this.handleMaintenanceFundsAvailable.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_WORK_ORDER_SUBMITTED,
      this.handleWorkOrderSubmitted.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_WORK_ORDER_APPROVED,
      this.handleWorkOrderApproved.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_WORK_ORDER_REJECTED,
      this.handleWorkOrderRejected.bind(this)
    );

    // Payment events
    this.emitterService.on(EventTypes.PAYMENT_SUCCEEDED, this.handlePaymentSucceeded.bind(this));
    this.emitterService.on(EventTypes.PAYMENT_FAILED, this.handlePaymentFailed.bind(this));
    this.emitterService.on(EventTypes.PAYMENT_OVERDUE, this.handlePaymentOverdue.bind(this));
    this.emitterService.on(EventTypes.PAYMENT_REFUNDED, this.handlePaymentRefunded.bind(this));
    this.emitterService.on(
      EventTypes.PAYMENT_METHOD_SETUP_COMPLETED,
      this.handlePaymentMethodSetupCompleted.bind(this)
    );
    this.emitterService.on(
      EventTypes.PAYMENT_REQUEST_CREATED,
      this.handlePaymentRequestCreated.bind(this)
    );
    this.emitterService.on(EventTypes.PAYMENT_CANCELLED, this.handlePaymentCancelled.bind(this));
    this.emitterService.on(EventTypes.PAYOUT_FAILED, this.handlePayoutFailed.bind(this));
    this.emitterService.on(EventTypes.PAYOUT_PAID, this.handlePayoutPaid.bind(this));
    this.emitterService.on(EventTypes.INVOICE_OVERDUE, this.handleInvoiceOverdue.bind(this));
    this.emitterService.on(
      EventTypes.SUBSCRIPTION_RENEWAL_UPCOMING,
      this.handleSubscriptionRenewalUpcoming.bind(this)
    );
    this.emitterService.on(
      EventTypes.MAINTENANCE_AI_TRIAGE_COMPLETED,
      this.handleAITriageCompleted.bind(this)
    );
  }

  private async handleLeaseActivated(payload: any): Promise<void> {
    try {
      const { leaseId, luid, cuid, tenantId, propertyManagerId } = payload;

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
    } catch (error) {
      this.log.error('Error sending lease activation notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload,
      });
    }
  }

  // ── Maintenance request handlers ───────────────────────────────────────────

  private async handleMRCreated(payload: MaintenanceRequestCreatedPayload): Promise<void> {
    try {
      const { cuid, mruid, title, priority } = payload;
      const { title: nTitle, message } = getFormattedNotification('maintenance.requestCreated', {
        priority,
        title,
        mruid,
      });
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
        priority: NotificationPriorityEnum.MEDIUM,
        title: nTitle,
        message,
        metadata: { mruid },
      });
    } catch (error) {
      this.log.error('Error sending MR created notification', { error, payload });
    }

    try {
      const { mruid, title, category, priority, tenantId } = payload;
      if (tenantId) {
        const creator = await this.userDAO.findFirst({
          _id: new Types.ObjectId(tenantId),
          deletedAt: null,
        });
        if (creator?.email) {
          this.emailQueue.addToEmailQueue('maintenanceRequestCreated', {
            to: creator.email,
            emailType: MailType.MAINTENANCE_REQUEST_CREATED,
            subject: '',
            data: { request: { mruid, title, category, priority }, currentuser: creator },
          });
        }
      }
    } catch (err) {
      this.log.error(
        { err, mruid: payload.mruid },
        'Failed to enqueue maintenanceRequestCreated email'
      );
    }
  }

  private async handleMRAssigned(payload: MaintenanceRequestAssignedPayload): Promise<void> {
    try {
      const { cuid, mruid, tenantId, vendorId } = payload;
      if (tenantId) {
        const { title, message } = getFormattedNotification('maintenance.requestAssigned', {
          mruid,
        });
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: tenantId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.MEDIUM,
          title,
          message,
          metadata: { mruid },
        });
      }
      const { title, message } = getFormattedNotification('maintenance.requestAssignedVendor', {
        mruid,
      });
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipient: vendorId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { mruid },
      });
    } catch (error) {
      this.log.error('Error sending MR assigned notification', { error, payload });
    }

    try {
      const { mruid, cuid, vendorId, assignedBy } = payload;
      const [request, vendorUser, assignedByUser] = await Promise.all([
        this.maintenanceRequestDAO.getByMruid(mruid, cuid),
        this.userDAO.findFirst({ _id: new Types.ObjectId(vendorId), deletedAt: null }),
        this.userDAO.findFirst({ _id: new Types.ObjectId(assignedBy), deletedAt: null }),
      ]);
      if (request && vendorUser?.email) {
        this.emailQueue.addToEmailQueue('maintenanceRequestAssigned', {
          to: vendorUser.email,
          emailType: MailType.MAINTENANCE_REQUEST_ASSIGNED,
          subject: '',
          data: {
            request: {
              ...(request.toObject ? request.toObject() : request),
              description: typeof request.description === 'object' ? '' : request.description,
            },
            vendor: vendorUser,
            assignedBy: assignedByUser,
          },
        });
      }
    } catch (err) {
      this.log.error(
        { err, mruid: payload.mruid },
        'Failed to enqueue maintenanceRequestAssigned email'
      );
    }
  }

  private async handleMRAccepted(payload: MaintenanceRequestAcceptedPayload): Promise<void> {
    try {
      const { cuid, mruid, tenantId } = payload;
      if (tenantId) {
        const { title, message } = getFormattedNotification('maintenance.requestAcceptedTenant', {
          mruid,
        });
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: tenantId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.MEDIUM,
          title,
          message,
          metadata: { mruid },
        });
      }
      const { title, message } = getFormattedNotification('maintenance.requestAccepted', { mruid });
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
        priority: NotificationPriorityEnum.LOW,
        title,
        message,
        metadata: { mruid },
      });
    } catch (error) {
      this.log.error('Error sending MR accepted notification', { error, payload });
    }

    try {
      const { mruid, cuid, tenantId } = payload;
      if (tenantId) {
        const [request, tenantUser] = await Promise.all([
          this.maintenanceRequestDAO.getByMruid(mruid, cuid),
          this.userDAO.findFirst({ _id: new Types.ObjectId(tenantId), deletedAt: null }),
        ]);
        if (request && tenantUser?.email) {
          this.emailQueue.addToEmailQueue('maintenanceRequestAccepted', {
            to: tenantUser.email,
            emailType: MailType.MAINTENANCE_REQUEST_ACCEPTED,
            subject: '',
            data: { request, tenant: tenantUser, vendor: {} },
          });
        }
      }
    } catch (err) {
      this.log.error(
        { err, mruid: payload.mruid },
        'Failed to enqueue maintenanceRequestAccepted email'
      );
    }
  }

  private async handleMRDeclined(payload: MaintenanceRequestDeclinedPayload): Promise<void> {
    try {
      const { cuid, mruid } = payload;
      const { title, message } = getFormattedNotification('maintenance.requestDeclined', { mruid });
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
        priority: NotificationPriorityEnum.HIGH,
        title,
        message,
        metadata: { mruid },
      });
    } catch (error) {
      this.log.error('Error sending MR declined notification', { error, payload });
    }

    try {
      const { mruid, cuid, vendorId, reason } = payload;
      const request = await this.maintenanceRequestDAO.getByMruid(mruid, cuid);
      if (request) {
        this.emailQueue.addToEmailQueue('maintenanceRequestDeclined', {
          to: '',
          emailType: MailType.MAINTENANCE_REQUEST_DECLINED,
          subject: '',
          data: { request, vendorId, reason },
        });
      }
    } catch (err) {
      this.log.error(
        { err, mruid: payload.mruid },
        'Failed to enqueue maintenanceRequestDeclined email'
      );
    }
  }

  private async handleMRWorkDone(payload: MaintenanceRequestWorkDonePayload): Promise<void> {
    try {
      const { cuid, mruid, tenantId } = payload;

      // Notify admin/staff that vendor has finished — awaiting invoice
      const { title, message } = getFormattedNotification('maintenance.workDone', { mruid });
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { mruid },
      });

      // Notify tenant that work on their request is complete
      if (tenantId) {
        const { title: tTitle, message: tMessage } = getFormattedNotification(
          'maintenance.workDoneTenant',
          { mruid }
        );
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: tenantId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.MEDIUM,
          title: tTitle,
          message: tMessage,
          metadata: { mruid },
        });
      }
    } catch (error) {
      this.log.error('Error sending MR work done notification', { error, payload });
    }
  }

  private async handleMRCompleted(payload: MaintenanceRequestCompletedPayload): Promise<void> {
    try {
      const { cuid, mruid, tenantId, vendorId, technicianId } = payload;
      const { title, message } = getFormattedNotification('maintenance.requestCompleted', {
        mruid,
      });
      if (tenantId) {
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: tenantId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.MEDIUM,
          title,
          message,
          metadata: { mruid },
        });
      }
      if (vendorId) {
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: vendorId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.LOW,
          title,
          message,
          metadata: { mruid },
        });
      }
      if (technicianId && technicianId !== vendorId) {
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: technicianId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.LOW,
          title,
          message,
          metadata: { mruid },
        });
      }
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
        priority: NotificationPriorityEnum.LOW,
        title,
        message,
        metadata: { mruid },
      });
    } catch (error) {
      this.log.error('Error sending MR completed notification', { error, payload });
    }

    try {
      const { mruid, cuid, tenantId } = payload;
      if (tenantId) {
        const [request, tenantUser] = await Promise.all([
          this.maintenanceRequestDAO.getByMruid(mruid, cuid),
          this.userDAO.findFirst({ _id: new Types.ObjectId(tenantId), deletedAt: null }),
        ]);
        if (request && tenantUser?.email) {
          this.emailQueue.addToEmailQueue('maintenanceRequestCompleted', {
            to: tenantUser.email,
            emailType: MailType.MAINTENANCE_REQUEST_COMPLETED,
            subject: '',
            data: { request, tenant: tenantUser },
          });
        }
      }
    } catch (err) {
      this.log.error(
        { err, mruid: payload.mruid },
        'Failed to enqueue maintenanceRequestCompleted email'
      );
    }
  }

  private async handleMRCancelled(payload: MaintenanceRequestCancelledPayload): Promise<void> {
    try {
      const { cuid, mruid, tenantId, vendorId, technicianId } = payload;
      const { title, message } = getFormattedNotification('maintenance.requestCancelled', {
        mruid,
      });
      if (tenantId) {
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: tenantId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.MEDIUM,
          title,
          message,
          metadata: { mruid },
        });
      }
      if (vendorId) {
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: vendorId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.MEDIUM,
          title,
          message,
          metadata: { mruid },
        });
      }
      if (technicianId && technicianId !== vendorId) {
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: technicianId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.MEDIUM,
          title,
          message,
          metadata: { mruid },
        });
      }
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
        priority: NotificationPriorityEnum.LOW,
        title,
        message,
        metadata: { mruid },
      });
    } catch (error) {
      this.log.error('Error sending MR cancelled notification', { error, payload });
    }
  }

  private async handleMRUpdatedByTenant(payload: MaintenanceRequestUpdatedPayload): Promise<void> {
    try {
      const { cuid, mruid, managedBy, propertyId } = payload;

      // Resolve recipient: MR's managedBy → property's managedBy → supervisor/accountAdmin
      let recipientId = managedBy;

      if (!recipientId && propertyId) {
        const property = await this.propertyDAO.findFirst({
          _id: new Types.ObjectId(propertyId),
          deletedAt: null,
        });
        recipientId = property?.managedBy?.toString();
      }

      if (!recipientId) {
        this.log.warn('No manager found for MR update notification, skipping', { mruid, cuid });
        return;
      }

      const { title, message } = getFormattedNotification('maintenance.requestUpdatedByTenant', {
        mruid,
      });
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipient: recipientId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.LOW,
        title,
        message,
        metadata: { mruid },
      });

      // Also notify the supervisor (or accountAdmin fallback) of the resolved recipient
      const approvers = await this.findApprovers(recipientId, cuid);
      for (const approverId of approvers) {
        if (approverId === recipientId) continue;
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: approverId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.LOW,
          title,
          message,
          metadata: { mruid },
        });
      }
    } catch (error) {
      this.log.error('Error sending MR updated by tenant notification', { error, payload });
    }
  }

  private async handleInvoiceSubmitted(payload: MaintenanceInvoiceSubmittedPayload): Promise<void> {
    try {
      const { cuid, mruid, amount, currency } = payload;
      const fmt = MoneyUtils.formatCurrency(amount || 0, currency || 'USD');
      const { title, message } = getFormattedNotification('maintenance.invoiceSubmitted', {
        mruid,
        amount: fmt,
      });
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
        priority: NotificationPriorityEnum.HIGH,
        title,
        message,
        metadata: { mruid },
      });
    } catch (error) {
      this.log.error('Error sending invoice submitted notification', { error, payload });
    }

    try {
      const { mruid, cuid, amount, vendorId } = payload;
      const request = await this.maintenanceRequestDAO.getByMruid(mruid, cuid);
      if (request) {
        this.emailQueue.addToEmailQueue('maintenanceInvoiceSubmitted', {
          to: '',
          emailType: MailType.MAINTENANCE_INVOICE_SUBMITTED,
          subject: '',
          data: { request, invoice: request.invoice, vendorId, amount },
        });
      }
    } catch (err) {
      this.log.error(
        { err, mruid: payload.mruid },
        'Failed to enqueue maintenanceInvoiceSubmitted email'
      );
    }
  }

  private async handleInvoiceApproved(payload: MaintenanceInvoiceApprovedPayload): Promise<void> {
    const {
      cuid,
      mruid,
      vendorId,
      technicianId,
      tenantId,
      isBillable,
      amount,
      currency,
      approvedBy,
    } = payload;
    const fmt = MoneyUtils.formatCurrency(amount || 0, currency || 'USD');

    // Notify vendor their invoice was approved
    if (vendorId) {
      try {
        const { title, message } = getFormattedNotification('maintenance.invoiceApproved', {
          mruid,
          amount: fmt,
        });
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: vendorId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.MEDIUM,
          title,
          message,
          metadata: { mruid },
        });
      } catch (error) {
        this.log.error('Error sending invoice approved notification to vendor', { error, payload });
      }

      try {
        const [vendorUser, approvedByUser] = await Promise.all([
          this.userDAO.findFirst({ _id: new Types.ObjectId(vendorId), deletedAt: null }),
          this.userDAO.findFirst({ _id: new Types.ObjectId(approvedBy), deletedAt: null }),
        ]);
        if (vendorUser?.email) {
          this.emailQueue.addToEmailQueue('maintenanceInvoiceApproved', {
            to: vendorUser.email,
            emailType: MailType.MAINTENANCE_INVOICE_APPROVED,
            subject: '',
            data: {
              request: { mruid, invoice: { amount, currency } },
              approvedBy: approvedByUser,
            },
          });
        }
      } catch (err) {
        this.log.error(
          { err, mruid },
          'Failed to enqueue maintenanceInvoiceApproved email to vendor'
        );
      }

      if (technicianId && technicianId !== vendorId) {
        try {
          const { title, message } = getFormattedNotification('maintenance.invoiceApproved', {
            mruid,
            amount: fmt,
          });
          await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
            cuid,
            type: NotificationTypeEnum.MAINTENANCE,
            recipient: technicianId,
            recipientType: RecipientTypeEnum.INDIVIDUAL,
            priority: NotificationPriorityEnum.MEDIUM,
            title,
            message,
            metadata: { mruid },
          });
        } catch (error) {
          this.log.error('Error sending invoice approved notification to technician', {
            error,
            payload,
          });
        }
      }
    }

    // Notify tenant they have a pending charge when the invoice is marked billable
    if (isBillable && tenantId) {
      try {
        const { title, message } = getFormattedNotification('maintenance.invoiceBillableNotice', {
          mruid,
          amount: fmt,
        });
        await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
          cuid,
          type: NotificationTypeEnum.PAYMENT,
          recipient: tenantId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.HIGH,
          title,
          message,
          metadata: { mruid, amount, currency },
        });
      } catch (error) {
        this.log.error('Error sending billable invoice notice to tenant', { error, payload });
      }
    }
  }

  private async handleMaintenanceChargeCreated(
    payload: MaintenanceChargeCreatedPayload
  ): Promise<void> {
    try {
      const { cuid, mruid, tenantId, amountInCents, currency, pytuid, dueDate } = payload;
      const fmt = MoneyUtils.formatCurrency(amountInCents || 0, currency || 'USD');
      const dueDateStr = new Date(dueDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const { title, message } = getFormattedNotification('maintenance.chargeCreated', {
        mruid,
        amount: fmt,
        dueDate: dueDateStr,
      });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipient: tenantId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.HIGH,
        title,
        message,
        metadata: { mruid, pytuid },
      });
    } catch (error) {
      this.log.error('Error sending maintenance charge notification to tenant', {
        error,
        payload,
      });
    }

    try {
      const {
        cuid,
        mruid,
        tenantId,
        amountInCents,
        currency,
        pytuid,
        title: jobTitle,
        dueDate,
      } = payload;
      const tenantUser = await this.userDAO.findFirst({
        _id: new Types.ObjectId(tenantId),
        deletedAt: null,
      });
      if (tenantUser?.email) {
        this.emailQueue.addToEmailQueue('maintenanceChargeCreated', {
          to: tenantUser.email,
          emailType: MailType.MAINTENANCE_CHARGE_CREATED,
          subject: '',
          data: {
            mruid,
            cuid,
            pytuid,
            jobTitle,
            amountInCents,
            currency,
            dueDate,
          },
        });
      }
    } catch (err) {
      this.log.error(
        { err, mruid: payload.mruid },
        'Failed to enqueue maintenanceChargeCreated email to tenant'
      );
    }
  }

  private async handleInvoiceRejected(payload: MaintenanceInvoiceRejectedPayload): Promise<void> {
    try {
      const { cuid, mruid, vendorId, technicianId } = payload;
      if (!vendorId) return;
      const { title, message } = getFormattedNotification('maintenance.invoiceRejected', { mruid });
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipient: vendorId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { mruid },
      });
      if (technicianId && technicianId !== vendorId) {
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: technicianId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.MEDIUM,
          title,
          message,
          metadata: { mruid },
        });
      }
    } catch (error) {
      this.log.error('Error sending invoice rejected notification', { error, payload });
    }

    try {
      const { mruid, cuid, vendorId, rejectionReason, rejectedBy } = payload;
      if (!vendorId) return;
      const [request, vendorUser, rejectedByUser] = await Promise.all([
        this.maintenanceRequestDAO.getByMruid(mruid, cuid),
        this.userDAO.findFirst({ _id: new Types.ObjectId(vendorId), deletedAt: null }),
        this.userDAO.findFirst({ _id: new Types.ObjectId(rejectedBy), deletedAt: null }),
      ]);
      if (request && vendorUser?.email) {
        this.emailQueue.addToEmailQueue('maintenanceInvoiceRejected', {
          to: vendorUser.email,
          emailType: MailType.MAINTENANCE_INVOICE_REJECTED,
          subject: '',
          data: { request, rejectionReason, rejectedBy: rejectedByUser },
        });
      }
    } catch (err) {
      this.log.error(
        { err, mruid: payload.mruid },
        'Failed to enqueue maintenanceInvoiceRejected email'
      );
    }
  }

  private async handleMaintenanceChargePaid(payload: MaintenanceChargePaidPayload): Promise<void> {
    try {
      const { cuid, mruid, amountInCents } = payload;
      const fmt = MoneyUtils.formatCurrency(amountInCents, 'usd');
      const { title, message } = getFormattedNotification('maintenance.chargePaid', {
        amount: fmt,
        mruid,
      });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
        priority: NotificationPriorityEnum.HIGH,
        title,
        message,
        metadata: { mruid },
      });
    } catch (error) {
      this.log.error('Error sending maintenance charge paid notification', { error, payload });
    }
  }

  private async handleMaintenanceFundsAvailable(
    payload: MaintenanceFundsAvailablePayload
  ): Promise<void> {
    try {
      const { cuid, mruid } = payload;
      const { title, message } = getFormattedNotification('maintenance.fundsAvailable', { mruid });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { mruid },
      });
    } catch (error) {
      this.log.error('Error sending funds available notification', { error, payload });
    }
  }

  private async handleWorkOrderSubmitted(
    payload: MaintenanceWorkOrderSubmittedPayload
  ): Promise<void> {
    try {
      const { cuid, mruid } = payload;
      const { title, message } = getFormattedNotification('maintenance.workOrderSubmitted', {
        mruid,
      });
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { mruid },
      });
    } catch (error) {
      this.log.error('Error sending work order submitted notification', { error, payload });
    }

    try {
      const { mruid, cuid, vendorId } = payload;
      const request = await this.maintenanceRequestDAO.getByMruid(mruid, cuid);
      if (request) {
        const workOrder = normalizeWorkOrderForEmail((request as any).workOrder);
        // Email to PM (no specific address — resolved by mailer config)
        this.emailQueue.addToEmailQueue('maintenanceWorkOrderSubmitted', {
          to: '',
          emailType: MailType.MAINTENANCE_WORK_ORDER_SUBMITTED,
          subject: '',
          data: { request, workOrder, vendorId },
        } as any);

        // Email + optional in-app notification to tenant
        if (request.tenantId) {
          const tenantUser = await this.userDAO.findFirst({
            _id: request.tenantId,
            deletedAt: null,
          });
          if (tenantUser?.email) {
            this.emailQueue.addToEmailQueue('maintenanceWorkOrderSubmittedTenant', {
              to: tenantUser.email,
              emailType: MailType.MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT,
              subject: '',
              data: { request, workOrder },
            } as any);
          }

          // If the vendor confirmed a visit date, notify the tenant in-app
          if (payload.scheduledDate) {
            const formattedDate = dayjs(payload.scheduledDate).format('ddd, MMM D, YYYY h:mm A');

            const { title, message } = getFormattedNotification(
              'maintenance.vendorScheduledVisit',
              {
                mruid,
                scheduledDate: formattedDate,
              }
            );
            await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
              cuid,
              type: NotificationTypeEnum.MAINTENANCE,
              recipientType: RecipientTypeEnum.INDIVIDUAL,
              recipient: request.tenantId.toString(),
              priority: NotificationPriorityEnum.MEDIUM,
              title,
              message,
              metadata: { mruid, scheduledDate: payload.scheduledDate },
            });
          }
        }
      }
    } catch (err) {
      this.log.error(
        { err, mruid: payload.mruid },
        'Failed to enqueue maintenanceWorkOrderSubmitted email'
      );
    }
  }

  private async handleWorkOrderApproved(
    payload: MaintenanceWorkOrderApprovedPayload
  ): Promise<void> {
    try {
      const { cuid, mruid, vendorId, technicianId } = payload;
      if (!vendorId) return;
      const { title, message } = getFormattedNotification('maintenance.workOrderApproved', {
        mruid,
      });
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipient: vendorId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { mruid },
      });
      if (technicianId && technicianId !== vendorId) {
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: technicianId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.MEDIUM,
          title,
          message,
          metadata: { mruid },
        });
      }
    } catch (error) {
      this.log.error('Error sending work order approved notification', { error, payload });
    }

    try {
      const { mruid, cuid, vendorId, approvedBy } = payload;
      if (!vendorId) return;
      const [request, vendorUser, approvedByUser] = await Promise.all([
        this.maintenanceRequestDAO.getByMruid(mruid, cuid),
        this.userDAO.findFirst({ _id: new Types.ObjectId(vendorId), deletedAt: null }),
        this.userDAO.findFirst({ _id: new Types.ObjectId(approvedBy), deletedAt: null }),
      ]);
      if (request && vendorUser?.email) {
        this.emailQueue.addToEmailQueue('maintenanceWorkOrderApproved', {
          to: vendorUser.email,
          emailType: MailType.MAINTENANCE_WORK_ORDER_APPROVED,
          subject: '',
          data: {
            request,
            workOrder: normalizeWorkOrderForEmail((request as any).workOrder),
            approvedBy: approvedByUser,
          },
        } as any);
      }
    } catch (err) {
      this.log.error(
        { err, mruid: payload.mruid },
        'Failed to enqueue maintenanceWorkOrderApproved email'
      );
    }
  }

  private async handleWorkOrderRejected(
    payload: MaintenanceWorkOrderRejectedPayload
  ): Promise<void> {
    try {
      const { cuid, mruid, vendorId, technicianId } = payload;
      if (!vendorId) return;
      const { title, message } = getFormattedNotification('maintenance.workOrderRejected', {
        mruid,
      });
      await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
        cuid,
        type: NotificationTypeEnum.MAINTENANCE,
        recipient: vendorId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { mruid },
      });
      if (technicianId && technicianId !== vendorId) {
        await this.createNotification(cuid, NotificationTypeEnum.MAINTENANCE, {
          cuid,
          type: NotificationTypeEnum.MAINTENANCE,
          recipient: technicianId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.MEDIUM,
          title,
          message,
          metadata: { mruid },
        });
      }
    } catch (error) {
      this.log.error('Error sending work order rejected notification', { error, payload });
    }

    try {
      const { mruid, cuid, vendorId, rejectedBy, rejectionReason } = payload;
      if (!vendorId) return;
      const [request, vendorUser, rejectedByUser] = await Promise.all([
        this.maintenanceRequestDAO.getByMruid(mruid, cuid),
        this.userDAO.findFirst({ _id: new Types.ObjectId(vendorId), deletedAt: null }),
        this.userDAO.findFirst({ _id: new Types.ObjectId(rejectedBy), deletedAt: null }),
      ]);
      if (request && vendorUser?.email) {
        this.emailQueue.addToEmailQueue('maintenanceWorkOrderRejected', {
          to: vendorUser.email,
          emailType: MailType.MAINTENANCE_WORK_ORDER_REJECTED,
          subject: '',
          data: {
            request,
            workOrder: normalizeWorkOrderForEmail((request as any).workOrder),
            rejectionReason,
            rejectedBy: rejectedByUser,
          },
        } as any);
      }
    } catch (err) {
      this.log.error(
        { err, mruid: payload.mruid },
        'Failed to enqueue maintenanceWorkOrderRejected email'
      );
    }
  }

  // ── Payment handlers ────────────────────────────────────────────────────────

  private async handlePaymentSucceeded(payload: PaymentSucceededPayload): Promise<void> {
    try {
      const { cuid, amount } = payload;
      const fmt = MoneyUtils.formatCurrency(amount || 0);
      const { title, message } = getFormattedNotification('payment.succeeded', { amount: fmt });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { pytuid: payload.pytuid },
      });
    } catch (error) {
      this.log.error('Error sending payment succeeded notification', { error, payload });
    }
  }

  private async handlePaymentFailed(payload: PaymentFailedPayload): Promise<void> {
    try {
      const { cuid, amount, tenantId, pytuid } = payload;
      const fmt = amount ? MoneyUtils.formatCurrency(amount) : '—';

      // PM announcement
      const { title, message } = getFormattedNotification('payment.failed', { amount: fmt });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
        priority: NotificationPriorityEnum.HIGH,
        title,
        message,
        metadata: { pytuid, tenantId },
      });

      // Tenant individual notification — tells them to update their payment method
      if (tenantId) {
        const tenantNotif = getFormattedNotification('payment.failedTenant', { amount: fmt });
        await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
          cuid,
          type: NotificationTypeEnum.PAYMENT,
          recipient: tenantId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.HIGH,
          title: tenantNotif.title,
          message: tenantNotif.message,
          metadata: { pytuid },
        });
      }
    } catch (error) {
      this.log.error('Error sending payment failed notification', { error, payload });
    }
  }

  private async handlePaymentOverdue(payload: PaymentOverduePayload): Promise<void> {
    try {
      const { cuid, tenantId } = payload;
      const fmt = MoneyUtils.formatCurrency(payload.amount || 0);
      const dueDateStr = new Date(payload.dueDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });

      // PM announcement
      const { title, message } = getFormattedNotification('payment.overdue', {
        amount: fmt,
        dueDate: dueDateStr,
      });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
        priority: NotificationPriorityEnum.HIGH,
        title,
        message,
        metadata: { pytuid: payload.pytuid, tenantId },
      });

      // Tenant individual notification — prompts them to pay before late fees apply
      if (tenantId) {
        const tenantNotif = getFormattedNotification('payment.overdueTenant', {
          amount: fmt,
          dueDate: dueDateStr,
        });
        await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
          cuid,
          type: NotificationTypeEnum.PAYMENT,
          recipient: tenantId,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          priority: NotificationPriorityEnum.HIGH,
          title: tenantNotif.title,
          message: tenantNotif.message,
          metadata: { pytuid: payload.pytuid },
        });
      }
    } catch (error) {
      this.log.error('Error sending payment overdue notification', { error, payload });
    }
  }

  private async handlePaymentRefunded(payload: PaymentRefundedPayload): Promise<void> {
    try {
      const { cuid, refundAmount } = payload;
      const fmt = MoneyUtils.formatCurrency(refundAmount || 0);
      const { title, message } = getFormattedNotification('payment.refunded', { amount: fmt });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.SUPER_ADMIN],
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { pytuid: payload.pytuid },
      });
    } catch (error) {
      this.log.error('Error sending payment refunded notification', { error, payload });
    }
  }

  private async handlePaymentMethodSetupCompleted(
    payload: PaymentMethodSetupCompletedPayload
  ): Promise<void> {
    try {
      const { tenantId, cuid, paymentMethodId } = payload;
      await this.sseService.sendToUser(
        tenantId,
        cuid,
        { resource: 'payment', action: 'payment-method-updated', resourceId: paymentMethodId },
        'resource-event'
      );
    } catch (error) {
      this.log.error('Error sending payment-method-updated SSE', { error, payload });
    }
  }

  private async handleAITriageCompleted(
    payload: MaintenanceAITriageCompletedPayload
  ): Promise<void> {
    try {
      const { cuid, mruid } = payload;

      // Notify PM staff (admin + super-admin) so the detail page refreshes live.
      // AI triage results are internal — the tenant does not need this signal.
      await this.sseService.broadcastToClient(
        cuid,
        { resource: 'maintenance', action: 'ai-analysis-ready', resourceUId: mruid },
        'resource-event',
        undefined,
        [ROLES.ADMIN, ROLES.SUPER_ADMIN]
      );
    } catch (error) {
      this.log.error('Error sending ai-analysis-ready SSE', { error, payload });
    }
  }

  private async handlePaymentRequestCreated(payload: PaymentRequestCreatedPayload): Promise<void> {
    try {
      const { tenantUserId, amountInCents, dueDate, pytuid, cuid } = payload;
      const fmt = MoneyUtils.formatCurrency(amountInCents || 0);
      const dueDateStr = new Date(dueDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const { title, message } = getFormattedNotification('payment.requested', {
        amount: fmt,
        dueDate: dueDateStr,
      });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipient: tenantUserId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.HIGH,
        title,
        message,
        metadata: { pytuid },
      });
    } catch (error) {
      this.log.error('Error sending payment request notification', { error, payload });
    }
  }

  private async handlePaymentCancelled(payload: PaymentCancelledPayload): Promise<void> {
    try {
      const { tenantUserId, amountInCents, pytuid, cuid } = payload;
      const fmt = MoneyUtils.formatCurrency(amountInCents || 0);
      const { title, message } = getFormattedNotification('payment.cancelled', {
        amount: fmt,
      });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipient: tenantUserId,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { pytuid },
      });
    } catch (error) {
      this.log.error('Error sending payment cancelled notification', { error, payload });
    }
  }

  private async handlePayoutFailed(payload: PayoutFailedPayload): Promise<void> {
    try {
      const { cuid, amountInCents, currency, reason } = payload;
      const fmt = MoneyUtils.formatCurrency(amountInCents || 0, currency || 'usd');
      const { title, message } = getFormattedNotification('payment.payoutFailed', {
        amount: fmt,
        reason: reason || 'unknown error',
      });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
        priority: NotificationPriorityEnum.HIGH,
        title,
        message,
        metadata: { payoutId: payload.payoutId, accountId: payload.accountId },
      });
    } catch (error) {
      this.log.error('Error sending payout failed notification', { error, payload });
    }
  }

  private async handlePayoutPaid(payload: PayoutPaidPayload): Promise<void> {
    try {
      const { cuid, amountInCents, currency } = payload;
      const fmt = MoneyUtils.formatCurrency(amountInCents || 0, currency || 'usd');
      const { title, message } = getFormattedNotification('payment.payoutPaid', { amount: fmt });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: { payoutId: payload.payoutId, accountId: payload.accountId },
      });
    } catch (error) {
      this.log.error('Error sending payout paid notification', { error, payload });
    }
  }

  private async handleInvoiceOverdue(payload: InvoiceOverduePayload): Promise<void> {
    try {
      const { cuid, amount, currency } = payload;
      const fmt = MoneyUtils.formatCurrency(amount || 0, currency || 'usd');
      const { title, message } = getFormattedNotification('payment.invoiceOverdue', {
        amount: fmt,
      });
      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
        priority: NotificationPriorityEnum.HIGH,
        title,
        message,
        metadata: {
          pytuid: payload.pytuid,
          invoiceId: payload.invoiceId,
          tenantId: payload.tenantId,
        },
      });
    } catch (error) {
      this.log.error('Error sending invoice overdue notification', { error, payload });
    }
  }

  private async handleSubscriptionRenewalUpcoming(
    payload: SubscriptionRenewalUpcomingPayload
  ): Promise<void> {
    try {
      const { cuid, planName, amountInCents, currency, renewalDate } = payload;
      const fmt = MoneyUtils.formatCurrency(amountInCents || 0, currency || 'usd');
      const renewalDateStr =
        renewalDate instanceof Date
          ? renewalDate.toLocaleDateString()
          : new Date(renewalDate).toLocaleDateString();

      const { title, message } = getFormattedNotification('payment.subscriptionRenewalUpcoming', {
        planName,
        amount: fmt,
        renewalDate: renewalDateStr,
      });

      await this.createNotification(cuid, NotificationTypeEnum.PAYMENT, {
        cuid,
        type: NotificationTypeEnum.PAYMENT,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
        priority: NotificationPriorityEnum.MEDIUM,
        title,
        message,
        metadata: {
          stripeSubscriptionId: payload.stripeSubscriptionId,
          planName,
          renewalDate: renewalDateStr,
        },
      });

      const adminId = await this.getClientAccountAdmin(cuid);
      if (adminId) {
        const adminUser = await this.userDAO.findFirst({
          _id: new Types.ObjectId(adminId),
          deletedAt: null,
        });
        if (adminUser?.email) {
          this.emailQueue.addToEmailQueue('subscriptionRenewalUpcoming', {
            to: adminUser.email,
            emailType: MailType.SUBSCRIPTION_RENEWAL_UPCOMING,
            subject: '',
            data: {
              planName,
              amount: fmt,
              renewalDate: renewalDateStr,
              currentUser: adminUser,
            },
          });
        }
      }
    } catch (error) {
      this.log.error('Error sending subscription renewal upcoming notification', {
        error,
        payload,
      });
    }
  }

  async destroy(): Promise<void> {}
}
