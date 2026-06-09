import { Types } from 'mongoose';
import { BadRequestError } from '@shared/customErrors';
import { IRequestContext } from '@interfaces/utils.interface';
import { PropertyUnitService } from '@services/property/propertyUnit.service';

describe('PropertyUnitService — Subscription Unit Limit Enforcement', () => {
  let propertyUnitService: PropertyUnitService;
  let mockSubscriptionDAO: any;
  let mockPropertyDAO: any;
  let mockPropertyUnitDAO: any;
  let mockEmitterService: any;

  const testCuid = 'test-client-cuid';
  const testPid = 'test-property-pid';
  const testUserId = new Types.ObjectId().toString();

  const mockSession = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    abortTransaction: jest.fn(),
    endSession: jest.fn(),
  };

  const createMockContext = (cuid: string, pid: string): IRequestContext =>
    ({
      request: {
        params: { cuid, pid },
        url: `/api/v1/properties/${pid}/units`,
        method: 'POST',
        path: `/api/v1/properties/${pid}/units`,
        query: {},
      },
      currentuser: { sub: testUserId },
      requestId: 'req-test-123',
      timestamp: new Date(),
    }) as any;

  beforeEach(() => {
    mockSubscriptionDAO = {
      findFirst: jest.fn(),
    };

    mockPropertyDAO = {
      findFirst: jest.fn().mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          id: new Types.ObjectId().toString(),
          pid: testPid,
          cuid: testCuid,
          maxAllowedUnits: 50,
        })
      ),
      canAddUnitToProperty: jest.fn().mockReturnValue(
        Promise.resolve({
          canAdd: true,
          currentCount: 0,
          maxCapacity: 50,
        })
      ),
      getPropertyUnits: jest.fn().mockReturnValue(
        Promise.resolve({ items: [], pagination: { total: 0 } })
      ),
      syncPropertyOccupancyWithUnits: jest.fn(),
    };

    mockPropertyUnitDAO = {
      startSession: jest.fn().mockReturnValue(Promise.resolve(mockSession)),
      withTransaction: jest.fn((session, callback) => callback(session)),
      insert: jest.fn().mockImplementation((data) =>
        Promise.resolve({
          _id: new Types.ObjectId(),
          ...data,
        })
      ),
      list: jest.fn().mockReturnValue(
        Promise.resolve({ items: [], pagination: { total: 0 } })
      ),
    };

    mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    const mockUnitNumberingService = {
      validateUnitNumberUpdate: jest.fn().mockReturnValue({ isValid: true }),
      validatePatternConsistency: jest.fn().mockReturnValue({ isConsistent: true }),
      validateUnitNumberFloorCorrelation: jest.fn().mockReturnValue({ isValid: true }),
    };

    propertyUnitService = new PropertyUnitService({
      subscriptionDAO: mockSubscriptionDAO,
      propertyDAO: mockPropertyDAO,
      propertyUnitDAO: mockPropertyUnitDAO,
      emitterService: mockEmitterService,
      unitNumberingService: mockUnitNumberingService,
      propertyCache: {
        invalidateProperty: jest.fn().mockReturnValue(Promise.resolve()),
      } as any,
      queueFactory: {} as any,
      profileDAO: {} as any,
      clientDAO: {} as any,
      leaseDAO: {} as any,
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createUnitsDirectly — subscription unit limit', () => {
    it('should reject when subscription unit limit is reached', async () => {
      mockSubscriptionDAO.findFirst.mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          cuid: testCuid,
          planName: 'essential',
          currentUnits: 10,
        })
      );

      const cxt = createMockContext(testCuid, testPid);
      const data = {
        units: [
          { unitNumber: '101', floor: 1, unitType: 'apartment', status: 'available' },
        ],
        cuid: testCuid,
        pid: testPid,
      };

      await expect(
        propertyUnitService.addPropertyUnit(cxt, data as any)
      ).rejects.toThrow(/Unit limit reached/);

      // Should NOT proceed to create units
      expect(mockPropertyUnitDAO.insert).not.toHaveBeenCalled();
    });

    it('should reject when batch would exceed subscription unit limit', async () => {
      mockSubscriptionDAO.findFirst.mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          cuid: testCuid,
          planName: 'essential',
          currentUnits: 8, // 8 of 10 used
        })
      );

      const cxt = createMockContext(testCuid, testPid);
      const data = {
        units: [
          { unitNumber: '101', floor: 1, unitType: 'apartment', status: 'available' },
          { unitNumber: '102', floor: 1, unitType: 'apartment', status: 'available' },
          { unitNumber: '103', floor: 1, unitType: 'apartment', status: 'available' },
        ],
        cuid: testCuid,
        pid: testPid,
      };

      await expect(
        propertyUnitService.addPropertyUnit(cxt, data as any)
      ).rejects.toThrow(/Cannot add 3 units.*2 remaining/);
    });

    it('should allow units when within subscription limit', async () => {
      mockSubscriptionDAO.findFirst.mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          cuid: testCuid,
          planName: 'growth',
          currentUnits: 10, // 10 of 50 used
        })
      );

      const cxt = createMockContext(testCuid, testPid);
      const data = {
        units: [
          { unitNumber: '101', floor: 1, unitType: 'apartment', status: 'available' },
        ],
        cuid: testCuid,
        pid: testPid,
      };

      const result = await propertyUnitService.addPropertyUnit(cxt, data as any);
      expect(result.success).toBe(true);
      expect(mockPropertyUnitDAO.insert).toHaveBeenCalled();
    });

    it('should skip subscription check when no subscription found', async () => {
      mockSubscriptionDAO.findFirst.mockReturnValue(Promise.resolve(null));

      const cxt = createMockContext(testCuid, testPid);
      const data = {
        units: [
          { unitNumber: '101', floor: 1, unitType: 'apartment', status: 'available' },
        ],
        cuid: testCuid,
        pid: testPid,
      };

      const result = await propertyUnitService.addPropertyUnit(cxt, data as any);
      expect(result.success).toBe(true);
    });
  });

  describe('importUnitsFromCsv — early subscription check', () => {
    it('should reject CSV import when already at subscription unit limit', async () => {
      mockSubscriptionDAO.findFirst.mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          cuid: testCuid,
          planName: 'essential',
          currentUnits: 10,
        })
      );

      const cxt = createMockContext(testCuid, testPid);
      const csvFile = {
        path: '/tmp/units.csv',
        fileSize: 1024,
        mimetype: 'text/csv',
        originalname: 'units.csv',
      };

      await expect(
        propertyUnitService.importUnitsFromCsv(cxt, csvFile as any)
      ).rejects.toThrow(/Unit limit reached/);

      // Should clean up CSV file
      expect(mockEmitterService.emit).toHaveBeenCalled();
    });

  });
});
