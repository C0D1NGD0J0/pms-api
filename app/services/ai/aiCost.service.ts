import { RedisService } from '@database/index';
import { BaseCache } from '@caching/base.cache';

interface CostRecord {
  breakdown: Record<string, number>;
  analysisCount: number;
  totalCostUSD: number;
  month: string;
  cuid: string;
}

interface AIBudgetConfig {
  alertThresholdPercent: number;
  monthlyBudgetUSD: number;
}

const DEFAULT_BUDGET: AIBudgetConfig = {
  alertThresholdPercent: 80,
  monthlyBudgetUSD: 100,
};

const KEY_PREFIX = 'ai-cost';

export class AICostService extends BaseCache {
  constructor({ redisService }: { redisService: RedisService }) {
    super({ redisService });
  }

  async canAnalyze(cuid: string): Promise<{ allowed: boolean; reason?: string }> {
    const record = await this.getMonthlyRecord(cuid);

    if (record.totalCostUSD >= DEFAULT_BUDGET.monthlyBudgetUSD) {
      return {
        allowed: false,
        reason: `Monthly AI budget exhausted ($${record.totalCostUSD.toFixed(2)} / $${DEFAULT_BUDGET.monthlyBudgetUSD})`,
      };
    }

    return { allowed: true };
  }

  async recordCost(
    cuid: string,
    feature: string,
    costUSD: number,
    inputTokens: number,
    outputTokens: number
  ): Promise<void> {
    try {
      const record = await this.getMonthlyRecord(cuid);

      record.totalCostUSD += costUSD;
      record.analysisCount += 1;
      record.breakdown[feature] = (record.breakdown[feature] || 0) + costUSD;

      const ttl = this.getMonthEndTTL();
      await this.setItem(this.getKey(cuid), this.serialize(record), ttl);

      const usagePercent = (record.totalCostUSD / DEFAULT_BUDGET.monthlyBudgetUSD) * 100;

      this.log.info(
        { cuid, feature, costUSD, inputTokens, outputTokens, monthlyTotal: record.totalCostUSD },
        'AI cost recorded'
      );

      if (usagePercent >= DEFAULT_BUDGET.alertThresholdPercent) {
        this.log.warn(
          { cuid, feature, usagePercent: usagePercent.toFixed(1), totalCost: record.totalCostUSD },
          'AI budget threshold reached'
        );
      }
    } catch (error) {
      this.log.error({ error, cuid, feature }, 'Failed to record AI cost — non-blocking');
    }
  }

  async getUsage(cuid: string): Promise<{ budgetUSD: number; usagePercent: number } & CostRecord> {
    const record = await this.getMonthlyRecord(cuid);
    return {
      ...record,
      budgetUSD: DEFAULT_BUDGET.monthlyBudgetUSD,
      usagePercent:
        DEFAULT_BUDGET.monthlyBudgetUSD > 0
          ? (record.totalCostUSD / DEFAULT_BUDGET.monthlyBudgetUSD) * 100
          : 0,
    };
  }

  private getKey(cuid: string): string {
    const month = new Date().toISOString().slice(0, 7);
    return `${KEY_PREFIX}:${cuid}:${month}`;
  }

  private getMonthEndTTL(): number {
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return Math.ceil((endOfMonth.getTime() - now.getTime()) / 1000);
  }

  private async getMonthlyRecord(cuid: string): Promise<CostRecord> {
    const result = await this.getItem<CostRecord>(this.getKey(cuid));
    if (result.success && result.data) {
      return result.data;
    }

    return {
      cuid,
      month: new Date().toISOString().slice(0, 7),
      totalCostUSD: 0,
      analysisCount: 0,
      breakdown: {},
    };
  }
}
