import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { ReportAnalysisAIService } from '@services/ai/reportAnalysisAI.service';

const mockAnthropicService = {
  createMessage: jest.fn() as any,
};

const mockFeatureFlagService = {
  isEnabled: jest.fn() as any,
};

const mockSubscriptionPlanConfig = {
  hasFeature: jest.fn() as any,
};

function createService() {
  return new ReportAnalysisAIService({
    anthropicService: mockAnthropicService as any,
    featureFlagService: mockFeatureFlagService as any,
    subscriptionPlanConfig: mockSubscriptionPlanConfig as any,
  });
}

const sampleReportData = {
  unitCounts: { total: 20, occupied: 18, vacant: 2, occupancyRate: 90 },
  paymentStats: {
    byCurrency: [
      { currency: 'CAD', totalRevenue: 500000, monthRevenue: 50000, pendingAmount: 10000 },
    ],
    overdueCount: 2,
    totalCount: 40,
    onTimeRate: 92,
    avgPaymentDelayDays: 1.5,
  },
  trends: { occupancyRate: { current: 90, previous: 85, delta: 5, deltaPercent: 5.9 } },
  period: 'last_30_days',
};

describe('ReportAnalysisAIService', () => {
  let service: ReportAnalysisAIService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createService();
  });

  it('should return feature_disabled when AI flag is off', async () => {
    mockFeatureFlagService.isEnabled.mockReturnValue(false);

    const result = await service.analyzeReport('portfolio', sampleReportData);

    expect(result).toEqual({ ok: false, reason: 'feature_disabled' });
    expect(mockFeatureFlagService.isEnabled).toHaveBeenCalledWith(FeatureFlag.AI_REPORT_ANALYSIS);
    expect(mockAnthropicService.createMessage).not.toHaveBeenCalled();
  });

  it('should return plan_not_eligible when plan lacks aiReportAnalysis', async () => {
    mockFeatureFlagService.isEnabled.mockReturnValue(true);
    mockSubscriptionPlanConfig.hasFeature.mockReturnValue(false);

    const result = await service.analyzeReport('essential', sampleReportData);

    expect(result).toEqual({ ok: false, reason: 'plan_not_eligible' });
    expect(mockSubscriptionPlanConfig.hasFeature).toHaveBeenCalledWith(
      'essential',
      'aiReportAnalysis'
    );
  });

  it('should return summary on successful AI call', async () => {
    mockFeatureFlagService.isEnabled.mockReturnValue(true);
    mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
    mockAnthropicService.createMessage.mockResolvedValue({
      content: 'Portfolio occupancy remains strong at 90%.',
      inputTokens: 500,
      outputTokens: 100,
    });

    const result = await service.analyzeReport('portfolio', sampleReportData);

    expect(result).toEqual({ ok: true, summary: 'Portfolio occupancy remains strong at 90%.' });
    expect(mockAnthropicService.createMessage).toHaveBeenCalledWith(
      expect.stringContaining('property management analyst'),
      expect.stringContaining('<report_data>'),
      expect.objectContaining({ temperature: 0.3, maxTokens: 1024 })
    );
  });

  it('should return analysis_error when AI returns empty content', async () => {
    mockFeatureFlagService.isEnabled.mockReturnValue(true);
    mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
    mockAnthropicService.createMessage.mockResolvedValue({
      content: '',
      inputTokens: 500,
      outputTokens: 0,
    });

    const result = await service.analyzeReport('portfolio', sampleReportData);

    expect(result).toEqual({ ok: false, reason: 'analysis_error' });
  });

  it('should return analysis_error when AI call throws', async () => {
    mockFeatureFlagService.isEnabled.mockReturnValue(true);
    mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
    mockAnthropicService.createMessage.mockRejectedValue(new Error('API rate limited'));

    const result = await service.analyzeReport('portfolio', sampleReportData);

    expect(result).toEqual({ ok: false, reason: 'analysis_error' });
  });

  it('should not send raw record data in prompt (only aggregated metrics)', async () => {
    mockFeatureFlagService.isEnabled.mockReturnValue(true);
    mockSubscriptionPlanConfig.hasFeature.mockReturnValue(true);
    mockAnthropicService.createMessage.mockResolvedValue({
      content: 'Summary text',
      inputTokens: 100,
      outputTokens: 50,
    });

    const dataWithRecords = {
      ...sampleReportData,
      rentRoll: [{ tenantName: 'John Doe', unitNumber: '101' }],
      recentPayments: { items: [{ tenant: 'jane@test.com' }] },
    };

    await service.analyzeReport('portfolio', dataWithRecords);

    const userContent = mockAnthropicService.createMessage.mock.calls[0][1];
    expect(userContent).not.toContain('John Doe');
    expect(userContent).not.toContain('jane@test.com');
    expect(userContent).toContain('unitCounts');
  });
});
