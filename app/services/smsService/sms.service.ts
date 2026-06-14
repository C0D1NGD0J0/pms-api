import Logger from 'bunyan';
import { SMSLogDAO } from '@dao/smsLogDAO';
import { ClientDAO } from '@dao/clientDAO';
import { createLogger } from '@utils/index';
import { ProfileDAO } from '@dao/profileDAO';
import { TwilioService } from '@services/external';
import { NotFoundError } from '@shared/customErrors';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
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

  constructor({
    subscriptionPlanConfig,
    notificationService,
    featureFlagService,
    subscriptionDAO,
    twilioService,
    profileDAO,
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
    this.smsLogDAO = smsLogDAO;
    this.clientDAO = clientDAO;
  }

  async sendSMS(input: ISendSMSInput): Promise<ISendSMSResult> {
    const { cuid, to, body, messageType, recipientUserId, sentBy } = input;

    // Gate checks
    const gateResult = await this.checkGates(cuid, messageType, recipientUserId);
    if (gateResult) return gateResult;

    // Quota
    const quota = await this.incrementQuota(cuid);
    if (!quota.success) return { success: false, error: 'quota_exceeded' };

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
      return { success: false, error: 'delivery_failed' };
    }
  }

  async sendOTP(
    cuid: string,
    currentUser: ICurrentUser,
    data: { phoneNumber: string }
  ): Promise<ISendSMSResult> {
    const { phoneNumber: phone } = data;
    const gateResult = await this.checkGates(cuid, SMSMessageType.OTP);
    if (gateResult) return gateResult;

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
      return { success: false, error: 'delivery_failed' };
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
      if (!result.valid) return { success: false, data: isVerified, error: 'Invalid code' };

      await this.profileDAO.update(
        { user: userId },
        {
          $set: {
            'settings.phoneVerification.verified': true,
            'settings.phoneVerification.verifiedAt': new Date(),
            'settings.phoneVerification.verifiedPhone': phone,
          },
        }
      );
      isVerified = true;
      return { success: true, data: isVerified };
    } catch (error: any) {
      this.log.error({ error, phone }, 'OTP verification failed');
      return { success: false, data: false, error: 'Verification failed' };
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
      percentUsed: limit > 0 ? Math.round((used / limit) * 100) : 0,
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
      return { success: false, error: 'sms_disabled' };
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client?.settings?.tenantFeatures?.smsNotifications) {
      return { success: false, error: 'sms_disabled' };
    }

    const subscription = await this.getActiveSubscription(cuid).catch(() => null);
    if (!subscription) {
      return { success: false, error: 'sms_disabled' };
    }

    // consent check for marketing (non-transactional) SMS only
    if (!isTransactionalSMS(messageType) && recipientUserId) {
      const profile = await this.profileDAO.findFirst({ user: recipientUserId });
      if (!profile?.settings?.smsConsent?.consented) {
        return { success: false, error: 'opted_out' };
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
      return { success: true, used: 0, limit: 0, remaining: 0 };
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
    const pct = (used / limit) * 100;

    if (pct >= 100) {
      const updated = await this.subscriptionDAO.update(
        { cuid, 'smsUsage.notifiedAt100': false },
        { $set: { 'smsUsage.notifiedAt100': true } }
      );
      if (updated) await this.notifyAccountAdmin(cuid, 'sms.quotaExhausted', { used, limit });
    } else if (pct >= 80) {
      const updated = await this.subscriptionDAO.update(
        { cuid, 'smsUsage.notifiedAt80': false },
        { $set: { 'smsUsage.notifiedAt80': true } }
      );
      if (updated)
        await this.notifyAccountAdmin(cuid, 'sms.quotaWarning', {
          used,
          limit,
          percentUsed: Math.round(pct),
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
    const dayOfMonth = new Date().getDate();
    this.log.info({ dayOfMonth }, 'Running SMS quota reset for billing cycle day');

    try {
      const result = await this.subscriptionDAO.updateMany(
        {
          status: ISubscriptionStatus.ACTIVE,
          $expr: { $eq: [{ $dayOfMonth: '$startDate' }, dayOfMonth] },
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

      this.log.info({ dayOfMonth, modifiedCount: result?.modifiedCount }, 'SMS quotas reset');
    } catch (error: any) {
      this.log.error({ error }, 'Failed to reset SMS quotas');
      throw error;
    }
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
