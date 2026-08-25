/**
 * PropertyUnitService — event emission tests
 *
 * Verifies that creating units emits UNIT_CREATED for each unit
 * so PropertyService can sync occupancy and invalidate cache.
 */
import { Types } from 'mongoose';

jest.mock('@di/index', () => ({ container: {} }));

import { PropertyUnitService } from '@services/property/propertyUnit.service';
import { EventTypes } from '@interfaces/events.interface';

const CUID = 'TEST_CLIENT_001';
const PID = 'PROP-001';
const USER_ID = new Types.ObjectId().toString();
const PROPERTY_ID = new Types.ObjectId();

const makeContext = (unitCount = 1) => ({
  request: {
    params: { cuid: CUID, pid: PID },
    url: `/clients/${CUID}/properties/${PID}/units`,
    method: 'POST',
    path: `/clients/${CUID}/properties/${PID}/units`,
    query: {},
  },
  userAgent: { browser: 'Chrome', version: '120', os: 'MacOS', raw: 'test', isMobile: false, isBot: false },
  langSetting: { lang: 'en', t: jest.fn((key: string) => key) },
  timing: { startTime: Date.now() },
  currentuser: { sub: USER_ID },
  service: { env: 'test' },
  source: 'WEB' as any,
  requestId: 'req-test',
  timestamp: new Date(),
});

const makeProperty = () => ({
  _id: PROPERTY_ID,
  id: PROPERTY_ID.toString(),
  pid: PID,
  cuid: CUID,
  maxUnits: 10,
});

const makeCreatedUnit = (puid: string) => ({
  _id: new Types.ObjectId(),
  puid,
  unitNumber: puid,
  cuid: CUID,
  propertyId: PROPERTY_ID,
});

const makeMocks = () => {
  const emitterService = {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  } as any;

  const propertyUnitDAO = {
    insert: jest.fn(),
    startSession: jest.fn().mockReturnValue(Promise.resolve({
      endSession: jest.fn(),
    })),
    withTransaction: jest.fn().mockImplementation(async (_session: any, fn: any) => fn(_session)),
  } as any;

  const propertyDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(makeProperty())),
    canAddUnitToProperty: jest.fn().mockReturnValue(
      Promise.resolve({ canAdd: true, maxCapacity: 10, currentCount: 0 })
    ),
    getPropertyUnits: jest.fn().mockReturnValue(
      Promise.resolve({ items: [], pagination: null })
    ),
  } as any;

  const subscriptionDAO = {
    findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
  } as any;

  const unitNumberingService = {
    validateUnitNumberUpdate: jest.fn().mockReturnValue({ isValid: true }),
  } as any;

  const propertyCache = {
    invalidateProperty: jest.fn().mockReturnValue(Promise.resolve()),
    invalidatePropertyLists: jest.fn().mockReturnValue(Promise.resolve()),
  } as any;

  return {
    emitterService,
    propertyUnitDAO,
    propertyDAO,
    subscriptionDAO,
    unitNumberingService,
    propertyCache,
  };
};

const makeService = (mocks: ReturnType<typeof makeMocks>) =>
  new PropertyUnitService({
    ...mocks,
    profileDAO: {} as any,
    clientDAO: {} as any,
    queueFactory: { getQueue: jest.fn() } as any,
    leaseDAO: { list: jest.fn(), hasNonDraftLeaseForUnit: jest.fn() } as any,
  });

describe('PropertyUnitService — UNIT_CREATED event emission', () => {
  afterEach(() => jest.clearAllMocks());

  it('should emit UNIT_CREATED for a single unit', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);
    const unit = makeCreatedUnit('U-101');
    mocks.propertyUnitDAO.insert.mockReturnValue(Promise.resolve(unit));

    await service.addPropertyUnit(makeContext() as any, {
      units: [{ unitNumber: 'U-101', unitType: 'apartment', floor: 1 }],
    } as any);

    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.UNIT_CREATED,
      expect.objectContaining({
        propertyId: PROPERTY_ID.toString(),
        propertyPid: PID,
        cuid: CUID,
        unitId: 'U-101',
        userId: USER_ID,
        changeType: 'created',
      })
    );
  });

  it('should emit UNIT_CREATED for each unit in a batch', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);
    mocks.propertyUnitDAO.insert
      .mockReturnValueOnce(Promise.resolve(makeCreatedUnit('U-101')))
      .mockReturnValueOnce(Promise.resolve(makeCreatedUnit('U-102')))
      .mockReturnValueOnce(Promise.resolve(makeCreatedUnit('U-103')));

    await service.addPropertyUnit(makeContext(3) as any, {
      units: [
        { unitNumber: 'U-101', unitType: 'apartment', floor: 1 },
        { unitNumber: 'U-102', unitType: 'apartment', floor: 1 },
        { unitNumber: 'U-103', unitType: 'apartment', floor: 1 },
      ],
    } as any);

    const unitCreatedCalls = mocks.emitterService.emit.mock.calls.filter(
      ([type]: [string]) => type === EventTypes.UNIT_CREATED
    );
    expect(unitCreatedCalls).toHaveLength(3);
  });

  it('should still emit UNIT_BATCH_CREATED alongside per-unit events', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);
    mocks.propertyUnitDAO.insert
      .mockReturnValueOnce(Promise.resolve(makeCreatedUnit('U-101')))
      .mockReturnValueOnce(Promise.resolve(makeCreatedUnit('U-102')));

    await service.addPropertyUnit(makeContext(2) as any, {
      units: [
        { unitNumber: 'U-101', unitType: 'apartment', floor: 1 },
        { unitNumber: 'U-102', unitType: 'apartment', floor: 1 },
      ],
    } as any);

    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.UNIT_BATCH_CREATED,
      expect.objectContaining({
        unitsCreated: 2,
        unitsFailed: 0,
      })
    );
  });

  it('should NOT emit UNIT_CREATED for failed units', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);
    mocks.unitNumberingService.validateUnitNumberUpdate
      .mockReturnValueOnce({ isValid: true })
      .mockReturnValueOnce({ isValid: false, message: 'Duplicate' });
    mocks.propertyUnitDAO.insert.mockReturnValue(
      Promise.resolve(makeCreatedUnit('U-101'))
    );

    await service.addPropertyUnit(makeContext(2) as any, {
      units: [
        { unitNumber: 'U-101', unitType: 'apartment', floor: 1 },
        { unitNumber: 'U-102', unitType: 'apartment', floor: 1 },
      ],
    } as any);

    const unitCreatedCalls = mocks.emitterService.emit.mock.calls.filter(
      ([type]: [string]) => type === EventTypes.UNIT_CREATED
    );
    expect(unitCreatedCalls).toHaveLength(1);
  });
});
