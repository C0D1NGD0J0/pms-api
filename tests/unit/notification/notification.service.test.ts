import { EventTypes } from '@interfaces/events.interface';
import { NotificationService } from '@services/notification/notification.service';
import { handleMaintenanceChargePaid } from '@services/notification/notification.maintenance.handlers';
import { handlePaymentSucceeded, handlePaymentOverdue, handlePaymentFailed } from '@services/notification/notification.payment.handlers';
import { NotificationPriorityEnum, INotificationDocument, NotificationTypeEnum, RecipientTypeEnum } from '@interfaces/notification.interface';
import {
  MaintenanceChargePaidPayload,
  PaymentSucceededPayload,
  PaymentOverduePayload,
  PaymentFailedPayload,
} from '@interfaces/events.interface';

// Mock NotificationDAO
const mockNotificationDAO = {
  create: jest.fn(),
  findFirst: jest.fn(),
  findByNuid: jest.fn(),
  list: jest.fn(),
  updateById: jest.fn(),
  updateMany: jest.fn(),
} as any;

// Mock EventEmitterService
const mockEmitterService = {
  on: jest.fn(),
  emit: jest.fn(),
  off: jest.fn(),
} as any;

// Mock UserService
const mockUserService = {
  getUsersByRole: jest.fn(),
} as any;

// Mock SSEService
const mockSSEService = {
  sendToUser: jest.fn(),
  broadcastToClient: jest.fn(),
} as any;

// Mock ProfileService
const mockProfileService = {
  getProfile: jest.fn(),
} as any;

// Mock ProfileDAO
const mockProfileDAO = {
  findFirst: jest.fn(),
} as any;

// Mock ClientDAO
const mockClientDAO = {
  findByCuid: jest.fn(),
} as any;

// Mock UserDAO
const mockUserDAO = {
  findById: jest.fn(),
} as any;

// Mock NotificationCache
const mockNotificationCache = {
  markAnnouncementsRead: jest.fn(),
  getReadAnnouncementNuids: jest.fn(),
} as any;

// Mock Logger
const _mockLogger = {
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
      notificationCache: mockNotificationCache,
      emitterService: mockEmitterService,
      profileDAO: mockProfileDAO,
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      userService: mockUserService,
      sseService: mockSSEService,
      profileService: mockProfileService,
    } as any);

    // Mock createNotification to avoid database calls
    jest.spyOn(notificationService, 'createNotification').mockReturnValue(Promise.resolve({
      success: true,
      data: { nuid: 'test-notification-id' } as unknown as INotificationDocument,
    }));

    // Spy on the actual logger methods
    jest.spyOn(notificationService['log'], 'error').mockImplementation((_msg: unknown) => undefined);
    jest.spyOn(notificationService['log'], 'info').mockImplementation((_msg: unknown) => undefined);
    jest.spyOn(notificationService['log'], 'warn').mockImplementation((_msg: unknown) => undefined);
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

      expect(notificationService['log'].info).toHaveBeenCalledWith(
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
      (notificationService.createNotification as jest.MockedFunction<typeof notificationService.createNotification>).mockRejectedValueOnce(
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

      expect(notificationService['log'].error).toHaveBeenCalledWith(
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
      (notificationService.createNotification as jest.MockedFunction<typeof notificationService.createNotification>).mockRejectedValueOnce(
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

      expect(notificationService['log'].error).toHaveBeenCalledWith(
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

      expect(notificationService['log'].info).toHaveBeenCalledWith(
        'System error notifications sent',
        expect.objectContaining({
          errorType: 'auto_send_failed',
          resourceIdentifier: 'LEASE-123',
          recipientCount: 2,
        })
      );
    });
  });

  describe('handleMaintenanceChargePaid', () => {
    let mockChargePaidCtx: any;
    const payload: MaintenanceChargePaidPayload = {
      cuid: 'CLIENT001',
      mruid: 'MR001',
      pytuid: 'PYT001',
      amountInCents: 50000,
    };

    beforeEach(() => {
      mockChargePaidCtx = {
        createNotification: jest.fn().mockReturnValue(Promise.resolve({ success: true, data: { nuid: 'test-notification-id' } })),
        log: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      };
    });

    it('creates a HIGH-priority PAYMENT announcement for ADMIN + SUPER_ADMIN', async () => {
      await handleMaintenanceChargePaid(mockChargePaidCtx, payload);

      expect(mockChargePaidCtx.createNotification).toHaveBeenCalledWith(
        'CLIENT001',
        NotificationTypeEnum.PAYMENT,
        expect.objectContaining({
          recipientType: RecipientTypeEnum.ANNOUNCEMENT,
          targetRoles: expect.arrayContaining(['admin', 'super-admin']),
          priority: NotificationPriorityEnum.HIGH,
          metadata: expect.objectContaining({ mruid: 'MR001' }),
        })
      );
    });

    it('passes the cuid as the first argument to createNotification', async () => {
      await handleMaintenanceChargePaid(mockChargePaidCtx, payload);

      expect(mockChargePaidCtx.createNotification).toHaveBeenCalledWith(
        'CLIENT001',
        expect.anything(),
        expect.anything()
      );
    });

    it('does not throw when createNotification rejects', async () => {
      mockChargePaidCtx.createNotification.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        handleMaintenanceChargePaid(mockChargePaidCtx, payload)
      ).resolves.not.toThrow();
    });

    it('logs error when createNotification rejects', async () => {
      mockChargePaidCtx.createNotification.mockRejectedValueOnce(new Error('DB error'));

      await handleMaintenanceChargePaid(mockChargePaidCtx, payload);

      expect(mockChargePaidCtx.log.error).toHaveBeenCalledWith(
        'Error sending maintenance charge paid notification',
        expect.objectContaining({ payload })
      );
    });
  });
});

