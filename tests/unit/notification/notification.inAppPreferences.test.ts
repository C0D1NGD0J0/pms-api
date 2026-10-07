import { Types } from 'mongoose';
import { NotificationService } from '@services/notification/notification.service';
import { NotificationTypeEnum, RecipientTypeEnum } from '@interfaces/notification.interface';

describe('NotificationService — in-app preferences for individual notifications', () => {
  const recipient = new Types.ObjectId().toString();
  const getUserNotificationPreferences = jest.fn();
  const create = jest.fn();
  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockImplementation(async (doc) => ({ ...doc, nuid: 'n1', toObject: () => doc }));
    service = new NotificationService({
      notificationDAO: { create } as any,
      notificationCache: {} as any,
      emitterService: { on: jest.fn(), emit: jest.fn() } as any,
      profileDAO: {} as any,
      clientDAO: {} as any,
      userDAO: {} as any,
      userService: {} as any,
      sseService: { sendToUser: jest.fn(), broadcastToClient: jest.fn() } as any,
      profileService: { getUserNotificationPreferences } as any,
      pushService: { sendToUser: jest.fn().mockResolvedValue(undefined) } as any,
      maintenanceRequestDAO: {} as any,
      guestPassDAO: {} as any,
      propertyDAO: {} as any,
      emailQueue: {} as any,
    } as any);
    jest.spyOn(service['log'], 'info').mockImplementation(() => undefined);
  });

  const send = (type: NotificationTypeEnum, extra: Record<string, unknown> = {}) =>
    service.createNotification('c1', type, {
      cuid: 'c1',
      type,
      title: 'Title',
      message: 'Message',
      recipientType: RecipientTypeEnum.INDIVIDUAL,
      recipient,
      ...extra,
    });

  it('does not store a notification in a category the recipient switched off', async () => {
    getUserNotificationPreferences.mockResolvedValue({
      success: true,
      data: { inAppNotifications: true, leases: false },
    });

    await send(NotificationTypeEnum.LEASE);

    expect(create).not.toHaveBeenCalled();
  });

  it('always stores required notifications', async () => {
    getUserNotificationPreferences.mockResolvedValue({
      success: true,
      data: { inAppNotifications: false, payments: false },
    });

    await send(NotificationTypeEnum.PAYMENT, { required: true });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ required: true, category: 'payments' })
    );
  });

  it('stamps the category from the type so announcements can be filtered later', async () => {
    getUserNotificationPreferences.mockResolvedValue({ success: true, data: {} });

    await send(NotificationTypeEnum.GUESTPASS);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'guestPasses', required: false })
    );
  });
});
