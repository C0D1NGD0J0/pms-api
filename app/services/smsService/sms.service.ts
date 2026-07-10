import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { SMSLogDAO } from '@dao/smsLogDAO';
import { ClientDAO } from '@dao/clientDAO';
import { ProfileDAO } from '@dao/profileDAO';
import { UserCache } from '@caching/user.cache';
import { TwilioService } from '@services/external';
import { NotFoundError } from '@shared/customErrors';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { calcPercentage, createLogger } from '@utils/index';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { SubscriptionPlanConfig } from '@services/subscription';
import { NotificationMessageKey } from '@services/notification';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { FeatureFlagService } from '@services/featureFlag/featureFlag.service';
import { NotificationService } from '@services/notification/notification.service';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  IPromiseReturnedData,
  ISubscriptionStatus,
  isTransactionalSMS,
  ISuccessReturnData,
  ISendSMSResult,
  SMSMessageType,
  ISendSMSInput,
  ICurrentUser,
  SMSStatus,
  PlanName,
} from '@interfaces/index';

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  notificationService: NotificationService;
  featureFlagService: FeatureFlagService;
  subscriptionDAO: SubscriptionDAO;
  twilioService: TwilioService;
  profileDAO: ProfileDAO;
  userCache: UserCache;
  smsLogDAO: SMSLogDAO;
  clientDAO: ClientDAO;
}

export class SMSService implements ICronProvider {
  private readonly log: Logger;
  private readonly smsLogDAO: SMSLogDAO;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly twilioService: TwilioService;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly featureFlagService: FeatureFlagService;
  private readonly notificationService: NotificationService;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;
  private readonly userCache: UserCache;

  constructor({
    subscriptionPlanConfig,
    notificationService,
    featureFlagService,
    subscriptionDAO,
    twilioService,
    profileDAO,
    userCache,
    smsLogDAO,
    clientDAO,
  }: IConstructor) {
    this.log = createLogger('SMSService');
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.notificationService = notificationService;
    this.featureFlagService = featureFlagService;
    this.subscriptionDAO = subscriptionDAO;
    this.twilioService = twilioService;
    this.profileDAO = profileDAO;
    this.userCache = userCache;
    this.smsLogDAO = smsLogDAO;
    this.clientDAO = clientDAO;
  }

  /**
   * Convenience method — looks up user's phone from profile and sends SMS.
   * Consuming services call this instead of sendSMS() directly.
   * Silently returns on failure (SMS should never block business logic).
   */
  async sendToUser(
    cuid: string,
    userId: string,
    body: string,
    messageType: SMSMessageType,
    sentBy?: string
  ): Promise<ISendSMSResult> {
    try {
      const profile = await this.profileDAO.findFirst({ user: new Types.ObjectId(userId) });
      const phone = profile?.personalInfo?.phoneNumber;
      if (!phone) {
        this.log.debug({ userId }, 'No phone number on profile — skipping SMS');
        return { success: false, error: 'unverified_phone' };
      }

      return this.sendSMS({
        cuid,
        to: phone,
        body,
        messageType,
        recipientUserId: userId,
        sentBy,
      });
    } catch (error: any) {
      this.log.error({ error, userId, cuid }, 'sendToUser failed — SMS skipped');
      return { success: false, error: 'delivery_failed' };
    }
  }

  async sendSMS(input: ISendSMSInput): Promise<ISendSMSResult> {
    const { cuid, to, body, messageType, recipientUserId, sentBy } = input;

    // Gate checks
    const gateResult = await this.checkGates(cuid, messageType, recipientUserId);
    if (gateResult) return gateResult;

    // Quota
    const quota = await this.incrementQuota(cuid);
    if (!quota.success)
      return { success: false, error: 'quota_exceeded', message: t('sms.errors.quotaExceeded') };

    // Send
    try {
      const result = await this.twilioService.sendSMS(to, body);
      await this.logSMS({
        cuid,
        recipientPhone: to,
        messageType,
        status: SMSStatus.SENT,
        twilioSid: result.sid,
        sentBy,
      });
      await this.checkThresholds(cuid, quota.used, quota.limit);
      return { success: true, twilioSid: result.sid, remaining: quota.remaining };
    } catch (error: any) {
      this.log.error({ error, cuid, to }, 'Twilio SMS delivery failed');
      await this.logSMS({
        cuid,
        recipientPhone: to,
        messageType,
        status: SMSStatus.FAILED,
        errorCode: error.code?.toString(),
        sentBy,
      });
      return {
        success: false,
        error: 'delivery_failed',
        message: t('common.errors.operationFailed', { action: 'send message' }),
      };
    }
  }