describe('NotificationService — Announcement Read Tracking', () => {
  let notificationService: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();

    notificationService = new NotificationService({
      notificationDAO: mockNotificationDAO,
      notificationCache: mockNotificationCache,
      emitterService: mockEmitterService,
      profileDAO: mockProfileDAO,
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      userService: mockUserService,
      sseService: mockSSEService,
      profileService: mockProfileService,
    } as any);

    jest.spyOn(notificationService['log'], 'error').mockImplementation(() => undefined);
    jest.spyOn(notificationService['log'], 'info').mockImplementation(() => undefined);
  });

  describe('markAllAsRead', () => {
    it('stores Redis keys for unread announcements and updates individual notifications in DB', async () => {
      mockNotificationDAO.updateMany.mockResolvedValue({ modifiedCount: 3 });
      mockNotificationDAO.list.mockResolvedValue({
        items: [{ nuid: 'ANN-1' }, { nuid: 'ANN-2' }],
      });
      mockNotificationCache.markAnnouncementsRead.mockResolvedValue(undefined);

      const result = await notificationService.markAllAsRead('user-123', 'CUID');

      expect(result.success).toBe(true);
      expect(result.data.modifiedCount).toBe(5);
      expect(mockNotificationDAO.updateMany).toHaveBeenCalledWith(
        { recipientType: 'individual', recipient: 'user-123', cuid: 'CUID', isRead: false },
        expect.objectContaining({ $set: { isRead: true, readAt: expect.any(Date) } })
      );
      expect(mockNotificationCache.markAnnouncementsRead).toHaveBeenCalledWith(
        'CUID',
        ['ANN-1', 'ANN-2'],
        'user-123'
      );
    });

    it('skips Redis when no unread announcements exist', async () => {
      mockNotificationDAO.updateMany.mockResolvedValue({ modifiedCount: 1 });
      mockNotificationDAO.list.mockResolvedValue({ items: [] });

      const result = await notificationService.markAllAsRead('user-123', 'CUID');

      expect(result.success).toBe(true);
      expect(mockNotificationCache.markAnnouncementsRead).not.toHaveBeenCalled();
    });
  });

  describe('markAsRead', () => {
    it('stores in Redis for announcements without updating DB', async () => {
      mockNotificationDAO.findByNuid.mockResolvedValue({
        nuid: 'ANN-1',
        recipientType: 'announcement',
        cuid: 'CUID',
      });
      mockNotificationCache.markAnnouncementsRead.mockResolvedValue(undefined);

      const result = await notificationService.markAsRead('ANN-1', 'user-123', 'CUID');

      expect(result.success).toBe(true);
      expect(mockNotificationCache.markAnnouncementsRead).toHaveBeenCalledWith(
        'CUID',
        ['ANN-1'],
        'user-123'
      );
      expect(mockNotificationDAO.updateById).not.toHaveBeenCalled();
    });

    it('returns not found when notification does not exist', async () => {
      mockNotificationDAO.findByNuid.mockResolvedValue(null);

      const result = await notificationService.markAsRead('MISSING', 'user-123', 'CUID');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });
});

