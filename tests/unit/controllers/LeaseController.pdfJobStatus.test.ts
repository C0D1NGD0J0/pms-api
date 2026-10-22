import { httpStatusCodes } from '@utils/index';
import { LeaseController } from '@controllers/LeaseController';

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('LeaseController — PDF job status', () => {
  const pdfGeneratorQueue = { getJobStatus: jest.fn() };
  const controller = new LeaseController({
    leaseService: {} as any,
    mediaUploadService: {} as any,
    leaseTemplateService: {} as any,
    pdfGeneratorQueue: pdfGeneratorQueue as any,
  });
  const req = { params: { cuid: 'CUID', jobId: 'job-1' } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('replaces the raw failure reason of a failed job with a generic one', async () => {
    pdfGeneratorQueue.getJobStatus.mockReturnValue(
      Promise.resolve({
        exists: true,
        id: 'job-1',
        state: 'failed',
        data: { cuid: 'CUID' },
        failedReason: 'ENOENT: no such file or directory, open /tmp/lease.pdf',
      })
    );
    const res = makeRes();

    await controller.getPdfJobStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(httpStatusCodes.OK);
    const body = res.json.mock.calls[0][0];
    expect(body.data.failedReason).toBe('Failed to generate the lease PDF');
  });

  it('omits failedReason when the job has not failed', async () => {
    pdfGeneratorQueue.getJobStatus.mockReturnValue(
      Promise.resolve({ exists: true, id: 'job-1', state: 'completed', data: { cuid: 'CUID' } })
    );
    const res = makeRes();

    await controller.getPdfJobStatus(req, res);

    expect(res.json.mock.calls[0][0].data.failedReason).toBeUndefined();
  });

  it('does not expose the error message when the status lookup throws', async () => {
    pdfGeneratorQueue.getJobStatus.mockReturnValue(
      Promise.reject(new Error('Redis connection refused 10.0.0.4:6379'))
    );
    const res = makeRes();

    await controller.getPdfJobStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(httpStatusCodes.INTERNAL_SERVER_ERROR);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Failed to get job status',
    });
  });
});
