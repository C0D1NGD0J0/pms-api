import { Types } from 'mongoose';
import { ESignatureWorker } from '@workers/esignature.worker';

// ── shared IDs ──────────────────────────────────────────────────────────
const leaseId = new Types.ObjectId();
const pmUserId = new Types.ObjectId();
const testCuid = 'TESTCLIENT123';
const testLuid = 'LEASE123';
const documentId = 'boldsign-doc-123';
const leaseNumber = 'L2026-ABCDE';
const expectedKey = `lease/signed_${leaseNumber}|||${leaseId}|||_${documentId}.pdf`;

// ── factory helpers ─────────────────────────────────────────────────────
const makeLease = (overrides: Record<string, any> = {}) => ({
  _id: leaseId,
  cuid: testCuid,
  luid: testLuid,
  leaseNumber,
  createdBy: pmUserId,
  leaseDocuments: [{ documentType: 'lease_agreement', status: 'active', key: 'agreement-key' }],
  ...overrides,
});

const makeJob = () =>
  ({
    id: `signed-doc:${documentId}`,
    data: { cuid: testCuid, luid: testLuid, leaseId: leaseId.toString(), documentId },
    progress: jest.fn(),
    discard: jest.fn().mockResolvedValue(undefined),
  }) as any;

const httpError = (statusCode: number) =>
  Object.assign(new Error(`BoldSign API Error: ${statusCode}`), { statusCode });

// ── mock builders ───────────────────────────────────────────────────────
const buildMocks = () => {
  const pdfBuffer = Buffer.from('%PDF-signed');
  return {
    pdfBuffer,
    leaseDAO: {
      findFirst: jest.fn().mockResolvedValue(makeLease()),
      updateLeaseDocuments: jest.fn().mockResolvedValue(makeLease()),
    } as any,
    boldSignService: {
      downloadSignedDocument: jest.fn().mockResolvedValue(pdfBuffer),
    } as any,
    s3Service: {
      uploadBuffer: jest
        .fn()
        .mockImplementation((_buffer: Buffer, key: string) =>
          Promise.resolve({ key, url: `https://s3.test/${key}` })
        ),
    } as any,
    leaseCache: {
      invalidateLease: jest.fn().mockResolvedValue(undefined),
      invalidateLeaseLists: jest.fn().mockResolvedValue(undefined),
    } as any,
    sseService: {
      broadcastToClient: jest.fn().mockResolvedValue(undefined),
    } as any,
    emitterService: { emit: jest.fn(), on: jest.fn(), off: jest.fn() } as any,
    mediaUploadService: {} as any,
    profileDAO: {} as any,
    propertyDAO: {} as any,
  };
};

