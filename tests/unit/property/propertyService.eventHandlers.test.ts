import { Types } from 'mongoose';
import { PropertyService } from '@services/property/property.service';
import { EventTypes } from '@interfaces/events.interface';

const createMockDependencies = () => ({
  propertyDAO: {
    findById: jest.fn(),
    update: jest.fn(),
  },
  propertyUnitDAO: {
    findFirst: jest.fn(),
  },
  profileDAO: {
    findFirst: jest.fn(),
  },
  clientDAO: {
    getClientByCuid: jest.fn(),
  },
  userDAO: {
    findFirst: jest.fn(),
  },
  propertyCache: {
    invalidatePropertyLists: jest.fn(),
  },
  propertyQueue: {
    addPropertyApprovalJob: jest.fn(),
  },
  uploadQueue: {
    addJob: jest.fn(),
  },
  emitterService: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  },
  geoCoderService: {
    geocode: jest.fn(),
  },
  propertyCsvProcessor: {
    processFile: jest.fn(),
  },
  mediaUploadService: {
    uploadFiles: jest.fn(),
  },
  notificationService: {
    sendNotification: jest.fn(),
  },
});

describe('PropertyService - Event Handlers', () => {
  let service: PropertyService;
  let mockDeps: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    mockDeps = createMockDependencies();
    service = new PropertyService(mockDeps as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('setupEventListeners', () => {
    it('should register LEASE_ESIGNATURE_COMPLETED event listener', () => {
      const calls = mockDeps.emitterService.on.mock.calls;
      const leaseActivatedCall = calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      );

      expect(leaseActivatedCall).toBeDefined();
      expect(leaseActivatedCall![1]).toBeInstanceOf(Function);
    });
  });

  describe('handleLeaseActivated', () => {
    const leaseId = new Types.ObjectId().toString();
    const propertyId = new Types.ObjectId().toString();
    const propertyUnitId = new Types.ObjectId().toString();

    it('should skip update when propertyUnitId is provided (unit-based lease)', async () => {
      const payload = {
        leaseId,
        propertyId,
        propertyUnitId,
      };

      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      await handler(payload);

      expect(mockDeps.propertyDAO.findById).not.toHaveBeenCalled();
      expect(mockDeps.propertyDAO.update).not.toHaveBeenCalled();
    });

    it('should mark property as occupied when no propertyUnitId (direct property lease)', async () => {
      const mockProperty = {
        _id: propertyId,
        occupancyStatus: 'vacant',
      };

      mockDeps.propertyDAO.findById.mockResolvedValue(mockProperty);
      mockDeps.propertyDAO.update.mockResolvedValue(true);

      const payload = {
        leaseId,
        propertyId,
        propertyUnitId: undefined,
      };

      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      await handler(payload);

      expect(mockDeps.propertyDAO.findById).toHaveBeenCalledWith(propertyId);
      expect(mockDeps.propertyDAO.update).toHaveBeenCalledWith(propertyId, {
        occupancyStatus: 'occupied',
        updatedAt: expect.any(Date),
      });
    });

    it('should skip update if property already occupied (idempotency)', async () => {
      const mockProperty = {
        _id: propertyId,
        occupancyStatus: 'occupied',
      };

      mockDeps.propertyDAO.findById.mockResolvedValue(mockProperty);

      const payload = {
        leaseId,
        propertyId,
        propertyUnitId: null,
      };

      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      await handler(payload);

      expect(mockDeps.propertyDAO.findById).toHaveBeenCalledWith(propertyId);
      expect(mockDeps.propertyDAO.update).not.toHaveBeenCalled();
    });

    it('should handle case when property is not found', async () => {
      mockDeps.propertyDAO.findById.mockResolvedValue(null);

      const payload = {
        leaseId,
        propertyId,
        propertyUnitId: undefined,
      };

      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      await handler(payload);

      expect(mockDeps.propertyDAO.findById).toHaveBeenCalledWith(propertyId);
      expect(mockDeps.propertyDAO.update).not.toHaveBeenCalled();
      // Should not throw error
    });

    it('should handle empty string propertyUnitId as direct property lease', async () => {
      const mockProperty = {
        _id: propertyId,
        occupancyStatus: 'vacant',
      };

      mockDeps.propertyDAO.findById.mockResolvedValue(mockProperty);
      mockDeps.propertyDAO.update.mockResolvedValue(true);

      const payload = {
        leaseId,
        propertyId,
        propertyUnitId: '',
      };

      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      await handler(payload);

      // Empty string is falsy, so should process as direct property lease
      expect(mockDeps.propertyDAO.findById).toHaveBeenCalledWith(propertyId);
      expect(mockDeps.propertyDAO.update).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockDeps.propertyDAO.findById.mockRejectedValue(new Error('Database error'));

      const payload = {
        leaseId,
        propertyId,
        propertyUnitId: undefined,
      };

      const handler = mockDeps.emitterService.on.mock.calls.find(
        (call) => call[0] === EventTypes.LEASE_ESIGNATURE_COMPLETED
      )?.[1];

      // Should not throw - errors should be caught and logged
      await expect(handler(payload)).resolves.not.toThrow();
    });
  });
});
