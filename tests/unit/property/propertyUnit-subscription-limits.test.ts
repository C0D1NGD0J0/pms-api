import { Types } from 'mongoose';
import { IRequestContext } from '@interfaces/utils.interface';
import { BadRequestError as _BadRequestError } from '@shared/customErrors';
import { PropertyUnitService } from '@services/property/propertyUnit.service';
import { PropertyUnitCsvProcessor } from '@services/csv/propertyUnitCsvProcessor';
import { subscriptionPlanConfig } from '@services/subscription/subscription_plans.config';

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
      getPropertyUnits: jest
        .fn()
        .mockReturnValue(Promise.resolve({ items: [], pagination: { total: 0 } })),
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
      list: jest.fn().mockReturnValue(Promise.resolve({ items: [], pagination: { total: 0 } })),
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
          resourceTracker: { propertyCount: 0, unitCount: 10, seatCount: 0 },
        })
      );

      const cxt = createMockContext(testCuid, testPid);
      const data = {
        units: [{ unitNumber: '101', floor: 1, unitType: 'apartment', status: 'available' }],
        cuid: testCuid,
        pid: testPid,
      };

      await expect(propertyUnitService.addPropertyUnit(cxt, data as any)).rejects.toThrow(
        /Unit limit reached/
      );

      // Should NOT proceed to create units
      expect(mockPropertyUnitDAO.insert).not.toHaveBeenCalled();
    });

    it('should reject when batch would exceed subscription unit limit', async () => {
      mockSubscriptionDAO.findFirst.mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          cuid: testCuid,
          planName: 'essential',
          resourceTracker: { propertyCount: 0, unitCount: 3, seatCount: 0 }, // 3 of 5 used
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

      await expect(propertyUnitService.addPropertyUnit(cxt, data as any)).rejects.toThrow(
        /Cannot add 3 units.*2 remaining/
      );
    });

    it('should allow units when within subscription limit', async () => {
      mockSubscriptionDAO.findFirst.mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          cuid: testCuid,
          planName: 'growth',
          resourceTracker: { propertyCount: 0, unitCount: 10, seatCount: 0 }, // 10 of 50 used
        })
      );

      const cxt = createMockContext(testCuid, testPid);
      const data = {
        units: [{ unitNumber: '101', floor: 1, unitType: 'apartment', status: 'available' }],
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
        units: [{ unitNumber: '101', floor: 1, unitType: 'apartment', status: 'available' }],
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
          resourceTracker: { propertyCount: 0, unitCount: 10, seatCount: 0 },
        })
      );

      const cxt = createMockContext(testCuid, testPid);
      const csvFile = {
        path: '/tmp/units.csv',
        fileSize: 1024,
        mimetype: 'text/csv',
        originalname: 'units.csv',
      };

      await expect(propertyUnitService.importUnitsFromCsv(cxt, csvFile as any)).rejects.toThrow(
        /Unit limit reached/
      );

      // Should clean up CSV file
      expect(mockEmitterService.emit).toHaveBeenCalled();
    });
  });
  describe('importUnitsFromCsv — saving the validated units', () => {
    const csvFile = { path: '/tmp/units.csv', fileSize: 1024 } as any;
    const managerId = new Types.ObjectId();

    beforeEach(() => {
      mockSubscriptionDAO.findFirst.mockResolvedValue(null);
      mockPropertyDAO.findFirst.mockResolvedValue({
        id: new Types.ObjectId().toString(),
        cuid: testCuid,
        pid: testPid,
        managedBy: managerId,
      });
      jest.spyOn(PropertyUnitCsvProcessor.prototype, 'validateCsv').mockResolvedValue({
        validUnits: [{ unitNumber: '101' }, { unitNumber: '102' }] as any,
        totalRows: 2,
        finishedAt: new Date(),
        errors: null,
      });
    });

    afterEach(() => jest.restoreAllMocks());

    it("gives units without a manager the property's manager (managedBy is required)", async () => {
      const createSpy = jest
        .spyOn(propertyUnitService as any, 'createUnitsDirectly')
        .mockResolvedValue({ data: [], errors: {}, message: 'All 2 units created successfully' });

      await propertyUnitService.importUnitsFromCsv(createMockContext(testCuid, testPid), csvFile);

      const { units } = createSpy.mock.calls[0][1] as any;
      expect(units.map((u: any) => u.managedBy.toString())).toEqual([
        managerId.toString(),
        managerId.toString(),
      ]);
    });

    it('reports the real created/failed counts instead of a blanket success message', async () => {
      jest.spyOn(propertyUnitService as any, 'createUnitsDirectly').mockResolvedValue({
        data: [{ unitNumber: '101' }],
        errors: { 'unit-1': { unitIndex: 1, unitNumber: '102', error: 'Duplicate unit number' } },
        message: '1 units created successfully, 1 failed',
      });

      const result = await propertyUnitService.importUnitsFromCsv(
        createMockContext(testCuid, testPid),
        csvFile
      );

      expect(result.message).toBe('1 units created successfully, 1 failed');
      // Same shape a CSV job notification carries, so the upload modal can show it directly
      expect(result.data).toEqual({
        totalRows: 2,
        createdCount: 1,
        errorCount: 1,
        errors: [
          { rowNumber: 2, errors: [{ field: 'unitNumber', error: 'Duplicate unit number' }] },
        ],
      });
    });
  });

  describe('unarchivePropertyUnit — subscription unit limit', () => {
    const unarchiveContext = () =>
      ({
        ...createMockContext(testCuid, testPid),
        request: {
          ...createMockContext(testCuid, testPid).request,
          params: { cuid: testCuid, pid: testPid, puid: 'UNIT-1' },
        },
      }) as any;

    const arrangeArchivedUnit = (activeUnits: number, maxUnits: number) => {
      jest.spyOn(subscriptionPlanConfig, 'getConfig').mockReturnValue({
        limits: { maxUnits },
      } as any);
      mockSubscriptionDAO.findFirst.mockResolvedValue({ planName: 'enterprise' });
      mockPropertyUnitDAO.findFirst = jest
        .fn()
        .mockResolvedValue({ id: new Types.ObjectId().toString(), puid: 'UNIT-1' });
      mockPropertyUnitDAO.list.mockResolvedValue({ items: [], pagination: { total: activeUnits } });
      mockPropertyUnitDAO.updateById = jest.fn().mockResolvedValue({ puid: 'UNIT-1' });
    };

    afterEach(() => jest.restoreAllMocks());

    it('should unarchive when the plan allows unlimited (-1) units', async () => {
      arrangeArchivedUnit(750, -1);

      const result = await propertyUnitService.unarchivePropertyUnit(unarchiveContext());

      expect(result.success).toBe(true);
      expect(mockPropertyUnitDAO.updateById).toHaveBeenCalled();
    });

    it('should still reject when a finite unit limit is reached', async () => {
      arrangeArchivedUnit(5, 5);

      await expect(propertyUnitService.unarchivePropertyUnit(unarchiveContext())).rejects.toThrow(
        'Cannot unarchive unit'
      );
      expect(mockPropertyUnitDAO.updateById).not.toHaveBeenCalled();
    });
  });
});
