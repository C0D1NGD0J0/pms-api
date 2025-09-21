import { Types } from 'mongoose';
import { VendorService } from '@services/vendor/vendor.service';
import { VendorDAO } from '@dao/vendorDAO';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { IVendorDocument, NewVendor } from '@interfaces/vendor.interface';

describe('VendorService', () => {
  let vendorService: VendorService;
  let mockVendorDAO: jest.Mocked<VendorDAO>;

  const mockIds = {
    vendor: new Types.ObjectId().toString(),
    user: new Types.ObjectId().toString(),
    client: 'test-client-123',
  };

  const createMockVendorDocument = (overrides: Partial<IVendorDocument> = {}): IVendorDocument =>
    ({
      _id: new Types.ObjectId(),
      vuid: 'vendor-123',
      connectedClients: [
        {
          cuid: mockIds.client,
          isConnected: true,
          primaryAccountHolder: new Types.ObjectId(mockIds.user),
        },
      ],
      companyName: 'Test Vendor Corp',
      businessType: 'general_contractor',
      registrationNumber: 'REG123456',
      taxId: 'TAX789',
      address: {
        street: '123 Business St',
        city: 'Test City',
        state: 'Test State',
        country: 'Test Country',
        postCode: '12345',
        fullAddress: '123 Business St, Test City, Test State 12345',
        computedLocation: {
          type: 'Point',
          coordinates: [-122.4194, 37.7749],
        },
      },
      contactPerson: {
        name: 'John Vendor',
        jobTitle: 'Owner',
        email: 'john@testvendor.com',
        phone: '+1234567890',
      },
      servicesOffered: {
        plumbing: true,
        electrical: false,
        hvac: true,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as IVendorDocument;

  const createMockNewVendor = (overrides: Partial<NewVendor> = {}): NewVendor => ({
    isPrimaryAccountHolder: true,
    connectedClients: [
      {
        cuid: mockIds.client,
        isConnected: true,
        primaryAccountHolder: new Types.ObjectId(mockIds.user),
      },
    ],
    companyName: 'Test Vendor Corp',
    businessType: 'general_contractor',
    registrationNumber: 'REG123456',
    taxId: 'TAX789',
    ...overrides,
  });

  const createMockServices = () => {
    const vendorDAO = {
      createVendor: jest.fn(),
      getVendorById: jest.fn(),
      getVendorByPrimaryAccountHolder: jest.fn(),
      findByRegistrationNumber: jest.fn(),
      findByCompanyName: jest.fn(),
      getFilteredVendors: jest.fn(),
      getVendorByVuid: jest.fn(),
      updateVendor: jest.fn(),
      getClientVendors: jest.fn(),
      getClientVendorStats: jest.fn(),
      throwErrorHandler: jest.fn(),
      findFirst: jest.fn(),
      list: jest.fn(),
      upsert: jest.fn(),
      insert: jest.fn(),
      updateById: jest.fn(),
      deleteItem: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      withTransaction: jest.fn(),
    } as unknown as jest.Mocked<VendorDAO>;

    const userDAO = {
      getUsersByFilteredType: jest.fn(),
      getUserById: jest.fn(),
      getLinkedVendorUsers: jest.fn(),
    } as unknown as jest.Mocked<any>;

    const clientDAO = {
      getClientByCuid: jest.fn(),
    } as unknown as jest.Mocked<any>;

    const permissionService = {
      canUserAccessVendors: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<any>;

    const vendorCache = {
      getFilteredVendors: jest.fn().mockResolvedValue({ success: false }),
      saveFilteredVendors: jest.fn().mockResolvedValue({ success: true }),
    } as unknown as jest.Mocked<any>;

    return { vendorDAO, userDAO, clientDAO, permissionService, vendorCache };
  };

  beforeEach(() => {
    const mocks = createMockServices();
    mockVendorDAO = mocks.vendorDAO;

    vendorService = new VendorService(mocks);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createVendor', () => {
    it('should successfully create vendor with valid data', async () => {
      const vendorData = createMockNewVendor();
      const mockVendorDoc = createMockVendorDocument();

      mockVendorDAO.findByRegistrationNumber.mockResolvedValue(null);
      mockVendorDAO.findByCompanyName.mockResolvedValue(null);
      mockVendorDAO.createVendor.mockResolvedValue(mockVendorDoc);

      const result = await vendorService.createVendor(vendorData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockVendorDoc);
      expect(result.message).toBe('Vendor created successfully');
      expect(mockVendorDAO.findByRegistrationNumber).toHaveBeenCalledWith('REG123456');
      expect(mockVendorDAO.findByCompanyName).toHaveBeenCalledWith('Test Vendor Corp');
      expect(mockVendorDAO.createVendor).toHaveBeenCalledWith(vendorData, undefined);
    });

    it('should throw BadRequestError for missing connectedClients', async () => {
      const vendorData = { ...createMockNewVendor(), connectedClients: [] };

      await expect(vendorService.createVendor(vendorData)).rejects.toThrow(BadRequestError);
      await expect(vendorService.createVendor(vendorData)).rejects.toThrow(
        'Connected clients information is required'
      );
    });

    it('should throw BadRequestError for missing companyName', async () => {
      const vendorData = createMockNewVendor({ companyName: '' });

      await expect(vendorService.createVendor(vendorData)).rejects.toThrow(BadRequestError);
      await expect(vendorService.createVendor(vendorData)).rejects.toThrow(
        'Company name is required'
      );
    });

    it('should update existing vendor when duplicate registration number found', async () => {
      const vendorData = createMockNewVendor();
      const existingVendor = createMockVendorDocument({
        connectedClients: [
          {
            cuid: 'different-client',
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(),
          },
        ],
      });

      mockVendorDAO.findByRegistrationNumber.mockResolvedValue(existingVendor);
      mockVendorDAO.findByCompanyName.mockResolvedValue(null);
      mockVendorDAO.updateVendor.mockResolvedValue(existingVendor);

      const result = await vendorService.createVendor(vendorData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Vendor connection updated successfully');
      expect(mockVendorDAO.updateVendor).toHaveBeenCalled();
      expect(mockVendorDAO.createVendor).not.toHaveBeenCalled();
    });

    it('should update existing vendor when duplicate company name found', async () => {
      const vendorData = createMockNewVendor({ registrationNumber: '' });
      const existingVendor = createMockVendorDocument({
        connectedClients: [
          {
            cuid: 'different-client-2',
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(),
          },
        ],
      });

      mockVendorDAO.findByRegistrationNumber.mockResolvedValue(null);
      mockVendorDAO.findByCompanyName.mockResolvedValue(existingVendor);
      mockVendorDAO.updateVendor.mockResolvedValue(existingVendor);

      const result = await vendorService.createVendor(vendorData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Vendor connection updated successfully');
      expect(mockVendorDAO.findByRegistrationNumber).not.toHaveBeenCalled();
      expect(mockVendorDAO.findByCompanyName).toHaveBeenCalledWith('Test Vendor Corp');
      expect(mockVendorDAO.updateVendor).toHaveBeenCalled();
      expect(mockVendorDAO.createVendor).not.toHaveBeenCalled();
    });

    it('should prioritize registration number over company name for deduplication', async () => {
      const vendorData = createMockNewVendor();
      const existingVendorByReg = createMockVendorDocument({
        companyName: 'Different Company',
        connectedClients: [
          {
            cuid: 'different-client',
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(),
          },
        ],
      });

      mockVendorDAO.findByRegistrationNumber.mockResolvedValue(existingVendorByReg);
      mockVendorDAO.findByCompanyName.mockResolvedValue(null);
      mockVendorDAO.updateVendor.mockResolvedValue(existingVendorByReg);

      const result = await vendorService.createVendor(vendorData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Vendor connection updated successfully');
      expect(mockVendorDAO.findByRegistrationNumber).toHaveBeenCalledWith('REG123456');
      expect(mockVendorDAO.findByCompanyName).not.toHaveBeenCalled();
      expect(mockVendorDAO.updateVendor).toHaveBeenCalled();
      expect(mockVendorDAO.createVendor).not.toHaveBeenCalled();
    });

    it('should not add duplicate client connections when updating existing vendor', async () => {
      const vendorData = createMockNewVendor();
      const existingVendor = createMockVendorDocument({
        connectedClients: [
          {
            cuid: mockIds.client, // same client
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(mockIds.user),
          },
        ],
      });

      mockVendorDAO.findByRegistrationNumber.mockResolvedValue(existingVendor);
      mockVendorDAO.updateVendor.mockResolvedValue(existingVendor);

      const result = await vendorService.createVendor(vendorData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Vendor connection updated successfully');
      expect(mockVendorDAO.updateVendor).not.toHaveBeenCalled(); // Should not update if no new connections
    });

    it('should throw BadRequestError for duplicate client connections', async () => {
      const vendorData = createMockNewVendor({
        connectedClients: [
          {
            cuid: mockIds.client,
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(mockIds.user),
          },
          {
            cuid: mockIds.client, // duplicate
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(mockIds.user),
          },
        ],
      });

      await expect(vendorService.createVendor(vendorData)).rejects.toThrow(BadRequestError);
      await expect(vendorService.createVendor(vendorData)).rejects.toThrow(
        'Duplicate client connections are not allowed'
      );
    });
  });

  describe('getVendorByUserId', () => {
    it('should successfully retrieve vendor by user ID', async () => {
      const mockVendorDoc = createMockVendorDocument();
      mockVendorDAO.getVendorByPrimaryAccountHolder.mockResolvedValue(mockVendorDoc);

      const result = await vendorService.getVendorByUserId(mockIds.user);

      expect(result).toEqual(mockVendorDoc);
      expect(mockVendorDAO.getVendorByPrimaryAccountHolder).toHaveBeenCalledWith(mockIds.user);
    });

    it('should return null when vendor not found', async () => {
      mockVendorDAO.getVendorByPrimaryAccountHolder.mockResolvedValue(null);

      const result = await vendorService.getVendorByUserId(mockIds.user);

      expect(result).toBeNull();
      expect(mockVendorDAO.getVendorByPrimaryAccountHolder).toHaveBeenCalledWith(mockIds.user);
    });
  });

  describe('updateVendorInfo', () => {
    const updateData = { companyName: 'Updated Vendor Corp' };

    it('should successfully update vendor information', async () => {
      const mockVendorDoc = createMockVendorDocument({ companyName: 'Updated Vendor Corp' });
      mockVendorDAO.updateVendor.mockResolvedValue(mockVendorDoc);

      const result = await vendorService.updateVendorInfo(mockIds.vendor, updateData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockVendorDoc);
      expect(result.message).toBe('Vendor information updated successfully');
      expect(mockVendorDAO.updateVendor).toHaveBeenCalledWith(
        mockIds.vendor,
        updateData,
        undefined
      );
    });

    it('should throw NotFoundError when vendor not found', async () => {
      mockVendorDAO.updateVendor.mockResolvedValue(null);

      await expect(vendorService.updateVendorInfo(mockIds.vendor, updateData)).rejects.toThrow(
        NotFoundError
      );
      await expect(vendorService.updateVendorInfo(mockIds.vendor, updateData)).rejects.toThrow(
        'Vendor not found'
      );
    });

    it('should handle DAO update errors properly', async () => {
      const error = new Error('Database connection failed');
      mockVendorDAO.updateVendor.mockRejectedValue(error);

      await expect(vendorService.updateVendorInfo(mockIds.vendor, updateData)).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  describe('getClientVendors', () => {
    it('should successfully retrieve client vendors list', async () => {
      const mockVendors = [createMockVendorDocument(), createMockVendorDocument()];
      mockVendorDAO.getClientVendors.mockResolvedValue(mockVendors);

      const result = await vendorService.getClientVendors(mockIds.client);

      expect(result).toEqual(mockVendors);
      expect(mockVendorDAO.getClientVendors).toHaveBeenCalledWith(mockIds.client);
    });

    it('should handle DAO errors gracefully', async () => {
      const error = new Error('Database query failed');
      mockVendorDAO.getClientVendors.mockRejectedValue(error);

      await expect(vendorService.getClientVendors(mockIds.client)).rejects.toThrow(
        'Database query failed'
      );
    });
  });

  describe('getVendorById', () => {
    it('should successfully retrieve vendor by ID', async () => {
      const mockVendorDoc = createMockVendorDocument();
      mockVendorDAO.getVendorById.mockResolvedValue(mockVendorDoc);

      const result = await vendorService.getVendorById(mockIds.vendor);

      expect(result).toEqual(mockVendorDoc);
      expect(mockVendorDAO.getVendorById).toHaveBeenCalledWith(mockIds.vendor);
    });

    it('should return null when vendor not found', async () => {
      mockVendorDAO.getVendorById.mockResolvedValue(null);

      const result = await vendorService.getVendorById(mockIds.vendor);

      expect(result).toBeNull();
      expect(mockVendorDAO.getVendorById).toHaveBeenCalledWith(mockIds.vendor);
    });
  });

  describe('createVendorFromCompanyProfile', () => {
    const createMockCompanyProfile = (overrides: any = {}) => ({
      legalEntityName: 'Test Legal Entity',
      companyName: 'Test Company',
      businessType: 'professional_services',
      registrationNumber: 'REG789',
      taxId: 'TAX123',
      address: {
        fullAddress: '456 Company Ave, Business City, BS 67890',
        street: '456 Company Ave',
        city: 'Business City',
        state: 'BS',
        country: 'US',
        postCode: '67890',
        coordinates: [-122.4194, 37.7749],
      },
      contactPerson: {
        name: 'Jane Company',
        jobTitle: 'CEO',
        email: 'jane@company.com',
        phone: '+1987654321',
      },
      ...overrides,
    });

    it('should create vendor with complete company profile', async () => {
      const companyProfile = createMockCompanyProfile();
      const mockVendorDoc = createMockVendorDocument();

      mockVendorDAO.findByRegistrationNumber.mockResolvedValue(null);
      mockVendorDAO.findByCompanyName.mockResolvedValue(null);
      mockVendorDAO.createVendor.mockResolvedValue(mockVendorDoc);

      const result = await vendorService.createVendorFromCompanyProfile(
        mockIds.client,
        mockIds.user,
        companyProfile
      );

      expect(result).toEqual(mockVendorDoc);
      const createVendorCall = mockVendorDAO.createVendor.mock.calls[0][0];
      expect(createVendorCall.companyName).toBe('Test Legal Entity');
      expect(createVendorCall.businessType).toBe('professional_services');
      expect(createVendorCall.registrationNumber).toBe('REG789');
      expect(createVendorCall.taxId).toBe('TAX123');
      expect(createVendorCall.address).toMatchObject({
        fullAddress: '456 Company Ave, Business City, BS 67890',
        street: '456 Company Ave',
        city: 'Business City',
        state: 'BS',
        country: 'US',
        postCode: '67890',
      });
      expect(createVendorCall.contactPerson).toMatchObject({
        name: 'Jane Company',
        jobTitle: 'CEO',
        email: 'jane@company.com',
        phone: '+1987654321',
      });
    });

    it('should create vendor with minimal company profile data', async () => {
      const companyProfile = {
        companyName: 'Minimal Company',
      };
      const mockVendorDoc = createMockVendorDocument();

      mockVendorDAO.findByRegistrationNumber.mockResolvedValue(null);
      mockVendorDAO.findByCompanyName.mockResolvedValue(null);
      mockVendorDAO.createVendor.mockResolvedValue(mockVendorDoc);

      const result = await vendorService.createVendorFromCompanyProfile(
        mockIds.client,
        mockIds.user,
        companyProfile
      );

      expect(result).toEqual(mockVendorDoc);
      const createVendorCall = mockVendorDAO.createVendor.mock.calls[0][0];
      expect(createVendorCall.companyName).toBe('Minimal Company');
      expect(createVendorCall.businessType).toBe('professional_services');
      expect(createVendorCall.address).toBeUndefined();
      expect(createVendorCall.contactPerson).toBeUndefined();
    });

    it('should handle missing optional fields (address, contactPerson)', async () => {
      const companyProfile = createMockCompanyProfile({
        address: null,
        contactPerson: null,
      });
      const mockVendorDoc = createMockVendorDocument();

      mockVendorDAO.findByRegistrationNumber.mockResolvedValue(null);
      mockVendorDAO.findByCompanyName.mockResolvedValue(null);
      mockVendorDAO.createVendor.mockResolvedValue(mockVendorDoc);

      const result = await vendorService.createVendorFromCompanyProfile(
        mockIds.client,
        mockIds.user,
        companyProfile
      );

      expect(result).toEqual(mockVendorDoc);
      const createCall = mockVendorDAO.createVendor.mock.calls[0][0];
      expect(createCall.address).toBeUndefined();
      expect(createCall.contactPerson).toBeUndefined();
    });

    it('should use default businessType when not provided', async () => {
      const companyProfile = createMockCompanyProfile({ businessType: undefined });
      const mockVendorDoc = createMockVendorDocument();

      mockVendorDAO.findByRegistrationNumber.mockResolvedValue(null);
      mockVendorDAO.findByCompanyName.mockResolvedValue(null);
      mockVendorDAO.createVendor.mockResolvedValue(mockVendorDoc);

      const result = await vendorService.createVendorFromCompanyProfile(
        mockIds.client,
        mockIds.user,
        companyProfile
      );

      expect(result).toEqual(mockVendorDoc);
      expect(mockVendorDAO.createVendor).toHaveBeenCalledWith(
        expect.objectContaining({
          businessType: 'professional_services',
        }),
        undefined
      );
    });

    it('should handle underlying createVendor errors', async () => {
      const companyProfile = createMockCompanyProfile();
      const error = new BadRequestError({ message: 'Company name is required' });

      mockVendorDAO.findByRegistrationNumber.mockResolvedValue(null);
      mockVendorDAO.createVendor.mockRejectedValue(error);

      await expect(
        vendorService.createVendorFromCompanyProfile(mockIds.client, mockIds.user, companyProfile)
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('getFilteredVendors', () => {
    it('should return vendors with proper FilteredUserTableData format', async () => {
      const mockClient = { _id: mockIds.client, cuid: mockIds.client };
      const mockVendors = [createMockVendorDocument()];
      const mockUsers = [
        {
          _id: new Types.ObjectId(mockIds.user),
          uid: 'user-123',
          email: 'vendor@test.com',
          isActive: true,
          cuids: [{ cuid: mockIds.client, isConnected: true }],
          profile: {
            personalInfo: {
              firstName: 'John',
              lastName: 'Vendor',
              phoneNumber: '+1234567890',
            },
          },
        },
      ];
      const mockResult = {
        items: mockVendors,
        pagination: {
          total: 1,
          page: 1,
          limit: 10,
          pages: 1,
        },
      };

      (vendorService as any).clientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockVendorDAO.getFilteredVendors.mockResolvedValue(mockResult as any);
      (vendorService as any).userDAO.getUserById.mockResolvedValue(mockUsers[0]);

      const result = await vendorService.getFilteredVendors(
        mockIds.client,
        {},
        { limit: 10, skip: 0 }
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]).toMatchObject({
        uid: 'user-123',
        email: 'vendor@test.com',
        isActive: true,
        fullName: 'John Vendor',
        vendorInfo: expect.objectContaining({
          companyName: 'Test Vendor Corp',
          businessType: 'general_contractor',
        }),
      });
    });
  });

  describe('getVendorInfo', () => {
    it('should return single vendor with proper format', async () => {
      const mockClient = { _id: mockIds.client, cuid: mockIds.client };
      const mockVendor = createMockVendorDocument({ _id: new Types.ObjectId(mockIds.vendor) });
      const mockUser = {
        _id: new Types.ObjectId(mockIds.user),
        uid: 'user-123',
        email: 'vendor@test.com',
        isActive: true,
        cuids: [{ cuid: mockIds.client, isConnected: true, roles: ['vendor'] }],
        profile: {
          personalInfo: {
            firstName: 'John',
            lastName: 'Vendor',
            phoneNumber: '+1234567890',
          },
        },
      };

      (vendorService as any).clientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockVendorDAO.getVendorByVuid.mockResolvedValue(mockVendor);
      (vendorService as any).userDAO.getUserById.mockResolvedValue(mockUser);
      (vendorService as any).userDAO.getLinkedVendorUsers.mockResolvedValue({ items: [] });

      const result = await vendorService.getVendorInfo(mockIds.client, 'vendor-123');

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        profile: expect.objectContaining({
          email: 'vendor@test.com',
          fullName: 'John Vendor',
          userType: 'vendor',
        }),
        vendorInfo: expect.objectContaining({
          companyName: 'Test Vendor Corp',
          businessType: 'general_contractor',
        }),
      });
    });

    it('should throw NotFoundError when vendor not found', async () => {
      const mockClient = { _id: mockIds.client, cuid: mockIds.client };

      (vendorService as any).clientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockVendorDAO.getVendorByVuid.mockResolvedValue(null);

      await expect(vendorService.getVendorInfo(mockIds.client, 'nonexistent-vuid')).rejects.toThrow(
        'Vendor not found'
      );
    });
  });

  describe('createVendor with linkedVendorUid', () => {
    it('should prioritize linkedVendorUid over company name matching', async () => {
      const existingVendorId = new Types.ObjectId().toString();
      const existingVendor = createMockVendorDocument({
        _id: new Types.ObjectId(existingVendorId),
        companyName: 'ACME Plumbing Services',
        registrationNumber: 'PLM-2024-001',
        connectedClients: [],
      });

      const vendorData: NewVendor = {
        companyName: 'ACME Plumbing Services',
        registrationNumber: 'PLM-2024-002', // Different reg number
        isPrimaryAccountHolder: true,
        connectedClients: [
          {
            cuid: mockIds.client,
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(mockIds.user),
          },
        ],
      };

      // Mock the vendor lookup by ID (linkedVendorUid)
      mockVendorDAO.getVendorById.mockResolvedValue(existingVendor);
      mockVendorDAO.updateVendor.mockResolvedValue(existingVendor);

      const result = await vendorService.createVendor(vendorData, undefined, existingVendorId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(existingVendor);
      expect(result.message).toBe('Vendor connection updated successfully');

      // Should have called getVendorById with linkedVendorUid first
      expect(mockVendorDAO.getVendorById).toHaveBeenCalledWith(existingVendorId);

      // Should NOT have called findByRegistrationNumber or findByCompanyName
      expect(mockVendorDAO.findByRegistrationNumber).not.toHaveBeenCalled();
      expect(mockVendorDAO.findByCompanyName).not.toHaveBeenCalled();
    });

    it('should log warning when linkedVendorUid data conflicts with CSV data', async () => {
      const existingVendorId = new Types.ObjectId().toString();
      const existingVendor = createMockVendorDocument({
        _id: new Types.ObjectId(existingVendorId),
        companyName: 'ACME Plumbing Services',
        registrationNumber: 'PLM-2024-001',
        connectedClients: [],
      });

      const vendorData: NewVendor = {
        companyName: 'Different Company Name', // Conflicting name
        registrationNumber: 'PLM-2024-002', // Conflicting reg number
        isPrimaryAccountHolder: true,
        connectedClients: [
          {
            cuid: mockIds.client,
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(mockIds.user),
          },
        ],
      };

      mockVendorDAO.getVendorById.mockResolvedValue(existingVendor);
      mockVendorDAO.updateVendor.mockResolvedValue(existingVendor);

      const loggerWarnSpy = jest.spyOn((vendorService as any).logger, 'warn').mockImplementation();

      const result = await vendorService.createVendor(vendorData, undefined, existingVendorId);

      expect(result.success).toBe(true);
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Vendor data conflicts for linkedVendorUid')
      );

      loggerWarnSpy.mockRestore();
    });

    it('should work with new vendor UID formats (dashes and underscores)', async () => {
      const existingVendorId = new Types.ObjectId().toString();
      const existingVendor = createMockVendorDocument({
        _id: new Types.ObjectId(existingVendorId),
        vuid: 'BQ--E29IUASZ', // New format with dashes
        companyName: 'ACME Plumbing Services',
        connectedClients: [],
      });

      const vendorData: NewVendor = {
        companyName: 'ACME Plumbing Services',
        isPrimaryAccountHolder: true,
        connectedClients: [
          {
            cuid: mockIds.client,
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(mockIds.user),
          },
        ],
      };

      mockVendorDAO.getVendorById.mockResolvedValue(existingVendor);

      const result = await vendorService.createVendor(vendorData, undefined, 'BQ--E29IUASZ');

      expect(result.success).toBe(true);
      expect(mockVendorDAO.getVendorById).toHaveBeenCalledWith('BQ--E29IUASZ');
    });

    it('should fall back to registration number matching when linkedVendorUid not found', async () => {
      const nonExistentVendorId = new Types.ObjectId().toString();
      const existingVendorByReg = createMockVendorDocument({
        companyName: 'ACME Plumbing Services',
        registrationNumber: 'PLM-2024-001',
        connectedClients: [],
      });

      const vendorData: NewVendor = {
        companyName: 'ACME Plumbing Services',
        registrationNumber: 'PLM-2024-001',
        isPrimaryAccountHolder: true,
        connectedClients: [
          {
            cuid: mockIds.client,
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(mockIds.user),
          },
        ],
      };

      // linkedVendorUid lookup fails
      mockVendorDAO.getVendorById.mockResolvedValue(null);
      // Registration number lookup succeeds
      mockVendorDAO.findByRegistrationNumber.mockResolvedValue(existingVendorByReg);
      mockVendorDAO.updateVendor.mockResolvedValue(existingVendorByReg);

      const result = await vendorService.createVendor(vendorData, undefined, nonExistentVendorId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(existingVendorByReg);

      // Should have tried linkedVendorUid first, then fallen back to registration number
      expect(mockVendorDAO.getVendorById).toHaveBeenCalledWith(nonExistentVendorId);
      expect(mockVendorDAO.findByRegistrationNumber).toHaveBeenCalledWith('PLM-2024-001');
    });
  });

  describe('getVendorStats', () => {
    it('should successfully retrieve vendor statistics', async () => {
      const cuid = 'test-client-123';
      const mockClient = { _id: mockIds.client, cuid };
      const mockVendorStats = {
        totalVendors: 5,
        businessTypeDistribution: [
          { name: 'General Contractor', value: 3, percentage: 60 },
          { name: 'Plumbing', value: 2, percentage: 40 },
        ],
        servicesDistribution: [
          { name: 'Plumbing', value: 4, percentage: 80 },
          { name: 'Electrical', value: 2, percentage: 40 },
          { name: 'HVAC', value: 1, percentage: 20 },
        ],
      };

      (vendorService as any).clientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockVendorDAO.getClientVendorStats.mockResolvedValue(mockVendorStats);

      const result = await vendorService.getVendorStats(cuid, { status: 'active' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        businessTypeDistribution: mockVendorStats.businessTypeDistribution,
        servicesDistribution: mockVendorStats.servicesDistribution,
        totalVendors: mockVendorStats.totalVendors,
      });
      expect(result.message).toBe('vendor.success.statsRetrieved');

      expect((vendorService as any).clientDAO.getClientByCuid).toHaveBeenCalledWith(cuid);
      expect(mockVendorDAO.getClientVendorStats).toHaveBeenCalledWith(cuid, { status: 'active' });
    });

    it('should throw BadRequestError when cuid is missing', async () => {
      await expect(vendorService.getVendorStats('')).rejects.toThrow(
        'client.errors.clientIdRequired'
      );
    });

    it('should throw NotFoundError when client not found', async () => {
      const cuid = 'nonexistent-client';

      (vendorService as any).clientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(vendorService.getVendorStats(cuid)).rejects.toThrow('client.errors.notFound');
    });
  });
});
