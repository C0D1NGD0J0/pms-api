import { ClientSession } from 'mongoose';

// Property DAO Mock
export const createMockPropertyDAO = () => ({
  findFirst: jest.fn(),
  list: jest.fn(),
  insert: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  startSession: jest.fn(),
  withTransaction: jest.fn().mockImplementation(
    async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
      return await callback(session);
    }
  ),
  getPropertyById: jest.fn(),
  getPropertiesByClient: jest.fn(),
});

// Property Unit DAO Mock
export const createMockPropertyUnitDAO = () => ({
  findFirst: jest.fn(),
  list: jest.fn(),
  insert: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  startSession: jest.fn(),
  withTransaction: jest.fn().mockImplementation(
    async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
      return await callback(session);
    }
  ),
  getUnitById: jest.fn(),
  getUnitsByProperty: jest.fn(),
});

// Property Service Mock (when implemented)
export const createMockPropertyService = () => ({
  createProperty: jest.fn(),
  updateProperty: jest.fn(),
  deleteProperty: jest.fn(),
  getPropertyById: jest.fn(),
  getPropertiesByClient: jest.fn(),
  uploadPropertyImages: jest.fn(),
});

// Property Unit Service Mock (when implemented)
export const createMockPropertyUnitService = () => ({
  createUnit: jest.fn(),
  updateUnit: jest.fn(),
  deleteUnit: jest.fn(),
  getUnitById: jest.fn(),
  getUnitsByProperty: jest.fn(),
});