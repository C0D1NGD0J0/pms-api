import { jest } from '@jest/globals';
import { JOB_NAME } from '@utils/constants';
import { PropertyWorker } from '@workers/property.worker';

jest.mock('@services/subscription/subscription_plans.config', () => ({
  subscriptionPlanConfig: {
    getConfig: jest.fn(),
  },
}));

import { subscriptionPlanConfig } from '@services/subscription/subscription_plans.config';

const mockPropertyCsvProcessor = {
  validateCsv: jest.fn() as any,
};

const mockEmitterService = {
  emit: jest.fn() as any,
};

const mockSubscriptionDAO = {
  findFirst: jest.fn() as any,
  updateResourceCount: jest.fn() as any,
};

const mockPropertyDAO = {
  countDocuments: jest.fn() as any,
  startSession: jest.fn() as any,
  withTransaction: jest.fn() as any,
  insertMany: jest.fn() as any,
};

const mockClientDAO = {};

const mockSseService = {
  sendToUser: jest.fn() as any,
};

const CUID = 'test-client-cuid';
const USER_ID = 'user-actor-id';

const makeJob = (overrides: Record<string, any> = {}) => ({
  id: 'job-1',
  progress: jest.fn() as any,
  data: {
    csvFilePath: '/tmp/properties.csv',
    userId: USER_ID,
    clientInfo: { cuid: CUID },
    ...overrides,
  },
});

const makeValidProperty = (name = 'Kensington Terrace') => ({
  name,
  address: { fullAddress: `${name} Address` },
});

let worker: PropertyWorker;

beforeEach(() => {
  jest.clearAllMocks();

  mockPropertyDAO.startSession.mockReturnValue(Promise.resolve('mock-session'));
  mockPropertyDAO.withTransaction.mockImplementation(async (_session: any, fn: any) =>
    fn('mock-session')
  );
  mockSubscriptionDAO.findFirst.mockReturnValue(Promise.resolve(null));

  worker = new PropertyWorker({
    propertyCsvProcessor: mockPropertyCsvProcessor as any,
    emitterService: mockEmitterService as any,
    subscriptionDAO: mockSubscriptionDAO as any,
    propertyDAO: mockPropertyDAO as any,
    clientDAO: mockClientDAO as any,
    sseService: mockSseService as any,
  });
});

describe('PropertyWorker.processCsvValidation', () => {
  it('emits a completed job-notification with counts and errors on success', async () => {
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(
      Promise.resolve({
        validProperties: [makeValidProperty()],
        totalRows: 2,
        errors: [{ rowNumber: 2, errors: [{ field: 'address', error: 'Invalid address' }] }],
      })
    );

    const job = makeJob();
    const result = await worker.processCsvValidation(job as any);

    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      CUID,
      expect.objectContaining({
        jobType: 'csv_property_validation',
        stage: 'completed',
        validCount: 1,
        errorCount: 1,
      }),
      'job-notification'
    );
    expect(result.success).toBe(true);
    expect(result.errorCount).toBe(1);
  });

  it('emits a failed job-notification when there are zero valid properties', async () => {
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(
      Promise.resolve({ validProperties: [], totalRows: 1, errors: [{ rowNumber: 1, errors: [] }] })
    );

    await worker.processCsvValidation(makeJob() as any);

    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      CUID,
      expect.objectContaining({ jobType: 'csv_property_validation', stage: 'failed' }),
      'job-notification'
    );
  });

  it('rethrows a fatal error without notifying — the queue reports the final failure once', async () => {
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(Promise.reject(new Error('boom')));

    await expect(worker.processCsvValidation(makeJob() as any)).rejects.toThrow('boom');

    expect(mockSseService.sendToUser).not.toHaveBeenCalledWith(
      USER_ID,
      CUID,
      expect.objectContaining({ stage: 'failed' }),
      'job-notification'
    );
  });
});

