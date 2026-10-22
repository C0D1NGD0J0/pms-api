import { InspectionController } from '@controllers/InspectionController';

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('InspectionController — AI analysis failures', () => {
  const inspectionAIService = { analyzeInspection: jest.fn() };
  const controller = new InspectionController({
    inspectionService: {} as any,
    inspectionAIService: inspectionAIService as any,
    inspectionReportService: {} as any,
    mediaUploadService: {} as any,
  });
  const req = {
    params: { cuid: 'CUID', iuid: 'IUID' },
    context: { currentuser: { subscription: { plan: { name: 'growth' } } } },
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['feature_disabled', 403],
    ['plan_not_eligible', 403],
    ['budget_exceeded', 429],
    ['inspection_not_found', 404],
    ['analysis_error', 500],
  ])('maps %s to status %i with a readable message and the code', async (reason, status) => {
    inspectionAIService.analyzeInspection.mockReturnValue(Promise.resolve({ ok: false, reason }));
    const res = makeRes();

    await controller.triggerAIAnalysis(req, res);

    expect(res.status).toHaveBeenCalledWith(status);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ success: false, code: reason });
    expect(body.message).not.toBe(reason);
    expect(body.message).not.toContain('_');
  });

  it('treats an unknown reason as a generic analysis failure', async () => {
    inspectionAIService.analyzeInspection.mockReturnValue(
      Promise.resolve({ ok: false, reason: 'something_new' })
    );
    const res = makeRes();

    await controller.triggerAIAnalysis(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].message).toBe('AI analysis failed. Please try again.');
  });
});
