import crypto from 'crypto';
import { RedisService } from '@database/index';

import { BaseCache } from './base.cache';

const WEBHOOK_TTL = 60 * 60 * 24 * 3; // 72 hours — covers Stripe's full retry window
const ROUTE_TTL = 60 * 60 * 24; // 24 hours

export class IdempotencyCache extends BaseCache {
  constructor({ redisService }: { redisService: RedisService }) {
    super({ redisService });
  }

  /** Compact, collision-resistant key: idmp:r:{MD5(method:userId:cuid:idempotencyKey)} */
  private routeKey(method: string, userId: string, cuid: string, idempotencyKey: string): string {
    const hash = crypto
      .createHash('md5')
      .update(`${method}:${userId}:${cuid}:${idempotencyKey}`)
      .digest('hex');
    return `idmp:r:${hash}`;
  }

  /** Atomically claim a webhook event. Returns true if this process won the race. */
  async claimWebhookEvent(eventId: string): Promise<boolean> {
    const key = `idmp:wh:${eventId}`;
    const result = await this.client.SET(key, 'processing', { NX: true, EX: WEBHOOK_TTL });
    return result === 'OK';
  }

  /** Mark a successfully processed webhook event. */
  async markWebhookProcessed(eventId: string): Promise<void> {
    await this.setItem(`idmp:wh:${eventId}`, 'processed', WEBHOOK_TTL);
  }

  /** Release a webhook claim so Stripe's retry can reclaim it. */
  async releaseWebhookClaim(eventId: string): Promise<void> {
    await this.deleteItems([`idmp:wh:${eventId}`]);
  }

  /** Look up a cached route response. Returns null if not found. */
  async getCachedRouteResponse(
    method: string,
    userId: string,
    cuid: string,
    idempotencyKey: string
  ): Promise<{ statusCode: number; body: unknown } | null> {
    const result = await this.getItem<{ statusCode: number; body: unknown }>(
      this.routeKey(method, userId, cuid, idempotencyKey)
    );
    return result.data ?? null;
  }

  /** Store a successful route response for replay on duplicate requests. */
  async cacheRouteResponse(
    method: string,
    userId: string,
    cuid: string,
    idempotencyKey: string,
    statusCode: number,
    body: unknown
  ): Promise<void> {
    await this.setItem(
      this.routeKey(method, userId, cuid, idempotencyKey),
      this.serialize({ statusCode, body }),
      ROUTE_TTL
    );
  }
}
