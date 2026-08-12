import { Types } from 'mongoose';
import { jest } from '@jest/globals';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import type { PlanName } from '@interfaces/subscription.interface';
import type { InspectionSubmittedPayload } from '@interfaces/events.interface';
import { InspectionAIService } from '@services/inspection/inspectionAI.service';
import {
  InspectionStatus,
  ConditionRating,
  InspectionType,
} from '@interfaces/inspection.interface';

// ─── Constants ────────────────────────────────────────────────────────────────

const CUID = 'test-client-cuid';
const IUID = 'insp-abc123';
const TEST_PLAN: PlanName = 'growth';

// ─── Mock Dependencies ───────────────────────────────────────────────────────

const mockInspectionDAO = {
  getByIuid: jest.fn() as any,
  updateById: jest.fn() as any,
  findFirst: jest.fn() as any,
};

const mockSubscriptionDAO = {
  findFirst: jest.fn() as any,
};

const mockAnthropicService = {
  createVisionMessage: jest.fn() as any,
};

const mockEmitterService = {
  emit: jest.fn() as any,
  on: jest.fn() as any,
};

const mockFeatureFlagService = {
  isEnabled: jest.fn() as any,
};

const mockAiCostService = {
  canAnalyze: jest.fn() as any,
  recordCost: jest.fn() as any,
};

const mockSubscriptionPlanConfig = {
  hasFeature: jest.fn() as any,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeInspection = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  iuid: IUID,
  cuid: CUID,
  type: InspectionType.MOVE_IN,
  status: InspectionStatus.SUBMITTED,
  tenantId: new Types.ObjectId(),
  propertyId: new Types.ObjectId(),
  leaseId: new Types.ObjectId(),
  scheduledDate: new Date(),
  rooms: [
    {
      name: 'Living Room',
      condition: ConditionRating.GOOD,
      items: [{ name: 'Walls', condition: ConditionRating.GOOD, notes: '' }],
      media: [{ url: 'https://s3.example.com/photo1.jpg', status: 'active' }],
    },
  ],
  media: [],
  ...overrides,
});

const makeAnthropicResult = (overrides: Record<string, any> = {}) => ({
  content: JSON.stringify({
    overallSummary: 'Property is in good condition overall.',
    riskFlags: [
      {
        type: 'damage_detected',
        severity: 'low',
        description: 'Minor scuff on living room wall',
        roomName: 'Living Room',
      },
    ],
  }),
  inputTokens: 1200,
  outputTokens: 350,
  model: 'claude-haiku-4-5-20251001',
  ...overrides,
});

