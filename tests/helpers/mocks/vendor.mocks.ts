import { Types, ClientSession } from 'mongoose';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { IVendorDocument, NewVendor, IVendor } from '@interfaces/vendor.interface';
import { createMockVendorDocument, createMockNewVendor } from '../mockFactories';

// VendorDAO Mock with all required methods
export const createMockVendorDAO = () => ({
  // Core CRUD operations
  createVendor: jest.fn().mockResolvedValue(createMockVendorDocument()),
  
  getVendorById: jest.fn().mockResolvedValue(createMockVendorDocument()),
  
  getVendorByPrimaryAccountHolder: jest.fn().mockResolvedValue(createMockVendorDocument()),
  
  findByRegistrationNumber: jest.fn().mockResolvedValue(null),
  
  updateVendor: jest.fn().mockResolvedValue(createMockVendorDocument()),
  
  getClientVendors: jest.fn().mockResolvedValue([createMockVendorDocument()]),
  
  getClientVendorStats: jest.fn().mockResolvedValue({
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
  }),

  // BaseDAO inherited methods
  findFirst: jest.fn().mockResolvedValue(createMockVendorDocument()),
  findById: jest.fn().mockResolvedValue(createMockVendorDocument()),
  list: jest.fn().mockResolvedValue([createMockVendorDocument()]),
  insert: jest.fn().mockResolvedValue(createMockVendorDocument()),
  updateById: jest.fn().mockResolvedValue(createMockVendorDocument()),
  deleteById: jest.fn().mockResolvedValue(createMockVendorDocument()),
  count: jest.fn().mockResolvedValue(1),
  aggregate: jest.fn().mockResolvedValue([]),
  withTransaction: jest.fn().mockImplementation(async (session: ClientSession, callback: Function) => {
    return callback(session);
  }),
});

// VendorService Mock with all business methods
export const createMockVendorService = () => ({
  createVendor: jest.fn().mockResolvedValue({
    success: true,
    data: createMockVendorDocument(),
    message: 'Vendor created successfully',
  } as ISuccessReturnData<IVendorDocument>),

  getVendorByUserId: jest.fn().mockResolvedValue(createMockVendorDocument()),

  updateVendorInfo: jest.fn().mockResolvedValue({
    success: true,
    data: createMockVendorDocument(),
    message: 'Vendor information updated successfully',
  } as ISuccessReturnData<IVendorDocument>),

  getClientVendors: jest.fn().mockResolvedValue([createMockVendorDocument()]),

  getVendorById: jest.fn().mockResolvedValue(createMockVendorDocument()),

  createVendorFromCompanyProfile: jest.fn().mockResolvedValue(createMockVendorDocument()),

  getVendorStats: jest.fn().mockResolvedValue({
    success: true,
    data: {
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
      departmentDistribution: [
        { name: 'General Contractor', value: 3, percentage: 60 },
        { name: 'Plumbing', value: 2, percentage: 40 },
      ],
      roleDistribution: [
        { name: 'Plumbing', value: 4, percentage: 80 },
        { name: 'Electrical', value: 2, percentage: 40 },
        { name: 'HVAC', value: 1, percentage: 20 },
      ],
      totalFilteredUsers: 5,
    },
  }),
});