import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/helpers';
import { ResourceContext } from '@interfaces/utils.interface';
import { NotificationDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { PROPERTY_APPROVAL_ROLES, PROPERTY_STAFF_ROLES } from '@utils/constants';
import { ISuccessReturnData, IPaginationQuery } from '@interfaces/utils.interface';
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
  notificationDAO: NotificationDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
  userService: any; // UserService - avoiding circular import
}

export class NotificationService {
  private readonly notificationDAO: NotificationDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private readonly userService: any;
  private readonly log: Logger;

  constructor({ notificationDAO, profileDAO, clientDAO, userDAO, userService }: IConstructor) {
    this.setupEventListeners();
    this.notificationDAO = notificationDAO;
    this.profileDAO = profileDAO;
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.userService = userService;
    this.log = createLogger('NotificationService');
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
    userId: string,
    cuid: string,
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

      // Get user's targeting info for announcement filtering
      const targetingInfo = await this.getUserTargetingInfo(userId, cuid);

      const result = await this.notificationDAO.findForUser(
        userId,
        cuid,
        targetingInfo,
        filters,
        pagination
      );
      this.log.info('Retrieved notifications successfully', {
        userId,
        cuid,
        count: result.data.length,
        total: result.total,
        roles: targetingInfo.roles,
        vendorId: targetingInfo.vendorId,
      });

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
    propertyId: string,
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
          {
            resourceName: ResourceContext.PROPERTY,
            resourceUid: propertyId,
            resourceId: propertyId,
            metadata: { changes },
          }
        );

        this.log.info('Notified property manager of update', {
          propertyId,
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
          {
            resourceName: ResourceContext.PROPERTY,
            resourceUid: propertyId,
            resourceId: propertyId,
            metadata: { changes },
          }
        );

        this.log.info('Notified supervisor of property update', {
          propertyId,
          supervisorId,
          actorUserId,
        });
      }
    } catch (error) {
      this.log.error('Failed to send property update notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        propertyId,
        actorUserId,
        cuid,
      });
    }
  }

  /**
   * Notify about approval needed - sends to appropriate approvers
   */
  async notifyApprovalNeeded(
    resourceId: string,
    resourceName: string,
    requesterId: string,
    requesterDisplayName: string,
    cuid: string,
    resourceType: ResourceContext = ResourceContext.PROPERTY,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const messageVars = {
        propertyName: resourceName,
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
            {
              resourceName: resourceType,
              resourceUid: resourceId,
              resourceId: resourceId,
              metadata,
            }
          );

          this.log.info('Sent approval needed notification', {
            resourceId,
            approverId,
            requesterId,
          });
        }
      }
    } catch (error) {
      this.log.error('Failed to send approval needed notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        resourceId,
        requesterId,
        cuid,
      });
    }
  }

  /**
   * Notify about approval decision (approved/rejected)
   */
  async notifyApprovalDecision(
    resourceId: string,
    resourceName: string,
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
        propertyName: resourceName,
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
        {
          resourceName: ResourceContext.PROPERTY,
          resourceUid: resourceId,
          resourceId: resourceId,
          metadata,
        }
      );

      this.log.info('Sent approval decision notification', {
        resourceId,
        decision,
        approverId,
        originalRequesterId,
      });
    } catch (error) {
      this.log.error('Failed to send approval decision notification', {
        error: error instanceof Error ? error.message : 'Unknown error',
        resourceId,
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
      resource,
    } = params;

    try {
      if ((PROPERTY_STAFF_ROLES as string[]).includes(userRole)) {
        // Staff update - notify about approval needed
        await this.notifyApprovalNeeded(
          resource.resourceId,
          propertyName,
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
          resource.resourceId,
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
        });
      }
    } catch (error) {
      // Log error but don't throw - don't fail property update if notifications fail
      this.log.error('Failed to send property update notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        propertyId: updatedProperty.pid,
        actorUserId,
        userRole,
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
  private async createNotificationFromTemplate(
    messageKey: NotificationMessageKey,
    variables: Record<string, any>,
    recipientId: string,
    type: NotificationTypeEnum,
    priority: NotificationPriorityEnum,
    cuid: string,
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
    };

    // Add resource info if available
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
   * Get user's targeting info (roles and vendor) for announcement filtering - delegates to UserService
   */
  private async getUserTargetingInfo(
    userId: string,
    cuid: string
  ): Promise<{ roles: string[]; vendorId?: string }> {
    return this.userService.getUserAnnouncementFilters(userId, cuid);
  }

  private setupEventListeners(): void {}

  async destroy(): Promise<void> {}
}