// ─── MR event handler tests ───────────────────────────────────────────────────
// Uses a real synchronous event emitter so handlers fire without async queuing.

// Flush all pending microtasks + I/O callbacks — needed because handlers chain multiple awaits.
const flushPromises = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('NotificationService - MR event handlers', () => {
  // Synchronous listener registry
  const listeners: Record<string, ((payload: unknown) => void)[]> = {};

  // Valid 24-hex ObjectId strings — handlers call `new Types.ObjectId(id)` which
  // throws a BSONError for short strings like 'tid1', silently swallowing the email.
  const testTenantId = '65f1a2b3c4d5e6f7a8b9c0d1';
  const testVendorId = '65f1a2b3c4d5e6f7a8b9c0d2';
  const testUserId = '65f1a2b3c4d5e6f7a8b9c0d3';

  const syncEmitter = {
    on: jest.fn((event: string, handler: (payload: unknown) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    off: jest.fn(),
    emit: (event: string, payload: unknown) => {
      (listeners[event] || []).forEach((fn) => fn(payload));
    },
  } as any;

  const mockEmailQueue = { addToEmailQueue: jest.fn() } as any;

  const mockMRDAO = {
    // scope stored as object (sanitized by submitWorkOrder service)
    getByMruid: jest.fn().mockReturnValue(
      Promise.resolve({ mruid: 'MR-001', title: 'Leaking pipe', category: 'plumbing', priority: 'high', tenantId: 'tid1', invoice: { amount: 50000, currency: 'USD' }, workOrder: { estimatedCostInCents: 20000, scope: { text: 'Fix pipe', html: '<p>Fix pipe</p>' }, notes: null, lineItems: [] } })
    ),
  } as any;

  const mockUserDAOMR = {
    findFirst: jest.fn().mockReturnValue(
      Promise.resolve({ _id: 'uid1', email: 'user@test.com', firstName: 'Test', firstName2: 'User' })
    ),
    findById: jest.fn(),
  } as any;

  const mockNotificationDAOMR = { create: jest.fn(), findFirst: jest.fn(), list: jest.fn(), updateById: jest.fn(), updateMany: jest.fn(), findByNuid: jest.fn() } as any;
  const mockNotificationCacheMR = { markAnnouncementsRead: jest.fn(), getReadAnnouncementNuids: jest.fn() } as any;

  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(listeners).forEach((k) => delete listeners[k]);

    service = new NotificationService({
      notificationDAO: mockNotificationDAOMR,
      notificationCache: mockNotificationCacheMR,
      emitterService: syncEmitter,
      maintenanceRequestDAO: mockMRDAO,
      emailQueue: mockEmailQueue,
      profileDAO: { findFirst: jest.fn() } as any,
      clientDAO: { findByCuid: jest.fn() } as any,
      userDAO: mockUserDAOMR,
      userService: { getUsersByRole: jest.fn() } as any,
      sseService: { sendToUser: jest.fn(), broadcastToClient: jest.fn() } as any,
      profileService: { getProfile: jest.fn() } as any,
    } as any);

    jest.spyOn(service, 'createNotification').mockReturnValue(Promise.resolve({ success: true, data: {} as any }));
  });

  afterEach(async () => {
    await service.destroy();
  });

  it('should create in-app notification and enqueue email on MAINTENANCE_REQUEST_CREATED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_CREATED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', tenantId: testTenantId,
      propertyId: 'pid', title: 'Leaking pipe', category: 'plumbing', priority: 'high',
    });
    await flushPromises();

    expect(service.createNotification).toHaveBeenCalled();
    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceRequestCreated',
      expect.objectContaining({ to: 'user@test.com' })
    );
  });

  it('should notify vendor and enqueue assignment email on MAINTENANCE_REQUEST_ASSIGNED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_ASSIGNED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', vendorId: testVendorId, assignedBy: testUserId,
    });
    await flushPromises();

    expect(service.createNotification).toHaveBeenCalled();
    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceRequestAssigned',
      expect.objectContaining({ to: 'user@test.com' })
    );
  });

  it('should notify tenant and enqueue accepted email on MAINTENANCE_REQUEST_ACCEPTED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_ACCEPTED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', vendorId: testVendorId, tenantId: testTenantId,
    });
    await flushPromises();

    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceRequestAccepted',
      expect.objectContaining({ to: 'user@test.com' })
    );
  });

  it('should enqueue declined email on MAINTENANCE_REQUEST_DECLINED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_DECLINED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', vendorId: testVendorId, reason: 'Busy',
    });
    await flushPromises();

    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceRequestDeclined',
      expect.objectContaining({ to: '' })
    );
  });

  it('should notify tenant and enqueue completed email on MAINTENANCE_REQUEST_COMPLETED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_COMPLETED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', tenantId: testTenantId,
      vendorId: testVendorId, completedBy: testUserId,
    });
    await flushPromises();

    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceRequestCompleted',
      expect.objectContaining({ to: 'user@test.com' })
    );
  });

  it('should enqueue invoice approved email on MAINTENANCE_INVOICE_APPROVED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_INVOICE_APPROVED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', invoiceId: 'inv1',
      tenantId: testTenantId, vendorId: testVendorId, amount: 50000, currency: 'USD',
      isBillable: true, approvedBy: testUserId, title: 'Leaking pipe',
    });
    await flushPromises();

    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceInvoiceApproved',
      expect.objectContaining({ to: 'user@test.com' })
    );
  });

  it('should enqueue invoice rejected email on MAINTENANCE_INVOICE_REJECTED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_INVOICE_REJECTED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', invoiceId: 'inv1',
      vendorId: testVendorId, rejectionReason: 'Insufficient detail', rejectedBy: testUserId,
    });
    await flushPromises();

    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceInvoiceRejected',
      expect.objectContaining({ to: 'user@test.com' })
    );
  });

  it('should enqueue work order approved email on MAINTENANCE_WORK_ORDER_APPROVED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_APPROVED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', vendorId: testVendorId, approvedBy: testUserId,
    });
    await flushPromises();

    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceWorkOrderApproved',
      expect.objectContaining({ to: 'user@test.com' })
    );
  });

  it('should enqueue work order rejected email on MAINTENANCE_WORK_ORDER_REJECTED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_REJECTED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', vendorId: testVendorId,
      rejectedBy: testUserId, rejectionReason: 'Out of scope',
    });
    await flushPromises();

    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceWorkOrderRejected',
      expect.objectContaining({ to: 'user@test.com' })
    );
  });

  it('should not enqueue email when payload has no tenantId for MAINTENANCE_REQUEST_CREATED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_CREATED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid',
      propertyId: 'pid', title: 'Leaking pipe', category: 'plumbing', priority: 'high',
    });
    await flushPromises();

    expect(mockEmailQueue.addToEmailQueue).not.toHaveBeenCalled();
  });

  it('should still create in-app notification even if emailQueue throws', async () => {
    mockEmailQueue.addToEmailQueue.mockImplementationOnce(() => { throw new Error('queue full'); });

    syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_CREATED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', tenantId: testTenantId,
      propertyId: 'pid', title: 'Pipe', category: 'plumbing', priority: 'medium',
    });
    await flushPromises();

    expect(service.createNotification).toHaveBeenCalled();
  });

  it('should create in-app notification and enqueue PM email on MAINTENANCE_WORK_ORDER_SUBMITTED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_SUBMITTED, {
      cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
    });
    await flushPromises();

    expect(service.createNotification).toHaveBeenCalledWith(
      'cuid1',
      expect.any(String),
      expect.objectContaining({ metadata: expect.objectContaining({ mruid: 'MR-001' }) })
    );
    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceWorkOrderSubmitted',
      expect.objectContaining({ data: expect.objectContaining({ vendorId: testVendorId }) })
    );
  });

  it('flattens work order scope from object to string for email on MAINTENANCE_WORK_ORDER_SUBMITTED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_SUBMITTED, {
      cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
    });
    await flushPromises();

    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceWorkOrderSubmitted',
      expect.objectContaining({
        data: expect.objectContaining({
          workOrder: expect.objectContaining({ scope: 'Fix pipe' }),
        }),
      })
    );
  });

  it('should enqueue tenant email when tenantId is present on MAINTENANCE_WORK_ORDER_SUBMITTED', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_SUBMITTED, {
      cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
    });
    await flushPromises();

    const tenantEmailCall = (mockEmailQueue.addToEmailQueue as jest.Mock).mock.calls.find(
      (c: any[]) => c[0] === 'maintenanceWorkOrderSubmittedTenant'
    );
    expect(tenantEmailCall).toBeDefined();
    expect(tenantEmailCall![1]).toMatchObject({ to: 'user@test.com' });
  });

  it('flattens work order scope on MAINTENANCE_WORK_ORDER_APPROVED email', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_APPROVED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', vendorId: testVendorId, approvedBy: testUserId,
    });
    await flushPromises();

    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceWorkOrderApproved',
      expect.objectContaining({
        data: expect.objectContaining({
          workOrder: expect.objectContaining({ scope: 'Fix pipe' }),
        }),
      })
    );
  });

  it('flattens work order scope on MAINTENANCE_WORK_ORDER_REJECTED email', async () => {
    syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_REJECTED, {
      cuid: 'cuid1', mruid: 'MR-001', requestId: 'rid', vendorId: testVendorId,
      rejectedBy: testUserId, rejectionReason: 'Out of scope',
    });
    await flushPromises();

    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'maintenanceWorkOrderRejected',
      expect.objectContaining({
        data: expect.objectContaining({
          workOrder: expect.objectContaining({ scope: 'Fix pipe' }),
        }),
      })
    );
  });

  // ── Technician notification tests ─────────────────────────────────────────

  const testTechnicianId = '65f1a2b3c4d5e6f7a8b9c0d4';

  describe('handleWorkOrderApproved — technician notifications', () => {
    it('sends 2 notifications when technicianId is present and differs from vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_APPROVED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
        technicianId: testTechnicianId, approvedBy: testUserId,
      });
      await flushPromises();

      const calls = (service.createNotification as jest.Mock).mock.calls.filter(
        (c: any[]) => c[1] === 'maintenance'
      );
      const recipients = calls.map((c: any[]) => c[2].recipient).filter(Boolean);
      expect(recipients).toContain(testVendorId);
      expect(recipients).toContain(testTechnicianId);
    });

    it('sends 1 notification when technicianId equals vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_APPROVED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
        technicianId: testVendorId, approvedBy: testUserId,
      });
      await flushPromises();

      const individualCalls = (service.createNotification as jest.Mock).mock.calls.filter(
        (c: any[]) => c[2]?.recipient === testVendorId
      );
      expect(individualCalls).toHaveLength(1);
    });

    it('sends 1 notification when technicianId is absent', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_APPROVED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId, approvedBy: testUserId,
      });
      await flushPromises();

      const individualCalls = (service.createNotification as jest.Mock).mock.calls.filter(
        (c: any[]) => c[2]?.recipientType === 'individual'
      );
      expect(individualCalls).toHaveLength(1);
      expect(individualCalls[0][2].recipient).toBe(testVendorId);
    });
  });

  describe('handleWorkOrderRejected — technician notifications', () => {
    it('sends individual notification to technician when technicianId present and different from vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_REJECTED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
        technicianId: testTechnicianId, rejectedBy: testUserId, rejectionReason: 'Scope unclear',
      });
      await flushPromises();

      const recipients = (service.createNotification as jest.Mock).mock.calls
        .map((c: any[]) => c[2]?.recipient).filter(Boolean);
      expect(recipients).toContain(testTechnicianId);
    });

    it('sends only 1 individual notification when technicianId equals vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_REJECTED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
        technicianId: testVendorId, rejectedBy: testUserId, rejectionReason: 'N/A',
      });
      await flushPromises();

      const individualCalls = (service.createNotification as jest.Mock).mock.calls.filter(
        (c: any[]) => c[2]?.recipient === testVendorId
      );
      expect(individualCalls).toHaveLength(1);
    });

    it('sends only 1 notification when technicianId is absent', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_WORK_ORDER_REJECTED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
        rejectedBy: testUserId, rejectionReason: 'Out of scope',
      });
      await flushPromises();

      const individualCalls = (service.createNotification as jest.Mock).mock.calls.filter(
        (c: any[]) => c[2]?.recipientType === 'individual'
      );
      expect(individualCalls).toHaveLength(1);
    });
  });

  describe('handleInvoiceApproved — technician notifications', () => {
    it('sends individual notification to technician when technicianId present and different from vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_INVOICE_APPROVED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
        technicianId: testTechnicianId, approvedBy: testUserId,
        amount: 50000, currency: 'USD', isBillable: false,
      });
      await flushPromises();

      const recipients = (service.createNotification as jest.Mock).mock.calls
        .map((c: any[]) => c[2]?.recipient).filter(Boolean);
      expect(recipients).toContain(testTechnicianId);
    });

    it('sends only 1 vendor notification when technicianId equals vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_INVOICE_APPROVED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
        technicianId: testVendorId, approvedBy: testUserId,
        amount: 50000, currency: 'USD', isBillable: false,
      });
      await flushPromises();

      const vendorCalls = (service.createNotification as jest.Mock).mock.calls.filter(
        (c: any[]) => c[2]?.recipient === testVendorId
      );
      expect(vendorCalls).toHaveLength(1);
    });

    it('sends only 1 notification when technicianId is absent', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_INVOICE_APPROVED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
        approvedBy: testUserId, amount: 50000, currency: 'USD', isBillable: false,
      });
      await flushPromises();

      const individualCalls = (service.createNotification as jest.Mock).mock.calls.filter(
        (c: any[]) => c[2]?.recipientType === 'individual'
      );
      expect(individualCalls).toHaveLength(1);
    });
  });

  describe('handleInvoiceRejected — technician notifications', () => {
    it('sends individual notification to technician when technicianId present and different from vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_INVOICE_REJECTED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
        technicianId: testTechnicianId, rejectedBy: testUserId, rejectionReason: 'Invalid amount',
      });
      await flushPromises();

      const recipients = (service.createNotification as jest.Mock).mock.calls
        .map((c: any[]) => c[2]?.recipient).filter(Boolean);
      expect(recipients).toContain(testTechnicianId);
    });

    it('sends only 1 individual notification when technicianId equals vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_INVOICE_REJECTED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
        technicianId: testVendorId, rejectedBy: testUserId, rejectionReason: 'N/A',
      });
      await flushPromises();

      const vendorCalls = (service.createNotification as jest.Mock).mock.calls.filter(
        (c: any[]) => c[2]?.recipient === testVendorId
      );
      expect(vendorCalls).toHaveLength(1);
    });

    it('sends only 1 notification when technicianId is absent', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_INVOICE_REJECTED, {
        cuid: 'cuid1', mruid: 'MR-001', vendorId: testVendorId,
        rejectedBy: testUserId, rejectionReason: 'Insufficient detail',
      });
      await flushPromises();

      const individualCalls = (service.createNotification as jest.Mock).mock.calls.filter(
        (c: any[]) => c[2]?.recipientType === 'individual'
      );
      expect(individualCalls).toHaveLength(1);
    });
  });

  describe('handleMRCancelled — technician notifications', () => {
    it('sends individual notification to technician when technicianId present and different from vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_CANCELLED, {
        cuid: 'cuid1', mruid: 'MR-001', tenantId: testTenantId,
        vendorId: testVendorId, technicianId: testTechnicianId,
      });
      await flushPromises();

      const recipients = (service.createNotification as jest.Mock).mock.calls
        .map((c: any[]) => c[2]?.recipient).filter(Boolean);
      expect(recipients).toContain(testTechnicianId);
    });

    it('sends only 1 vendor notification when technicianId equals vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_CANCELLED, {
        cuid: 'cuid1', mruid: 'MR-001', tenantId: testTenantId,
        vendorId: testVendorId, technicianId: testVendorId,
      });
      await flushPromises();

      const vendorCalls = (service.createNotification as jest.Mock).mock.calls.filter(
        (c: any[]) => c[2]?.recipient === testVendorId
      );
      expect(vendorCalls).toHaveLength(1);
    });

    it('sends only vendor notification when technicianId is absent', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_CANCELLED, {
        cuid: 'cuid1', mruid: 'MR-001', tenantId: testTenantId, vendorId: testVendorId,
      });
      await flushPromises();

      const recipients = (service.createNotification as jest.Mock).mock.calls
        .map((c: any[]) => c[2]?.recipient).filter(Boolean);
      expect(recipients).not.toContain(testTechnicianId);
    });
  });

  describe('handleMRCompleted — technician notifications', () => {
    it('sends individual notification to technician when technicianId present and different from vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_COMPLETED, {
        cuid: 'cuid1', mruid: 'MR-001', tenantId: testTenantId,
        vendorId: testVendorId, technicianId: testTechnicianId, completedBy: testUserId,
      });
      await flushPromises();

      const recipients = (service.createNotification as jest.Mock).mock.calls
        .map((c: any[]) => c[2]?.recipient).filter(Boolean);
      expect(recipients).toContain(testTechnicianId);
    });

    it('sends only 1 vendor notification when technicianId equals vendorId', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_COMPLETED, {
        cuid: 'cuid1', mruid: 'MR-001', tenantId: testTenantId,
        vendorId: testVendorId, technicianId: testVendorId, completedBy: testUserId,
      });
      await flushPromises();

      const vendorCalls = (service.createNotification as jest.Mock).mock.calls.filter(
        (c: any[]) => c[2]?.recipient === testVendorId
      );
      expect(vendorCalls).toHaveLength(1);
    });

    it('sends only vendor/tenant notifications when technicianId is absent', async () => {
      syncEmitter.emit(EventTypes.MAINTENANCE_REQUEST_COMPLETED, {
        cuid: 'cuid1', mruid: 'MR-001', tenantId: testTenantId,
        vendorId: testVendorId, completedBy: testUserId,
      });
      await flushPromises();

      const recipients = (service.createNotification as jest.Mock).mock.calls
        .map((c: any[]) => c[2]?.recipient).filter(Boolean);
      expect(recipients).not.toContain(testTechnicianId);
    });
  });
});

