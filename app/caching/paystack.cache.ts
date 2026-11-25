import { RedisService } from '@database/index';
import { IPaystackBank } from '@interfaces/paystack.interface';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { convertTimeToSecondsAndMilliseconds } from '@utils/index';

import { BaseCache } from './base.cache';

/**
 * Paystack reference data that rarely changes. Only the bank list is cached: account-name
 * checks, subaccounts and transactions are always fetched live.
 */
export class PaystackCache extends BaseCache {
  private readonly BANKS_KEY = 'paystack:banks:NG';
  private readonly BANKS_TTL: number;

  constructor({ redisService }: { redisService: RedisService }) {
    super({ redisService });
    this.BANKS_TTL = convertTimeToSecondsAndMilliseconds('24h').seconds;
  }

  async getBanks(): Promise<ISuccessReturnData<IPaystackBank[] | null>> {
    const result = await this.getItem<IPaystackBank[]>(this.BANKS_KEY);
    if (result.success && Array.isArray(result.data)) {
      return { success: true, data: result.data };
    }
    return { success: false, data: null };
  }

  async cacheBanks(banks: IPaystackBank[]): Promise<ISuccessReturnData> {
    if (!banks.length) {
      return { success: false, data: null, error: 'Not caching an empty bank list' };
    }
    return this.setItem(this.BANKS_KEY, this.serialize(banks), this.BANKS_TTL);
  }
}
