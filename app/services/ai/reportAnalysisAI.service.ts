import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { PlanName } from '@interfaces/subscription.interface';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { FeatureFlagService } from '@services/featureFlag/featureFlag.service';
import { AnthropicService } from '@services/external/anthropic/anthropic.service';
import { SubscriptionPlanConfig } from '@services/subscription/subscription_plans.config';

import {
  REPORT_ANALYSIS_SYSTEM_PROMPT,
  buildReportAnalysisUserPrompt,
} from './reportAnalysisAI.prompts';

export type ReportAnalysisResult =
  | { ok: true; summary: string }
  | {
      ok: false;
      reason: 'feature_disabled' | 'plan_not_eligible' | 'analysis_error';
    };

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  featureFlagService: FeatureFlagService;
  anthropicService: AnthropicService;
}

export class ReportAnalysisAIService {
  private readonly log: Logger;
  private readonly anthropicService: AnthropicService;
  private readonly featureFlagService: FeatureFlagService;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;

  constructor({ anthropicService, featureFlagService, subscriptionPlanConfig }: IConstructor) {
    this.log = createLogger('ReportAnalysisAIService');
    this.anthropicService = anthropicService;
    this.featureFlagService = featureFlagService;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
  }

  async analyzeReport(
    planName: PlanName,
    reportData: Record<string, any>
  ): Promise<ReportAnalysisResult> {
    if (!this.featureFlagService.isEnabled(FeatureFlag.AI_REPORT_ANALYSIS)) {
      return { ok: false, reason: 'feature_disabled' };
    }

    if (!this.subscriptionPlanConfig.hasFeature(planName, 'aiReportAnalysis')) {
      this.log.info({ planName }, 'AI report analysis not available on plan');
      return { ok: false, reason: 'plan_not_eligible' };
    }

    try {
      const userContent = buildReportAnalysisUserPrompt(reportData);

      const result = await this.anthropicService.createMessage(
        REPORT_ANALYSIS_SYSTEM_PROMPT,
        userContent,
        { temperature: 0.3, maxTokens: 1024 }
      );

      const summary = result.content.trim();
      if (!summary) {
        this.log.warn('AI returned empty report analysis');
        return { ok: false, reason: 'analysis_error' };
      }

      this.log.info(
        { inputTokens: result.inputTokens, outputTokens: result.outputTokens },
        'Report analysis generated'
      );

      return { ok: true, summary };
    } catch (error: any) {
      this.log.error({ error: error.message }, 'AI report analysis failed');
      return { ok: false, reason: 'analysis_error' };
    }
  }
}