// ===========================================================================
// Rent payment notification gaps
// ===========================================================================

describe('NotificationService - handlePaymentFailed', () => {
  let mockCtx: any;

  const basePayload: PaymentFailedPayload = {
    cuid: 'CLIENT001',
    pytuid: 'PYT001',
    invoiceId: 'inv_123',
    amount: 150000,
    tenantId: 'tenant-user-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCtx = {
      createNotification: jest.fn().mockReturnValue(Promise.resolve({ success: true, data: { nuid: 'nuid-1' } })),
      log: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    };
  });

  it('sends HIGH-priority PM announcement to ADMIN + SUPER_ADMIN', async () => {
    await handlePaymentFailed(mockCtx, basePayload);

    expect(mockCtx.createNotification).toHaveBeenCalledWith(
      'CLIENT001',
      NotificationTypeEnum.PAYMENT,
      expect.objectContaining({
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: expect.arrayContaining(['admin', 'super-admin']),
        priority: NotificationPriorityEnum.HIGH,
      })
    );
  });

  it('sends individual HIGH-priority notification to tenant when tenantId present', async () => {
    await handlePaymentFailed(mockCtx, basePayload);

    expect(mockCtx.createNotification).toHaveBeenCalledWith(
      'CLIENT001',
      NotificationTypeEnum.PAYMENT,
      expect.objectContaining({
        recipient: 'tenant-user-id',
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.HIGH,
      })
    );
  });

  it('creates 2 notifications (PM + tenant) when tenantId present', async () => {
    await handlePaymentFailed(mockCtx, basePayload);

    expect(mockCtx.createNotification).toHaveBeenCalledTimes(2);
  });

  it('creates only 1 notification (PM) when tenantId absent', async () => {
    const { tenantId: _t, ...noTenant } = basePayload;
    await handlePaymentFailed(mockCtx, noTenant as PaymentFailedPayload);

    expect(mockCtx.createNotification).toHaveBeenCalledTimes(1);
  });

  it('does not throw when createNotification rejects', async () => {
    mockCtx.createNotification.mockRejectedValue(new Error('DB'));

    await expect(
      handlePaymentFailed(mockCtx, basePayload)
    ).resolves.not.toThrow();
  });
});

