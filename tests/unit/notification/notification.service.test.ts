import { beforeEach, describe, expect, jest, it } from '@jest/globals';
import { NotificationService } from '@services/notification/notification.service';
import { NotificationPriorityEnum, NotificationTypeEnum, RecipientTypeEnum } from '@interfaces/notification.interface';

// Mock NotificationDAO
const mockNotificationDAO = {
  create: jest.fn(),
  findFirst: jest.fn(),
  list: jest.fn(),
  updateById: jest.fn(),
} as any;

// Mock Logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
} as any;

describe('NotificationService - New Methods', () => {
  let notificationService: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();

    notificationService = new NotificationService({
      notificationDAO: mockNotificationDAO,
      log: mockLogger,
    } as any);

    // Mock createNotification to avoid database calls
    notificationService.createNotification = jest.fn().mockResolvedValue({
      success: true,
      data: { nuid: 'test-notification-id' },
    });
  });

  describe('notifyLeaseLifecycleEvent', () => {
    it('should send notification to tenant for renewal_created event', async () => {
      const params = {
        eventType: 'renewal_created' as const,
        lease: {
          luid: 'LEASE-123',
          leaseNumber: 'L-2025-001',
          cuid: 'client-123',
          tenantId: 'tenant-123',
          propertyAddress: '123 Main St',
          endDate: new Date('2026-12-31'),
          startDate: new Date('2026-01-01'),
        },
        recipients: {
          tenant: true,
        },
        metadata: {
          autoApproved: false,
          originalLeaseId: 'LEASE-OLD',
        },
      };

      await notificationService.notifyLeaseLifecycleEvent(params);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        'client-123',
        NotificationTypeEnum.LEASE,
        expect.objectContaining({
          type: NotificationTypeEnum.LEASE,
          recipient: 'tenant-123',
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          metadata: expect.objectContaining({
            leaseId: 'LEASE-123',
            leaseNumber: 'L-2025-001',
            eventType: 'renewal_created',
            recipientRole: 'tenant',
          }),
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Lease lifecycle event notifications sent: renewal_created',
        expect.any(Object)
      );
    });

    it('should send notifications to multiple recipients', async () => {
      const params = {
        eventType: 'renewal_approved' as const,
        lease: {
          luid: 'LEASE-123',
          leaseNumber: 'L-2025-001',
          cuid: 'client-123',
          tenantId: 'tenant-123',
          propertyAddress: '123 Main St',
          endDate: new Date('2026-12-31'),
          startDate: new Date('2026-01-01'),
        },
        recipients: {
          tenant: true,
          propertyManager: 'manager-123',
          createdBy: 'creator-123',
        },
      };

      await notificationService.notifyLeaseLifecycleEvent(params);

      // Should be called 3 times: tenant, manager, creator
      expect(notificationService.createNotification).toHaveBeenCalledTimes(3);
    });

    it('should handle expired event', async () => {
      const params = {
        eventType: 'expired' as const,
        lease: {
          luid: 'LEASE-123',
          leaseNumber: 'L-2025-001',
          cuid: 'client-123',
          tenantId: 'tenant-123',
          propertyAddress: '123 Main St',
          endDate: new Date('2025-12-31'),
        },
        recipients: {
          tenant: true,
          propertyManager: 'manager-123',
        },
        metadata: {
          daysPastExpiry: 8,
          noRenewal: true,
        },
      };

      await notificationService.notifyLeaseLifecycleEvent(params);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        'client-123',
        NotificationTypeEnum.LEASE,
        expect.objectContaining({
          metadata: expect.objectContaining({
            eventType: 'expired',
            daysPastExpiry: 8,
            noRenewal: true,
          }),
        })
      );
    });

    it('should handle renewal_incomplete event with high priority', async () => {
      const params = {
        eventType: 'renewal_incomplete' as const,
        lease: {
          luid: 'LEASE-123',
          leaseNumber: 'L-2025-001',
          cuid: 'client-123',
          tenantId: 'tenant-123',
          propertyAddress: '123 Main St',
          endDate: new Date('2025-12-31'),
        },
        recipients: {
          propertyManager: 'manager-123',
          createdBy: 'creator-123',
        },
        metadata: {
          renewalId: 'RENEWAL-123',
          renewalStatus: 'pending_signature',
          actionRequired: true,
        },
      };

      await notificationService.notifyLeaseLifecycleEvent(params);

      expect(notificationService.createNotification).toHaveBeenCalled();
    });

    it('should not send notifications if no recipients', async () => {
      const params = {
        eventType: 'renewal_created' as const,
        lease: {
          luid: 'LEASE-123',
          leaseNumber: 'L-2025-001',
          cuid: 'client-123',
          tenantId: 'tenant-123',
          propertyAddress: '123 Main St',
          endDate: new Date('2026-12-31'),
        },
        recipients: {}, // No recipients
      };

      await notificationService.notifyLeaseLifecycleEvent(params);

      expect(notificationService.createNotification).not.toHaveBeenCalled();
    });

    it('should not duplicate notifications to same user', async () => {
      const params = {
        eventType: 'renewal_approved' as const,
        lease: {
          luid: 'LEASE-123',
          leaseNumber: 'L-2025-001',
          cuid: 'client-123',
          tenantId: 'tenant-123',
          propertyAddress: '123 Main St',
          endDate: new Date('2026-12-31'),
        },
        recipients: {
          tenant: true,
          propertyManager: 'manager-123',
          createdBy: 'manager-123', // Same as property manager
        },
      };

      await notificationService.notifyLeaseLifecycleEvent(params);

      // Should be called 2 times: tenant and manager (not duplicate for creator)
      expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
    });

    it('should handle errors gracefully', async () => {
      (notificationService.createNotification as jest.Mock).mockRejectedValueOnce(
        new Error('Database error')
      );

      const params = {
        eventType: 'expired' as const,
        lease: {
          luid: 'LEASE-123',
          leaseNumber: 'L-2025-001',
          cuid: 'client-123',
          tenantId: 'tenant-123',
          propertyAddress: '123 Main St',
          endDate: new Date('2025-12-31'),
        },
        recipients: {
          tenant: true,
        },
      };

      // Should not throw
      await expect(
        notificationService.notifyLeaseLifecycleEvent(params)
      ).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send lease lifecycle event notifications',
        expect.any(Object)
      );
    });
  });

  describe('notifySystemError', () => {
    it('should send system error notification to single recipient', async () => {
      const params = {
        cuid: 'client-123',
        recipientIds: ['admin-123'],
        errorType: 'auto_renewal_failed' as const,
        resourceType: 'lease' as const,
        resourceIdentifier: 'LEASE-123',
        errorMessage: 'Failed to create renewal lease',
        metadata: {
          leaseId: 'LEASE-123',
          daysUntilExpiry: 30,
        },
      };

      await notificationService.notifySystemError(params);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        'client-123',
        NotificationTypeEnum.SYSTEM,
        expect.objectContaining({
          type: NotificationTypeEnum.SYSTEM,
          priority: NotificationPriorityEnum.HIGH,
          recipient: 'admin-123',
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          metadata: expect.objectContaining({
            errorType: 'auto_renewal_failed',
            resourceType: 'lease',
            resourceIdentifier: 'LEASE-123',
            error: 'Failed to create renewal lease',
            actionRequired: true,
          }),
        })
      );
    });

    it('should send notifications to multiple admins', async () => {
      const params = {
        cuid: 'client-123',
        recipientIds: ['admin-1', 'admin-2', 'admin-3'],
        errorType: 'auto_send_failed' as const,
        resourceType: 'lease' as const,
        resourceIdentifier: 'RENEWAL-456',
        errorMessage: 'Failed to send renewal for signature',
      };

      await notificationService.notifySystemError(params);

      expect(notificationService.createNotification).toHaveBeenCalledTimes(3);
    });

    it('should handle expired_lease_processing_failed error', async () => {
      const params = {
        cuid: 'client-123',
        recipientIds: ['creator-123'],
        errorType: 'expired_lease_processing_failed' as const,
        resourceType: 'lease' as const,
        resourceIdentifier: 'LEASE-789',
        errorMessage: 'Failed to mark lease as expired',
        metadata: {
          leaseId: 'LEASE-789',
        },
      };

      await notificationService.notifySystemError(params);

      expect(notificationService.createNotification).toHaveBeenCalledWith(
        'client-123',
        NotificationTypeEnum.SYSTEM,
        expect.objectContaining({
          priority: NotificationPriorityEnum.HIGH,
          metadata: expect.objectContaining({
            errorType: 'expired_lease_processing_failed',
            leaseId: 'LEASE-789',
          }),
        })
      );
    });

    it('should handle general error type', async () => {
      const params = {
        cuid: 'client-123',
        recipientIds: ['admin-123'],
        errorType: 'general' as const,
        resourceType: 'system' as const,
        resourceIdentifier: 'SYSTEM',
        errorMessage: 'Unknown system error',
      };

      await notificationService.notifySystemError(params);

      expect(notificationService.createNotification).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      (notificationService.createNotification as jest.Mock).mockRejectedValueOnce(
        new Error('Notification creation failed')
      );

      const params = {
        cuid: 'client-123',
        recipientIds: ['admin-123'],
        errorType: 'auto_renewal_failed' as const,
        resourceType: 'lease' as const,
        resourceIdentifier: 'LEASE-123',
        errorMessage: 'Test error',
      };

      // Should not throw
      await expect(notificationService.notifySystemError(params)).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send system error notifications',
        expect.any(Object)
      );
    });

    it('should log successful notifications', async () => {
      const params = {
        cuid: 'client-123',
        recipientIds: ['admin-1', 'admin-2'],
        errorType: 'auto_send_failed' as const,
        resourceType: 'lease' as const,
        resourceIdentifier: 'LEASE-123',
        errorMessage: 'Test error',
      };

      await notificationService.notifySystemError(params);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'System error notifications sent',
        expect.objectContaining({
          errorType: 'auto_send_failed',
          resourceIdentifier: 'LEASE-123',
          recipientCount: 2,
        })
      );
    });
  });
});
