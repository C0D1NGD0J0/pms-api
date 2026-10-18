import { Types } from 'mongoose';
import { PropertyUnit, Property } from '@models/index';
import { EventTypes } from '@interfaces/events.interface';
import { PropertyUnitDAO, PropertyDAO } from '@dao/index';
import { PropertyUnitWorker } from '@workers/propertyUnit.worker';
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';
import {
  createTestPropertyUnit,
  createTestProperty,
  clearTestDatabase,
  createTestClient,
} from '@tests/helpers';

const mockEmitterService = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };

const managedBy = new Types.ObjectId();
const buildUnit = (unitNumber: string) => ({
  unitNumber,
  managedBy,
  unitType: 'residential',
  floor: 1,
  status: 'available',
  specifications: { totalArea: 800, bedrooms: 2, bathrooms: 1 },
  fees: { rentAmount: 1500, currency: 'USD' },
});

describe('PropertyUnitWorker (integration)', () => {
  let worker: PropertyUnitWorker;
  let client: any;
  let property: any;
  const userId = new Types.ObjectId().toString();

  const runBatch = (unitNumbers: string[]) =>
    worker.processUnitBatchCreation({
      id: 'job-1',
      progress: jest.fn(),
      data: {
        units: unitNumbers.map(buildUnit),
        pid: property.pid,
        cuid: client.cuid,
        userId,
      },
    } as any);

  beforeAll(() => {
    const propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
    worker = new PropertyUnitWorker({
      propertyDAO: new PropertyDAO({ propertyModel: Property, propertyUnitDAO }),
      propertyUnitDAO,
      emitterService: mockEmitterService as any,
      subscriptionDAO: { findFirst: jest.fn().mockResolvedValue(null) } as any,
      unitNumberingService: new UnitNumberingService(),
      sseService: { sendToUser: jest.fn().mockResolvedValue(undefined) } as any,
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
    client = await createTestClient();
    property = await createTestProperty(client.cuid, client._id, { maxAllowedUnits: 20 });
  });

  it('creates the other units when one unit number already exists on the property', async () => {
    await createTestPropertyUnit(client.cuid, property._id, { unitNumber: '101' });

    const result = await runBatch(['101', '102', '103', '104', '105', '106']);

    expect(result.data.successfullyCreated).toBe(5);
    expect(result.data.errors).toEqual([
      expect.objectContaining({ unitIndex: 0, unitNumber: '101', error: expect.any(String) }),
    ]);
    const saved = await PropertyUnit.find({ propertyId: property._id, deletedAt: null }).lean();
    expect(saved.map((u) => u.unitNumber).sort()).toEqual([
      '101',
      '102',
      '103',
      '104',
      '105',
      '106',
    ]);
  });

  it('reports a unit number repeated within the batch instead of aborting the batch', async () => {
    const result = await runBatch(['101', '102', '102', '103', '104', '105']);

    expect(result.data.successfullyCreated).toBe(5);
    expect(result.data.errors).toEqual([
      expect.objectContaining({ unitIndex: 2, unitNumber: '102' }),
    ]);
  });

  it('emits UNIT_BATCH_CREATED so the unit counter and property cache are updated', async () => {
    await runBatch(['101', '102', '103', '104', '105', '106']);

    expect(mockEmitterService.emit).toHaveBeenCalledWith(EventTypes.UNIT_BATCH_CREATED, {
      propertyId: property._id.toString(),
      propertyPid: property.pid,
      cuid: client.cuid,
      userId,
      unitsCreated: 6,
      unitsFailed: 0,
    });
    expect(mockEmitterService.emit).not.toHaveBeenCalledWith(
      EventTypes.PROPERTY_CREATED,
      expect.anything()
    );
  });

  it('syncs the property occupancy with the committed units', async () => {
    await runBatch(['101', '102', '103', '104', '105', '106']);

    const saved = await Property.findById(property._id).lean();
    expect(saved!.occupancyStatus).toBe('vacant');
    expect(saved!.lastModifiedBy?.toString()).toBe(userId);
  });

  it('does not emit UNIT_BATCH_CREATED when every unit fails', async () => {
    await createTestPropertyUnit(client.cuid, property._id, { unitNumber: '101' });

    const result = await runBatch(['101']);

    expect(result.success).toBe(false);
    expect(mockEmitterService.emit).not.toHaveBeenCalledWith(
      EventTypes.UNIT_BATCH_CREATED,
      expect.anything()
    );
  });
});
