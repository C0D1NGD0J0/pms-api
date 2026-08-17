import { NotificationTypeEnum } from '@interfaces/notification.interface';
import { NotificationService } from '@services/notification/notification.service';

const mockProfileService = {
  getUserNotificationPreferences: jest.fn(),
  getProfile: jest.fn(),
} as any;

const mockEmitterService = {
  on: jest.fn(),
  emit: jest.fn(),
  off: jest.fn(),
} as any;

describe('NotificationService.shouldSendEmail', () => {
  let notificationService: NotificationService;
  const userId = 'user-123';
  const cuid = 'CLIENT-ABC';

  beforeEach(() => {
    jest.clearAllMocks();

    notificationService = new NotificationService({
      notificationDAO: { create: jest.fn(), findFirst: jest.fn(), list: jest.fn() } as any,
      notificationCache: {} as any,
      maintenanceRequestDAO: {} as any,
      emitterService: mockEmitterService,
      clientDAO: {} as any,
      propertyDAO: {} as any,
      emailQueue: {} as any,
      userDAO: {} as any,
      userService: {} as any,
      sseService: {} as any,
      profileService: mockProfileService,
      guestPassDAO: {} as any,
      pushService: {} as any,
    } as any);
  });

  describe('critical types bypass preferences', () => {
    it('should return true for PAYMENT type regardless of preferences', async () => {
      // profileService should never be called for critical types
      const result = await notificationService.shouldSendEmail(
        userId,
        cuid,
        NotificationTypeEnum.PAYMENT
      );

      expect(result).toBe(true);
      expect(mockProfileService.getUserNotificationPreferences).not.toHaveBeenCalled();
    });

    it('should return true for SYSTEM type regardless of preferences', async () => {
      const result = await notificationService.shouldSendEmail(
        userId,
        cuid,
        NotificationTypeEnum.SYSTEM
      );

      expect(result).toBe(true);
      expect(mockProfileService.getUserNotificationPreferences).not.toHaveBeenCalled();
    });

    it('should return true for LEASE type regardless of preferences', async () => {
      const result = await notificationService.shouldSendEmail(
        userId,
        cuid,
        NotificationTypeEnum.LEASE
      );

      expect(result).toBe(true);
      expect(mockProfileService.getUserNotificationPreferences).not.toHaveBeenCalled();
    });
  });

  describe('non-critical types check user preferences', () => {
    it('should return false for INSPECTION type when emailNotifications is false', async () => {
      mockProfileService.getUserNotificationPreferences.mockResolvedValue({
        success: true,
        data: { emailNotifications: false },
      });

      const result = await notificationService.shouldSendEmail(
        userId,
        cuid,
        NotificationTypeEnum.INSPECTION
      );

      expect(result).toBe(false);
      expect(mockProfileService.getUserNotificationPreferences).toHaveBeenCalledWith(userId, cuid);
    });

    it('should return true for INSPECTION type when emailNotifications is true', async () => {
      mockProfileService.getUserNotificationPreferences.mockResolvedValue({
        success: true,
        data: { emailNotifications: true },
      });

      const result = await notificationService.shouldSendEmail(
        userId,
        cuid,
        NotificationTypeEnum.INSPECTION
      );

      expect(result).toBe(true);
    });

    it('should return true for MAINTENANCE type when emailNotifications is undefined', async () => {
      mockProfileService.getUserNotificationPreferences.mockResolvedValue({
        success: true,
        data: {},
      });

      const result = await notificationService.shouldSendEmail(
        userId,
        cuid,
        NotificationTypeEnum.MAINTENANCE
      );

      // emailNotifications !== false evaluates to true when undefined
      expect(result).toBe(true);
    });
  });

  describe('error handling defaults to allowing email', () => {
    it('should return true when preferences retrieval fails with an error', async () => {
      mockProfileService.getUserNotificationPreferences.mockRejectedValue(
        new Error('Database connection lost')
      );

      const result = await notificationService.shouldSendEmail(
        userId,
        cuid,
        NotificationTypeEnum.INSPECTION
      );

      expect(result).toBe(true);
    });

    it('should return true when preferences data is null', async () => {
      mockProfileService.getUserNotificationPreferences.mockResolvedValue({
        success: true,
        data: null,
      });

      const result = await notificationService.shouldSendEmail(
        userId,
        cuid,
        NotificationTypeEnum.INSPECTION
      );

      expect(result).toBe(true);
    });

    it('should return true when preferences response has success: false', async () => {
      mockProfileService.getUserNotificationPreferences.mockResolvedValue({
        success: false,
        data: null,
      });

      const result = await notificationService.shouldSendEmail(
        userId,
        cuid,
        NotificationTypeEnum.MAINTENANCE
      );

      expect(result).toBe(true);
    });
  });
});
