import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { InspectionDAO } from '@dao/inspectionDAO';
import { EventTypes } from '@interfaces/events.interface';
import { AICostService } from '@services/ai/aiCost.service';
import { EventEmitterService } from '@services/eventEmitter';
import { PlanName } from '@interfaces/subscription.interface';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { AIInspectionAnalysis } from '@interfaces/inspectionAI.interface';
import { FeatureFlagService } from '@services/featureFlag/featureFlag.service';
import { InspectionStatus, InspectionType } from '@interfaces/inspection.interface';
import { SubscriptionPlanConfig } from '@services/subscription/subscription_plans.config';
import {
  AnthropicContentBlock,
  AnthropicService,
} from '@services/external/anthropic/anthropic.service';

import {
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  buildComparisonPrompt,
} from './inspectionAI.prompts';

const INPUT_COST_PER_MTOK = 3;
const OUTPUT_COST_PER_MTOK = 15;

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  featureFlagService: FeatureFlagService;
  emitterService: EventEmitterService;
  anthropicService: AnthropicService;
  aiCostService: AICostService;
  inspectionDAO: InspectionDAO;
}

export class InspectionAIService {
  private readonly log: Logger;
  private readonly inspectionDAO: InspectionDAO;
  private readonly anthropicService: AnthropicService;
  private readonly emitterService: EventEmitterService;
  private readonly featureFlagService: FeatureFlagService;
  private readonly costService: AICostService;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;

  constructor({
    inspectionDAO,
    anthropicService,
    emitterService,
    featureFlagService,
    aiCostService,
    subscriptionPlanConfig,
  }: IConstructor) {
    this.log = createLogger('InspectionAIService');
    this.inspectionDAO = inspectionDAO;
    this.anthropicService = anthropicService;
    this.emitterService = emitterService;
    this.featureFlagService = featureFlagService;
    this.costService = aiCostService;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
  }

  async analyzeInspection(
    cuid: string,
    iuid: string,
    planName: PlanName
  ): Promise<AIInspectionAnalysis | null> {
    if (!this.featureFlagService.isEnabled(FeatureFlag.AI_INSPECTION_ANALYSIS)) {
      return null;
    }

    if (!this.subscriptionPlanConfig.hasFeature(planName, 'aiInspectionAnalysis')) {
      this.log.info({ planName }, 'AI inspection analysis not available on plan — skipping');
      return null;
    }

    const { allowed, reason } = this.costService.canAnalyze(cuid);
    if (!allowed) {
      this.log.warn({ cuid, iuid, reason }, 'AI analysis skipped — budget exceeded');
      return null;
    }

    const inspection = await this.inspectionDAO.getByIuid(iuid, cuid);
    if (!inspection) {
      this.log.error({ cuid, iuid }, 'Inspection not found for AI analysis');
      return null;
    }

    try {
      const contentBlocks: AnthropicContentBlock[] = [
        { type: 'text', text: buildAnalysisUserPrompt(inspection, 'submission') },
      ];

      // Attach room photos for vision analysis
      for (const room of inspection.rooms) {
        for (const media of room.media || []) {
          if (media.url && media.status === 'active') {
            contentBlocks.push({
              type: 'image',
              source: { type: 'url', url: media.url },
            } as AnthropicContentBlock);
          }
        }
      }

      // For move-out: compare against move-in inspection
      if (inspection.type === InspectionType.MOVE_OUT) {
        const moveInInspection = await this.inspectionDAO.findFirst({
          cuid,
          leaseId: inspection.leaseId,
          type: InspectionType.MOVE_IN,
          status: { $in: [InspectionStatus.APPROVED, InspectionStatus.SUBMITTED] },
          deletedAt: null,
        });
        if (moveInInspection) {
          contentBlocks.push({
            type: 'text',
            text: buildComparisonPrompt(
              JSON.stringify(moveInInspection.rooms, null, 2),
              JSON.stringify(inspection.rooms, null, 2)
            ),
          });
        }
      }

      const result = await this.anthropicService.createVisionMessage(
        buildAnalysisSystemPrompt(),
        contentBlocks,
        { temperature: 0.2 }
      );

      const rawJson = result.content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const parsed = JSON.parse(rawJson);

      const costUSD =
        (result.inputTokens / 1_000_000) * INPUT_COST_PER_MTOK +
        (result.outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK;

      const analysis: AIInspectionAnalysis = {
        overallSummary: parsed.overallSummary || '',
        riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
        costInfo: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCostUSD: costUSD,
        },
        analyzedAt: new Date(),
        model: result.model,
      };

      this.costService.recordCost(
        cuid,
        'inspectionAnalysis',
        costUSD,
        result.inputTokens,
        result.outputTokens
      );

      await this.inspectionDAO.updateById(inspection._id.toString(), {
        $set: { aiAnalysis: analysis },
      });

      this.emitterService.emit(EventTypes.INSPECTION_AI_ANALYZED, {
        riskFlagCount: analysis.riskFlags.length,
        costUSD,
        iuid,
        cuid,
      });

      this.log.info(
        { iuid, cuid, riskFlags: analysis.riskFlags.length, costUSD },
        'AI inspection analysis completed'
      );

      return analysis;
    } catch (error) {
      this.log.error({ error, iuid, cuid }, 'AI inspection analysis failed');
      return null;
    }
  }
}
