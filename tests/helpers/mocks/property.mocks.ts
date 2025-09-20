import { ClientSession } from 'mongoose';

// Property DAO Mock
export const createMockPropertyDAO = () => ({
  findFirst: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  startSession: jest.fn(),
  withTransaction: jest
    .fn()
    .mockImplementation(
      async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
        return await callback(session);
      }
    ),
  getPropertyById: jest.fn(),
  getPropertiesByClient: jest.fn(),
  getPropertiesByClientId: jest.fn(),
  findPropertyByAddress: jest.fn(),
  createProperty: jest.fn(),
  updatePropertyDocument: jest.fn(),
  archiveProperty: jest.fn(),
  canAddUnitToProperty: jest.fn(),
  getPropertyUnits: jest.fn(),
  getUnitCountsByStatus: jest.fn(),
  updatePropertyOccupancy: jest.fn(),
  countDocuments: jest.fn(),
  syncPropertyOccupancyWithUnitsEnhanced: jest.fn(),
});

// Property Unit DAO Mock
export const createMockPropertyUnitDAO = () => ({
  findFirst: jest.fn(),
  list: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  startSession: jest.fn(),
  withTransaction: jest
    .fn()
    .mockImplementation(
      async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
        return await callback(session);
      }
    ),
  getUnitById: jest.fn(),
  getUnitsByProperty: jest.fn(),
  getPropertyUnitInfo: jest.fn(),
  getExistingUnitNumbers: jest.fn(),
  getNextAvailableUnitNumber: jest.fn(),
  getSuggestedStartingUnitNumber: jest.fn(),
});

// GeoCoderService Mock
export const createMockGeoCoderService = () => ({
  getCoordinates: jest.fn(),
  reverseGeocode: jest.fn(),
  validateAddress: jest.fn(),
});

// EventEmitterService Mock
export const createMockEventEmitterService = () => ({
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  once: jest.fn(),
  removeListener: jest.fn(),
  removeAllListeners: jest.fn(),
});

// PropertyCache Mock
export const createMockPropertyCache = () => ({
  cacheProperty: jest.fn(),
  getProperty: jest.fn(),
  invalidateProperty: jest.fn(),
  getClientProperties: jest.fn(),
  saveClientProperties: jest.fn(),
  invalidatePropertyLists: jest.fn(),
  clearAll: jest.fn(),
});

// UnitNumberingService Mock
export const createMockUnitNumberingService = () => ({
  validateUnitNumberUpdate: jest.fn(),
  suggestUnitNumber: jest.fn(),
  generateSequentialNumber: jest.fn(),
  parseUnitNumber: jest.fn(),
});

// PropertyCsvProcessor Mock
export const createMockPropertyCsvProcessor = () => ({
  validateCsv: jest.fn(),
  processCsv: jest.fn(),
  parseCsv: jest.fn(),
});

// PropertyUnitCsvProcessor Mock
export const createMockPropertyUnitCsvProcessor = () => ({
  validateCsv: jest.fn(),
  processCsv: jest.fn(),
  parseCsv: jest.fn(),
});

// Property Queue Mocks
export const createMockPropertyQueue = () => ({
  addCsvImportJob: jest.fn(),
  addCsvValidationJob: jest.fn(),
  process: jest.fn(),
  close: jest.fn(),
});

export const createMockPropertyUnitQueue = () => ({
  addUnitBatchCreationJob: jest.fn(),
  process: jest.fn(),
  close: jest.fn(),
});

export const createMockUploadQueue = () => ({
  addToUploadQueue: jest.fn(),
  process: jest.fn(),
  close: jest.fn(),
});

// Property Service Mock
export const createMockPropertyService = () => ({
  addProperty: jest.fn(),
  addPropertiesFromCsv: jest.fn(),
  updatePropertyDocuments: jest.fn(),
  validateCsv: jest.fn(),
  getClientProperties: jest.fn(),
  getClientProperty: jest.fn(),
  updateClientProperty: jest.fn(),
  archiveClientProperty: jest.fn(),
  markDocumentsAsFailed: jest.fn(),
  getUnitInfoForProperty: jest.fn(),
  destroy: jest.fn(),
});

// Property Unit Service Mock
export const createMockPropertyUnitService = () => ({
  addPropertyUnit: jest.fn(),
  getPropertyUnit: jest.fn(),
  getPropertyUnits: jest.fn(),
  updatePropertyUnit: jest.fn(),
  updateUnitStatus: jest.fn(),
  archiveUnit: jest.fn(),
  setupInspection: jest.fn(),
  addDocumentToUnit: jest.fn(),
  deleteDocumentFromUnit: jest.fn(),
  validateUnitsCsv: jest.fn(),
  importUnitsFromCsv: jest.fn(),
});

// Property Validation Service Mock
export const createMockPropertyValidationService = () => ({
  validateCurrency: jest.fn().mockReturnValue([]),
  validateDate: jest.fn().mockReturnValue([]),
  validateNumericField: jest.fn().mockReturnValue([]),
  validateProperty: jest.fn().mockReturnValue({ valid: true, errors: [] }),
  validateFieldByType: jest.fn().mockReturnValue([]),
});

// Validation Result Mock
export const createMockValidationResult = (overrides = {}) => ({
  valid: true,
  errors: [],
  ...overrides,
});

// Property Validation Rules Mock
export const createMockPropertyValidationRules = (overrides = {}) => ({
  minTotalArea: 500,
  maxUnits: 100,
  allowBedrooms: true,
  allowBathrooms: true,
  ...overrides,
});
