import { Types } from 'mongoose';
import { jest } from '@jest/globals';
import { InspectionService } from '@services/inspection/inspection.service';
import { InspectionStatus, InspectionType } from '@interfaces/inspection.interface';

// ─── Mock DAOs & External Services ──────────────────────────────────────────

const mockInspectionDAO = {
  getByIuid: jest.fn() as any,
  listByClient: jest.fn() as any,
  listForTenant: jest.fn() as any,
  insert: jest.fn() as any,
  updateById: jest.fn() as any,
  archiveDocument: jest.fn() as any,
  list: jest.fn() as any,
  findFirst: jest.fn() as any,
  update: jest.fn() as any,
};

const mockLeaseDAO = {
  findFirst: jest.fn() as any,
  list: jest.fn() as any,
};

const mockPropertyDAO = {
  findFirst: jest.fn() as any,
  updateById: jest.fn() as any,
};

const mockPropertyUnitDAO = {
  findFirst: jest.fn() as any,
  updateById: jest.fn() as any,
};

const mockUserDAO = {
  findFirst: jest.fn() as any,
};

const mockEmitterService = {
  emit: jest.fn() as any,
  on: jest.fn() as any,
};

const mockPaymentDAO = {
  findFirst: jest.fn() as any,
};

const mockNotificationService = {
  createNotification: jest.fn() as any,
};

const mockEmailQueue = {
  addToEmailQueue: jest.fn() as any,
} as any;

const CUID = 'test-client-cuid';

let service: InspectionService;

beforeEach(() => {
  jest.clearAllMocks();

  service = new InspectionService({
    inspectionDAO: mockInspectionDAO as any,
    propertyUnitDAO: mockPropertyUnitDAO as any,
    leaseDAO: mockLeaseDAO as any,
    propertyDAO: mockPropertyDAO as any,
    userDAO: mockUserDAO as any,
    emitterService: mockEmitterService as any,
    notificationService: mockNotificationService as any,
    paymentDAO: mockPaymentDAO as any,
    emailQueue: mockEmailQueue,
    mediaUploadService: {} as any,
    sseService: {} as any,
    s3Service: { getSignedUrl: jest.fn(), uploadFiles: jest.fn() } as any,
  });
});

describe('InspectionService.updateReportDocument', () => {
  const inspectionId = new Types.ObjectId().toString();
  const pdfResult = {
    url: 'https://s3.example.com/report.pdf',
    key: 'inspection/report_123.pdf',
    size: 204800,
  };

  it('should update reportDocument fields and return the cuid and iuid', async () => {
    const inspection = {
      _id: new Types.ObjectId(inspectionId),
      iuid: 'INS1',
      cuid: CUID,
      status: InspectionStatus.SUBMITTED,
      type: InspectionType.MOVE_IN,
    };

    mockInspectionDAO.updateById.mockReturnValue(Promise.resolve(inspection));

    const result = await service.updateReportDocument(inspectionId, pdfResult);

    expect(result).toEqual({ cuid: CUID, iuid: 'INS1' });

    // Verify updateById was called with the correct $set payload
    expect(mockInspectionDAO.updateById).toHaveBeenCalledWith(
      inspectionId,
      expect.objectContaining({
        $set: expect.objectContaining({
          'reportDocument.url': pdfResult.url,
          'reportDocument.key': pdfResult.key,
          'reportDocument.size': pdfResult.size,
          'reportDocument.status': 'active',
        }),
      })
    );

    // Verify generatedAt is a Date
    const updateCall = mockInspectionDAO.updateById.mock.calls[0];
    const setPayload = updateCall[1].$set;
    expect(setPayload['reportDocument.generatedAt']).toBeInstanceOf(Date);
  });

  it('should return null when the inspection is not found', async () => {
    mockInspectionDAO.updateById.mockReturnValue(Promise.resolve(null));

    const result = await service.updateReportDocument(inspectionId, pdfResult);

    expect(result).toBeNull();
    expect(mockInspectionDAO.updateById).toHaveBeenCalledTimes(1);
  });

  it('should handle pdfResult without optional key and size', async () => {
    const minimalPdfResult = { url: 'https://s3.example.com/report.pdf' };
    const inspection = {
      _id: new Types.ObjectId(inspectionId),
      iuid: 'INS1',
      cuid: CUID,
    };

    mockInspectionDAO.updateById.mockReturnValue(Promise.resolve(inspection));

    const result = await service.updateReportDocument(inspectionId, minimalPdfResult);

    expect(result).toEqual({ cuid: CUID, iuid: 'INS1' });

    const updateCall = mockInspectionDAO.updateById.mock.calls[0];
    const setPayload = updateCall[1].$set;
    expect(setPayload['reportDocument.url']).toBe(minimalPdfResult.url);
    expect(setPayload['reportDocument.key']).toBeUndefined();
    expect(setPayload['reportDocument.size']).toBeUndefined();
    expect(setPayload['reportDocument.status']).toBe('active');
  });
});
