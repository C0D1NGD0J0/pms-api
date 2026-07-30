export interface AIRiskFlag {
  type:
    | 'damage_detected'
    | 'dispute_risk'
    | 'missing_documentation'
    | 'photo_mismatch'
    | 'rating_inconsistency';
  severity: 'low' | 'medium' | 'high';
  description: string;
  roomName: string;
}

export interface AIInspectionAnalysis {
  costInfo: {
    estimatedCostUSD: number;
    inputTokens: number;
    outputTokens: number;
  };
  riskFlags: AIRiskFlag[];
  overallSummary: string;
  analyzedAt: Date;
  model: string;
}

export interface AIBudgetConfig {
  alertThresholdPercent: number;
  perInspectionLimitUSD: number;
  monthlyBudgetUSD: number;
}