describe('PropertyWorker.processCsvImport', () => {
  beforeEach(() => {
    (subscriptionPlanConfig.getConfig as jest.Mock).mockReturnValue({
      limits: { maxProperties: -1 },
    } as any);
    mockPropertyDAO.insertMany.mockImplementation((batch: any) => Promise.resolve(batch));
  });

  it('returns the row errors from validation instead of hard-coding null', async () => {
    const rowErrors = [{ rowNumber: 2, errors: [{ field: 'address', error: 'Invalid address' }] }];
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(
      Promise.resolve({ validProperties: [makeValidProperty()], totalRows: 2, errors: rowErrors })
    );

    const result = await worker.processCsvImport(makeJob() as any);

    expect(result.errors).toEqual(expect.arrayContaining(rowErrors));
  });

  it('reports a row error for every property dropped by the subscription quota trim', async () => {
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(
      Promise.resolve({
        validProperties: [makeValidProperty('Kept'), makeValidProperty('Dropped')],
        totalRows: 2,
        errors: null,
      })
    );
    mockSubscriptionDAO.findFirst.mockReturnValue(
      Promise.resolve({ client: 'client-id', planName: 'starter' })
    );
    (subscriptionPlanConfig.getConfig as jest.Mock).mockReturnValue({
      limits: { maxProperties: 5 },
    } as any);
    mockPropertyDAO.countDocuments.mockReturnValue(Promise.resolve(4)); // 1 slot remaining

    const result = await worker.processCsvImport(makeJob() as any);

    expect(result.data?.totalInserted).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({
        errors: [
          expect.objectContaining({ field: 'quota', error: expect.stringMatching(/Dropped/) }),
        ],
      }),
    ]);
  });

  it('emits a failed job-notification without inserting when the quota is already exhausted', async () => {
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(
      Promise.resolve({ validProperties: [makeValidProperty()], totalRows: 1, errors: null })
    );
    mockSubscriptionDAO.findFirst.mockReturnValue(
      Promise.resolve({ client: 'client-id', planName: 'starter' })
    );
    (subscriptionPlanConfig.getConfig as jest.Mock).mockReturnValue({
      limits: { maxProperties: 5 },
    } as any);
    mockPropertyDAO.countDocuments.mockReturnValue(Promise.resolve(5)); // already at limit

    const result = await worker.processCsvImport(makeJob() as any);

    expect(result.success).toBe(false);
    expect(mockPropertyDAO.withTransaction).not.toHaveBeenCalled();
    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      CUID,
      expect.objectContaining({ jobType: 'csv_property_import', stage: 'failed' }),
      'job-notification'
    );
  });

  it('emits a completed job-notification with the inserted count on success', async () => {
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(
      Promise.resolve({ validProperties: [makeValidProperty()], totalRows: 1, errors: null })
    );

    await worker.processCsvImport(makeJob() as any);

    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      CUID,
      expect.objectContaining({
        jobType: 'csv_property_import',
        stage: 'completed',
        createdCount: 1,
      }),
      'job-notification'
    );
  });

  it('imports properties as approved when the importer can approve them (like single creation)', async () => {
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(
      Promise.resolve({
        validProperties: [makeValidProperty('Alpha Tower')],
        totalRows: 1,
        errors: null,
      })
    );
    mockPropertyDAO.insertMany.mockImplementation((batch: any[]) => Promise.resolve(batch));

    await worker.processCsvImport(
      makeJob({ autoApprove: true, userId: '6acd03c359d0cb2da82035db' }) as any
    );

    const [inserted] = mockPropertyDAO.insertMany.mock.calls[0][0];
    expect(inserted.approvalStatus).toBe('approved');
    expect(inserted.approvalDetails[0]).toEqual(expect.objectContaining({ action: 'approved' }));
  });

  it('leaves properties for review when the importer cannot approve them', async () => {
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(
      Promise.resolve({
        validProperties: [makeValidProperty('Alpha Tower')],
        totalRows: 1,
        errors: null,
      })
    );
    mockPropertyDAO.insertMany.mockImplementation((batch: any[]) => Promise.resolve(batch));

    await worker.processCsvImport(makeJob() as any);

    const [inserted] = mockPropertyDAO.insertMany.mock.calls[0][0];
    expect(inserted.approvalStatus).toBeUndefined();
  });

  // insertMany (ordered: false) silently drops rows the Property model rejects
  it('reports a failure instead of success when no rows were actually saved', async () => {
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(
      Promise.resolve({
        validProperties: [
          makeValidProperty('Alpha Tower'),
          makeValidProperty('Birch Court'),
          makeValidProperty('Cedar House'),
        ],
        totalRows: 3,
        errors: null,
      })
    );
    mockPropertyDAO.insertMany.mockImplementation(() => Promise.resolve([]));

    const result = await worker.processCsvImport(makeJob() as any);

    expect(result.success).toBe(false);
    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      CUID,
      expect.objectContaining({
        jobType: 'csv_property_import',
        stage: 'failed',
        createdCount: 0,
        message: 'No properties could be imported',
        errors: [
          expect.objectContaining({
            errors: [expect.objectContaining({ field: 'save' })],
          }),
        ],
      }),
      'job-notification'
    );
  });

  it('reports rows that could not be saved alongside the ones that were', async () => {
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(
      Promise.resolve({
        validProperties: [makeValidProperty('Alpha Tower'), makeValidProperty('Birch Court')],
        totalRows: 2,
        errors: null,
      })
    );
    mockPropertyDAO.insertMany.mockImplementation((batch: any[]) =>
      Promise.resolve(batch.slice(0, 1))
    );

    await worker.processCsvImport(makeJob() as any);

    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      CUID,
      expect.objectContaining({
        stage: 'completed',
        createdCount: 1,
        errorCount: 1,
        message: 'Imported 1 property with some errors',
      }),
      'job-notification'
    );
  });

  it('rethrows a fatal error without notifying — the queue reports the final failure once', async () => {
    mockPropertyCsvProcessor.validateCsv.mockReturnValue(Promise.reject(new Error('fatal')));

    await expect(worker.processCsvImport(makeJob() as any)).rejects.toThrow('fatal');

    expect(mockSseService.sendToUser).not.toHaveBeenCalledWith(
      USER_ID,
      CUID,
      expect.objectContaining({ stage: 'failed' }),
      'job-notification'
    );
  });
});

describe('PropertyWorker.notifyCsvJobFailed', () => {
  it.each([
    [JOB_NAME.CSV_VALIDATION_JOB, 'csv_property_validation'],
    [JOB_NAME.CSV_IMPORT_JOB, 'csv_property_import'],
  ])('sends a failed notification for a %s that failed for good', async (name, jobType) => {
    const job = { ...makeJob(), name };

    await worker.notifyCsvJobFailed(job as any, new Error('job timed out'));

    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      CUID,
      expect.objectContaining({
        jobId: 'job-1',
        jobType,
        stage: 'failed',
        error: 'job timed out',
      }),
      'job-notification'
    );
  });
});
