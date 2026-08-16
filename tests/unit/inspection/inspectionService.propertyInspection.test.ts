import { Types } from 'mongoose';
import { jest } from '@jest/globals';
import { InspectionService } from '@services/inspection/inspection.service';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';
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
  findById: jest.fn() as any,
  list: jest.fn() as any,
};

const mockEmitterService = {
  emit: jest.fn() as any,
  on: jest.fn() as any,
};

const mockEmailQueue = {
  addToEmailQueue: jest.fn() as any,
} as any;

const CUID = 'test-client-cuid';
const USER_ID = new Types.ObjectId().toString();
const APPROVER_ID = new Types.ObjectId().toString();
const PROPERTY_ID = new Types.ObjectId();
const PROPERTY_PID = 'prop-abc123';
const UNIT_ID = new Types.ObjectId();
const UNIT_PUID = 'unit-xyz789';
const IUID = 'insp-prop-001';

const makeProperty = (overrides: Record<string, any> = {}) => ({
  _id: PROPERTY_ID,
  pid: PROPERTY_PID,
  cuid: CUID,
  operationalStatus: 'active',
  deletedAt: null,
  ...overrides,
});

const makeUnit = (overrides: Record<string, any> = {}) => ({
  _id: UNIT_ID,
  puid: UNIT_PUID,
  propertyId: PROPERTY_ID,
  status: PropertyUnitStatusEnum.AVAILABLE,
  deletedAt: null,
  ...overrides,
});

const makeInspection = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  iuid: IUID,
  cuid: CUID,
  type: InspectionType.ROUTINE,
  status: InspectionStatus.SCHEDULED,
  propertyId: PROPERTY_ID,
  inspectorUid: USER_ID,
  scheduledDate: new Date(),
  rooms: [],
  media: [],
  ...overrides,
});

let service: InspectionService;

beforeEach(() => {
  jest.clearAllMocks();

  mockUserDAO.findById.mockResolvedValue({ fullname: 'Test User', email: 'test@test.com' });
  mockUserDAO.list.mockResolvedValue({ items: [] });

  service = new InspectionService({
    inspectionDAO: mockInspectionDAO as any,
    propertyUnitDAO: mockPropertyUnitDAO as any,
    leaseDAO: mockLeaseDAO as any,
    propertyDAO: mockPropertyDAO as any,
    userDAO: mockUserDAO as any,
    emitterService: mockEmitterService as any,
    emailQueue: mockEmailQueue,
  });
});

