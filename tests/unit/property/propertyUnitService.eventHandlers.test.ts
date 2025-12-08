import { Types } from 'mongoose';
import { EventTypes } from '@interfaces/events.interface';
import { PropertyUnitService } from '@services/property/propertyUnit.service';

const createMockDependencies = () => ({
  propertyUnitDAO: {
    findById: jest.fn(),
    update: jest.fn(),
  },
  propertyDAO: {
    findFirst: jest.fn(),
  },
  profileDAO: {
    findFirst: jest.fn(),
  },
  clientDAO: {
    getClientByCuid: jest.fn(),
  },
  propertyCache: {
    invalidatePropertyLists: jest.fn(),
  },
  propertyQueue: {
    addPropertyApprovalJob: jest.fn(),
  },
  propertyUnitQueue: {
    addJob: jest.fn(),
  },
  emitterService: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  },
  unitNumberingService: {
    generateUnitNumber: jest.fn(),
  },
});

describe('PropertyUnitService - Event Handlers', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let service: PropertyUnitService;
  let mockDeps: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mockDeps = createMockDependencies();
    service = new PropertyUnitService(mockDeps as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initializeEventListeners', () => {
    it('should register LEASE_ESIGNATURE_COMPLETED event listener', () => {
      expect(mockDeps.emitterService.on).toHaveBeenCalledWith(
        EventTypes.LEASE_ESIGNATURE_COMPLETED,
        expect.any(Function)
      );
    });
  });

  describe('handleLeaseActivated', () => {
    const leaseId = new Types.ObjectId().toString();
    const propertyUnitId = new Types.ObjectId().toString();
    const tenantId = new Types.ObjectId().toString();

    it('should skip update when propertyUnitId is not provided', async () => {
      const payload = {
        leaseId,
        propertyUnitId: undefined,
        tenantId,
      };

      // Trigger the event handler
      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      await handler(payload);

      expect(mockDeps.propertyUnitDAO.findById).not.toHaveBeenCalled();
    });

    it('should skip update when propertyUnitId is empty string', async () => {
      const payload = {
        leaseId,
        propertyUnitId: '',
        tenantId,
      };

      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      await handler(payload);

      expect(mockDeps.propertyUnitDAO.findById).not.toHaveBeenCalled();
    });

    it('should mark unit as occupied when propertyUnitId is provided', async () => {
      const mockUnit = {
        _id: propertyUnitId,
        status: 'available',
        markUnitAsOccupied: jest.fn().mockResolvedValue(true),
      };

      mockDeps.propertyUnitDAO.findById.mockResolvedValue(mockUnit);

      const payload = {
        leaseId,
        propertyUnitId,
        tenantId,
      };

      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      await handler(payload);

      expect(mockDeps.propertyUnitDAO.findById).toHaveBeenCalledWith(propertyUnitId);
      expect(mockUnit.markUnitAsOccupied).toHaveBeenCalledWith(leaseId, tenantId);
    });

    it('should skip update if unit already marked as occupied with same lease (idempotency)', async () => {
      const mockUnit = {
        _id: propertyUnitId,
        status: 'occupied',
        currentLease: new Types.ObjectId(leaseId),
        markUnitAsOccupied: jest.fn(),
      };

      mockDeps.propertyUnitDAO.findById.mockResolvedValue(mockUnit);

      const payload = {
        leaseId,
        propertyUnitId,
        tenantId,
      };

      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      await handler(payload);

      expect(mockDeps.propertyUnitDAO.findById).toHaveBeenCalledWith(propertyUnitId);
      expect(mockUnit.markUnitAsOccupied).not.toHaveBeenCalled();
    });

    it('should handle case when unit is not found', async () => {
      mockDeps.propertyUnitDAO.findById.mockResolvedValue(null);

      const payload = {
        leaseId,
        propertyUnitId,
        tenantId,
      };

      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      await handler(payload);

      expect(mockDeps.propertyUnitDAO.findById).toHaveBeenCalledWith(propertyUnitId);
      // Should not throw error
    });

    it('should handle errors gracefully', async () => {
      mockDeps.propertyUnitDAO.findById.mockRejectedValue(new Error('Database error'));

      const payload = {
        leaseId,
        propertyUnitId,
        tenantId,
      };

      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      // Should not throw - errors should be caught and logged
      await expect(handler(payload)).resolves.not.toThrow();
    });
  });
});