const makeService = () =>
  new InspectionAIService({
    inspectionDAO: mockInspectionDAO as any,
    subscriptionDAO: mockSubscriptionDAO as any,
    anthropicService: mockAnthropicService as any,
    emitterService: mockEmitterService as any,
    featureFlagService: mockFeatureFlagService as any,
    aiCostService: mockAiCostService as any,
    subscriptionPlanConfig: mockSubscriptionPlanConfig as any,
  });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('InspectionAIService', () => {
  let service: InspectionAIService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = makeService();
  });

  // ── analyzeInspection ────────────────────────────────────────────────────

  describe('analyzeInspection', () => {
    it('should return feature_disabled when AI_INSPECTION_ANALYSIS flag is off', async () => {
      mockFeatureFlagService.isEnabled.mockReturnValue(false);

      const result = await service.analyzeInspection(CUID, IUID, TEST_PLAN);

      expect(result).toEqual({ ok: false, reason: 'feature_disabled' });
      expect(mockFeatureFlagService.isEnabled).toHaveBeenCalledWith(
        FeatureFlag.AI_INSPECTION_ANALYSIS
      );
      expect(mockAnthropicService.createVisionMessage).not.toHaveBeenCalled();
    });

    it('should return plan_not_eligible when plan does not include aiInspectionAnalysis', async () => {
      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(false);

      const result = await service.analyzeInspection(CUID, IUID, TEST_PLAN);

      expect(result).toEqual({ ok: false, reason: 'plan_not_eligible' });
      expect(mockSubscriptionPlanConfig.hasFeature).toHaveBeenCalledWith(
        TEST_PLAN,
        'aiInspectionAnalysis'
      );
      expect(mockAiCostService.canAnalyze).not.toHaveBeenCalled();
    });

    it('should return budget_exceeded when cost limit is reached', async () => {
      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
      mockAiCostService.canAnalyze.mockReturnValue(
        Promise.resolve({ allowed: false, reason: 'Monthly AI budget exhausted' })
      );

      const result = await service.analyzeInspection(CUID, IUID, TEST_PLAN);

      expect(result).toEqual({ ok: false, reason: 'budget_exceeded' });
      expect(mockAiCostService.canAnalyze).toHaveBeenCalledWith(CUID);
      expect(mockInspectionDAO.getByIuid).not.toHaveBeenCalled();
    });

    it('should return inspection_not_found when inspection does not exist', async () => {
      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
      mockAiCostService.canAnalyze.mockReturnValue(Promise.resolve({ allowed: true }));
      mockInspectionDAO.getByIuid.mockReturnValue(Promise.resolve(null));

      const result = await service.analyzeInspection(CUID, IUID, TEST_PLAN);

      expect(result).toEqual({ ok: false, reason: 'inspection_not_found' });
      expect(mockInspectionDAO.getByIuid).toHaveBeenCalledWith(IUID, CUID);
    });

    it('should call Anthropic, parse response, save to DB, record cost, and emit event on success', async () => {
      const inspection = makeInspection();
      const anthropicResult = makeAnthropicResult();

      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
      mockAiCostService.canAnalyze.mockReturnValue(Promise.resolve({ allowed: true }));
      mockInspectionDAO.getByIuid.mockReturnValue(Promise.resolve(inspection));
      mockAnthropicService.createVisionMessage.mockReturnValue(Promise.resolve(anthropicResult));
      mockInspectionDAO.updateById.mockReturnValue(Promise.resolve(inspection));

      const result = await service.analyzeInspection(CUID, IUID, TEST_PLAN);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.analysis.overallSummary).toBe('Property is in good condition overall.');
        expect(result.analysis.riskFlags).toHaveLength(1);
        expect(result.analysis.riskFlags[0].type).toBe('damage_detected');
        expect(result.analysis.costInfo.inputTokens).toBe(1200);
        expect(result.analysis.costInfo.outputTokens).toBe(350);
        expect(result.analysis.model).toBe('claude-haiku-4-5-20251001');
        expect(result.analysis.analyzedAt).toBeInstanceOf(Date);
      }

      // Verify Anthropic was called with maxTokens: 2048
      expect(mockAnthropicService.createVisionMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
        expect.objectContaining({ temperature: 0.2, maxTokens: 2048 })
      );

      // Verify DB update
      expect(mockInspectionDAO.updateById).toHaveBeenCalledWith(
        inspection._id.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({
            aiAnalysis: expect.objectContaining({
              overallSummary: 'Property is in good condition overall.',
              riskFlags: expect.arrayContaining([
                expect.objectContaining({ type: 'damage_detected' }),
              ]),
            }),
          }),
        })
      );

      // Verify cost recording
      expect(mockAiCostService.recordCost).toHaveBeenCalledWith(
        CUID,
        'inspectionAnalysis',
        expect.any(Number),
        1200,
        350
      );

      // Verify event emission
      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        'inspection:ai:analyzed',
        expect.objectContaining({
          riskFlagCount: 1,
          iuid: IUID,
          cuid: CUID,
          costUSD: expect.any(Number),
        })
      );
    });

    it('should include image content blocks from room media in Anthropic call', async () => {
      const inspection = makeInspection({
        rooms: [
          {
            name: 'Kitchen',
            condition: ConditionRating.FAIR,
            items: [],
            media: [
              { url: 'https://s3.example.com/kitchen1.jpg', status: 'active' },
              { url: 'https://s3.example.com/kitchen2.jpg', status: 'active' },
              { url: 'https://s3.example.com/deleted.jpg', status: 'deleted' },
            ],
          },
        ],
      });

      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
      mockAiCostService.canAnalyze.mockReturnValue(Promise.resolve({ allowed: true }));
      mockInspectionDAO.getByIuid.mockReturnValue(Promise.resolve(inspection));
      mockAnthropicService.createVisionMessage.mockReturnValue(
        Promise.resolve(makeAnthropicResult())
      );
      mockInspectionDAO.updateById.mockReturnValue(Promise.resolve(inspection));

      await service.analyzeInspection(CUID, IUID, TEST_PLAN);

      const contentBlocks = mockAnthropicService.createVisionMessage.mock.calls[0][1];
      const imageBlocks = contentBlocks.filter((b: any) => b.type === 'image');
      // 2 active images, the deleted one is excluded
      expect(imageBlocks).toHaveLength(2);
      expect(imageBlocks[0].source.url).toBe('https://s3.example.com/kitchen1.jpg');
      expect(imageBlocks[1].source.url).toBe('https://s3.example.com/kitchen2.jpg');
    });

    it('should handle malformed Anthropic response gracefully (not valid JSON)', async () => {
      const inspection = makeInspection();

      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
      mockAiCostService.canAnalyze.mockReturnValue(Promise.resolve({ allowed: true }));
      mockInspectionDAO.getByIuid.mockReturnValue(Promise.resolve(inspection));
      mockAnthropicService.createVisionMessage.mockReturnValue(
        Promise.resolve({
          content: 'This is not valid JSON at all {{{',
          inputTokens: 500,
          outputTokens: 100,
          model: 'claude-haiku-4-5-20251001',
        })
      );

      const result = await service.analyzeInspection(CUID, IUID, TEST_PLAN);

      expect(result).toEqual({ ok: false, reason: 'analysis_error' });
      expect(mockInspectionDAO.updateById).not.toHaveBeenCalled();
      expect(mockAiCostService.recordCost).not.toHaveBeenCalled();
    });

    it('should return analysis_error when Anthropic returns a non-object (null string)', async () => {
      const inspection = makeInspection();

      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
      mockAiCostService.canAnalyze.mockReturnValue(Promise.resolve({ allowed: true }));
      mockInspectionDAO.getByIuid.mockReturnValue(Promise.resolve(inspection));
      mockAnthropicService.createVisionMessage.mockReturnValue(
        Promise.resolve({
          content: 'null',
          inputTokens: 500,
          outputTokens: 10,
          model: 'claude-haiku-4-5-20251001',
        })
      );

      const result = await service.analyzeInspection(CUID, IUID, TEST_PLAN);

      expect(result).toEqual({ ok: false, reason: 'analysis_error' });
    });

    it('should use maxTokens: 2048 in the Anthropic call', async () => {
      const inspection = makeInspection();

      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
      mockAiCostService.canAnalyze.mockReturnValue(Promise.resolve({ allowed: true }));
      mockInspectionDAO.getByIuid.mockReturnValue(Promise.resolve(inspection));
      mockAnthropicService.createVisionMessage.mockReturnValue(
        Promise.resolve(makeAnthropicResult())
      );
      mockInspectionDAO.updateById.mockReturnValue(Promise.resolve(inspection));

      await service.analyzeInspection(CUID, IUID, TEST_PLAN);

      const opts = mockAnthropicService.createVisionMessage.mock.calls[0][2];
      expect(opts.maxTokens).toBe(2048);
    });

    it('should filter out invalid risk flags from the response', async () => {
      const inspection = makeInspection();

      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
      mockAiCostService.canAnalyze.mockReturnValue(Promise.resolve({ allowed: true }));
      mockInspectionDAO.getByIuid.mockReturnValue(Promise.resolve(inspection));
      mockAnthropicService.createVisionMessage.mockReturnValue(
        Promise.resolve(
          makeAnthropicResult({
            content: JSON.stringify({
              overallSummary: 'Some summary',
              riskFlags: [
                { type: 'damage_detected', description: 'Valid flag', roomName: 'Room 1' },
                { type: null, description: 'Invalid — missing type' },
                { description: 'Also invalid — no type at all' },
                'not an object at all',
              ],
            }),
          })
        )
      );
      mockInspectionDAO.updateById.mockReturnValue(Promise.resolve(inspection));

      const result = await service.analyzeInspection(CUID, IUID, TEST_PLAN);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.analysis.riskFlags).toHaveLength(1);
        expect(result.analysis.riskFlags[0].type).toBe('damage_detected');
      }
    });

    it('should strip markdown code fences from Anthropic response before parsing', async () => {
      const inspection = makeInspection();

      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
      mockAiCostService.canAnalyze.mockReturnValue(Promise.resolve({ allowed: true }));
      mockInspectionDAO.getByIuid.mockReturnValue(Promise.resolve(inspection));
      mockAnthropicService.createVisionMessage.mockReturnValue(
        Promise.resolve(
          makeAnthropicResult({
            content: '```json\n{"overallSummary":"Wrapped in fences","riskFlags":[]}\n```',
          })
        )
      );
      mockInspectionDAO.updateById.mockReturnValue(Promise.resolve(inspection));

      const result = await service.analyzeInspection(CUID, IUID, TEST_PLAN);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.analysis.overallSummary).toBe('Wrapped in fences');
      }
    });
  });

  // ── handleInspectionSubmitted ────────────────────────────────────────────

  describe('handleInspectionSubmitted', () => {
    const payload: InspectionSubmittedPayload = {
      type: InspectionType.MOVE_IN,
      inspectorUid: 'usr-abc123',
      tenantId: new Types.ObjectId().toString(),
      iuid: IUID,
      cuid: CUID,
    };

    it('should auto-trigger analyzeInspection with the subscription plan', async () => {
      mockSubscriptionDAO.findFirst.mockReturnValue(Promise.resolve({ planName: 'growth' }));
      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
      mockAiCostService.canAnalyze.mockReturnValue(Promise.resolve({ allowed: true }));
      mockInspectionDAO.getByIuid.mockReturnValue(Promise.resolve(makeInspection()));
      mockAnthropicService.createVisionMessage.mockReturnValue(
        Promise.resolve(makeAnthropicResult())
      );
      mockInspectionDAO.updateById.mockReturnValue(Promise.resolve({}));

      // The constructor registers the listener — simulate the event
      const listener = mockEmitterService.on.mock.calls.find(
        (call: any[]) => call[0] === 'inspection:submitted'
      );
      expect(listener).toBeDefined();

      // Call the bound handler directly
      await listener![1](payload);

      expect(mockSubscriptionDAO.findFirst).toHaveBeenCalledWith({ cuid: CUID });
      expect(mockAnthropicService.createVisionMessage).toHaveBeenCalled();
    });

    it('should default to essential plan when subscription is not found', async () => {
      mockSubscriptionDAO.findFirst.mockReturnValue(Promise.resolve(null));
      mockFeatureFlagService.isEnabled.mockReturnValue(true);
      mockSubscriptionPlanConfig.hasFeature.mockReturnValue(false);

      const listener = mockEmitterService.on.mock.calls.find(
        (call: any[]) => call[0] === 'inspection:submitted'
      );

      await listener![1](payload);

      expect(mockSubscriptionPlanConfig.hasFeature).toHaveBeenCalledWith(
        'essential',
        'aiInspectionAnalysis'
      );
    });

    it('should skip gracefully when analysis returns ok: false', async () => {
      mockSubscriptionDAO.findFirst.mockReturnValue(Promise.resolve({ planName: 'essential' }));
      mockFeatureFlagService.isEnabled.mockReturnValue(false);

      const listener = mockEmitterService.on.mock.calls.find(
        (call: any[]) => call[0] === 'inspection:submitted'
      );

      // Should not throw
      await expect(listener![1](payload)).resolves.not.toThrow();
      expect(mockAnthropicService.createVisionMessage).not.toHaveBeenCalled();
    });

    it('should catch and log errors without throwing', async () => {
      mockSubscriptionDAO.findFirst.mockReturnValue(
        Promise.reject(new Error('DB connection lost'))
      );

      const listener = mockEmitterService.on.mock.calls.find(
        (call: any[]) => call[0] === 'inspection:submitted'
      );

      // Should not propagate the error
      await expect(listener![1](payload)).resolves.not.toThrow();
    });
  });
});
