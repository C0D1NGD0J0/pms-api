import Logger from 'bunyan';
import { SSEService } from '@services/index';
import { EmailQueue } from '@queues/email.queue';
import { PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { ISuccessReturnData, ResourceContext } from '@interfaces/utils.interface';
import {
  ICreateNotificationRequest,
  NotificationPriorityEnum,
  INotificationDocument,
  NotificationTypeEnum,
} from '@interfaces/notification.interface';

import { NotificationMessageKey } from './notificationMessages';

export interface INotificationContext {
  createNotificationFromTemplate: (
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
  ) => Promise<void>;
  createNotification: (
    cuid: string,
    type: NotificationTypeEnum,
    data: ICreateNotificationRequest
  ) => Promise<ISuccessReturnData<INotificationDocument>>;
  isSelfNotification: (actorUserId: string, recipientUserId: string) => boolean;
  getUserDisplayName: (userId: string, cuid: string) => Promise<string>;
  findApprovers: (userId: string, cuid: string) => Promise<string[]>;
  maintenanceRequestDAO: MaintenanceRequestDAO;
  propertyDAO: PropertyDAO;
  emailQueue: EmailQueue;
  sseService: SSEService;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
  log: Logger;
}