describe('NotificationService - handlePaymentOverdue', () => {
  let mockCtx: any;

  const basePayload: PaymentOverduePayload = {
    cuid: 'CLIENT001',
    pytuid: 'PYT001',
    amount: 150000,
    dueDate: new Date('2026-05-01'),
    paymentType: 'rent',
    tenantId: 'tenant-user-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCtx = {
      createNotification: jest.fn().mockReturnValue(Promise.resolve({ success: true, data: { nuid: 'nuid-1' } })),
      log: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    };
  });

  it('sends PM announcement to ADMIN + SUPER_ADMIN', async () => {
    await handlePaymentOverdue(mockCtx, basePayload);

    expect(mockCtx.createNotification).toHaveBeenCalledWith(
      'CLIENT001',
      NotificationTypeEnum.PAYMENT,
      expect.objectContaining({
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        targetRoles: expect.arrayContaining(['admin', 'super-admin']),
        priority: NotificationPriorityEnum.HIGH,
      })
    );
  });

  it('sends individual notification to tenant when tenantId present', async () => {
    await handlePaymentOverdue(mockCtx, basePayload);

    expect(mockCtx.createNotification).toHaveBeenCalledWith(
      'CLIENT001',
      NotificationTypeEnum.PAYMENT,
      expect.objectContaining({
        recipient: 'tenant-user-id',
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        priority: NotificationPriorityEnum.HIGH,
      })
    );
  });

  it('creates 2 notifications (PM + tenant) when tenantId present', async () => {
    await handlePaymentOverdue(mockCtx, basePayload);

    expect(mockCtx.createNotification).toHaveBeenCalledTimes(2);
  });

  it('skips tenant notification when tenantId absent', async () => {
    const { tenantId: _t, ...noTenant } = basePayload;
    await handlePaymentOverdue(mockCtx, noTenant as PaymentOverduePayload);

    expect(mockCtx.createNotification).toHaveBeenCalledTimes(1);
  });

  it('does not throw when createNotification rejects', async () => {
    mockCtx.createNotification.mockRejectedValue(new Error('DB'));

    await expect(
      handlePaymentOverdue(mockCtx, basePayload)
    ).resolves.not.toThrow();
  });
});

