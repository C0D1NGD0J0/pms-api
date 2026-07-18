import Logger from 'bunyan';
import { Types } from 'mongoose';
import { createLogger } from '@utils/helpers';
import { EmailQueue } from '@queues/email.queue';
import { NotificationCache } from '@caching/index';
import { ICurrentUser } from '@interfaces/user.interface';
import { EventTypes } from '@interfaces/events.interface';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { NotificationDAO, GuestPassDAO, PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { EventEmitterService, ProfileService, UserService, SSEService } from '@services/index';
import { ISuccessReturnData, IPaginationQuery, ResourceContext } from '@interfaces/utils.interface';
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

import { INotificationContext } from './notification.types';
import { handleLeaseActivated } from './notification.lease.handlers';
import { getFormattedNotification, NotificationMessageKey } from './notificationMessages';
import {
  handleGuestPassValidated,
  handleGuestPassCreated,
  handleGuestPassRevoked,
  handleGuestPassExpired,
} from './notification.guestpass.handlers';
import {
  notifyLeaseESignatureFailed as notifyLeaseESignatureFailedFn,
  notifyLeaseESignatureSent as notifyLeaseESignatureSentFn,
  notifyLeaseLifecycleEvent as notifyLeaseLifecycleEventFn,
  notifySystemError as notifySystemErrorFn,
} from './notification.lease.public';
import {
  handlePropertyUpdateNotifications as handlePropertyUpdateNotificationsFn,
  notifyPendingChangesOverridden as notifyPendingChangesOverriddenFn,
  notifyApprovalDecision as notifyApprovalDecisionFn,
  notifyPropertyUpdate as notifyPropertyUpdateFn,
  notifyApprovalNeeded as notifyApprovalNeededFn,
} from './notification.property';
import {
  handlePaymentMethodSetupCompleted,
  handleSubscriptionRenewalUpcoming,
  handlePadPreDebitNotification,
  handlePaymentRequestCreated,
  handlePadMandateConfirmed,
  handlePaymentSucceeded,
  handlePaymentCancelled,
  handlePaymentRefunded,
  handlePaymentOverdue,
  handleInvoiceOverdue,
  handlePaymentFailed,
  handlePayoutFailed,
  handlePayoutPaid,
} from './notification.payment.handlers';
import {
  handleMaintenanceFundsAvailable,
  handleMaintenanceChargeCreated,
  handleMaintenanceChargePaid,
  handleWorkOrderSubmitted,
  handleMRUpdatedByTenant,
  handleWorkOrderApproved,
  handleWorkOrderRejected,
  handleAITriageCompleted,
  handleInvoiceSubmitted,
  handleInvoiceApproved,
  handleInvoiceRejected,
  handleAutoVendorPaid,
  handleMRCompleted,
  handleMRCancelled,
  handleVendorPaid,
  handleMRAssigned,
  handleMRAccepted,
  handleMRDeclined,
  handleMRWorkDone,
  handleMRCreated,
} from './notification.maintenance.handlers';

interface IConstructor {
  maintenanceRequestDAO: MaintenanceRequestDAO;
  notificationCache: NotificationCache;
  emitterService: EventEmitterService;
  notificationDAO: NotificationDAO;
  profileService: ProfileService;
  guestPassDAO: GuestPassDAO;
  userService: UserService;
  propertyDAO: PropertyDAO;
  emailQueue: EmailQueue;
  sseService: SSEService;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class NotificationService {
  private readonly notificationDAO: NotificationDAO;
  private readonly notificationCache: NotificationCache;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;
  private readonly guestPassDAO: GuestPassDAO;
  private readonly emitterService: EventEmitterService;
  private readonly userService: UserService;
  private readonly sseService: SSEService;
  private readonly profileService: ProfileService;
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
    clientDAO,
    propertyDAO,
    emailQueue,
    userDAO,
    userService,
    sseService,
    profileService,
    guestPassDAO,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.guestPassDAO = guestPassDAO;
    this.propertyDAO = propertyDAO;
    this.sseService = sseService;
    this.emailQueue = emailQueue;
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
        targetDepartments: validatedData.targetDepartments,
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
        pagination,
        { archivedAt: null } // Exclude archived individual notifications
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

      const userObjectId = new Types.ObjectId(userId);

      // Overlay read status from readBy array and filter out archived
      const filtered = result.data.filter((notif) => {
        // Exclude announcements archived by this user
        if (notif.archivedBy && notif.archivedBy.some((id) => id.equals(userObjectId))) {
          return false;
        }
        return true;
      });

      for (const notif of filtered) {
        if (notif.readBy && notif.readBy.some((id) => id.equals(userObjectId))) {
          (notif as any).isRead = true;
        }
      }

      return {
        success: true,
        data: {
          notifications: filtered,
          total: filtered.length,
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

  // ── Property notifications (logic in notification.property.ts) ─────────────

  async notifyPropertyUpdate(
    resourceInfo: { resourceName: ResourceContext; resourceUid: string; resourceId: string },
    propertyName: string,
    actorUserId: string,
    actorDisplayName: string,
    cuid: string,
    changes: Record<string, any>,
    propertyManagerId?: string
  ): Promise<void> {
    return notifyPropertyUpdateFn(
      this.buildContext(),
      resourceInfo,
      propertyName,
      actorUserId,
      actorDisplayName,
      cuid,
      changes,
      propertyManagerId
    );
  }

  async notifyApprovalNeeded(
    resource: { resourceId: string; resourceUid: string; resourceName: string },
    requesterId: string,
    requesterDisplayName: string,
    cuid: string,
    resourceType: ResourceContext = ResourceContext.PROPERTY,
    metadata?: Record<string, any>
  ): Promise<void> {
    return notifyApprovalNeededFn(
      this.buildContext(),
      resource,
      requesterId,
      requesterDisplayName,
      cuid,
      resourceType,
      metadata
    );
  }

  async notifyApprovalDecision(
    resource: { resourceId: string; resourceName: string; resourceUid: string },
    approverId: string,
    cuid: string,
    decision: 'approved' | 'rejected',
    originalRequesterId: string,
    reason?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    return notifyApprovalDecisionFn(
      this.buildContext(),
      resource,
      approverId,
      cuid,
      decision,
      originalRequesterId,
      reason,
      metadata
    );
  }

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
    return handlePropertyUpdateNotificationsFn(this.buildContext(), params);
  }

  async notifyPendingChangesOverridden(
    propertyId: string,
    propertyName: string,
    adminUserId: string,
    adminName: string,
    originalRequesterId: string,
    cuid: string,
    context: { address?: string; overriddenAt: Date; overrideReason: string }
  ): Promise<void> {
    return notifyPendingChangesOverriddenFn(
      this.buildContext(),
      propertyId,
      propertyName,
      adminUserId,
      adminName,
      originalRequesterId,
      cuid,
      context
    );
  }

  // ── Lease notifications (logic in notification.lease.public.ts) ─────────────

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
    return notifyLeaseESignatureSentFn(this.buildContext(), params);
  }

  async notifyLeaseESignatureFailed(params: {
    leaseNumber: string;
    error: string;
    propertyManagerId: string;
    actorId: string;
    cuid: string;
    resource: { resourceId: string; resourceUid: string; resourceType: ResourceContext };
  }): Promise<void> {
    return notifyLeaseESignatureFailedFn(this.buildContext(), params);
  }

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
    recipients: { tenant?: boolean; propertyManager?: string; createdBy?: string };
    metadata?: Record<string, any>;
    customMessage?: { title?: string; message?: string };
  }): Promise<void> {
    return notifyLeaseLifecycleEventFn(this.buildContext(), params);
  }

  async notifySystemError(params: {
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
  }): Promise<void> {
    return notifySystemErrorFn(this.buildContext(), params);
  }

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
        await this.notificationDAO.update(
          { nuid: notificationId, cuid },
          { $addToSet: { readBy: new Types.ObjectId(userId) } }
        );
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
        { recipientType: RecipientTypeEnum.INDIVIDUAL, recipient: userId, cuid, isRead: false },
        { $set: { isRead: true, readAt: new Date() } }
      );

      const userObjectId = new Types.ObjectId(userId);
      const announcementResult = await this.notificationDAO.updateMany(
        {
          recipientType: RecipientTypeEnum.ANNOUNCEMENT,
          cuid,
          readBy: { $ne: userObjectId },
          deletedAt: null,
        },
        { $addToSet: { readBy: userObjectId } }
      );

      return {
        success: true,
        data: {
          modifiedCount: individualResult.modifiedCount + (announcementResult.modifiedCount || 0),
        },
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

  async archiveNotification(
    nuid: string,
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData> {
    try {
      const notification = await this.notificationDAO.findByNuid(nuid, cuid);
      if (!notification) {
        return { success: false, data: null, message: 'Notification not found' };
      }

      if (notification.recipientType === 'announcement') {
        await this.notificationDAO.update(
          { nuid, cuid },
          { $addToSet: { archivedBy: new Types.ObjectId(userId) } }
        );
      } else {
        if (notification.recipient?.toString() !== userId) {
          return { success: false, data: null, message: 'Access denied' };
        }
        await this.notificationDAO.updateById(notification._id.toString(), {
          archivedAt: new Date(),
        });
      }

      return { success: true, data: null, message: 'Notification archived' };
    } catch (error) {
      this.log.error('Error archiving notification', {
        error: error instanceof Error ? error.message : 'Unknown error',
        nuid,
        userId,
        cuid,
      });
      return { success: false, data: null, message: 'Failed to archive notification' };
    }
  }

  async archiveAllRead(
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData<{ modifiedCount: number }>> {
    try {
      const userObjectId = new Types.ObjectId(userId);

      // Archive read individual notifications
      const individualResult = await this.notificationDAO.updateMany(
        {
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: userObjectId,
          cuid,
          isRead: true,
          archivedAt: null,
          deletedAt: null,
        },
        { $set: { archivedAt: new Date() } }
      );

      // Archive read announcements (user is in readBy but not in archivedBy)
      const announcementResult = await this.notificationDAO.updateMany(
        {
          recipientType: RecipientTypeEnum.ANNOUNCEMENT,
          cuid,
          readBy: userObjectId,
          archivedBy: { $ne: userObjectId },
          deletedAt: null,
        },
        { $addToSet: { archivedBy: userObjectId } }
      );

      return {
        success: true,
        data: {
          modifiedCount:
            (individualResult.modifiedCount || 0) + (announcementResult.modifiedCount || 0),
        },
        message: 'Read notifications archived',
      };
    } catch (error) {
      this.log.error('Error archiving all read notifications', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        cuid,
      });
      return {
        success: false,
        data: { modifiedCount: 0 },
        message: 'Failed to archive read notifications',
      };
    }
  }

  /**
   * Check if a notification has already been sent
   * Used to prevent duplicate notifications (e.g., lease expiry reminders).
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
          notification.targetRoles,
          notification.targetDepartments
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
        [NotificationTypeEnum.GUESTPASS]: 'system', // Map GUESTPASS to system notifications
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
    const ctx = this.buildContext();

    this.emitterService.on(EventTypes.LEASE_ESIGNATURE_COMPLETED, (p) =>
      handleLeaseActivated(ctx, p)
    );

    // Maintenance request events
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_CREATED, (p) => handleMRCreated(ctx, p));
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_ASSIGNED, (p) =>
      handleMRAssigned(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_ACCEPTED, (p) =>
      handleMRAccepted(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_DECLINED, (p) =>
      handleMRDeclined(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_WORK_DONE, (p) =>
      handleMRWorkDone(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_COMPLETED, (p) =>
      handleMRCompleted(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_CANCELLED, (p) =>
      handleMRCancelled(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_UPDATED, (p) =>
      handleMRUpdatedByTenant(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_INVOICE_SUBMITTED, (p) =>
      handleInvoiceSubmitted(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_INVOICE_APPROVED, (p) =>
      handleInvoiceApproved(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_CHARGE_CREATED, (p) =>
      handleMaintenanceChargeCreated(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_INVOICE_REJECTED, (p) =>
      handleInvoiceRejected(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_VENDOR_PAID, (p) => handleVendorPaid(ctx, p));
    this.emitterService.on(EventTypes.MAINTENANCE_CHARGE_PAID, (p) =>
      handleMaintenanceChargePaid(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_FUNDS_AVAILABLE, (p) =>
      handleMaintenanceFundsAvailable(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_AUTO_VENDOR_PAID, (p) =>
      handleAutoVendorPaid(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_WORK_ORDER_SUBMITTED, (p) =>
      handleWorkOrderSubmitted(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_WORK_ORDER_APPROVED, (p) =>
      handleWorkOrderApproved(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_WORK_ORDER_REJECTED, (p) =>
      handleWorkOrderRejected(ctx, p)
    );

    // Payment events
    this.emitterService.on(EventTypes.PAYMENT_SUCCEEDED, (p) => handlePaymentSucceeded(ctx, p));
    this.emitterService.on(EventTypes.PAYMENT_FAILED, (p) => handlePaymentFailed(ctx, p));
    this.emitterService.on(EventTypes.PAYMENT_OVERDUE, (p) => handlePaymentOverdue(ctx, p));
    this.emitterService.on(EventTypes.PAYMENT_REFUNDED, (p) => handlePaymentRefunded(ctx, p));
    this.emitterService.on(EventTypes.PAYMENT_METHOD_SETUP_COMPLETED, (p) =>
      handlePaymentMethodSetupCompleted(ctx, p)
    );
    this.emitterService.on(EventTypes.PAYMENT_REQUEST_CREATED, (p) =>
      handlePaymentRequestCreated(ctx, p)
    );
    this.emitterService.on(EventTypes.PAYMENT_CANCELLED, (p) => handlePaymentCancelled(ctx, p));
    this.emitterService.on(EventTypes.PAYOUT_FAILED, (p) => handlePayoutFailed(ctx, p));
    this.emitterService.on(EventTypes.PAYOUT_PAID, (p) => handlePayoutPaid(ctx, p));
    this.emitterService.on(EventTypes.INVOICE_OVERDUE, (p) => handleInvoiceOverdue(ctx, p));
    this.emitterService.on(EventTypes.PAD_MANDATE_CONFIRMED, (p) =>
      handlePadMandateConfirmed(ctx, p)
    );
    this.emitterService.on(EventTypes.PAD_PRE_DEBIT_NOTIFICATION, (p) =>
      handlePadPreDebitNotification(ctx, p)
    );
    this.emitterService.on(EventTypes.SUBSCRIPTION_RENEWAL_UPCOMING, (p) =>
      handleSubscriptionRenewalUpcoming(ctx, p)
    );
    this.emitterService.on(EventTypes.MAINTENANCE_AI_TRIAGE_COMPLETED, (p) =>
      handleAITriageCompleted(ctx, p)
    );

    // Guest pass events
    this.emitterService.on(EventTypes.GUEST_PASS_CREATED, (p) => handleGuestPassCreated(ctx, p));
    this.emitterService.on(EventTypes.GUEST_PASS_VALIDATED, (p) =>
      handleGuestPassValidated(ctx, p)
    );
    this.emitterService.on(EventTypes.GUEST_PASS_REVOKED, (p) => handleGuestPassRevoked(ctx, p));
    this.emitterService.on(EventTypes.GUEST_PASS_EXPIRED, (p) => handleGuestPassExpired(ctx, p));
  }

  private buildContext(): INotificationContext {
    return {
      createNotification: (...args) => this.createNotification(...args),
      createNotificationFromTemplate: (...args) => this.createNotificationFromTemplate(...args),
      findApprovers: (...args) => this.findApprovers(...args),
      getUserDisplayName: (...args) => this.getUserDisplayName(...args),
      isSelfNotification: (...args) => this.isSelfNotification(...args),
      emailQueue: this.emailQueue,
      userDAO: this.userDAO,
      clientDAO: this.clientDAO,
      propertyDAO: this.propertyDAO,
      maintenanceRequestDAO: this.maintenanceRequestDAO,
      guestPassDAO: this.guestPassDAO,
      sseService: this.sseService,
      log: this.log,
    };
  }

  async destroy(): Promise<void> {}
}
