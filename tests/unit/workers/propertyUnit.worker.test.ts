import { jest } from '@jest/globals';
import { EventTypes } from '@interfaces/events.interface';
import { PropertyUnitWorker } from '@workers/propertyUnit.worker';

jest.mock('@services/subscription/subscription_plans.config', () => ({
  subscriptionPlanConfig: {
    getConfig: jest.fn(),
  },
}));

import { subscriptionPlanConfig } from '@services/subscription/subscription_plans.config';

const mockUnitNumberingService = {
  validatePatternConsistency: jest.fn() as any,
  validateUnitNumberFloorCorrelation: jest.fn() as any,
};

const mockEmitterService = {
  emit: jest.fn() as any,
};

const mockPropertyUnitDAO = {
  startSession: jest.fn() as any,
  withTransaction: jest.fn() as any,
  insert: jest.fn() as any,
  distinct: jest.fn() as any,
};

const mockSubscriptionDAO = {
  findFirst: jest.fn() as any,
};

const mockPropertyDAO = {
  findFirst: jest.fn() as any,
  canAddUnitToProperty: jest.fn() as any,
  syncPropertyOccupancyWithUnits: jest.fn() as any,
};

const CUID = 'test-client-cuid';
const USER_ID = '507f1f77bcf86cd799439012';
const PID = 'property-pid-1';
const PROPERTY_MONGO_ID = '507f1f77bcf86cd799439011';

const makeUnit = (unitNumber: string, overrides: Record<string, any> = {}) => ({
  unitNumber,
  floor: 1,
  unitType: 'studio',
  ...overrides,
});

const makeJob = (units: any[], overrides: Record<string, any> = {}) => ({
  id: 'job-1',
  progress: jest.fn() as any,
  data: {
    units,
    pid: PID,
    cuid: CUID,
    userId: USER_ID,
    ...overrides,
  },
});

let worker: PropertyUnitWorker;

const mockSseService = { sendToUser: (jest.fn() as any).mockResolvedValue(undefined) };

beforeEach(() => {
  jest.clearAllMocks();

  mockPropertyDAO.findFirst.mockReturnValue(Promise.resolve({ id: PROPERTY_MONGO_ID }));
  mockPropertyDAO.canAddUnitToProperty.mockReturnValue(
    Promise.resolve({ canAdd: true, currentCount: 0, maxCapacity: 0 })
  );
  mockPropertyDAO.syncPropertyOccupancyWithUnits.mockReturnValue(Promise.resolve(undefined));
  mockSubscriptionDAO.findFirst.mockReturnValue(Promise.resolve(null));
  mockUnitNumberingService.validatePatternConsistency.mockReturnValue({ isConsistent: true });
  mockUnitNumberingService.validateUnitNumberFloorCorrelation.mockReturnValue({ isValid: true });
  mockPropertyUnitDAO.distinct.mockReturnValue(Promise.resolve([]));
  mockPropertyUnitDAO.startSession.mockReturnValue(Promise.resolve('mock-session'));
  mockPropertyUnitDAO.withTransaction.mockImplementation(async (_session: any, fn: any) =>
    fn('mock-session')
  );
  mockPropertyUnitDAO.insert.mockImplementation((data: any) =>
    Promise.resolve({ ...data, id: `unit-${data.unitNumber}` })
  );

  worker = new PropertyUnitWorker({
    unitNumberingService: mockUnitNumberingService as any,
    emitterService: mockEmitterService as any,
    propertyUnitDAO: mockPropertyUnitDAO as any,
    subscriptionDAO: mockSubscriptionDAO as any,
    propertyDAO: mockPropertyDAO as any,
    sseService: mockSseService as any,
  });
});