describe('NotificationService - handlePaymentSucceeded', () => {
  let mockCtx: any;

  const payload: PaymentSucceededPayload = {
    cuid: 'CLIENT001',
    pytuid: 'PYT001',
    invoiceId: 'inv_1',
    amount: 150000,
    paidAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCtx = {
      createNotification: jest.fn().mockReturnValue(Promise.resolve({ success: true, data: { nuid: 'nuid-1' } })),
      emailQueue: { addToEmailQueue: jest.fn() },
      userDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve(null)) },
      log: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    };
  });

  it('sends notification to both ADMIN and SUPER_ADMIN', async () => {
    await handlePaymentSucceeded(mockCtx, payload);

    expect(mockCtx.createNotification).toHaveBeenCalledWith(
      'CLIENT001',
      NotificationTypeEnum.PAYMENT,
      expect.objectContaining({
        targetRoles: expect.arrayContaining(['admin', 'super-admin']),
      })
    );
  });

  it('does not send to SUPER_ADMIN only', async () => {
    await handlePaymentSucceeded(mockCtx, payload);

    const call = (mockCtx.createNotification as jest.Mock).mock.calls[0][2];
    expect(call.targetRoles).toContain('admin');
  });

  it('queues payment receipt email when tenantId is present', async () => {
    const tenantId = '507f1f77bcf86cd799439011';
    const payloadWithTenant: PaymentSucceededPayload = {
      ...payload,
      tenantId,
      receiptUrl: 'https://stripe.com/receipt/123',
      paymentType: 'rent',
    };

    mockCtx.userDAO.findFirst.mockReturnValue(
      Promise.resolve({
        email: 'tenant@example.com',
        fullname: 'Jane Doe',
        profile: { personalInfo: { firstName: 'Jane' } },
      })
    );

    await handlePaymentSucceeded(mockCtx, payloadWithTenant);

    expect(mockCtx.emailQueue.addToEmailQueue).toHaveBeenCalledWith(
      'paymentReceipt',
      expect.objectContaining({
        to: 'tenant@example.com',
        emailType: 'PAYMENT_RECEIPT',
        data: expect.objectContaining({
          tenantName: 'Jane',
          paymentType: 'Rent',
          receiptUrl: 'https://stripe.com/receipt/123',
        }),
      })
    );
  });

  it('does not queue receipt email when tenantId is absent', async () => {
    await handlePaymentSucceeded(mockCtx, payload);

    expect(mockCtx.emailQueue.addToEmailQueue).not.toHaveBeenCalled();
  });
});
