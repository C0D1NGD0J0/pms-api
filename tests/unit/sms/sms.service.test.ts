import { Types } from 'mongoose';
import { NotFoundError } from '@shared/customErrors';
import { ISubscriptionStatus } from '@interfaces/index';
import { SMSService } from '@services/smsService/sms.service';
import { SMSMessageType, ISendSMSInput, SMSStatus } from '@interfaces/sms.interface';

// ── Shared constants ──────────────────────────────────────────────────────────

const CUID = 'TEST_CUID_001';
const USER_ID = new Types.ObjectId().toString();
const ADMIN_ID = new Types.ObjectId();
const PHONE = '+14155551234';
const TWILIO_SID = 'SM_test_sid_001';

// ── Mock factory ──────────────────────────────────────────────────────────────

const makeMocks = (overrides: Record<string, any> = {}) => {
  const smsLogDAO = {
    createLog: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(null),
    updateBySid: jest.fn().mockResolvedValue({}),
    getLogsByCuid: jest.fn().mockResolvedValue({ items: [], pagination: null }),
    ...overrides.smsLogDAO,
  } as any;

  const clientDAO = {
    getClientByCuid: jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      cuid: CUID,
      accountAdmin: ADMIN_ID,
      settings: { tenantFeatures: { smsNotifications: true } },
    }),
    findFirst: jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      cuid: CUID,
      accountAdmin: ADMIN_ID,
    }),
    ...overrides.clientDAO,
  } as any;

  const profileDAO = {
    findFirst: jest.fn().mockResolvedValue({
      personalInfo: { phoneNumber: PHONE },
      settings: {
        phoneVerification: { verified: true, verifiedPhone: PHONE },
        smsConsent: { consented: true, consentedAt: new Date() },
        notifications: { smsNotifications: true },
      },
    }),
    update: jest.fn().mockResolvedValue({}),
    ...overrides.profileDAO,
  } as any;

  const twilioService = {
    sendSMS: jest.fn().mockResolvedValue({ sid: TWILIO_SID }),
    sendOTP: jest.fn().mockResolvedValue({ sid: TWILIO_SID }),
    verifyOTP: jest.fn().mockResolvedValue({ valid: true }),
    ...overrides.twilioService,
  } as any;

  const subscriptionDAO = {
    findFirst: jest.fn().mockResolvedValue({
      _id: new Types.ObjectId(),
      cuid: CUID,
      status: ISubscriptionStatus.ACTIVE,
      planName: 'growth',
      startDate: new Date(),
      smsUsage: {
        countThisPeriod: 5,
        periodStart: new Date(),
        notifiedAt80: false,
        notifiedAt100: false,
      },
    }),
    update: jest.fn().mockResolvedValue({
      smsUsage: { countThisPeriod: 6 },
    }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    ...overrides.subscriptionDAO,
  } as any;

  const featureFlagService = {
    isEnabled: jest.fn().mockReturnValue(true),
    ...overrides.featureFlagService,
  } as any;

  const notificationService = {
    createNotificationFromTemplate: jest.fn().mockResolvedValue({}),
    ...overrides.notificationService,
  } as any;

  const subscriptionPlanConfig = {
    getConfig: jest.fn().mockReturnValue({
      limits: { smsQuota: 40 },
    }),
    ...overrides.subscriptionPlanConfig,
  } as any;

  const userCache = {
    invalidateUserDetail: jest.fn().mockResolvedValue({ success: true }),
    invalidateUserLists: jest.fn().mockResolvedValue({ success: true }),
    ...overrides.userCache,
  } as any;

  return {
    smsLogDAO,
    clientDAO,
    profileDAO,
    twilioService,
    subscriptionDAO,
    featureFlagService,
    notificationService,
    subscriptionPlanConfig,
    userCache,
  };
};

const makeService = (overrides: Record<string, any> = {}) => {
  const mocks = makeMocks(overrides);
  const service = new SMSService(mocks);
  return { service, ...mocks };
};

const makeCurrentUser = (sub = USER_ID) =>
  ({
    sub,
    uid: 'uid-123',
    email: 'test@example.com',
    client: { cuid: CUID, role: 'tenant', displayname: 'Test', isVerified: true },
  }) as any;