describe('PropertyUnitWorker.processUnitBatchCreation', () => {
  it('throws when the property cannot be found', async () => {
    mockPropertyDAO.findFirst.mockReturnValue(Promise.resolve(null));

    await expect(
      worker.processUnitBatchCreation(makeJob([makeUnit('101')]) as any)
    ).rejects.toThrow('Property not found');
  });

  it("stores new units' fees in cents and the property's currency, whatever the form sent", async () => {
    mockPropertyDAO.findFirst.mockReturnValue(
      Promise.resolve({ id: PROPERTY_MONGO_ID, fees: { currency: 'CAD' } })
    );

    await worker.processUnitBatchCreation(
      makeJob([makeUnit('101', { fees: { rentAmount: 1800, currency: 'USD' } })]) as any
    );

    expect(mockPropertyUnitDAO.insert).toHaveBeenCalledWith(
      // Typed in dollars, stored in cents
      expect.objectContaining({ fees: { rentAmount: 180000, currency: 'CAD' } }),
      'mock-session'
    );
  });

  it('reads the remaining unit quota off subscription.resourceTracker.unitCount', async () => {
    mockSubscriptionDAO.findFirst.mockReturnValue(
      Promise.resolve({ planName: 'starter', resourceTracker: { unitCount: 8 } })
    );
    (subscriptionPlanConfig.getConfig as jest.Mock).mockReturnValue({
      limits: { maxUnits: 10 },
    } as any);

    const result = await worker.processUnitBatchCreation(
      makeJob([makeUnit('101'), makeUnit('102')]) as any
    );

    expect(result.success).toBe(true);
    expect(result.data.successfullyCreated).toBe(2);
  });

  it('rejects the whole batch when the subscription unit quota is already exhausted', async () => {
    mockSubscriptionDAO.findFirst.mockReturnValue(
      Promise.resolve({ planName: 'starter', resourceTracker: { unitCount: 10 } })
    );
    (subscriptionPlanConfig.getConfig as jest.Mock).mockReturnValue({
      limits: { maxUnits: 10 },
    } as any);

    await expect(
      worker.processUnitBatchCreation(makeJob([makeUnit('101')]) as any)
    ).rejects.toThrow('Unit limit reached');
  });

  it('rejects the batch when it would exceed the remaining unit quota', async () => {
    mockSubscriptionDAO.findFirst.mockReturnValue(
      Promise.resolve({ planName: 'starter', resourceTracker: { unitCount: 9 } })
    );
    (subscriptionPlanConfig.getConfig as jest.Mock).mockReturnValue({
      limits: { maxUnits: 10 },
    } as any);

    await expect(
      worker.processUnitBatchCreation(makeJob([makeUnit('101'), makeUnit('102')]) as any)
    ).rejects.toThrow(/Cannot add 2 units/);
  });

  it('skips the quota check entirely for unlimited (-1) plans', async () => {
    mockSubscriptionDAO.findFirst.mockReturnValue(
      Promise.resolve({ planName: 'enterprise', resourceTracker: { unitCount: 999 } })
    );
    (subscriptionPlanConfig.getConfig as jest.Mock).mockReturnValue({
      limits: { maxUnits: -1 },
    } as any);

    const result = await worker.processUnitBatchCreation(makeJob([makeUnit('101')]) as any);

    expect(result.success).toBe(true);
  });

  it('throws when the property has reached its maximum unit capacity', async () => {
    mockPropertyDAO.canAddUnitToProperty.mockReturnValue(
      Promise.resolve({ canAdd: false, currentCount: 5, maxCapacity: 5 })
    );

    await expect(
      worker.processUnitBatchCreation(makeJob([makeUnit('101')]) as any)
    ).rejects.toThrow('Property has reached maximum unit capacity');
  });

  it('throws when adding the batch would exceed the property max capacity (including archived units)', async () => {
    mockPropertyDAO.canAddUnitToProperty.mockReturnValue(
      Promise.resolve({ canAdd: true, currentCount: 4, maxCapacity: 5 })
    );

    await expect(
      worker.processUnitBatchCreation(makeJob([makeUnit('101'), makeUnit('102')]) as any)
    ).rejects.toThrow(/exceed the limit/);
  });

  it('throws when the batch has inconsistent unit numbering patterns', async () => {
    mockUnitNumberingService.validatePatternConsistency.mockReturnValue({
      isConsistent: false,
      recommendation: 'Use a consistent prefix',
    });

    await expect(
      worker.processUnitBatchCreation(makeJob([makeUnit('101'), makeUnit('A2')]) as any)
    ).rejects.toThrow('Pattern inconsistency: Use a consistent prefix');
  });

  it('collects per-unit floor-correlation errors instead of failing the whole batch', async () => {
    mockUnitNumberingService.validateUnitNumberFloorCorrelation
      .mockReturnValueOnce({ isValid: true })
      .mockReturnValueOnce({ isValid: false, message: 'Unit 205 cannot be on floor 1' });

    const result = await worker.processUnitBatchCreation(
      makeJob([makeUnit('101'), makeUnit('205', { floor: 1 })]) as any
    );

    expect(result.data.successfullyCreated).toBe(1);
    expect(result.data.failed).toBe(1);
    expect(result.data.errors).toEqual([
      expect.objectContaining({ unitIndex: 1, unitNumber: '205' }),
    ]);
  });

  it('syncs property occupancy and emits UNIT_BATCH_CREATED after inserting units', async () => {
    const result = await worker.processUnitBatchCreation(
      makeJob([makeUnit('101'), makeUnit('102')]) as any
    );

    expect(mockPropertyDAO.syncPropertyOccupancyWithUnits).toHaveBeenCalledWith(
      PROPERTY_MONGO_ID,
      USER_ID
    );
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      EventTypes.UNIT_BATCH_CREATED,
      expect.objectContaining({
        propertyId: PROPERTY_MONGO_ID,
        propertyPid: PID,
        cuid: CUID,
        unitsCreated: 2,
        unitsFailed: 0,
      })
    );
    expect(result.success).toBe(true);
    expect(result.data.createdUnits).toHaveLength(2);
    // The units form waits for this instead of claiming success when the job was queued
    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      CUID,
      expect.objectContaining({
        jobType: 'unit_batch_create',
        stage: 'completed',
        createdCount: 2,
        errorCount: 0,
        propertyPid: PID,
      }),
      'job-notification'
    );
  });

  it('does not sync occupancy when every unit in the batch failed', async () => {
    mockUnitNumberingService.validateUnitNumberFloorCorrelation.mockReturnValue({
      isValid: false,
      message: 'bad floor',
    });

    const result = await worker.processUnitBatchCreation(makeJob([makeUnit('101')]) as any);

    expect(mockPropertyDAO.syncPropertyOccupancyWithUnits).not.toHaveBeenCalled();
    expect(result.data.successfullyCreated).toBe(0);
    expect(result.success).toBe(false);
  });

  it('propagates errors thrown from within the transaction', async () => {
    mockPropertyUnitDAO.withTransaction.mockImplementation(() =>
      Promise.reject(new Error('transaction aborted'))
    );

    await expect(
      worker.processUnitBatchCreation(makeJob([makeUnit('101')]) as any)
    ).rejects.toThrow('transaction aborted');
  });
});

describe('PropertyUnitWorker — telling the units form the outcome', () => {
  const job = (overrides: Record<string, any> = {}) => ({
    id: 'job-7',
    progress: jest.fn(),
    data: { units: [], pid: 'PID1', cuid: 'CUID1', userId: 'user-1', requestId: 'r1', ...overrides },
  });

  it('sends a failed job-notification when the batch fails for good', async () => {
    await worker.notifyUnitBatchFailed(job() as any, new Error('Unit limit reached'));

    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      'user-1',
      'CUID1',
      expect.objectContaining({
        jobId: 'job-7',
        jobType: 'unit_batch_create',
        stage: 'failed',
        propertyPid: 'PID1',
        message: 'Unit limit reached',
      }),
      'job-notification'
    );
  });
});

