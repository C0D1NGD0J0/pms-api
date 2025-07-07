import { Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import { generateShortUID } from '@utils/index';
import { IRequestContext, CURRENCIES } from '@interfaces/utils.interface';
import { IPropertyUnitDocument } from '@interfaces/propertyUnit.interface';
import { IPropertyDocument, OccupancyStatus, PropertyType } from '@interfaces/property.interface';

/**
 * Enhanced property-specific test data factories
 */
export class PropertyTestFactory {
  static createPropertyData(overrides: Partial<IPropertyDocument> = {}): any {
    const baseProperty = {
      name: faker.company.name() + ' Property',
      description: {
        text: faker.lorem.paragraph(),
        html: `<p>${faker.lorem.paragraph()}</p>`,
      },
      address: {
        street: faker.location.streetAddress(),
        city: faker.location.city(),
        state: faker.location.state({ abbreviated: true }),
        postCode: faker.location.zipCode(),
        country: 'United States',
        fullAddress: '',
        coordinates: {
          latitude: faker.location.latitude(),
          longitude: faker.location.longitude(),
        },
      },
      propertyType: faker.helpers.arrayElement([
        'house',
        'apartment',
        'condo',
        'townhouse',
        'duplex',
        'commercial',
        'industrial',
      ]) as PropertyType,
      occupancyStatus: faker.helpers.arrayElement([
        'vacant',
        'occupied',
        'partially_occupied',
      ]) as OccupancyStatus,
      status: faker.helpers.arrayElement(['active', 'inactive', 'pending']),
      specifications: {
        totalArea: faker.number.int({ min: 500, max: 5000 }),
        lotSize: faker.number.int({ min: 1000, max: 10000 }),
        yearBuilt: faker.number.int({ min: 1950, max: 2023 }),
        bedrooms: faker.number.int({ min: 0, max: 5 }),
        bathrooms: faker.number.float({ min: 1, max: 4, fractionDigits: 1 }),
        parkingSpaces: faker.number.int({ min: 0, max: 4 }),
        amenities: faker.helpers.arrayElements(
          ['pool', 'gym', 'laundry', 'parking', 'elevator', 'balcony', 'garden'],
          { min: 0, max: 4 }
        ),
      },
      financialDetails: {
        purchasePrice: faker.number.int({ min: 100000, max: 1000000 }),
        marketValue: faker.number.int({ min: 100000, max: 1000000 }),
        purchaseDate: faker.date.past({ years: 10 }),
        lastAssessmentDate: faker.date.recent({ days: 365 }),
        assessedValue: faker.number.int({ min: 100000, max: 1000000 }),
      },
      fees: {
        rentalAmount: faker.number.int({ min: 800, max: 5000 }),
        securityDeposit: faker.number.int({ min: 800, max: 5000 }),
        applicationFee: faker.number.int({ min: 25, max: 100 }),
        lateFee: faker.number.int({ min: 25, max: 100 }),
        petFee: faker.number.int({ min: 0, max: 500 }),
      },
      documents: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    };

    // Generate full address
    baseProperty.address.fullAddress = `${baseProperty.address.street}, ${baseProperty.address.city}, ${baseProperty.address.state} ${baseProperty.address.postCode}`;

    return baseProperty;
  }

  static createPropertyUnit(overrides: Partial<IPropertyUnitDocument> = {}): any {
    return {
      unitNumber: faker.string.alphanumeric(3).toUpperCase(),
      propertyId: new Types.ObjectId(),
      specifications: {
        bedrooms: faker.number.int({ min: 0, max: 4 }),
        bathrooms: faker.number.float({ min: 1, max: 3, fractionDigits: 1 }),
        totalArea: faker.number.int({ min: 400, max: 2000 }),
        amenities: faker.helpers.arrayElements(
          ['balcony', 'dishwasher', 'washer_dryer', 'fireplace', 'walk_in_closet'],
          { min: 0, max: 3 }
        ),
      },
      fees: {
        rentAmount: faker.number.int({ min: 800, max: 3000 }),
        securityDeposit: faker.number.int({ min: 800, max: 3000 }),
      },
      status: faker.helpers.arrayElement([
        'available',
        'occupied',
        'maintenance',
        'reserved',
        'inactive',
      ]),
      occupancyStatus: faker.helpers.arrayElement(['vacant', 'occupied']),
      currentTenant: null,
      leaseInfo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  static createRequestContext(overrides: Partial<IRequestContext> = {}): IRequestContext {
    const userId = new Types.ObjectId().toString();
    const cid = generateShortUID();

    return {
      requestId: generateShortUID(),
      currentuser: {
        sub: userId,
        email: faker.internet.email(),
        fullname: faker.person.fullName(),
        permissions: ['read', 'write', 'delete'],
        ...overrides.currentuser,
      },
      request: {
        url: '/api/properties',
        method: 'GET',
        params: { cid },
        query: {},
        ip: '127.0.0.1',
        ...overrides.request,
      },
      ...overrides,
    };
  }

  static createCsvValidationData() {
    return {
      csvFilePath: '/tmp/test-properties.csv',
      cid: generateShortUID(),
      userId: new Types.ObjectId().toString(),
    };
  }

  static createUploadResult() {
    return {
      fieldName: 'documents',
      originalName: faker.system.fileName(),
      filename: faker.system.fileName(),
      path: `/uploads/${faker.system.fileName()}`,
      size: faker.number.int({ min: 1000, max: 5000000 }),
      mimetype: 'image/jpeg',
    };
  }

  static createPropertyFilterQuery() {
    return {
      pagination: {
        page: 1,
        limit: 10,
        sort: 'desc',
        sortBy: 'createdAt',
      },
      filters: {
        propertyType: faker.helpers.arrayElements(['house', 'apartment', 'condo']),
        status: faker.helpers.arrayElements(['active', 'inactive']),
        occupancyStatus: faker.helpers.arrayElement(['vacant', 'occupied', 'partially_occupied']),
        priceRange: {
          min: faker.number.int({ min: 100000, max: 300000 }),
          max: faker.number.int({ min: 300000, max: 1000000 }),
        },
        areaRange: {
          min: faker.number.int({ min: 500, max: 1000 }),
          max: faker.number.int({ min: 1000, max: 5000 }),
        },
        location: {
          city: faker.location.city(),
          state: faker.location.state(),
          postCode: faker.location.zipCode(),
        },
        searchTerm: faker.company.name(),
        dateRange: {
          field: 'createdAt',
          start: faker.date.past({ years: 1 }),
          end: new Date(),
        },
      },
    };
  }
}

/**
 * Property test scenarios for comprehensive testing
 */
export class PropertyTestScenarios {
  static getValidPropertyCreationScenarios() {
    return [
      {
        name: 'Single family house',
        data: PropertyTestFactory.createPropertyData({
          propertyType: 'house',
          specifications: { bedrooms: 3, bathrooms: 2, totalArea: 1500 },
        }),
      },
      {
        name: 'Multi-unit apartment building',
        data: PropertyTestFactory.createPropertyData({
          propertyType: 'apartment',
          specifications: { totalArea: 12000 },
        }),
      },
      {
        name: 'Commercial property',
        data: PropertyTestFactory.createPropertyData({
          propertyType: 'commercial',
          specifications: { totalArea: 2500, bedrooms: 0 },
        }),
      },
      {
        name: 'Industrial property',
        data: PropertyTestFactory.createPropertyData({
          propertyType: 'industrial',
          specifications: { totalArea: 5000, lotSize: 2000 },
        }),
      },
    ];
  }

  static getInvalidPropertyCreationScenarios() {
    return [
      {
        name: 'Missing required name',
        data: PropertyTestFactory.createPropertyData({ name: '' }),
        expectedError: 'validation',
      },
      {
        name: 'Invalid property type',
        data: PropertyTestFactory.createPropertyData({ propertyType: 'invalid' as any }),
        expectedError: 'validation',
      },
      {
        name: 'Commercial with bedrooms',
        data: PropertyTestFactory.createPropertyData({
          propertyType: 'commercial',
          specifications: { bedrooms: 3, totalArea: 150 },
        }),
        expectedError: 'business rule',
      },
      {
        name: 'Industrial without lot size',
        data: PropertyTestFactory.createPropertyData({
          propertyType: 'industrial',
          specifications: { totalArea: 500 },
        }),
        expectedError: 'business rule',
      },
      {
        name: 'Occupied property without rent',
        data: PropertyTestFactory.createPropertyData({
          occupancyStatus: 'occupied',
          fees: { rentalAmount: 0, taxAmount: 0, currency: 'USD' as CURRENCIES, managementFees: 0 },
        }),
        expectedError: 'business rule',
      },
    ];
  }

  static getPropertyUpdateScenarios() {
    return [
      {
        name: 'Update basic information',
        updateData: {
          name: 'Updated Property Name',
          description: { text: 'Updated description' },
        },
      },
      {
        name: 'Update financial details',
        updateData: {
          financialDetails: {
            marketValue: 500000,
            lastAssessmentDate: new Date(),
          },
        },
      },
      {
        name: 'Update specifications',
        updateData: {
          specifications: {
            totalArea: 2000,
            amenities: ['pool', 'gym'],
          },
        },
      },
      {
        name: 'Change occupancy status',
        updateData: {
          occupancyStatus: 'vacant',
          fees: { rentalAmount: 1500 },
        },
      },
    ];
  }
}

/**
 * Property-specific assertion helpers
 */
export class PropertyAssertions {
  static expectPropertyStructure(property: any) {
    expect(property).toHaveProperty('name');
    expect(property).toHaveProperty('address');
    expect(property).toHaveProperty('propertyType');
    expect(property).toHaveProperty('specifications');
    expect(property).toHaveProperty('financialDetails');
    expect(property).toHaveProperty('fees');
    expect(property.address).toHaveProperty('street');
    expect(property.address).toHaveProperty('city');
    expect(property.address).toHaveProperty('state');
    expect(property.address).toHaveProperty('postCode');
  }

  static expectPropertyUnitStructure(unit: any) {
    expect(unit).toHaveProperty('unitNumber');
    expect(unit).toHaveProperty('propertyId');
    expect(unit).toHaveProperty('specifications');
    expect(unit).toHaveProperty('fees');
    expect(unit).toHaveProperty('status');
    expect(unit.specifications).toHaveProperty('bedrooms');
    expect(unit.specifications).toHaveProperty('bathrooms');
    expect(unit.fees).toHaveProperty('rent');
  }

  static expectValidationError(error: any, field: string) {
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('validation');
    if (error.errorInfo && error.errorInfo[field]) {
      expect(error.errorInfo[field]).toBeDefined();
    }
  }

  static expectPropertyBusinessRules(property: any) {
    if (property.propertyType === 'commercial') {
      expect(property.specifications.totalArea).toBeGreaterThanOrEqual(200);
    }

    if (property.propertyType === 'industrial') {
      expect(property.specifications.lotSize).toBeDefined();
      expect(property.specifications.totalArea).toBeGreaterThanOrEqual(1000);
    }

    if (property.occupancyStatus === 'occupied') {
      expect(property.fees.rentalAmount).toBeGreaterThan(0);
    }
  }

  static expectCacheOperations(mockCache: any, operation: string, key?: string) {
    switch (operation) {
      case 'invalidate':
        if (key) {
          expect(mockCache.invalidateProperty).toHaveBeenCalledWith(expect.any(String), key);
        } else {
          expect(mockCache.invalidatePropertyLists).toHaveBeenCalled();
        }
        break;
      case 'get':
        expect(mockCache.getClientProperties).toHaveBeenCalled();
        break;
      case 'set':
        expect(mockCache.saveClientProperties).toHaveBeenCalled();
        break;
    }
  }

  static expectQueueOperations(mockQueue: any, jobType: string, data?: any) {
    switch (jobType) {
      case 'csv-validation':
        expect(mockQueue.addCsvValidationJob).toHaveBeenCalledWith(
          expect.objectContaining(data || {})
        );
        break;
      case 'csv-import':
        expect(mockQueue.addCsvImportJob).toHaveBeenCalledWith(expect.objectContaining(data || {}));
        break;
      case 'upload':
        expect(mockQueue.addToUploadQueue).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining(data || {})
        );
        break;
    }
  }
}