  async sendOTP(
    cuid: string,
    currentUser: ICurrentUser,
    data: { phoneNumber: string }
  ): Promise<ISendSMSResult> {
    const { phoneNumber: phone } = data;
    const userId = currentUser?.sub;

    // OTP only checks the platform feature flag — NOT client toggle or plan.
    // Phone verification is a security feature that must work regardless of
    // whether the PM has enabled SMS notifications for tenants.
    if (!this.featureFlagService.isEnabled(FeatureFlag.SMS)) {
      return {
        success: false,
        error: 'sms_disabled',
        message: t('common.errors.featureNotAvailable'),
      };
    }

    // Only allow verifying the phone number on the user's profile
    const profile = await this.profileDAO.findFirst({ user: new Types.ObjectId(userId) });
    if (profile?.personalInfo?.phoneNumber !== phone) {
      return {
        success: false,
        error: 'unverified_phone',
        message: t('sms.errors.phoneNumberMismatch'),
      };
    }

    // Cooldown: 60 seconds between OTP sends per user
    const recentOTP = await this.smsLogDAO.findFirst({
      cuid,
      recipientPhone: phone,
      messageType: SMSMessageType.OTP,
      sentAt: { $gte: dayjs().subtract(60, 'seconds').toDate() },
    });
    if (recentOTP) {
      return {
        success: false,
        error: 'rate_limited',
        message: t('sms.errors.cooldownActive'),
      };
    }

    try {
      const result = await this.twilioService.sendOTP(phone);
      await this.logSMS({
        cuid,
        recipientPhone: phone,
        messageType: SMSMessageType.OTP,
        status: SMSStatus.SENT,
        twilioSid: result.sid,
      });
      return { success: true, twilioSid: result.sid };
    } catch (error: any) {
      this.log.error({ error, phone }, 'Failed to send OTP');
      await this.logSMS({
        cuid,
        recipientPhone: phone,
        messageType: SMSMessageType.OTP,
        status: SMSStatus.FAILED,
        errorCode: error.code?.toString(),
      });
      return {
        success: false,
        error: 'delivery_failed',
        message: t('common.errors.operationFailed', { action: 'send verification code' }),
      };
    }
  }

  async verifyOTP(
    cuid: string,
    currentUser: ICurrentUser,
    data: { phoneNumber: string; otp: string }
  ): Promise<ISuccessReturnData<boolean>> {
    const { phoneNumber: phone, otp: code } = data;
    const userId = currentUser?.sub;

    try {
      let isVerified = false;
      const result = await this.twilioService.verifyOTP(phone, code);
      if (!result.valid)
        return { success: false, data: isVerified, error: t('sms.errors.invalidCode') };

      await this.profileDAO.update(
        { user: new Types.ObjectId(userId) },
        {
          $set: {
            'settings.phoneVerification.verified': true,
            'settings.phoneVerification.verifiedAt': new Date(),
            'settings.phoneVerification.verifiedPhone': phone,
          },
        }
      );
      isVerified = true;
      await this.userCache.invalidateUserDetail(cuid, userId);
      return { success: true, data: isVerified };
    } catch (error: any) {
      this.log.error({ error, phone }, 'OTP verification failed');
      return {
        success: false,
        data: false,
        error: t('common.errors.operationFailed', { action: 'complete phone verification' }),
      };
    }
  }

  async updateSMSConsent(
    cuid: string,
    currentUser: ICurrentUser,
    data: { consent: boolean }
  ): Promise<ISuccessReturnData<undefined>> {
    const userId = currentUser?.sub;
    const consented = data.consent;
    const update = consented
      ? {
          $set: {
            'settings.smsConsent.consented': true,
            'settings.smsConsent.consentedAt': new Date(),
          },
          $unset: { 'settings.smsConsent.revokedAt': '' },
        }
      : {
          $set: {
            'settings.smsConsent.consented': false,
            'settings.smsConsent.revokedAt': new Date(),
          },
        };

    await this.profileDAO.update({ user: userId }, update);
    await this.userCache.invalidateUserDetail(cuid, userId);
    return { success: true, data: undefined };
  }

  async getQuotaStatus(cuid: string): Promise<
    ISuccessReturnData<{
      remainingQuota: number;
      quotaUsed: number;
      percentUsed: number;
      resetDate: Date;
      enabled: boolean;
    }>
  > {
    const subscription = await this.getActiveSubscription(cuid);
    const limit = this.getQuotaLimitForPlan(subscription.planName);
    const used = subscription.smsUsage?.countThisPeriod || 0;

    const result = {
      enabled: limit > 0,
      limit,
      quotaUsed: used,
      remainingQuota: Math.max(0, limit - used),
      percentUsed: calcPercentage(used, limit),
      resetDate: subscription.smsUsage?.periodStart || subscription.startDate,
    };

    return { success: true, data: result };
  }

