import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { InspectionDAO } from '@dao/inspectionDAO';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { AICostService } from '@services/ai/aiCost.service';
import { EventEmitterService } from '@services/eventEmitter';
import { PlanName } from '@interfaces/subscription.interface';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { AIInspectionAnalysis } from '@interfaces/inspectionAI.interface';
import { FeatureFlagService } from '@services/featureFlag/featureFlag.service';
import { InspectionStatus, InspectionType } from '@interfaces/inspection.interface';
import { InspectionSubmittedPayload, EventTypes } from '@interfaces/events.interface';
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

export type AIAnalysisResult =
  | { ok: true; analysis: AIInspectionAnalysis }
  | {
      ok: false;
      reason:
        | 'feature_disabled'
        | 'plan_not_eligible'
        | 'budget_exceeded'
        | 'inspection_not_found'
        | 'analysis_error';
    };

const INPUT_COST_PER_MTOK = 3;
const OUTPUT_COST_PER_MTOK = 15;

interface IConstructor {
  subscriptionPlanConfig: SubscriptionPlanConfig;
  featureFlagService: FeatureFlagService;
  emitterService: EventEmitterService;
  anthropicService: AnthropicService;
  subscriptionDAO: SubscriptionDAO;
  aiCostService: AICostService;
  inspectionDAO: InspectionDAO;
}

export class InspectionAIService {
  private readonly log: Logger;
  private readonly inspectionDAO: InspectionDAO;
  private readonly subscriptionDAO: SubscriptionDAO;
  private readonly anthropicService: AnthropicService;
  private readonly emitterService: EventEmitterService;
  private readonly featureFlagService: FeatureFlagService;
  private readonly costService: AICostService;
  private readonly subscriptionPlanConfig: SubscriptionPlanConfig;

  constructor({
    inspectionDAO,
    subscriptionDAO,
    anthropicService,
    emitterService,
    featureFlagService,
    aiCostService,
    subscriptionPlanConfig,
  }: IConstructor) {
    this.log = createLogger('InspectionAIService');
    this.inspectionDAO = inspectionDAO;
    this.subscriptionDAO = subscriptionDAO;
    this.anthropicService = anthropicService;
    this.emitterService = emitterService;
    this.featureFlagService = featureFlagService;
    this.costService = aiCostService;
    this.subscriptionPlanConfig = subscriptionPlanConfig;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.emitterService.on(
      EventTypes.INSPECTION_SUBMITTED,
      this.handleInspectionSubmitted.bind(this)
    );
  }

  private async handleInspectionSubmitted(payload: InspectionSubmittedPayload): Promise<void> {
    try {
      const subscription = await this.subscriptionDAO.findFirst({ cuid: payload.cuid });
      const planName: PlanName = (subscription?.planName as PlanName) || 'essential';
      const result = await this.analyzeInspection(payload.cuid, payload.iuid, planName);
      if (!result.ok) {
        this.log.info(
          { iuid: payload.iuid, cuid: payload.cuid, reason: result.reason },
          'Auto-triggered AI analysis skipped'
        );
      }
    } catch (error) {
      this.log.error(
        { error, iuid: payload.iuid, cuid: payload.cuid },
        'Auto-triggered AI analysis failed — non-blocking'
      );
    }
  }

  async analyzeInspection(
    cuid: string,
    iuid: string,
    planName: PlanName
  ): Promise<AIAnalysisResult> {
    if (!this.featureFlagService.isEnabled(FeatureFlag.AI_INSPECTION_ANALYSIS)) {
      return { ok: false, reason: 'feature_disabled' };
    }

    if (!this.subscriptionPlanConfig.hasFeature(planName, 'aiInspectionAnalysis')) {
      this.log.info({ planName }, 'AI inspection analysis not available on plan — skipping');
      return { ok: false, reason: 'plan_not_eligible' };
    }

    const { allowed, reason } = await this.costService.canAnalyze(cuid);
    if (!allowed) {
      this.log.warn({ cuid, iuid, reason }, 'AI analysis skipped — budget exceeded');
      return { ok: false, reason: 'budget_exceeded' };
    }

    const inspection = await this.inspectionDAO.getByIuid(iuid, cuid);
    if (!inspection) {
      this.log.error({ cuid, iuid }, 'Inspection not found for AI analysis');
      return { ok: false, reason: 'inspection_not_found' };
    }

    try {
      const promptType = inspection.status === InspectionStatus.DISPUTED ? 'dispute' : 'submission';
      const contentBlocks: AnthropicContentBlock[] = [
        { type: 'text', text: buildAnalysisUserPrompt(inspection, promptType) },
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

      // For move-out: compare against move-in inspection on the same lease
      if (inspection.type === InspectionType.MOVE_OUT && inspection.leaseId) {
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

      // Validate expected shape — guard against model response drift
      if (typeof parsed !== 'object' || parsed === null) {
        this.log.warn({ iuid, cuid }, 'AI response is not a valid object');
        return { ok: false, reason: 'analysis_error' };
      }

      const costUSD =
        (result.inputTokens / 1_000_000) * INPUT_COST_PER_MTOK +
        (result.outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK;

      const validFlags = (Array.isArray(parsed.riskFlags) ? parsed.riskFlags : []).filter(
        (f: any) => f && typeof f.type === 'string' && typeof f.description === 'string'
      );

      const analysis: AIInspectionAnalysis = {
        overallSummary: typeof parsed.overallSummary === 'string' ? parsed.overallSummary : '',
        riskFlags: validFlags,
        costInfo: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCostUSD: costUSD,
        },
        analyzedAt: new Date(),
        model: result.model,
      };

      // fire-and-forget — cost recording is non-blocking (has internal try/catch)
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

      return { ok: true, analysis };
    } catch (error) {
      this.log.error({ error, iuid, cuid }, 'AI inspection analysis failed');
      return { ok: false, reason: 'analysis_error' };
    }
  }
}