describe('InspectionService — Property-Only Inspections (Path B)', () => {
  // ─── scheduleInspection — Property Path ───────────────────────────────────

  describe('scheduleInspection — Property Path', () => {
    it('schedules routine inspection for property without lease', async () => {
      const property = makeProperty();
      mockPropertyDAO.findFirst.mockResolvedValue(property);
      mockInspectionDAO.findFirst.mockResolvedValue(null);
      mockUserDAO.findFirst.mockResolvedValue({ uid: USER_ID });
      mockInspectionDAO.insert.mockImplementation((data: any) =>
        Promise.resolve({ ...data, iuid: IUID })
      );

      const result = await service.scheduleInspection(CUID, USER_ID, {
        type: InspectionType.ROUTINE,
        propertyId: PROPERTY_PID,
        scheduledDate: new Date().toISOString(),
      });

      expect(result.success).toBe(true);

      // Inspection created with propertyId, no leaseId
      const insertData = mockInspectionDAO.insert.mock.calls[0][0];
      expect(insertData.propertyId).toEqual(PROPERTY_ID);
      expect(insertData.leaseId).toBeUndefined();

      // previousOperationalStatus saved
      expect(insertData.previousOperationalStatus).toBe('active');

      // Property status set to maintenance
      expect(mockPropertyDAO.updateById).toHaveBeenCalledWith(PROPERTY_ID.toString(), {
        operationalStatus: 'maintenance',
      });
    });

    it('schedules routine inspection for specific unit', async () => {
      const property = makeProperty();
      const unit = makeUnit();
      mockPropertyDAO.findFirst.mockResolvedValue(property);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(unit);
      mockInspectionDAO.findFirst.mockResolvedValue(null);
      mockUserDAO.findFirst.mockResolvedValue({ uid: USER_ID });
      mockInspectionDAO.insert.mockImplementation((data: any) =>
        Promise.resolve({ ...data, iuid: IUID })
      );

      const result = await service.scheduleInspection(CUID, USER_ID, {
        type: InspectionType.ROUTINE,
        propertyId: PROPERTY_PID,
        propertyUnitId: UNIT_PUID,
        scheduledDate: new Date().toISOString(),
      });

      expect(result.success).toBe(true);

      // Unit status set to maintenance
      expect(mockPropertyUnitDAO.updateById).toHaveBeenCalledWith(UNIT_ID.toString(), {
        status: PropertyUnitStatusEnum.MAINTENANCE,
      });

      // Property status NOT changed (only unit)
      expect(mockPropertyDAO.updateById).not.toHaveBeenCalled();

      // previousOperationalStatus saved from unit
      const insertData = mockInspectionDAO.insert.mock.calls[0][0];
      expect(insertData.previousOperationalStatus).toBe(PropertyUnitStatusEnum.AVAILABLE);
      expect(insertData.propertyUnitId).toEqual(UNIT_ID);
    });

    it('rejects move-out type without lease', async () => {
      await expect(
        service.scheduleInspection(CUID, USER_ID, {
          type: InspectionType.MOVE_OUT,
          propertyId: PROPERTY_PID,
          scheduledDate: new Date().toISOString(),
        })
      ).rejects.toThrow(/Only routine inspections can be scheduled without a lease/);
    });

    it('rejects move-in type without lease', async () => {
      await expect(
        service.scheduleInspection(CUID, USER_ID, {
          type: InspectionType.MOVE_IN,
          propertyId: PROPERTY_PID,
          scheduledDate: new Date().toISOString(),
        })
      ).rejects.toThrow(/Only routine inspections can be scheduled without a lease/);
    });

    it('rejects duplicate active routine on same property', async () => {
      const property = makeProperty();
      mockPropertyDAO.findFirst.mockResolvedValue(property);
      mockInspectionDAO.findFirst.mockResolvedValue({
        iuid: 'existing-insp',
        status: InspectionStatus.SCHEDULED,
      });

      await expect(
        service.scheduleInspection(CUID, USER_ID, {
          type: InspectionType.ROUTINE,
          propertyId: PROPERTY_PID,
          scheduledDate: new Date().toISOString(),
        })
      ).rejects.toThrow(/routine inspection is already active for this property/);
    });

    it('rejects if neither leaseId nor propertyId provided', async () => {
      await expect(
        service.scheduleInspection(CUID, USER_ID, {
          type: InspectionType.ROUTINE,
          scheduledDate: new Date().toISOString(),
        })
      ).rejects.toThrow(/Either leaseId or propertyId is required/);
    });
  });

  // ─── Status Revert on Completion ──────────────────────────────────────────

  describe('Status revert on completion', () => {
    it('reverts property to previous status on approval when still maintenance', async () => {
      const inspection = makeInspection({
        status: InspectionStatus.PENDING_REVIEW,
        previousOperationalStatus: 'active',
        propertyId: PROPERTY_ID,
        propertyUnitId: undefined,
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockResolvedValue({
        ...inspection,
        status: InspectionStatus.APPROVED,
      });

      // Property is still maintenance — should revert
      mockPropertyDAO.findFirst.mockResolvedValue(
        makeProperty({ operationalStatus: 'maintenance' })
      );

      await service.approveInspection(CUID, IUID, APPROVER_ID, 'admin');

      expect(mockPropertyDAO.updateById).toHaveBeenCalledWith(PROPERTY_ID.toString(), {
        operationalStatus: 'active',
      });
    });

    it('skips revert when PM manually changed status', async () => {
      const inspection = makeInspection({
        status: InspectionStatus.PENDING_REVIEW,
        previousOperationalStatus: 'active',
        propertyId: PROPERTY_ID,
        propertyUnitId: undefined,
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockResolvedValue({
        ...inspection,
        status: InspectionStatus.APPROVED,
      });

      // PM changed status to 'inactive' — should NOT revert
      mockPropertyDAO.findFirst.mockResolvedValue(makeProperty({ operationalStatus: 'inactive' }));

      await service.approveInspection(CUID, IUID, APPROVER_ID, 'admin');

      expect(mockPropertyDAO.updateById).not.toHaveBeenCalled();
    });
  });
});