  async getSMSHistory(
    cuid: string,
    filters: { messageType?: SMSMessageType; status?: string; page?: number; limit?: number }
  ): IPromiseReturnedData<any> {
    try {
      const page = filters.page || 1;
      const limit = filters.limit || 20;
      const skip = (page - 1) * limit;

      const result = await this.smsLogDAO.getLogsByCuid(
        cuid,
        { messageType: filters.messageType, status: filters.status },
        { limit, skip }
      );
      return { success: true, data: result as any, message: 'SMS logs retrieved' };
    } catch (error) {
      this.log.error({ error }, 'Error listing SMS logs');
      throw error;
    }
  }

  private async checkGates(
    cuid: string,
    messageType: SMSMessageType,
    recipientUserId?: string
  ): Promise<ISendSMSResult | null> {
    if (!this.featureFlagService.isEnabled(FeatureFlag.SMS)) {
      return {
        success: false,
        error: 'sms_disabled',
        message: t('common.errors.featureNotAvailable'),
      };
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client?.settings?.tenantFeatures?.smsNotifications) {
      return { success: false, error: 'sms_disabled', message: t('sms.errors.notEnabled') };
    }

    const subscription = await this.getActiveSubscription(cuid).catch(() => null);
    if (!subscription) {
      return {
        success: false,
        error: 'sms_disabled',
        message: t('common.errors.featureNotAvailable'),
      };
    }

    // For non-transactional SMS, check recipient-level gates
    if (!isTransactionalSMS(messageType) && recipientUserId) {
      const profile = await this.profileDAO.findFirst({ user: recipientUserId });

      // Recipient must have a verified phone number
      if (
        !profile?.settings?.phoneVerification?.verified ||
        !profile?.settings?.phoneVerification?.verifiedPhone
      ) {
        return {
          success: false,
          error: 'unverified_phone',
          message: t('sms.errors.phoneNotVerified'),
        };
      }

      // Recipient must have opted into SMS consent
      if (!profile?.settings?.smsConsent?.consented) {
        return { success: false, error: 'opted_out', message: t('sms.errors.recipientOptedOut') };
      }

      // Recipient must have SMS notifications enabled in their profile
      if (!profile?.settings?.notifications?.smsNotifications) {
        return { success: false, error: 'opted_out', message: t('sms.errors.recipientOptedOut') };
      }
    }

    return null; // all gates passed
  }

  private async incrementQuota(
    cuid: string
  ): Promise<{ success: boolean; used: number; limit: number; remaining: number }> {
    const subscription = await this.getActiveSubscription(cuid);
    const limit = this.getQuotaLimitForPlan(subscription.planName);

    if (limit === 0) {
      return { success: false, used: 0, limit: 0, remaining: 0 };
    }

    // Lazy-init: if smsUsage subdoc doesn't exist or countThisPeriod is missing,
    // initialize it before attempting the atomic increment
    if (subscription.smsUsage?.countThisPeriod === undefined) {
      await this.subscriptionDAO.update(
        {
          cuid,
          $or: [
            { smsUsage: { $exists: false } },
            { smsUsage: null },
            { 'smsUsage.countThisPeriod': { $exists: false } },
          ],
        },
        {
          $set: {
            'smsUsage.countThisPeriod': 0,
            'smsUsage.periodStart': new Date(),
            'smsUsage.lastResetAt': new Date(),
            'smsUsage.notifiedAt80': false,
            'smsUsage.notifiedAt100': false,
          },
        }
      );
    }

    // Atomic check + increment — prevents race conditions
    const updated = await this.subscriptionDAO.update(
      { cuid, 'smsUsage.countThisPeriod': { $lt: limit } },
      { $inc: { 'smsUsage.countThisPeriod': 1 } }
    );

    if (!updated) {
      this.log.warn({ cuid }, 'SMS quota exceeded');
      return { success: false, used: limit, limit, remaining: 0 };
    }

    const used = updated.smsUsage?.countThisPeriod ?? 1;
    return { success: true, used, limit, remaining: Math.max(0, limit - used) };
  }

  private async getActiveSubscription(cuid: string) {
    const subscription = await this.subscriptionDAO.findFirst({
      cuid,
      status: ISubscriptionStatus.ACTIVE,
    });
    if (!subscription) throw new NotFoundError({ message: 'Active subscription not found' });
    return subscription;
  }

  private async checkThresholds(cuid: string, used: number, limit: number): Promise<void> {
    if (limit === 0) return;
    const percentUsed = calcPercentage(used, limit);

    if (percentUsed >= 100) {
      const updated = await this.subscriptionDAO.update(
        { cuid, 'smsUsage.notifiedAt100': false },
        { $set: { 'smsUsage.notifiedAt100': true } }
      );
      if (updated) await this.notifyAccountAdmin(cuid, 'sms.quotaExhausted', { used, limit });
    } else if (percentUsed >= 80) {
      const updated = await this.subscriptionDAO.update(
        { cuid, 'smsUsage.notifiedAt80': false },
        { $set: { 'smsUsage.notifiedAt80': true } }
      );
      if (updated)
        await this.notifyAccountAdmin(cuid, 'sms.quotaWarning', {
          used,
          limit,
          percentUsed,
        });
    }
  }

