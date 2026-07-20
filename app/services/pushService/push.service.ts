import webpush from 'web-push';
import { ProfileDAO } from '@dao/index';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { FeatureFlagService } from '@services/featureFlag';
import { FeatureFlag } from '@interfaces/featureFlag.interface';

export interface PushPayload {
  badge?: string;
  title: string;
  icon?: string;
  body: string;
  url?: string;
  tag?: string;
}

interface IConstructor {
  featureFlagService: FeatureFlagService;
  profileDAO: ProfileDAO;
}

export class PushService {
  private isConfigured = false;
  private readonly profileDAO: ProfileDAO;
  private log = createLogger('PushService');
  private readonly featureFlagService: FeatureFlagService;

  constructor({ profileDAO, featureFlagService }: IConstructor) {
    this.profileDAO = profileDAO;
    this.featureFlagService = featureFlagService;

    const { PUBLIC_KEY, PRIVATE_KEY, SUBJECT } = envVariables.VAPID;
    if (PUBLIC_KEY && PRIVATE_KEY && SUBJECT) {
      try {
        webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
        this.isConfigured = true;
        this.log.info('VAPID credentials configured');
      } catch (err) {
        this.log.error('Failed to configure VAPID credentials', { error: err });
      }
    } else {
      this.log.warn('VAPID keys not configured — push notifications will be disabled');
    }
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.isConfigured) {
      this.log.warn('PushService is not configured. Skipping push notification.');
      return;
    }

    if (!this.featureFlagService.isEnabled(FeatureFlag.PUSH_NOTIFICATIONS)) {
      this.log.warn('Push notifications feature flag is disabled. Skipping push notification.');
      return;
    }

    const pushSubscriptions = await this.profileDAO.getPushSubscriptions(userId);
    if (!pushSubscriptions || pushSubscriptions.length === 0) {
      this.log.info(`No push subscriptions found for user ${userId}. Skipping push notification.`);
      return;
    }

    const message = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icons/icon-192x192.png',
      badge: payload.badge || '/icons/icon-192x192.png',
      data: {
        url: payload.url,
        timestamp: Date.now(),
      },
      tag: payload.tag || undefined,
    });

    const results = await Promise.allSettled(
      pushSubscriptions.map((subscription) =>
        webpush
          .sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth,
              },
            },
            message,
            { TTL: 86400 }
          )
          .catch((err) => {
            // 410 Gone = subscription expired (user uninstalled browser, cleared data)
            // 404 Not Found = subscription endpoint no longer valid
            // In both cases, remove the dead subscription to keep the array clean.
            if (err.statusCode === 410 || err.statusCode === 404) {
              this.log.info('Removing expired push subscription', {
                userId,
                endpoint: subscription.endpoint,
                statusCode: err.statusCode,
              });
              this.profileDAO
                .removePushSubscription(userId, subscription.endpoint)
                .catch((removeErr: any) => {
                  this.log.error('Failed to remove expired subscription', {
                    error: removeErr,
                  });
                });
            }
            throw err; // rethrow so allSettled marks it as "rejected"
          })
      )
    );

    // log summary (not individual failures as those are logged above)
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.log.warn(`Push delivery: ${failed}/${results.length} failed`, {
        userId,
      });
    }
  }

  /**
   * Register a device's push subscription for a user.
   * Called from the subscribe endpoint when the browser obtains
   * a PushSubscription from pushManager.subscribe().
   */
  async subscribe(
    userId: string,
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    },
    deviceLabel?: string
  ): Promise<void> {
    await this.profileDAO.addPushSubscription(userId, {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      deviceLabel: deviceLabel || '',
    });

    this.log.info('Push subscription registered', {
      userId,
      endpoint: subscription.endpoint.substring(0, 50) + '...',
    });
  }

  /**
   * Remove a device's push subscription.
   * Called when user disables push or when the frontend
   * calls pushSubscription.unsubscribe().
   */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.profileDAO.removePushSubscription(userId, endpoint);

    this.log.info('Push subscription removed', {
      userId,
      endpoint: endpoint.substring(0, 50) + '...',
    });
  }
}
