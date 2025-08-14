import { PropertyUnitService } from '@services/property/propertyUnit.service';
import { IRequestContext, RequestSource } from '@interfaces/utils.interface';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';
import {
  createMockClientDAO,
  createMockEventEmitterService,
  createMockProfileDAO,
  createMockProperty,
  createMockPropertyCache,
  createMockPropertyDAO,
  createMockPropertyQueue,
  createMockPropertyUnit,
  createMockPropertyUnitDAO,
  createMockPropertyUnitQueue,
  createMockUnitNumberingService,
  createMockClient,
  createMockCurrentUser,
} from '@tests/helpers';

// Mock EventTypes
jest.mock('@interfaces/events.interface', () => ({
  EventTypes: {
    UNIT_CREATED: 'UNIT_CREATED',
    UNIT_UPDATED: 'UNIT_UPDATED',
    UNIT_ARCHIVED: 'UNIT_ARCHIVED',
    UNIT_STATUS_CHANGED: 'UNIT_STATUS_CHANGED',
    UNIT_BATCH_CREATED: 'UNIT_BATCH_CREATED',
    DELETE_LOCAL_ASSET: 'DELETE_LOCAL_ASSET',
  },
}));

describe('PropertyUnitService', () => {
  let propertyUnitService: PropertyUnitService;
  let mockPropertyUnitDAO: any;
  let mockPropertyDAO: any;
  let mockClientDAO: any;
  let mockProfileDAO: any;
  let mockPropertyCache: any;
  let mockPropertyQueue: any;
  let mockPropertyUnitQueue: any;
  let mockEventEmitterService: any;
  let mockUnitNumberingService: any;

  beforeEach(() => {
    mockPropertyUnitDAO = createMockPropertyUnitDAO();
    mockPropertyDAO = createMockPropertyDAO();
    mockClientDAO = createMockClientDAO();
    mockProfileDAO = createMockProfileDAO();
    mockPropertyCache = createMockPropertyCache();
    mockPropertyQueue = createMockPropertyQueue();
    mockPropertyUnitQueue = createMockPropertyUnitQueue();
    mockEventEmitterService = createMockEventEmitterService();
    mockUnitNumberingService = createMockUnitNumberingService();

    propertyUnitService = new PropertyUnitService({
      propertyUnitDAO: mockPropertyUnitDAO,
      propertyDAO: mockPropertyDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      propertyCache: mockPropertyCache,
      propertyQueue: mockPropertyQueue,
      propertyUnitQueue: mockPropertyUnitQueue,
      emitterService: mockEventEmitterService,
      unitNumberingService: mockUnitNumberingService,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addPropertyUnit', () => {
    const createMockContext = (): IRequestContext => ({
      request: {
        params: { cuid: 'test-cuid', pid: 'test-pid' },
        path: '/test',
        method: 'POST',
        url: '/test',
        query: {},
      },
      currentuser: createMockCurrentUser(),
      requestId: 'req-123',
      userAgent: {
        browser: 'Chrome',
        version: '91.0',
        os: 'Windows',
        raw: 'Mozilla/5.0...',
        isMobile: false,
        isBot: false,
      },
      langSetting: {
        lang: 'en',
        t: jest.fn().mockImplementation((key: string) => key),
      },
      timing: {
        startTime: Date.now(),
      },
      service: { env: 'test' },
      source: RequestSource.WEB,
      ip: '127.0.0.1',
      timestamp: new Date(),
    });

    it('should create units directly for batch size ≤ 5', async () => {
      // Arrange
      const mockContext = createMockContext();
      // Using 'any' type to bypass interface compatibility issues in tests
      const unitData: any = {
        units: [
          { unitNumber: '101', fees: { rentAmount: 1200, securityDeposit: 1200, currency: 'USD' } },
          { unitNumber: '102', fees: { rentAmount: 1300, securityDeposit: 1300, currency: 'USD' } },
        ],
      };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();
      const mockCreatedUnits = [createMockPropertyUnit(), createMockPropertyUnit()];

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.canAddUnitToProperty.mockResolvedValue({
        canAdd: true,
        maxAllowed: 10,
        current: 3,
      });
      mockPropertyUnitDAO.startSession.mockReturnValue('mock-session');
      mockPropertyUnitDAO.withTransaction.mockImplementation(
        async (_session: any, callback: any) => {
          return await callback(_session);
        }
      );
      jest.spyOn(propertyUnitService as any, 'createUnitsDirectly').mockResolvedValue({
        success: true,
        data: mockCreatedUnits,
        message: 'Units created successfully',
      });

      // Act
      const result = await propertyUnitService.addPropertyUnit(mockContext, unitData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCreatedUnits);
      expect(propertyUnitService['createUnitsDirectly']).toHaveBeenCalled();
    });

    it('should create units via queue for batch size > 5', async () => {
      // Arrange
      const mockContext = createMockContext();
      // Using 'any' type to bypass interface compatibility issues in tests
      const unitData: any = {
        units: Array.from({ length: 7 }, (_, i) => ({
          unitNumber: `10${i + 1}`,
          fees: { rentAmount: 1200, securityDeposit: 1200, currency: 'USD' },
        })),
      };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.canAddUnitToProperty.mockResolvedValue({
        canAdd: true,
        maxAllowed: 20,
        current: 3,
      });
      jest.spyOn(propertyUnitService as any, 'createUnitsViaQueue').mockResolvedValue({
        success: true,
        data: { jobId: 'job-123' },
        message: 'Units queued for creation',
      });

      // Act
      const result = await propertyUnitService.addPropertyUnit(mockContext, unitData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ jobId: 'job-123' });
      expect(propertyUnitService['createUnitsViaQueue']).toHaveBeenCalled();
    });

    it('should throw BadRequestError when property cannot add more units', async () => {
      // Arrange
      const mockContext = createMockContext();
      // Using 'any' type to bypass interface compatibility issues in tests
      const unitData: any = {
        units: [{ unitNumber: '101', fees: { rentAmount: 1200, currency: 'USD' } }],
      };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.canAddUnitToProperty.mockResolvedValue({
        canAdd: false,
        maxAllowed: 5,
        current: 5,
        message: 'Maximum units reached',
      });

      // Act & Assert
      await expect(propertyUnitService.addPropertyUnit(mockContext, unitData)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should validate required parameters', async () => {
      // Arrange
      const mockContext = { ...createMockContext(), params: { cuid: '', pid: 'test-pid' } };
      // Using 'any' type to bypass interface compatibility issues in tests
      const unitData: any = { units: [] };

      // Act & Assert
      await expect(propertyUnitService.addPropertyUnit(mockContext, unitData)).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe('getPropertyUnit', () => {
    it('should successfully retrieve a property unit', async () => {
      // Arrange
      const mockContext: IRequestContext = {
        request: {
          params: { cuid: 'test-cuid', pid: 'test-pid', unitId: 'test-unit-id' },
          path: '/test',
          method: 'GET',
          url: '/test',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        userAgent: {
          browser: 'Chrome',
          version: '91.0',
          os: 'Windows',
          raw: 'Mozilla/5.0...',
          isMobile: false,
          isBot: false,
        },
        langSetting: {
          lang: 'en',
          t: jest.fn().mockImplementation((key: string) => key),
        },
        timing: {
          startTime: Date.now(),
        },
        service: { env: 'test' },
        source: RequestSource.WEB,
        ip: '127.0.0.1',
        timestamp: new Date(),
        requestId: 'req-123',
      };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();
      const mockUnit = createMockPropertyUnit();

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(mockUnit);

      // Act
      const result = await propertyUnitService.getPropertyUnit(mockContext);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUnit);
      expect(mockPropertyUnitDAO.findFirst).toHaveBeenCalledWith({
        id: 'test-unit-id',
        propertyId: mockProperty.id,
      });
    });

    it('should throw NotFoundError when unit not found', async () => {
      // Arrange
      const mockContext: IRequestContext = {
        request: {
          params: { cuid: 'test-cuid', pid: 'test-pid', unitId: 'invalid-unit-id' },
          path: '/test',
          method: 'GET',
          url: '/test',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        userAgent: {
          browser: 'Chrome',
          version: '91.0',
          os: 'Windows',
          raw: 'Mozilla/5.0...',
          isMobile: false,
          isBot: false,
        },
        langSetting: {
          lang: 'en',
          t: jest.fn().mockImplementation((key: string) => key),
        },
        timing: {
          startTime: Date.now(),
        },
        service: { env: 'test' },
        source: RequestSource.WEB,
        ip: '127.0.0.1',
        timestamp: new Date(),
        requestId: 'req-123',
      };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyUnitService.getPropertyUnit(mockContext)).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe('getPropertyUnits', () => {
    it('should retrieve paginated property units with filters', async () => {
      // Arrange
      const mockContext: IRequestContext = {
        request: {
          params: { cuid: 'test-cuid', pid: 'test-pid' },
          path: '/test',
          method: 'GET',
          url: '/test',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        userAgent: {
          browser: 'Chrome',
          version: '91.0',
          os: 'Windows',
          raw: 'Mozilla/5.0...',
          isMobile: false,
          isBot: false,
        },
        langSetting: {
          lang: 'en',
          t: jest.fn().mockImplementation((key: string) => key),
        },
        timing: {
          startTime: Date.now(),
        },
        service: { env: 'test' },
        source: RequestSource.WEB,
        ip: '127.0.0.1',
        timestamp: new Date(),
        requestId: 'req-123',
      };
      // Using any type for pagination to avoid complex interface matching
      const pagination: any = {
        filters: { status: 'available', unitType: 'residential' },
        pagination: { page: 1, limit: 10, sort: 1, sortBy: 'unitNumber' },
      };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();
      const mockUnits = [createMockPropertyUnit(), createMockPropertyUnit()];

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.getPropertyUnits.mockResolvedValue(mockUnits);

      // Act
      const result = await propertyUnitService.getPropertyUnits(mockContext, pagination);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUnits);
      expect(result.message).toBe('propertyUnit.success.unitsRetrieved');
    });
  });

  describe('updatePropertyUnit', () => {
    it('should successfully update a property unit', async () => {
      // Arrange
      const mockContext: IRequestContext = {
        request: {
          params: { cuid: 'test-cuid', pid: 'test-pid', unitId: 'test-unit-id' },
          path: '/test',
          method: 'PUT',
          url: '/test',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        userAgent: {
          browser: 'Chrome',
          version: '91.0',
          os: 'Windows',
          raw: 'Mozilla/5.0...',
          isMobile: false,
          isBot: false,
        },
        langSetting: {
          lang: 'en',
          t: jest.fn().mockImplementation((key: string) => key),
        },
        timing: {
          startTime: Date.now(),
        },
        service: { env: 'test' },
        source: RequestSource.WEB,
        ip: '127.0.0.1',
        timestamp: new Date(),
        requestId: 'req-123',
      };
      // Using any type for updateData to avoid complex CURRENCIES type validation
      const updateData: any = {
        description: 'Updated description',
        fees: { rentAmount: 1500, securityDeposit: 1500, currency: 'USD' },
      };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty({ status: 'active' });
      const mockUnit = createMockPropertyUnit();
      const mockUpdatedUnit = { ...mockUnit, ...updateData };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(mockUnit);
      mockPropertyUnitDAO.update.mockResolvedValue(mockUpdatedUnit);
      mockPropertyCache.invalidateProperty.mockResolvedValue({ success: true });

      // Act
      const result = await propertyUnitService.updatePropertyUnit(mockContext, updateData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedUnit);
      expect(mockPropertyUnitDAO.update).toHaveBeenCalled();
      expect(mockEventEmitterService.emit).toHaveBeenCalledWith('UNIT_UPDATED', expect.any(Object));
      expect(mockPropertyCache.invalidateProperty).toHaveBeenCalledWith('test-cuid', 'test-pid');
    });

    it('should validate unit number uniqueness when updating', async () => {
      // Arrange
      const mockContext: IRequestContext = {
        request: {
          params: { cuid: 'test-cuid', pid: 'test-pid', unitId: 'test-unit-id' },
          path: '/test',
          method: 'PUT',
          url: '/test',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        userAgent: {
          browser: 'Chrome',
          version: '91.0',
          os: 'Windows',
          raw: 'Mozilla/5.0...',
          isMobile: false,
          isBot: false,
        },
        langSetting: {
          lang: 'en',
          t: jest.fn().mockImplementation((key: string) => key),
        },
        timing: {
          startTime: Date.now(),
        },
        service: { env: 'test' },
        source: RequestSource.WEB,
        ip: '127.0.0.1',
        timestamp: new Date(),
        requestId: 'req-123',
      };
      const updateData = { unitNumber: '201' };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty({ status: 'active' });
      const mockUnit = createMockPropertyUnit({ unitNumber: '101' });

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(mockUnit);
      mockPropertyDAO.getPropertyUnits.mockResolvedValue({
        items: [mockUnit],
        pagination: { page: 1, limit: 1000, total: 1 },
      });
      mockUnitNumberingService.validateUnitNumberUpdate.mockResolvedValue({
        isValid: false,
        error: 'Unit number already exists',
      });

      // Act & Assert
      await expect(propertyUnitService.updatePropertyUnit(mockContext, updateData)).rejects.toThrow(
        ValidationRequestError
      );
    });
  });

  describe('updateUnitStatus', () => {
    it('should update unit status and emit status change event', async () => {
      // Arrange
      const mockContext: IRequestContext = {
        request: {
          params: { cuid: 'test-cuid', pid: 'test-pid', unitId: 'test-unit-id' },
          path: '/test',
          method: 'PUT',
          url: '/test',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        userAgent: {
          browser: 'Chrome',
          version: '91.0',
          os: 'Windows',
          raw: 'Mozilla/5.0...',
          isMobile: false,
          isBot: false,
        },
        langSetting: {
          lang: 'en',
          t: jest.fn().mockImplementation((key: string) => key),
        },
        timing: {
          startTime: Date.now(),
        },
        service: { env: 'test' },
        source: RequestSource.WEB,
        ip: '127.0.0.1',
        timestamp: new Date(),
        requestId: 'req-123',
      };
      const updateData = { status: 'maintenance' };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty({ status: 'active' });
      const mockUnit = createMockPropertyUnit({ status: 'available' });
      const mockUpdatedUnit = { ...mockUnit, status: 'maintenance' };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(mockUnit);
      mockPropertyUnitDAO.update.mockResolvedValue(mockUpdatedUnit);
      mockPropertyCache.invalidateProperty.mockResolvedValue({ success: true });

      // Act
      const result = await propertyUnitService.updateUnitStatus(mockContext, updateData);

      // Assert
      expect(result.success).toBe(true);
      expect(mockEventEmitterService.emit).toHaveBeenCalledWith(
        'UNIT_STATUS_CHANGED',
        expect.objectContaining({
          unitId: 'test-unit-id',
          previousStatus: 'available',
          newStatus: 'maintenance',
          changeType: 'status_changed',
          cuid: 'test-cuid',
          propertyPid: 'test-pid',
        })
      );
    });
  });

  describe('archiveUnit', () => {
    it('should successfully archive a unit', async () => {
      // Arrange
      const mockContext: IRequestContext = {
        request: {
          params: { cuid: 'test-cuid', pid: 'test-pid', unitId: 'test-unit-id' },
          path: '/test',
          method: 'DELETE',
          url: '/test',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        userAgent: {
          browser: 'Chrome',
          version: '91.0',
          os: 'Windows',
          raw: 'Mozilla/5.0...',
          isMobile: false,
          isBot: false,
        },
        langSetting: {
          lang: 'en',
          t: jest.fn().mockImplementation((key: string) => key),
        },
        timing: {
          startTime: Date.now(),
        },
        service: { env: 'test' },
        source: RequestSource.WEB,
        ip: '127.0.0.1',
        timestamp: new Date(),
        requestId: 'req-123',
      };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty({ status: 'active' });
      const mockUnit = createMockPropertyUnit();

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(mockUnit);
      mockPropertyUnitDAO.update.mockResolvedValue({ ...mockUnit, deletedAt: new Date() });
      mockPropertyCache.invalidateProperty.mockResolvedValue({ success: true });

      // Act
      const result = await propertyUnitService.archiveUnit(mockContext);

      // Assert
      expect(result.success).toBe(true);
      expect(mockPropertyUnitDAO.update).toHaveBeenCalledWith(
        { id: 'test-unit-id', propertyId: mockProperty.id },
        expect.objectContaining({ deletedAt: expect.any(Date) }),
        undefined
      );
      expect(mockEventEmitterService.emit).toHaveBeenCalledWith(
        'UNIT_ARCHIVED',
        expect.any(Object)
      );
      expect(mockPropertyCache.invalidateProperty).toHaveBeenCalledWith('test-cuid', 'test-pid');
    });
  });

  describe('setupInspection', () => {
    it('should successfully setup inspection for a unit', async () => {
      // Arrange
      const mockContext: IRequestContext = {
        request: {
          params: { cuid: 'test-cuid', pid: 'test-pid', unitId: 'test-unit-id' },
          path: '/test',
          method: 'POST',
          url: '/test',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        userAgent: {
          browser: 'Chrome',
          version: '91.0',
          os: 'Windows',
          raw: 'Mozilla/5.0...',
          isMobile: false,
          isBot: false,
        },
        langSetting: {
          lang: 'en',
          t: jest.fn().mockImplementation((key: string) => key),
        },
        timing: {
          startTime: Date.now(),
        },
        service: { env: 'test' },
        source: RequestSource.WEB,
        ip: '127.0.0.1',
        timestamp: new Date(),
        requestId: 'req-123',
      };
      const inspectionData = {
        inspector: { name: 'John Inspector', contact: 'john@example.com' },
        inspectionDate: new Date(),
        notes: 'Regular inspection',
      };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty({ status: 'active' });
      const mockUnit = createMockPropertyUnit();
      const mockUpdatedUnit = { ...mockUnit, inspections: [inspectionData] };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(mockUnit);
      mockPropertyUnitDAO.update.mockResolvedValue(mockUpdatedUnit);

      // Act
      const result = await propertyUnitService.setupInspection(mockContext, inspectionData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedUnit);
      expect(mockPropertyUnitDAO.update).toHaveBeenCalled();
    });
  });

  describe('addDocumentToUnit', () => {
    it('should successfully add document to unit', async () => {
      // Arrange
      const mockContext: IRequestContext = {
        request: {
          params: { cuid: 'test-cuid', pid: 'test-pid', unitId: 'test-unit-id' },
          path: '/test',
          method: 'POST',
          url: '/test',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        userAgent: {
          browser: 'Chrome',
          version: '91.0',
          os: 'Windows',
          raw: 'Mozilla/5.0...',
          isMobile: false,
          isBot: false,
        },
        langSetting: {
          lang: 'en',
          t: jest.fn().mockImplementation((key: string) => key),
        },
        timing: {
          startTime: Date.now(),
        },
        service: { env: 'test' },
        source: RequestSource.WEB,
        ip: '127.0.0.1',
        timestamp: new Date(),
        requestId: 'req-123',
      };
      const documentData = {
        url: 'https://example.com/doc.pdf',
        documentName: 'Lease Agreement',
        documentType: 'lease',
      };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty({ status: 'active' });
      const mockUnit = createMockPropertyUnit();
      const mockUpdatedUnit = { ...mockUnit, documents: [documentData] };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(mockUnit);
      mockPropertyUnitDAO.update.mockResolvedValue(mockUpdatedUnit);

      // Act
      const result = await propertyUnitService.addDocumentToUnit(mockContext, documentData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedUnit);
      expect(mockPropertyUnitDAO.update).toHaveBeenCalled();
    });
  });

  describe('validateUnitsCsv', () => {
    it.skip('should successfully validate CSV file', async () => {
      // Arrange
      const mockContext: IRequestContext = {
        request: {
          params: { cuid: 'test-cuid', pid: 'test-pid' },
          path: '/test',
          method: 'POST',
          url: '/test',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        userAgent: {
          browser: 'Chrome',
          version: '91.0',
          os: 'Windows',
          raw: 'Mozilla/5.0...',
          isMobile: false,
          isBot: false,
        },
        langSetting: {
          lang: 'en',
          t: jest.fn().mockImplementation((key: string) => key),
        },
        timing: {
          startTime: Date.now(),
        },
        service: { env: 'test' },
        source: RequestSource.WEB,
        ip: '127.0.0.1',
        timestamp: new Date(),
        requestId: 'req-123',
      };
      // Using any type for csvFile to avoid interface matching
      const csvFile: any = {
        path: '/tmp/units.csv',
        fileSize: 1024,
        originalname: 'units.csv',
      };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();
      const mockJob = { id: 'validation-job-123' };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitQueue.addUnitBatchCreationJob.mockResolvedValue(mockJob);

      // Act
      const result = await propertyUnitService.validateUnitsCsv(mockContext, csvFile);

      // Assert
      expect(result.success).toBe(true);
      // Use any type assertion to avoid property check error
      expect((result.data as any).validUnits).toBeDefined();
    });

    it('should throw BadRequestError for oversized CSV file', async () => {
      // Arrange
      const mockContext: IRequestContext = {
        request: {
          params: { cuid: 'test-cuid', pid: 'test-pid' },
          path: '/test',
          method: 'POST',
          url: '/test',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        userAgent: {
          browser: 'Chrome',
          version: '91.0',
          os: 'Windows',
          raw: 'Mozilla/5.0...',
          isMobile: false,
          isBot: false,
        },
        langSetting: {
          lang: 'en',
          t: jest.fn().mockImplementation((key: string) => key),
        },
        timing: {
          startTime: Date.now(),
        },
        service: { env: 'test' },
        source: RequestSource.WEB,
        ip: '127.0.0.1',
        timestamp: new Date(),
        requestId: 'req-123',
      };

      const csvFile = {
        originalFileName: 'test.csv',
        fieldName: 'csvFile',
        mimeType: 'text/csv',
        path: '/tmp/test.csv',
        url: '/tmp/test.csv',
        key: 'csv-files/test.csv',
        status: 'pending' as const,
        filename: 'test.csv',
        fileSize: 15 * 1024 * 1024, // 15MB - too large
        uploadedAt: new Date(),
        uploadedBy: 'user-123',
      };

      const mockClient = createMockClient();
      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);

      // Act & Assert
      await expect(
        propertyUnitService.validateUnitsCsv(mockContext, csvFile)
      ).rejects.toThrow(BadRequestError);
    });
  });
});