  private getQuotaLimitForPlan(planName: string): number {
    const config = this.subscriptionPlanConfig.getConfig(planName as PlanName);
    return config.limits.smsQuota ?? 0;
  }

  private async logSMS(data: {
    cuid: string;
    recipientPhone: string;
    messageType: SMSMessageType;
    status: SMSStatus;
    twilioSid?: string;
    errorCode?: string;
    sentBy?: string;
  }): Promise<void> {
    await this.smsLogDAO.createLog({
      ...data,
      sentBy: data.sentBy as any,
      sentAt: new Date(),
    });
  }

  private async notifyAccountAdmin(
    cuid: string,
    messageKey: NotificationMessageKey,
    variables: Record<string, any>
  ): Promise<void> {
    try {
      const client = await this.clientDAO.findFirst({ cuid });
      if (!client?.accountAdmin) return;

      const adminId =
        typeof client.accountAdmin === 'object' && client.accountAdmin._id
          ? client.accountAdmin._id.toString()
          : client.accountAdmin.toString();

      await this.notificationService.createNotificationFromTemplate(
        messageKey,
        variables,
        adminId,
        NotificationTypeEnum.SYSTEM,
        NotificationPriorityEnum.HIGH,
        cuid,
        adminId // author = system acting on behalf of admin
      );
    } catch (error: any) {
      this.log.error({ error, cuid, messageKey }, 'Failed to notify account admin');
    }
  }

  private async resetQuotasForBillingCycle(): Promise<void> {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const isLastDay = dayOfMonth === lastDayOfMonth;

    this.log.info({ dayOfMonth, isLastDay }, 'Running SMS quota reset for billing cycle day');

    try {
      // Match subscriptions whose start day equals today,
      // OR if today is the last day of the month, also match subscriptions
      // whose start day exceeds the last day (e.g. start day 31 in a 30-day month)
      const matchFilter: Record<string, unknown> = {
        status: ISubscriptionStatus.ACTIVE,
      };

      if (isLastDay) {
        matchFilter.$expr = {
          $or: [
            { $eq: [{ $dayOfMonth: '$startDate' }, dayOfMonth] },
            { $gt: [{ $dayOfMonth: '$startDate' }, lastDayOfMonth] },
          ],
        };
      } else {
        matchFilter.$expr = { $eq: [{ $dayOfMonth: '$startDate' }, dayOfMonth] };
      }

      const result = await this.subscriptionDAO.updateMany(matchFilter, {
        $set: {
          'smsUsage.countThisPeriod': 0,
          'smsUsage.periodStart': new Date(),
          'smsUsage.lastResetAt': new Date(),
          'smsUsage.notifiedAt80': false,
          'smsUsage.notifiedAt100': false,
        },
      });

      this.log.info(
        { dayOfMonth, isLastDay, modifiedCount: result?.modifiedCount },
        'SMS quotas reset'
      );
    } catch (error: any) {
      this.log.error({ error }, 'Failed to reset SMS quotas');
      throw error;
    }
  }

  async handleStatusCallback(data: {
    MessageSid: string;
    MessageStatus: string;
    To?: string;
    ErrorCode?: string;
  }): Promise<void> {
    const { MessageSid, MessageStatus, ErrorCode } = data;

    const statusMap: Record<string, SMSStatus> = {
      queued: SMSStatus.QUEUED,
      sent: SMSStatus.SENT,
      delivered: SMSStatus.DELIVERED,
      failed: SMSStatus.FAILED,
      undelivered: SMSStatus.FAILED,
    };

    const newStatus = statusMap[MessageStatus];
    if (!newStatus) {
      this.log.warn({ MessageSid, MessageStatus }, 'Unknown Twilio message status');
      return;
    }

    const updateFields: Record<string, unknown> = { status: newStatus };
    if (ErrorCode) updateFields.errorCode = ErrorCode;

    await this.smsLogDAO.updateBySid(MessageSid, updateFields);
    this.log.info({ MessageSid, MessageStatus, newStatus }, 'SMS status updated via webhook');
  }

  getCronJobs(): ICronJob[] {
    return [
      {
        name: 'sms:monthly-quota-reset',
        schedule: '5 0 * * *',
        handler: this.resetQuotasForBillingCycle.bind(this),
        enabled: true,
        service: 'SMSService',
        description: 'Reset SMS quotas for clients whose billing cycle renews today',
        timeout: 300000,
      },
    ];
  }
}