// ── tests ───────────────────────────────────────────────────────────────
describe('ESignatureWorker — storeSignedDocument', () => {
  it('downloads the signed PDF, uploads it to S3 and attaches it as signed_lease', async () => {
    const mocks = buildMocks();
    const worker = new ESignatureWorker(mocks);

    const result = await worker.storeSignedDocument(makeJob());

    expect(result).toEqual({ success: true, key: expectedKey });
    expect(mocks.leaseDAO.findFirst).toHaveBeenCalledWith({
      _id: leaseId,
      cuid: testCuid,
      deletedAt: null,
    });
    expect(mocks.boldSignService.downloadSignedDocument).toHaveBeenCalledWith(documentId);
    expect(mocks.s3Service.uploadBuffer).toHaveBeenCalledWith(
      mocks.pdfBuffer,
      expectedKey,
      'application/pdf',
      leaseId.toString()
    );
    expect(mocks.leaseDAO.updateLeaseDocuments).toHaveBeenCalledWith(
      leaseId.toString(),
      [
        expect.objectContaining({
          documentType: 'signed_lease',
          filename: `signed_${leaseNumber}_${documentId}.pdf`,
          key: expectedKey,
          actorId: pmUserId.toString(),
          size: mocks.pdfBuffer.length,
        }),
      ],
      pmUserId.toString(),
      testCuid
    );
  });

  it('refreshes caches and tells viewers a document was added', async () => {
    const mocks = buildMocks();
    const worker = new ESignatureWorker(mocks);

    await worker.storeSignedDocument(makeJob());

    expect(mocks.leaseCache.invalidateLease).toHaveBeenCalledWith(testCuid, testLuid);
    expect(mocks.leaseCache.invalidateLeaseLists).toHaveBeenCalledWith(testCuid);
    expect(mocks.sseService.broadcastToClient).toHaveBeenCalledWith(
      testCuid,
      { resource: 'lease', action: 'document-added', resourceUId: testLuid },
      'resource-event'
    );
  });

  it('skips the download when the signed copy is already stored (idempotent retry)', async () => {
    const mocks = buildMocks();
    mocks.leaseDAO.findFirst.mockResolvedValue(
      makeLease({
        leaseDocuments: [{ documentType: 'signed_lease', status: 'active', key: expectedKey }],
      })
    );
    const worker = new ESignatureWorker(mocks);

    const result = await worker.storeSignedDocument(makeJob());

    expect(result).toEqual({ success: true, skipped: true, key: expectedKey });
    expect(mocks.boldSignService.downloadSignedDocument).not.toHaveBeenCalled();
    expect(mocks.s3Service.uploadBuffer).not.toHaveBeenCalled();
    expect(mocks.leaseDAO.updateLeaseDocuments).not.toHaveBeenCalled();
  });

  it('skips without retrying when the lease no longer exists', async () => {
    const mocks = buildMocks();
    mocks.leaseDAO.findFirst.mockResolvedValue(null);
    const worker = new ESignatureWorker(mocks);

    const result = await worker.storeSignedDocument(makeJob());

    expect(result).toEqual({ success: false, skipped: true });
    expect(mocks.boldSignService.downloadSignedDocument).not.toHaveBeenCalled();
  });

  it('discards the job on a permanent 4xx so Bull does not retry it', async () => {
    const mocks = buildMocks();
    mocks.boldSignService.downloadSignedDocument.mockRejectedValue(httpError(403));
    const worker = new ESignatureWorker(mocks);
    const job = makeJob();

    await expect(worker.storeSignedDocument(job)).rejects.toThrow('BoldSign API Error: 403');
    expect(job.discard).toHaveBeenCalled();
    expect(mocks.s3Service.uploadBuffer).not.toHaveBeenCalled();
  });

  it.each([404, 409, 429, 500])(
    'lets Bull retry a %i (PDF not ready yet, throttled or server error)',
    async (statusCode) => {
      const mocks = buildMocks();
      mocks.boldSignService.downloadSignedDocument.mockRejectedValue(httpError(statusCode));
      const worker = new ESignatureWorker(mocks);
      const job = makeJob();

      await expect(worker.storeSignedDocument(job)).rejects.toThrow();
      expect(job.discard).not.toHaveBeenCalled();
    }
  );

  it('lets Bull retry a failure without an HTTP status (network, open circuit)', async () => {
    const mocks = buildMocks();
    mocks.boldSignService.downloadSignedDocument.mockRejectedValue(new Error('ECONNRESET'));
    const worker = new ESignatureWorker(mocks);
    const job = makeJob();

    await expect(worker.storeSignedDocument(job)).rejects.toThrow('ECONNRESET');
    expect(job.discard).not.toHaveBeenCalled();
  });

  it('does not fail the job when the SSE broadcast fails', async () => {
    const mocks = buildMocks();
    mocks.sseService.broadcastToClient.mockRejectedValue(new Error('SSE down'));
    const worker = new ESignatureWorker(mocks);

    await expect(worker.storeSignedDocument(makeJob())).resolves.toEqual(
      expect.objectContaining({ success: true })
    );
  });
});
