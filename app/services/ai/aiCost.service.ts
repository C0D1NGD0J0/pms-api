import Logger from 'bunyan';
import { createLogger } from '@utils/index';

interface CostRecord {
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

export class AICostService {
  private readonly log: Logger;
  private costRecords: Map<string, CostRecord> = new Map();

  constructor() {
    this.log = createLogger('AICostService');
  }

  canAnalyze(cuid: string): { allowed: boolean; reason?: string } {
    const record = this.getMonthlyRecord(cuid);

    if (record.totalCostUSD >= DEFAULT_BUDGET.monthlyBudgetUSD) {
      return {
        allowed: false,
        reason: `Monthly AI budget exhausted ($${record.totalCostUSD.toFixed(2)} / $${DEFAULT_BUDGET.monthlyBudgetUSD})`,
      };
    }

    return { allowed: true };
  }

  recordCost(
    cuid: string,
    feature: string,
    costUSD: number,
    inputTokens: number,
    outputTokens: number
  ): void {
    const key = this.getKey(cuid);
    const record = this.getMonthlyRecord(cuid);

    record.totalCostUSD += costUSD;
    record.analysisCount += 1;
    this.costRecords.set(key, record);

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
  }

  getUsage(cuid: string): { budgetUSD: number; usagePercent: number } & CostRecord {
    const record = this.getMonthlyRecord(cuid);
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
    return `${cuid}:${month}`;
  }

  private getMonthlyRecord(cuid: string): CostRecord {
    const key = this.getKey(cuid);
    return (
      this.costRecords.get(key) || {
        cuid,
        month: new Date().toISOString().slice(0, 7),
        totalCostUSD: 0,
        analysisCount: 0,
      }
    );
  }
}
