import { RedisService } from '@database/index';

import { BaseCache } from './base.cache';

export class NotificationCache extends BaseCache {
  private readonly ANNOUNCEMENT_READ_TTL = 48 * 60 * 60; // 48 hours

  constructor({ redisService }: { redisService: RedisService }) {
    super({ redisService });
  }

  async markAnnouncementsRead(cuid: string, nuids: string[], userId: string): Promise<void> {
    if (!nuids.length) return;
    const multi = this.client.multi();
    for (const nuid of nuids) {
      multi.SETEX(`announce:read:${cuid}:${nuid}:${userId}`, this.ANNOUNCEMENT_READ_TTL, '1');
    }
    await multi.exec();
  }

  async getReadAnnouncementNuids(
    cuid: string,
    nuids: string[],
    userId: string
  ): Promise<Set<string>> {
    if (!nuids.length) return new Set();
    const keys = nuids.map((nuid) => `announce:read:${cuid}:${nuid}:${userId}`);
    const results = await this.client.mGet(keys);
    const readSet = new Set<string>();
    results.forEach((val, i) => {
      if (val) readSet.add(nuids[i]);
    });
    return readSet;
  }
}