const makeSendInput = (overrides: Partial<ISendSMSInput> = {}): ISendSMSInput => ({
  cuid: CUID,
  to: PHONE,
  body: 'Your rent is due tomorrow.',
  messageType: SMSMessageType.PAYMENT_REMINDER,
  recipientUserId: USER_ID,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SMSService', () => {
  afterEach(() => jest.restoreAllMocks());

  // ─── sendSMS ────────────────────────────────────────────────────────────────

  describe('sendSMS', () => {
    it('should send successfully when all gates pass', async () => {
      const { service, twilioService, smsLogDAO } = makeService();
      const input = makeSendInput();

      const result = await service.sendSMS(input);

      expect(result.success).toBe(true);
      expect(result.twilioSid).toBe(TWILIO_SID);
      expect(result.remaining).toBeDefined();
      expect(twilioService.sendSMS).toHaveBeenCalledWith(PHONE, input.body);
      expect(smsLogDAO.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          cuid: CUID,
          recipientPhone: PHONE,
          messageType: SMSMessageType.PAYMENT_REMINDER,
          status: SMSStatus.SENT,
          twilioSid: TWILIO_SID,
        })
      );
    });

    it('should return sms_disabled when feature flag is off', async () => {
      const { service } = makeService({
        featureFlagService: { isEnabled: jest.fn().mockReturnValue(false) },
      });

      const result = await service.sendSMS(makeSendInput());

      expect(result.success).toBe(false);
      expect(result.error).toBe('sms_disabled');
    });

    it('should return sms_disabled when client SMS toggle is off', async () => {
      const { service } = makeService({
        clientDAO: {
          getClientByCuid: jest.fn().mockResolvedValue({
            settings: { tenantFeatures: { smsNotifications: false } },
          }),
        },
      });

      const result = await service.sendSMS(makeSendInput());

      expect(result.success).toBe(false);
      expect(result.error).toBe('sms_disabled');
    });

    it('should return sms_disabled when no active subscription exists', async () => {
      const { service } = makeService({
        subscriptionDAO: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      });

      const result = await service.sendSMS(makeSendInput());

      expect(result.success).toBe(false);
      expect(result.error).toBe('sms_disabled');
    });

    it('should return opted_out for marketing SMS when recipient has not consented', async () => {
      const { service } = makeService({
        profileDAO: {
          findFirst: jest.fn().mockResolvedValue({
            personalInfo: { phoneNumber: PHONE },
            settings: {
              phoneVerification: { verified: true, verifiedPhone: PHONE },
              smsConsent: { consented: false },
              notifications: { smsNotifications: true },
            },
          }),
          update: jest.fn(),
        },
      });

      // MAINTENANCE_UPDATE is non-transactional
      const result = await service.sendSMS(
        makeSendInput({ messageType: SMSMessageType.MAINTENANCE_UPDATE })
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('opted_out');
    });

    it('should return unverified_phone for non-transactional SMS when phone is not verified', async () => {
      const { service } = makeService({
        profileDAO: {
          findFirst: jest.fn().mockResolvedValue({
            personalInfo: { phoneNumber: PHONE },
            settings: {
              phoneVerification: { verified: false, verifiedPhone: null },
              smsConsent: { consented: true },
              notifications: { smsNotifications: true },
            },
          }),
          update: jest.fn(),
        },
      });

      const result = await service.sendSMS(
        makeSendInput({ messageType: SMSMessageType.MAINTENANCE_UPDATE })
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('unverified_phone');
    });

    it('should skip recipient-level gates for transactional SMS (OTP, SYSTEM)', async () => {
      const { service, twilioService } = makeService({
        profileDAO: {
          findFirst: jest.fn().mockResolvedValue({
            personalInfo: { phoneNumber: PHONE },
            settings: {
              phoneVerification: { verified: false },
              smsConsent: { consented: false },
              notifications: { smsNotifications: false },
            },
          }),
          update: jest.fn(),
        },
      });

      // SYSTEM is transactional — should bypass recipient gates
      const result = await service.sendSMS(makeSendInput({ messageType: SMSMessageType.SYSTEM }));

      expect(result.success).toBe(true);
      expect(twilioService.sendSMS).toHaveBeenCalled();
    });

    it('should return quota_exceeded when atomic $inc returns null', async () => {
      const { service, twilioService } = makeService({
        subscriptionDAO: {
          findFirst: jest.fn().mockResolvedValue({
            cuid: CUID,
            status: ISubscriptionStatus.ACTIVE,
            planName: 'growth',
            smsUsage: { countThisPeriod: 40 },
          }),
          // Atomic increment returns null when quota is already at limit
          update: jest.fn().mockResolvedValue(null),
        },
      });

      const result = await service.sendSMS(makeSendInput());

      expect(result.success).toBe(false);
      expect(result.error).toBe('quota_exceeded');
      expect(twilioService.sendSMS).not.toHaveBeenCalled();
    });

    it('should return delivery_failed and log failure when Twilio throws', async () => {
      const twilioError = new Error('Twilio network error');
      (twilioError as any).code = 21211;

      const { service, smsLogDAO } = makeService({
        twilioService: {
          sendSMS: jest.fn().mockRejectedValue(twilioError),
        },
      });

      const result = await service.sendSMS(makeSendInput());

      expect(result.success).toBe(false);
      expect(result.error).toBe('delivery_failed');
      expect(smsLogDAO.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SMSStatus.FAILED,
          errorCode: '21211',
        })
      );
    });
  });

  // ─── sendToUser ─────────────────────────────────────────────────────────────

  describe('sendToUser', () => {
    it('should look up phone from profile and delegate to sendSMS', async () => {
      const { service, twilioService } = makeService();

      const result = await service.sendToUser(CUID, USER_ID, 'Hello!', SMSMessageType.SYSTEM);

      expect(result.success).toBe(true);
      expect(twilioService.sendSMS).toHaveBeenCalledWith(PHONE, 'Hello!');
    });

    it('should return unverified_phone when user has no phone number', async () => {
      const { service, twilioService } = makeService({
        profileDAO: {
          findFirst: jest.fn().mockResolvedValue({
            personalInfo: { phoneNumber: null },
          }),
          update: jest.fn(),
        },
      });

      const result = await service.sendToUser(CUID, USER_ID, 'Hello!', SMSMessageType.SYSTEM);

      expect(result.success).toBe(false);
      expect(result.error).toBe('unverified_phone');
      expect(twilioService.sendSMS).not.toHaveBeenCalled();
    });

    it('should return unverified_phone when profile is not found', async () => {
      const { service } = makeService({
        profileDAO: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      });

      const result = await service.sendToUser(CUID, USER_ID, 'Hello!', SMSMessageType.SYSTEM);

      expect(result.success).toBe(false);
      expect(result.error).toBe('unverified_phone');
    });

    it('should return delivery_failed when profileDAO throws', async () => {
      const { service } = makeService({
        profileDAO: {
          findFirst: jest.fn().mockRejectedValue(new Error('DB error')),
          update: jest.fn(),
        },
      });

      const result = await service.sendToUser(CUID, USER_ID, 'Hello!', SMSMessageType.SYSTEM);

      expect(result.success).toBe(false);
      expect(result.error).toBe('delivery_failed');
    });
  });

  // ─── sendOTP ────────────────────────────────────────────────────────────────

  describe('sendOTP', () => {
    it('should send OTP successfully', async () => {
      const { service, twilioService, smsLogDAO } = makeService();
      const currentUser = makeCurrentUser();

      const result = await service.sendOTP(CUID, currentUser, { phoneNumber: PHONE });

      expect(result.success).toBe(true);
      expect(result.twilioSid).toBe(TWILIO_SID);
      expect(twilioService.sendOTP).toHaveBeenCalledWith(PHONE);
      expect(smsLogDAO.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          messageType: SMSMessageType.OTP,
          status: SMSStatus.SENT,
          twilioSid: TWILIO_SID,
        })
      );
    });

    it('should return sms_disabled when feature flag is off', async () => {
      const { service, twilioService } = makeService({
        featureFlagService: { isEnabled: jest.fn().mockReturnValue(false) },
      });
      const currentUser = makeCurrentUser();

      const result = await service.sendOTP(CUID, currentUser, { phoneNumber: PHONE });

      expect(result.success).toBe(false);
      expect(result.error).toBe('sms_disabled');
      expect(twilioService.sendOTP).not.toHaveBeenCalled();
    });

    it('should return unverified_phone when phone does not match profile', async () => {
      const { service } = makeService({
        profileDAO: {
          findFirst: jest.fn().mockResolvedValue({
            personalInfo: { phoneNumber: '+19999999999' },
          }),
          update: jest.fn(),
        },
      });
      const currentUser = makeCurrentUser();

      const result = await service.sendOTP(CUID, currentUser, { phoneNumber: PHONE });

      expect(result.success).toBe(false);
      expect(result.error).toBe('unverified_phone');
    });

    it('should return rate_limited when a recent OTP exists (cooldown active)', async () => {
      const { service } = makeService({
        smsLogDAO: {
          createLog: jest.fn(),
          findFirst: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
        },
      });
      const currentUser = makeCurrentUser();

      const result = await service.sendOTP(CUID, currentUser, { phoneNumber: PHONE });

      expect(result.success).toBe(false);
      expect(result.error).toBe('rate_limited');
    });

    it('should return delivery_failed and log failure when Twilio throws', async () => {
      const { service, smsLogDAO } = makeService({
        twilioService: {
          sendOTP: jest.fn().mockRejectedValue(new Error('Twilio down')),
        },
      });
      const currentUser = makeCurrentUser();

      const result = await service.sendOTP(CUID, currentUser, { phoneNumber: PHONE });

      expect(result.success).toBe(false);
      expect(result.error).toBe('delivery_failed');
      expect(smsLogDAO.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          messageType: SMSMessageType.OTP,
          status: SMSStatus.FAILED,
        })
      );
    });
  });

  // ─── verifyOTP ──────────────────────────────────────────────────────────────

  describe('verifyOTP', () => {
    it('should return verified=true and update profile on valid code', async () => {
      const { service, profileDAO, twilioService } = makeService();
      const currentUser = makeCurrentUser();

      const result = await service.verifyOTP(CUID, currentUser, {
        phoneNumber: PHONE,
        otp: '123456',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
      expect(twilioService.verifyOTP).toHaveBeenCalledWith(PHONE, '123456');
      expect(profileDAO.update).toHaveBeenCalledWith(
        { user: expect.any(Types.ObjectId) },
        {
          $set: {
            'settings.phoneVerification.verified': true,
            'settings.phoneVerification.verifiedAt': expect.any(Date),
            'settings.phoneVerification.verifiedPhone': PHONE,
          },
        }
      );
    });

    it('should return verified=false when code is invalid', async () => {
      const { service, profileDAO } = makeService({
        twilioService: {
          verifyOTP: jest.fn().mockResolvedValue({ valid: false }),
        },
      });
      const currentUser = makeCurrentUser();

      const result = await service.verifyOTP(CUID, currentUser, {
        phoneNumber: PHONE,
        otp: '000000',
      });

      expect(result.success).toBe(false);
      expect(result.data).toBe(false);
      expect(profileDAO.update).not.toHaveBeenCalled();
    });

    it('should return error when Twilio throws during verification', async () => {
      const { service } = makeService({
        twilioService: {
          verifyOTP: jest.fn().mockRejectedValue(new Error('Twilio verify error')),
        },
      });
      const currentUser = makeCurrentUser();

      const result = await service.verifyOTP(CUID, currentUser, {
        phoneNumber: PHONE,
        otp: '123456',
      });

      expect(result.success).toBe(false);
      expect(result.data).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ─── updateSMSConsent ───────────────────────────────────────────────────────

  describe('updateSMSConsent', () => {
    it('should set consented=true with consentedAt and unset revokedAt', async () => {
      const { service, profileDAO } = makeService();
      const currentUser = makeCurrentUser();

      const result = await service.updateSMSConsent(CUID, currentUser, { consent: true });

      expect(result.success).toBe(true);
      expect(profileDAO.update).toHaveBeenCalledWith(
        { user: USER_ID },
        {
          $set: {
            'settings.smsConsent.consented': true,
            'settings.smsConsent.consentedAt': expect.any(Date),
          },
          $unset: { 'settings.smsConsent.revokedAt': '' },
        }
      );
    });

    it('should set consented=false with revokedAt when revoking consent', async () => {
      const { service, profileDAO } = makeService();
      const currentUser = makeCurrentUser();

      const result = await service.updateSMSConsent(CUID, currentUser, { consent: false });

      expect(result.success).toBe(true);
      expect(profileDAO.update).toHaveBeenCalledWith(
        { user: USER_ID },
        {
          $set: {
            'settings.smsConsent.consented': false,
            'settings.smsConsent.revokedAt': expect.any(Date),
          },
        }
      );
    });
  });

  // ─── getQuotaStatus ─────────────────────────────────────────────────────────

  describe('getQuotaStatus', () => {
    it('should return correct used/remaining/percentUsed', async () => {
      const { service } = makeService({
        subscriptionDAO: {
          findFirst: jest.fn().mockResolvedValue({
            cuid: CUID,
            status: ISubscriptionStatus.ACTIVE,
            planName: 'growth',
            startDate: new Date('2026-01-01'),
            smsUsage: {
              countThisPeriod: 10,
              periodStart: new Date('2026-06-01'),
            },
          }),
          update: jest.fn(),
        },
        subscriptionPlanConfig: {
          getConfig: jest.fn().mockReturnValue({ limits: { smsQuota: 40 } }),
        },
      });

      const result = await service.getQuotaStatus(CUID);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        quotaUsed: 10,
        remainingQuota: 30,
        percentUsed: 25,
        enabled: true,
      });
    });

    it('should throw NotFoundError when no active subscription exists', async () => {
      const { service } = makeService({
        subscriptionDAO: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
        },
      });

      await expect(service.getQuotaStatus(CUID)).rejects.toThrow(NotFoundError);
    });

    it('should handle missing smsUsage gracefully (defaults to 0)', async () => {
      const { service } = makeService({
        subscriptionDAO: {
          findFirst: jest.fn().mockResolvedValue({
            cuid: CUID,
            status: ISubscriptionStatus.ACTIVE,
            planName: 'growth',
            startDate: new Date('2026-01-01'),
            smsUsage: undefined,
          }),
          update: jest.fn(),
        },
        subscriptionPlanConfig: {
          getConfig: jest.fn().mockReturnValue({ limits: { smsQuota: 40 } }),
        },
      });

      const result = await service.getQuotaStatus(CUID);

      expect(result.data.quotaUsed).toBe(0);
      expect(result.data.remainingQuota).toBe(40);
    });
  });

  // ─── checkThresholds (tested via sendSMS side effects) ──────────────────────

  describe('checkThresholds (via sendSMS)', () => {
    it('should notify at 80% threshold and set notifiedAt80 flag', async () => {
      const mockUpdate = jest
        .fn()
        // First call: incrementQuota — getActiveSubscription
        .mockResolvedValueOnce({ smsUsage: { countThisPeriod: 32 } })
        // Second call: checkThresholds — update notifiedAt80
        .mockResolvedValueOnce({ smsUsage: { notifiedAt80: true } });

      const { service, notificationService } = makeService({
        subscriptionDAO: {
          findFirst: jest.fn().mockResolvedValue({
            cuid: CUID,
            status: ISubscriptionStatus.ACTIVE,
            planName: 'growth',
            smsUsage: { countThisPeriod: 31 },
          }),
          update: mockUpdate,
        },
        subscriptionPlanConfig: {
          getConfig: jest.fn().mockReturnValue({ limits: { smsQuota: 40 } }),
        },
      });

      await service.sendSMS(makeSendInput({ messageType: SMSMessageType.SYSTEM }));

      // checkThresholds should have tried to update the notifiedAt80 flag
      expect(mockUpdate).toHaveBeenCalledWith(
        { cuid: CUID, 'smsUsage.notifiedAt80': false },
        { $set: { 'smsUsage.notifiedAt80': true } }
      );
      expect(notificationService.createNotificationFromTemplate).toHaveBeenCalled();
    });

    it('should notify at 100% threshold and set notifiedAt100 flag', async () => {
      const mockUpdate = jest
        .fn()
        // incrementQuota returns the updated doc at count=40
        .mockResolvedValueOnce({ smsUsage: { countThisPeriod: 40 } })
        // checkThresholds updates notifiedAt100
        .mockResolvedValueOnce({ smsUsage: { notifiedAt100: true } });

      const { service, notificationService } = makeService({
        subscriptionDAO: {
          findFirst: jest.fn().mockResolvedValue({
            cuid: CUID,
            status: ISubscriptionStatus.ACTIVE,
            planName: 'growth',
            smsUsage: { countThisPeriod: 39 },
          }),
          update: mockUpdate,
        },
        subscriptionPlanConfig: {
          getConfig: jest.fn().mockReturnValue({ limits: { smsQuota: 40 } }),
        },
      });

      await service.sendSMS(makeSendInput({ messageType: SMSMessageType.SYSTEM }));

      expect(mockUpdate).toHaveBeenCalledWith(
        { cuid: CUID, 'smsUsage.notifiedAt100': false },
        { $set: { 'smsUsage.notifiedAt100': true } }
      );
      expect(notificationService.createNotificationFromTemplate).toHaveBeenCalled();
    });

    it('should not send duplicate notification when already notified at 80%', async () => {
      const mockUpdate = jest
        .fn()
        // incrementQuota
        .mockResolvedValueOnce({ smsUsage: { countThisPeriod: 33 } })
        // checkThresholds — already notified, returns null
        .mockResolvedValueOnce(null);

      const { service, notificationService } = makeService({
        subscriptionDAO: {
          findFirst: jest.fn().mockResolvedValue({
            cuid: CUID,
            status: ISubscriptionStatus.ACTIVE,
            planName: 'growth',
            smsUsage: { countThisPeriod: 32, notifiedAt80: true },
          }),
          update: mockUpdate,
        },
        subscriptionPlanConfig: {
          getConfig: jest.fn().mockReturnValue({ limits: { smsQuota: 40 } }),
        },
      });

      await service.sendSMS(makeSendInput({ messageType: SMSMessageType.SYSTEM }));

      // createNotificationFromTemplate should NOT be called because the update
      // to notifiedAt80 returned null (filter didn't match — already notified)
      expect(notificationService.createNotificationFromTemplate).not.toHaveBeenCalled();
    });
  });

  // ─── handleStatusCallback ───────────────────────────────────────────────────

  describe('handleStatusCallback', () => {
    it('should update SMS log status via Twilio webhook callback', async () => {
      const { service, smsLogDAO } = makeService();

      await service.handleStatusCallback({
        MessageSid: TWILIO_SID,
        MessageStatus: 'delivered',
      });

      expect(smsLogDAO.updateBySid).toHaveBeenCalledWith(TWILIO_SID, {
        status: SMSStatus.DELIVERED,
      });
    });

    it('should include errorCode when present in callback', async () => {
      const { service, smsLogDAO } = makeService();

      await service.handleStatusCallback({
        MessageSid: TWILIO_SID,
        MessageStatus: 'failed',
        ErrorCode: '30007',
      });

      expect(smsLogDAO.updateBySid).toHaveBeenCalledWith(TWILIO_SID, {
        status: SMSStatus.FAILED,
        errorCode: '30007',
      });
    });

    it('should ignore unknown Twilio status values', async () => {
      const { service, smsLogDAO } = makeService();

      await service.handleStatusCallback({
        MessageSid: TWILIO_SID,
        MessageStatus: 'some_future_status',
      });

      expect(smsLogDAO.updateBySid).not.toHaveBeenCalled();
    });
  });

  // ─── getCronJobs ────────────────────────────────────────────────────────────

  describe('getCronJobs', () => {
    it('should return the monthly quota reset cron job', () => {
      const { service } = makeService();

      const jobs = service.getCronJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        name: 'sms:monthly-quota-reset',
        enabled: true,
        service: 'SMSService',
      });
      expect(typeof jobs[0].handler).toBe('function');
    });
  });
});
