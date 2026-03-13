import { Types } from 'mongoose';
import { PropertyDAO } from '@dao/propertyDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { CURRENCIES } from '@interfaces/utils.interface';
import { PropertyUnit, Property, Client, User } from '@models/index';
import { PropertyUnitStatusEnum, PropertyUnitTypeEnum } from '@interfaces/propertyUnit.interface';
import { clearTestDatabase } from '@tests/helpers';
import {
  OccupancyStatus,
  PropertyStatus,
  PropertyType,} from '@interfaces/property.interface';

describe('PropertyDAO Integration Tests', () => {
  let propertyDAO: PropertyDAO;
  let propertyUnitDAO: PropertyUnitDAO;
  let testClientId: Types.ObjectId;
  let testUserId: Types.ObjectId;
  let testPropertyId: Types.ObjectId;

  beforeAll(async () => {
    propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
    propertyDAO = new PropertyDAO({
      propertyModel: Property,
      propertyUnitDAO: propertyUnitDAO,
    });
  });
  beforeEach(async () => {
    await clearTestDatabase();
    testClientId = new Types.ObjectId();
    testUserId = new Types.ObjectId();

    // Create test client
    await Client.create({
      _id: testClientId,
      cuid: 'TEST_CLIENT',
      displayName: 'Test Company',
      status: 'active',
      accountAdmin: testUserId,
      accountType: { category: 'individual' },
    });

    // Create test user
    await User.create({
      _id: testUserId,
      uid: 'test-uid',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      password: 'hashed',
      activecuid: 'TEST_CLIENT',
      cuids: [
        {
          cuid: 'TEST_CLIENT',
          clientDisplayName: 'Test Company',
          roles: ['admin'],
          isConnected: true,
        },
      ],
    });

    // Create a test property
    const property = await Property.create({
      cuid: 'TEST_CLIENT',
      name: 'Test Property',
      propertyType: 'apartment',
      status: 'available',
      managedBy: testUserId,
      createdBy: testUserId,
      maxAllowedUnits: 10,
      occupancyStatus: 'vacant',
      address: {
        fullAddress: '123 Main St, Toronto, ON M5B 2K3',
        street: 'Main St',
        streetNumber: '123',
        city: 'Toronto',
        state: 'ON',
        postCode: 'M5B 2K3',
        country: 'Canada',
      },
      computedLocation: {
        type: 'Point',
        coordinates: [-79.3832, 43.6532], // Toronto coordinates
      },
      description: { text: 'Test property description' },
      specifications: {
        totalArea: 1500,
        bedrooms: 3,
        bathrooms: 2,
      },
      fees: {
        currency: 'USD',
        rentalAmount: 2000,
        taxAmount: 300,
        managementFees: 200,
      },
      utilities: {
        water: true,
        gas: true,
        electricity: true,
        internet: false,
        cableTV: false,
       trash: false, heating: true, centralAC: false },
      financialDetails: {
        marketValue: 500000,
        purchasePrice: 450000,
      },
    });

    testPropertyId = property._id;
  });

  describe('getFilteredProperties', () => {
    it('should filter properties by property type', async () => {
      await Property.create({
        cuid: 'TEST_CLIENT',
        name: 'House Property',
        propertyType: 'house',
        status: 'available',
        managedBy: testUserId,
        createdBy: testUserId,
        address: {
          fullAddress: '456 Oak Ave, Toronto, ON M5C 1A1',
          city: 'Toronto',
        },
        computedLocation: {
          type: 'Point',
          coordinates: [-79.4, 43.65],
        },
        description: { text: 'House description' },
        
        utilities: { water: true, gas: true, electricity: true, internet: false, cableTV: false, trash: false, heating: true, centralAC: false },
      });

      const result = await propertyDAO.getFilteredProperties(
        'TEST_CLIENT',
        { propertyType: ['apartment'] },
        { page: 1, limit: 10 }
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0].propertyType).toBe('apartment');
    });

    it('should filter properties by status', async () => {
      await Property.updateOne({ _id: testPropertyId }, { status: 'occupied' });

      const result = await propertyDAO.getFilteredProperties(
        'TEST_CLIENT',
        { status: ['occupied'] },
        { page: 1, limit: 10 }
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0].status).toBe('occupied');
    });

    it('should filter properties by price range', async () => {
      await Property.create({
        cuid: 'TEST_CLIENT',
        name: 'Expensive Property',
        propertyType: 'condominium',
        status: 'available',
        managedBy: testUserId,
        createdBy: testUserId,
        address: { fullAddress: '789 Luxury Blvd, Toronto, ON M5D 2B2' },
        computedLocation: { type: 'Point', coordinates: [-79.39, 43.66] },
        description: { text: 'Luxury condo' },
        
        utilities: { water: true, gas: true, electricity: true, internet: true, cableTV: true, trash: false, heating: true, centralAC: false },
        financialDetails: { marketValue: 1000000 },
      });

      const result = await propertyDAO.getFilteredProperties(
        'TEST_CLIENT',
        { priceRange: { min: 400000, max: 600000 } },
        { page: 1, limit: 10 }
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0].financialDetails?.marketValue).toBe(500000);
    });

    it('should filter properties by area range', async () => {
      const result = await propertyDAO.getFilteredProperties(
        'TEST_CLIENT',
        { areaRange: { min: 1000, max: 2000 } },
        { page: 1, limit: 10 }
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0].specifications.totalArea).toBe(1500);
    });

    it('should filter properties by location city', async () => {
      await Property.create({
        cuid: 'TEST_CLIENT',
        name: 'Vancouver Property',
        propertyType: 'townhouse',
        status: 'available',
        managedBy: testUserId,
        createdBy: testUserId,
        address: {
          fullAddress: '321 West Coast St, Vancouver, BC V5K 0A1',
          city: 'Vancouver',
          state: 'BC',
        },
        computedLocation: { type: 'Point', coordinates: [-123.1207, 49.2827] },
        description: { text: 'Vancouver property' },
        specifications: {},
        fees: { currency: 'CAD', rentalAmount: 3500, taxAmount: 450, managementFees: 300 },
        utilities: { water: true, gas: true, electricity: true, internet: false, cableTV: false, trash: false, heating: true, centralAC: false },
      });

      const result = await propertyDAO.getFilteredProperties(
        'TEST_CLIENT',
        { location: { city: 'Toronto' } },
        { page: 1, limit: 10 }
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0].address.city).toBe('Toronto');
    });

    it('should throw error if clientId is not provided', async () => {
      await expect(
        propertyDAO.getFilteredProperties('', {}, { page: 1, limit: 10 })
      ).rejects.toThrow();
    });

    it('should apply pagination correctly', async () => {
      // Create 15 properties
      for (let i = 0; i < 14; i++) {
        await Property.create({
          cuid: 'TEST_CLIENT',
          name: `Property ${i}`,
          propertyType: 'apartment',
          status: 'available',
          managedBy: testUserId,
          createdBy: testUserId,
          address: { fullAddress: `${i} Street, Toronto, ON M${i}A ${i}B${i}` },
          computedLocation: { type: 'Point', coordinates: [-79.38 - i * 0.01, 43.65 + i * 0.01] },
          description: { text: 'Test' },
          
          utilities: {
            water: true,
            gas: true,
            electricity: true,
            internet: false,
            cableTV: false,
           trash: false, heating: true, centralAC: false },
        });
      }

      const result = await propertyDAO.getFilteredProperties(
        'TEST_CLIENT',
        {},
        { page: 1, limit: 5 }
      );

      expect(result.items.length).toBe(5);
      expect(result.pagination?.total).toBe(15);
    });
  });

  describe('updatePropertyOccupancy', () => {
    it('should update property occupancy status', async () => {
      const result = await propertyDAO.updatePropertyOccupancy(
        testPropertyId.toString(),
        'occupied',
        10,
        testUserId.toString()
      );

      expect(result).not.toBeNull();
      expect(result?.occupancyStatus).toBe('occupied');
      expect(result?.maxAllowedUnits).toBe(10);
    });

    it('should throw error if occupancy rate exceeds 200', async () => {
      await expect(
        propertyDAO.updatePropertyOccupancy(
          testPropertyId.toString(),
          'occupied',
          250,
          testUserId.toString()
        )
      ).rejects.toThrow();
    });

    it('should throw error if occupancy rate is negative', async () => {
      await expect(
        propertyDAO.updatePropertyOccupancy(
          testPropertyId.toString(),
          'occupied',
          -5,
          testUserId.toString()
        )
      ).rejects.toThrow();
    });

    it('should throw error if propertyId or status not provided', async () => {
      await expect(
        propertyDAO.updatePropertyOccupancy('', 'occupied', 10, testUserId.toString())
      ).rejects.toThrow();
    });
  });

  describe('getPropertiesByClientId', () => {
    it('should return all properties for a client', async () => {
      const result = await propertyDAO.getPropertiesByClientId('TEST_CLIENT');

      expect(result.items.length).toBe(1);
      expect(result.items[0].cuid).toBe('TEST_CLIENT');
    });

    it('should sort properties by specified field', async () => {
      await Property.create({
        cuid: 'TEST_CLIENT',
        name: 'Another Property',
        propertyType: 'house',
        status: 'available',
        managedBy: testUserId,
        createdBy: testUserId,
        address: { fullAddress: '999 Last St, Toronto, ON M9Z 9Z9' },
        computedLocation: { type: 'Point', coordinates: [-79.5, 43.7] },
        description: { text: 'Another property' },
        
        utilities: { water: true, gas: true, electricity: true, internet: false, cableTV: false, trash: false, heating: true, centralAC: false },
      });

      const result = await propertyDAO.getPropertiesByClientId('TEST_CLIENT', {}, {
        sortBy: 'name',
        sort: 'asc',
      });

      expect(result.items.length).toBe(2);
      expect(result.items[0].name).toBe('Another Property');
      expect(result.items[1].name).toBe('Test Property');
    });

    it('should sort by price when sortBy is price', async () => {
      await Property.create({
        cuid: 'TEST_CLIENT',
        name: 'Cheap Property',
        propertyType: 'house',
        status: 'available',
        managedBy: testUserId,
        createdBy: testUserId,
        address: { fullAddress: '100 Budget St, Toronto, ON M1B 1B1' },
        computedLocation: { type: 'Point', coordinates: [-79.35, 43.6] },
        description: { text: 'Affordable housing' },
        
        utilities: { water: true, gas: true, electricity: true, internet: false, cableTV: false, trash: false, heating: true, centralAC: false },
        financialDetails: { marketValue: 300000 },
      });

      const result = await propertyDAO.getPropertiesByClientId('TEST_CLIENT', {}, {
        sortBy: 'price',
        sort: 'asc',
      });

      expect(result.items.length).toBe(2);
      expect(result.items[0].financialDetails?.marketValue).toBe(300000);
    });

    it('should throw error if clientId not provided', async () => {
      await expect(propertyDAO.getPropertiesByClientId('')).rejects.toThrow();
    });
  });

  describe('updatePropertyDocument', () => {
    it('should add documents to property', async () => {
      const property = await Property.findById(testPropertyId);
      const uploadData = [
        {
          fieldName: 'documents',
          documentName: 'Lease Agreement',
          key: 's3-key-123',
          url: 'https://example.com/doc.pdf',
          actorId: testUserId.toString(),
          filename: 'lease.pdf',
          resourceId: testPropertyId.toString(),
          publicuid: 'pub-uid-doc-123',
        },
      ];

      const result = await propertyDAO.updatePropertyDocument(
        property!.pid,
        uploadData,
        testUserId.toString()
      );

      expect(result).not.toBeNull();
      expect(result?.documents?.length).toBe(1);
      expect(result?.documents![0].key).toBe('s3-key-123');
    });

    it('should add images to property', async () => {
      const property = await Property.findById(testPropertyId);
      const uploadData = [
        {
          fieldName: 'images',
          key: 'image-key-456',
          url: 'https://example.com/image.jpg',
          filename: 'property.jpg',
          actorId: testUserId.toString(),
          resourceId: testPropertyId.toString(),
          publicuid: 'pub-uid-img-456',
        },
      ];

      const result = await propertyDAO.updatePropertyDocument(
        property!.pid,
        uploadData,
        testUserId.toString()
      );

      expect(result).not.toBeNull();
      expect(result?.images?.length).toBe(1);
      expect(result?.images![0].key).toBe('image-key-456');
    });

    it('should add both documents and images', async () => {
      const property = await Property.findById(testPropertyId);
      const uploadData = [
        {
          fieldName: 'documents',
          documentName: 'Tax Document',
          key: 'doc-key-789',
          url: 'https://example.com/tax.pdf',
          actorId: testUserId.toString(),
          filename: 'tax.pdf',
          resourceId: testPropertyId.toString(),
          publicuid: 'pub-uid-doc-789',
        },
        {
          fieldName: 'images',
          key: 'img-key-101',
          url: 'https://example.com/photo.jpg',
          filename: 'photo.jpg',
          actorId: testUserId.toString(),
          resourceId: testPropertyId.toString(),
          publicuid: 'pub-uid-img-101',
        },
      ];

      const result = await propertyDAO.updatePropertyDocument(
        property!.pid,
        uploadData,
        testUserId.toString()
      );

      expect(result).not.toBeNull();
      expect(result?.documents?.length).toBe(1);
      expect(result?.images?.length).toBe(1);
    });

    it('should throw error if property not found', async () => {
      await expect(
        propertyDAO.updatePropertyDocument('INVALID_PID', [], testUserId.toString())
      ).rejects.toThrow();
    });

    it('should throw error if uploadData is empty', async () => {
      const property = await Property.findById(testPropertyId);
      await expect(
        propertyDAO.updatePropertyDocument(property!.pid, [], testUserId.toString())
      ).rejects.toThrow();
    });
  });

  describe('findPropertiesNearby', () => {
    it('should find properties within specified radius', async () => {
      // Create property at different location
      await Property.create({
        cuid: 'TEST_CLIENT',
        name: 'Nearby Property',
        propertyType: 'apartment',
        status: 'available',
        managedBy: testUserId,
        createdBy: testUserId,
        address: { fullAddress: '200 Close St, Toronto, ON M5E 1C1' },
        computedLocation: {
          type: 'Point',
          coordinates: [-79.385, 43.654], // Very close to test property
        },
        description: { text: 'Nearby property' },
        
        utilities: { water: true, gas: true, electricity: true, internet: false, cableTV: false, trash: false, heating: true, centralAC: false },
      });

      const result = await propertyDAO.findPropertiesNearby(
        'TEST_CLIENT',
        [-79.3832, 43.6532],
        5
      );

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should throw error for invalid coordinates', async () => {
      await expect(
        propertyDAO.findPropertiesNearby('TEST_CLIENT', [-200, 43.6532], 5)
      ).rejects.toThrow();
    });

    it('should throw error for invalid radius', async () => {
      await expect(
        propertyDAO.findPropertiesNearby('TEST_CLIENT', [-79.3832, 43.6532], 0)
      ).rejects.toThrow();
    });

    it('should throw error if clientId not provided', async () => {
      await expect(
        propertyDAO.findPropertiesNearby('', [-79.3832, 43.6532], 5)
      ).rejects.toThrow();
    });
  });

  describe('findPropertyByAddress', () => {
    it('should find property by exact address', async () => {
      const result = await propertyDAO.findPropertyByAddress(
        '123 Main St, Toronto, ON M5B 2K3',
        'TEST_CLIENT'
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Test Property');
    });

    it('should be case insensitive', async () => {
      const result = await propertyDAO.findPropertyByAddress(
        '123 main st, toronto, on m5b 2k3',
        'TEST_CLIENT'
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Test Property');
    });

    it('should return null for non-existent address', async () => {
      const result = await propertyDAO.findPropertyByAddress(
        '999 Nonexistent St',
        'TEST_CLIENT'
      );

      expect(result).toBeNull();
    });

    it('should throw error if address or clientId not provided', async () => {
      await expect(propertyDAO.findPropertyByAddress('', 'TEST_CLIENT')).rejects.toThrow();
    });
  });

  describe('createProperty', () => {
    it('should create a new property', async () => {
      const propertyData = {
        cuid: 'TEST_CLIENT',
        name: 'New Property',
        propertyType: 'house' as PropertyType,
        status: 'available' as PropertyStatus,
        managedBy: testUserId,
        createdBy: testUserId,
        address: {
          fullAddress: '555 New Ave, Toronto, ON M5N 1N1',
          city: 'Toronto',
          state: 'ON',
        },
        computedLocation: {
          type: 'Point' as const,
          coordinates: [-79.4, 43.67],
        },
        description: { text: 'Brand new property' },
        specifications: { totalArea: 2000 },
        fees: {
          currency: 'USD' as CURRENCIES,
          rentalAmount: 3000,
          taxAmount: 400,
          managementFees: 250,
        },
        utilities: {
          water: true,
          gas: true,
          electricity: true,
          internet: true,
          cableTV: false,
         trash: false, heating: true, centralAC: false },
        occupancyStatus: 'vacant' as OccupancyStatus,
      };

      const result = await propertyDAO.createProperty(propertyData);

      expect(result).toBeDefined();
      expect(result.name).toBe('New Property');
      expect(result.pid).toBeDefined();
    });
  });

  describe('removePropertyDocument', () => {
    it('should remove a document from property', async () => {
      // First add a document
      const property = await Property.findById(testPropertyId);
      await propertyDAO.updatePropertyDocument(
        property!.pid,
        [
          {
            fieldName: 'documents',
            documentName: 'To Remove',
            key: 'remove-key',
            url: 'https://example.com/remove.pdf',
            actorId: testUserId.toString(),
            filename: 'remove.pdf',
            resourceId: testPropertyId.toString(),
            publicuid: 'pub-uid-remove',
          },
        ],
        testUserId.toString()
      );

      const updatedProperty = await Property.findById(testPropertyId);
      const docId = updatedProperty!.documents![0]._id!;

      const result = await propertyDAO.removePropertyDocument(
        testPropertyId.toString(),
        docId.toString(),
        testUserId.toString()
      );

      expect(result).not.toBeNull();
      expect(result?.documents?.length).toBe(0);
    });

    it('should throw error if required parameters not provided', async () => {
      await expect(
        propertyDAO.removePropertyDocument('', 'docId', testUserId.toString())
      ).rejects.toThrow();
    });
  });

  describe('removePropertyImage', () => {
    it('should remove an image from property', async () => {
      // First add an image
      const property = await Property.findById(testPropertyId);
      await propertyDAO.updatePropertyDocument(
        property!.pid,
        [
          {
            fieldName: 'images',
            key: 'img-remove',
            url: 'https://example.com/remove.jpg',
            filename: 'remove.jpg',
            actorId: testUserId.toString(),
            resourceId: testPropertyId.toString(),
            publicuid: 'pub-uid-img-remove',
          },
        ],
        testUserId.toString()
      );

      const updatedProperty = await Property.findById(testPropertyId);
      const imageId = updatedProperty!.images![0]._id!;

      const result = await propertyDAO.removePropertyImage(
        testPropertyId.toString(),
        imageId.toString(),
        testUserId.toString()
      );

      expect(result).not.toBeNull();
      expect(result?.images?.length).toBe(0);
    });

    it('should throw error if required parameters not provided', async () => {
      await expect(
        propertyDAO.removePropertyImage('', 'imageId', testUserId.toString())
      ).rejects.toThrow();
    });
  });

  describe('removePropertyMedia', () => {
    it('should remove document media', async () => {
      const property = await Property.findById(testPropertyId);
      await propertyDAO.updatePropertyDocument(
        property!.pid,
        [
          {
            fieldName: 'documents',
            documentName: 'Media Doc',
            key: 'media-doc',
            url: 'https://example.com/media.pdf',
            actorId: testUserId.toString(),
            filename: 'media.pdf',
            resourceId: testPropertyId.toString(),
            publicuid: 'pub-uid-media-doc',
          },
        ],
        testUserId.toString()
      );

      const updatedProperty = await Property.findById(testPropertyId);
      const docId = updatedProperty!.documents![0]._id!;

      const result = await propertyDAO.removePropertyMedia(
        testPropertyId.toString(),
        docId.toString(),
        'document',
        testUserId.toString()
      );

      expect(result).not.toBeNull();
      expect(result?.documents?.length).toBe(0);
    });

    it('should remove image media', async () => {
      const property = await Property.findById(testPropertyId);
      await propertyDAO.updatePropertyDocument(
        property!.pid,
        [
          {
            fieldName: 'images',
            key: 'media-img',
            url: 'https://example.com/media.jpg',
            filename: 'media.jpg',
            actorId: testUserId.toString(),
            resourceId: testPropertyId.toString(),
            publicuid: 'pub-uid-media-img',
          },
        ],
        testUserId.toString()
      );

      const updatedProperty = await Property.findById(testPropertyId);
      const imageId = updatedProperty!.images![0]._id!;

      const result = await propertyDAO.removePropertyMedia(
        testPropertyId.toString(),
        imageId.toString(),
        'image',
        testUserId.toString()
      );

      expect(result).not.toBeNull();
      expect(result?.images?.length).toBe(0);
    });

    it('should throw error if required parameters not provided', async () => {
      await expect(
        propertyDAO.removePropertyMedia('', 'mediaId', 'document', testUserId.toString())
      ).rejects.toThrow();
    });
  });

  describe('searchProperties', () => {
    it('should search properties by name', async () => {
      const result = await propertyDAO.searchProperties('Test Property', 'TEST_CLIENT');

      expect(result.items.length).toBe(1);
      expect(result.items[0].name).toBe('Test Property');
    });

    it('should search properties by city', async () => {
      const result = await propertyDAO.searchProperties('Toronto', 'TEST_CLIENT');

      expect(result.items.length).toBe(1);
      expect(result.items[0].address.city).toBe('Toronto');
    });

    it('should return all properties when query is empty', async () => {
      const result = await propertyDAO.searchProperties('', 'TEST_CLIENT');

      expect(result.items.length).toBe(1);
    });

    it('should throw error if clientId not provided', async () => {
      expect(() => propertyDAO.searchProperties('test', '')).toThrow();
    });
  });

  describe('archiveProperty', () => {
    it('should archive property with no active units', async () => {
      const result = await propertyDAO.archiveProperty(
        testPropertyId.toString(),
        testUserId.toString()
      );

      expect(result).toBe(true);

      const property = await Property.findById(testPropertyId);
      expect(property?.deletedAt).toBeDefined();
    });

    it('should not archive property with active units', async () => {
      // Create an active unit
      await PropertyUnit.create({
        propertyId: testPropertyId,
        unitNumber: 'Unit-101',
        cuid: 'TEST_CLIENT',
        unitType: PropertyUnitTypeEnum.RESIDENTIAL,
        status: PropertyUnitStatusEnum.AVAILABLE,
        createdBy: testUserId,
        managedBy: testUserId,
        address: { fullAddress: '123 Main St, Unit 101, Toronto, ON M5B 2K3' },
        specifications: { totalArea: 800, bathrooms: 1 },
        fees: { currency: 'USD', rentAmount: 1500 },
        utilities: { water: true, gas: true, electricity: true, internet: false, cableTV: false, trash: false, heating: true, centralAC: false },
      });

      await expect(
        propertyDAO.archiveProperty(testPropertyId.toString(), testUserId.toString())
      ).rejects.toThrow('Cannot archive property');
    });

    it('should throw error if propertyId or userId not provided', async () => {
      await expect(propertyDAO.archiveProperty('', testUserId.toString())).rejects.toThrow();
    });
  });

  describe('getPropertyUnits', () => {
    it('should return all units for a property', async () => {
      await PropertyUnit.create({
        propertyId: testPropertyId,
        unitNumber: 'Unit-201',
        cuid: 'TEST_CLIENT',
        unitType: PropertyUnitTypeEnum.RESIDENTIAL,
        status: PropertyUnitStatusEnum.AVAILABLE,
        createdBy: testUserId,
        managedBy: testUserId,
        address: { fullAddress: '123 Main St, Unit 201, Toronto, ON M5B 2K3' },
        specifications: { totalArea: 850, bathrooms: 1 },
        fees: { currency: 'USD', rentAmount: 1600 },
        utilities: { water: true, gas: true, electricity: true, internet: false, cableTV: false, trash: false, heating: true, centralAC: false },
      });

      const result = await propertyDAO.getPropertyUnits(testPropertyId.toString(), {
        page: 1,
        limit: 10,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].unitNumber).toBe('Unit-201');
    });

    it('should throw error if propertyId not provided', async () => {
      await expect(propertyDAO.getPropertyUnits('', { page: 1, limit: 10 })).rejects.toThrow();
    });
  });

  describe('getUnitCountsByStatus', () => {
    it('should return unit counts by status', async () => {
      await PropertyUnit.insertMany([
        {
          propertyId: testPropertyId,
          unitNumber: 'Unit-301',
          cuid: 'TEST_CLIENT',
          unitType: PropertyUnitTypeEnum.RESIDENTIAL,
          status: PropertyUnitStatusEnum.AVAILABLE,
          createdBy: testUserId,
          managedBy: testUserId,
          address: { fullAddress: '123 Main St, Unit 301' },
          specifications: { totalArea: 800, bathrooms: 1 },
          fees: { currency: 'USD', rentAmount: 1500 },
          utilities: {
            water: true,
            gas: true,
            electricity: true,
            internet: false,
            cableTV: false,
            trash: false,
            heating: true,
            centralAC: false,
          },
        },
        {
          propertyId: testPropertyId,
          unitNumber: 'Unit-302',
          cuid: 'TEST_CLIENT',
          unitType: PropertyUnitTypeEnum.RESIDENTIAL,
          status: PropertyUnitStatusEnum.OCCUPIED,
          createdBy: testUserId,
          managedBy: testUserId,
          address: { fullAddress: '123 Main St, Unit 302' },
          specifications: { totalArea: 800, bathrooms: 1 },
          fees: { currency: 'USD', rentAmount: 1500 },
          utilities: {
            water: true,
            gas: true,
            electricity: true,
            internet: false,
            cableTV: false,
            trash: false,
            heating: true,
            centralAC: false,
          },
        },
        {
          propertyId: testPropertyId,
          unitNumber: 'Unit-303',
          cuid: 'TEST_CLIENT',
          unitType: PropertyUnitTypeEnum.RESIDENTIAL,
          status: PropertyUnitStatusEnum.MAINTENANCE,
          createdBy: testUserId,
          managedBy: testUserId,
          address: { fullAddress: '123 Main St, Unit 303' },
          specifications: { totalArea: 800, bathrooms: 1 },
          fees: { currency: 'USD', rentAmount: 1500 },
          utilities: {
            water: true,
            gas: true,
            electricity: true,
            internet: false,
            cableTV: false,
            trash: false,
            heating: true,
            centralAC: false,
          },
        },
      ]);

      const result = await propertyDAO.getUnitCountsByStatus(testPropertyId.toString());

      expect(result.total).toBe(3);
      expect(result.available).toBe(1);
      expect(result.occupied).toBe(1);
      expect(result.maintenance).toBe(1);
    });

    it('should throw error if propertyId not provided', async () => {
      await expect(propertyDAO.getUnitCountsByStatus('')).rejects.toThrow();
    });
  });

  describe('canAddUnitToProperty', () => {
    it('should allow adding unit when below max capacity', async () => {
      const result = await propertyDAO.canAddUnitToProperty(testPropertyId.toString());

      expect(result.canAdd).toBe(true);
      expect(result.currentCount).toBe(0);
      expect(result.maxCapacity).toBe(10);
    });

    it('should not allow adding unit when at max capacity', async () => {
      // Create 10 units (max capacity)
      for (let i = 0; i < 10; i++) {
        await PropertyUnit.create({
          propertyId: testPropertyId,
          unitNumber: `Unit-${i}`,
          cuid: 'TEST_CLIENT',
          unitType: PropertyUnitTypeEnum.RESIDENTIAL,
          status: PropertyUnitStatusEnum.AVAILABLE,
          createdBy: testUserId,
          managedBy: testUserId,
          address: { fullAddress: `123 Main St, Unit ${i}` },
          specifications: { totalArea: 800, bathrooms: 1 },
          fees: { currency: 'USD', rentAmount: 1500 },
          utilities: {
            water: true,
            gas: true,
            electricity: true,
            internet: false,
            cableTV: false,
            trash: false,
            heating: true,
            centralAC: false,
          },
        });
      }

      const result = await propertyDAO.canAddUnitToProperty(testPropertyId.toString());

      expect(result.canAdd).toBe(false);
      expect(result.currentCount).toBe(10);
      expect(result.maxCapacity).toBe(10);
    });

    it('should throw error if propertyId not provided', async () => {
      await expect(propertyDAO.canAddUnitToProperty('')).rejects.toThrow();
    });

    it('should throw error if property not found', async () => {
      const fakeId = new Types.ObjectId().toString();
      await expect(propertyDAO.canAddUnitToProperty(fakeId)).rejects.toThrow();
    });
  });

  describe('validateUnitToPropertyCompatibility', () => {
    it('should validate compatible unit type for apartment', async () => {
      const result = await propertyDAO.validateUnitToPropertyCompatibility(
        testPropertyId.toString(),
        '2BR'
      );

      expect(result.canAdd).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject incompatible unit type for property', async () => {
      const result = await propertyDAO.validateUnitToPropertyCompatibility(
        testPropertyId.toString(),
        'commercial'
      );

      expect(result.canAdd).toBe(false);
      expect(result.reason).toContain('not compatible');
    });

    it('should enforce single unit limit for houses', async () => {
      // Create a house property
      const house = await Property.create({
        cuid: 'TEST_CLIENT',
        name: 'House Property',
        propertyType: 'house',
        status: 'available',
        managedBy: testUserId,
        createdBy: testUserId,
        address: { fullAddress: '777 House St, Toronto, ON M7H 7H7' },
        computedLocation: { type: 'Point', coordinates: [-79.45, 43.68] },
        description: { text: 'Single house' },
        
        utilities: { water: true, gas: true, electricity: true, internet: false, cableTV: false, trash: false, heating: true, centralAC: false },
        maxAllowedUnits: 5,
      });

      // Add one unit
      await PropertyUnit.create({
        propertyId: house._id,
        unitNumber: 'Main',
        cuid: 'TEST_CLIENT',
        unitType: PropertyUnitTypeEnum.RESIDENTIAL,
        status: PropertyUnitStatusEnum.AVAILABLE,
        createdBy: testUserId,
        managedBy: testUserId,
        address: { fullAddress: '777 House St' },
        specifications: { totalArea: 2000, bathrooms: 2 },
        fees: { currency: 'USD', rentAmount: 3500 },
        utilities: { water: true, gas: true, electricity: true, internet: false, cableTV: false, trash: false, heating: true, centralAC: false },
      });

      const result = await propertyDAO.validateUnitToPropertyCompatibility(
        house._id.toString(),
        '2BR'
      );

      expect(result.canAdd).toBe(false);
      expect(result.reason).toContain('Houses can only have one unit');
    });

    it('should throw error if propertyId not provided', async () => {
      await expect(
        propertyDAO.validateUnitToPropertyCompatibility('', '2BR')
      ).rejects.toThrow();
    });
  });

  describe('syncPropertyOccupancyWithUnits', () => {
    it('should set status to vacant when no units exist', async () => {
      const result = await propertyDAO.syncPropertyOccupancyWithUnits(
        testPropertyId.toString(),
        testUserId.toString()
      );

      expect(result?.occupancyStatus).toBe('vacant');
    });

    it('should set status to occupied when all units are occupied', async () => {
      await PropertyUnit.insertMany([
        {
          propertyId: testPropertyId,
          unitNumber: 'Unit-401',
          cuid: 'TEST_CLIENT',
          status: PropertyUnitStatusEnum.OCCUPIED,
          createdBy: testUserId,
          address: { fullAddress: '123 Main St, Unit 401' },
          unitType: PropertyUnitTypeEnum.RESIDENTIAL,
          managedBy: testUserId,
          specifications: { totalArea: 800, bathrooms: 1 },
          fees: { currency: 'USD', rentAmount: 1500 },
          utilities: {
            water: true,
            gas: true,
            electricity: true,
            internet: false,
            cableTV: false,
           trash: false, heating: true, centralAC: false },
        amenities: { parking: false, cableTV: false, storage: false, internet: false, dishwasher: false, washerDryer: false, airConditioning: false }},
        {
          propertyId: testPropertyId,
          unitNumber: 'Unit-402',
          cuid: 'TEST_CLIENT',
          status: PropertyUnitStatusEnum.OCCUPIED,
          createdBy: testUserId,
          address: { fullAddress: '123 Main St, Unit 402' },
          unitType: PropertyUnitTypeEnum.RESIDENTIAL,
          managedBy: testUserId,
          specifications: { totalArea: 800, bathrooms: 1 },
          fees: { currency: 'USD', rentAmount: 1500 },
          utilities: {
            water: true,
            gas: true,
            electricity: true,
            internet: false,
            cableTV: false,
           trash: false, heating: true, centralAC: false },
        amenities: { parking: false, cableTV: false, storage: false, internet: false, dishwasher: false, washerDryer: false, airConditioning: false }},
      ]);

      const result = await propertyDAO.syncPropertyOccupancyWithUnits(
        testPropertyId.toString(),
        testUserId.toString()
      );

      expect(result?.occupancyStatus).toBe('occupied');
    });

    it('should set status to partially_occupied when some units occupied', async () => {
      await PropertyUnit.insertMany([
        {
          propertyId: testPropertyId,
          unitNumber: 'Unit-501',
          cuid: 'TEST_CLIENT',
          status: PropertyUnitStatusEnum.OCCUPIED,
          createdBy: testUserId,
          address: { fullAddress: '123 Main St, Unit 501' },
          unitType: PropertyUnitTypeEnum.RESIDENTIAL,
          managedBy: testUserId,
          specifications: { totalArea: 800, bathrooms: 1 },
          fees: { currency: 'USD', rentAmount: 1500 },
          utilities: {
            water: true,
            gas: true,
            electricity: true,
            internet: false,
            cableTV: false,
           trash: false, heating: true, centralAC: false },
        amenities: { parking: false, cableTV: false, storage: false, internet: false, dishwasher: false, washerDryer: false, airConditioning: false }},
        {
          propertyId: testPropertyId,
          unitNumber: 'Unit-502',
          cuid: 'TEST_CLIENT',
          status: PropertyUnitStatusEnum.AVAILABLE,
          createdBy: testUserId,
          address: { fullAddress: '123 Main St, Unit 502' },
          unitType: PropertyUnitTypeEnum.RESIDENTIAL,
          managedBy: testUserId,
          specifications: { totalArea: 800, bathrooms: 1 },
          fees: { currency: 'USD', rentAmount: 1500 },
          utilities: {
            water: true,
            gas: true,
            electricity: true,
            internet: false,
            cableTV: false,
           trash: false, heating: true, centralAC: false },
        amenities: { parking: false, cableTV: false, storage: false, internet: false, dishwasher: false, washerDryer: false, airConditioning: false }},
      ]);

      const result = await propertyDAO.syncPropertyOccupancyWithUnits(
        testPropertyId.toString(),
        testUserId.toString()
      );

      expect(result?.occupancyStatus).toBe('partially_occupied');
    });

    it('should throw error if propertyId or userId not provided', async () => {
      await expect(
        propertyDAO.syncPropertyOccupancyWithUnits('', testUserId.toString())
      ).rejects.toThrow();
    });
  });

  describe('syncPropertyOccupancyWithUnitsEnhanced', () => {
    it('should correctly determine occupancy for properties with units', async () => {
      await PropertyUnit.create({
        propertyId: testPropertyId,
        unitNumber: 'Unit-601',
        cuid: 'TEST_CLIENT',
        status: PropertyUnitStatusEnum.AVAILABLE,
        createdBy: testUserId,
        address: { fullAddress: '123 Main St, Unit 601' },
        unitType: PropertyUnitTypeEnum.RESIDENTIAL,
        managedBy: testUserId,
        specifications: { totalArea: 800, bathrooms: 1 },
        fees: { currency: 'USD', rentAmount: 1500 },
        utilities: { water: true, gas: true, electricity: true, internet: false, cableTV: false, trash: false, heating: true, centralAC: false },
      });

      const result = await propertyDAO.syncPropertyOccupancyWithUnitsEnhanced(
        testPropertyId.toString(),
        testUserId.toString()
      );

      expect(result?.occupancyStatus).toBe('vacant');
    });

    it('should throw error if property not found', async () => {
      const fakeId = new Types.ObjectId().toString();
      await expect(
        propertyDAO.syncPropertyOccupancyWithUnitsEnhanced(fakeId, testUserId.toString())
      ).rejects.toThrow();
    });
  });

  describe('canArchiveProperty', () => {
    it('should allow archiving property with no active units', async () => {
      const result = await propertyDAO.canArchiveProperty(testPropertyId.toString());

      expect(result.canArchive).toBe(true);
      expect(result.activeUnitCount).toBe(0);
    });

    it('should not allow archiving property with active units', async () => {
      await PropertyUnit.create({
        propertyId: testPropertyId,
        unitNumber: 'Unit-701',
        cuid: 'TEST_CLIENT',
        status: PropertyUnitStatusEnum.AVAILABLE,
        createdBy: testUserId,
        address: { fullAddress: '123 Main St, Unit 701' },
        unitType: PropertyUnitTypeEnum.RESIDENTIAL,
        managedBy: testUserId,
        specifications: { totalArea: 800, bathrooms: 1 },
        fees: { currency: 'USD', rentAmount: 1500 },
        utilities: { water: true, gas: true, electricity: true, internet: false, cableTV: false, trash: false, heating: true, centralAC: false },
      });

      const result = await propertyDAO.canArchiveProperty(testPropertyId.toString());

      expect(result.canArchive).toBe(false);
      expect(result.activeUnitCount).toBeGreaterThan(0);
    });

    it('should throw error if propertyId not provided', async () => {
      await expect(propertyDAO.canArchiveProperty('')).rejects.toThrow();
    });
  });

  describe('findPropertyWithActiveMedia', () => {
    it('should return property with only active media', async () => {
      await Property.findById(testPropertyId);

      // Add documents with different statuses
      await Property.updateOne(
        { _id: testPropertyId },
        {
          $push: {
            documents: {
              $each: [
                {
                  documentName: 'Active Doc',
                  url: 'https://example.com/active.pdf',
                  status: 'active',
                  externalUrl: 'https://example.com/active.pdf',
                  documentType: 'lease',
                  uploadedBy: testUserId,
                  uploadedAt: new Date(),
                },
                {
                  documentName: 'Deleted Doc',
                  url: 'https://example.com/deleted.pdf',
                  status: 'deleted',
                  externalUrl: 'https://example.com/deleted.pdf',
                  documentType: 'other',
                  uploadedBy: testUserId,
                  uploadedAt: new Date(),
                },
              ],
            },
          },
        }
      );

      const result = await propertyDAO.findPropertyWithActiveMedia({
        _id: testPropertyId,
      });

      expect(result).not.toBeNull();
      expect(result?.documents?.length).toBe(1);
      expect(result?.documents![0].status).toBe('active');
    });

    it('should not filter images (images dont have status field)', async () => {
      await Property.updateOne(
        { _id: testPropertyId },
        {
          $push: {
            images: {
              $each: [
                {
                  url: 'https://example.com/active.jpg',
                  uploadedBy: testUserId,
                  uploadedAt: new Date(),
                },
                {
                  url: 'https://example.com/another.jpg',
                  uploadedBy: testUserId,
                  uploadedAt: new Date(),
                },
              ],
            },
          },
        }
      );

      const result = await propertyDAO.findPropertyWithActiveMedia({
        _id: testPropertyId,
      });

      expect(result).not.toBeNull();
      // Images don't have a status field, so both should be returned
      expect(result?.images?.length).toBe(2);
    });
  });
});
