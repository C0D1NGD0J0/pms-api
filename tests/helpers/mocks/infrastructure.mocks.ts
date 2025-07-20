// Redis Service Mock
export const createMockRedisService = () => ({
  client: {
    get: jest.fn().mockResolvedValue('mock-value'),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    isReady: true,
    isOpen: true,
    connect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue('OK'),
  },
  connect: jest.fn().mockResolvedValue(true),
  disconnect: jest.fn().mockResolvedValue(true),
});

// S3 Service Mock
export const createMockS3Service = () => ({
  uploadFiles: jest.fn().mockResolvedValue([
    {
      resourceId: 'property123',
      url: 'https://mock-s3-url.com/file.jpg',
      filename: 'test-image.jpg',
      size: 1024,
    },
  ]),
  deleteFiles: jest.fn().mockResolvedValue(true),
  getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.com'),
});

// Email Queue Mock
export const createMockEmailQueue = () => ({
  addToEmailQueue: jest.fn().mockResolvedValue(true),
  processQueueJobs: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn().mockResolvedValue(true),
});

// Database Service Mock
export const createMockDatabaseService = () => ({
  connect: jest.fn().mockResolvedValue(true),
  disconnect: jest.fn().mockResolvedValue(true),
  isConnected: jest.fn().mockReturnValue(true),
});

// Logger Mock
export const createMockLogger = () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  child: jest.fn().mockReturnThis(),
});

// Queue Mocks
export const createMockInvitationQueue = () => ({
  addToQueue: jest.fn().mockResolvedValue(true),
  processQueueJobs: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn().mockResolvedValue(true),
});

export const createMockPropertyQueue = () => ({
  addToQueue: jest.fn().mockResolvedValue(true),
  processQueueJobs: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn().mockResolvedValue(true),
});

export const createMockPropertyUnitQueue = () => ({
  addToQueue: jest.fn().mockResolvedValue(true),
  processQueueJobs: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn().mockResolvedValue(true),
});

export const createMockUploadQueue = () => ({
  addToQueue: jest.fn().mockResolvedValue(true),
  processQueueJobs: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn().mockResolvedValue(true),
});

export const createMockDocumentProcessingQueue = () => ({
  addToQueue: jest.fn().mockResolvedValue(true),
  processQueueJobs: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn().mockResolvedValue(true),
});

export const createMockEventBusQueue = () => ({
  addToQueue: jest.fn().mockResolvedValue(true),
  processQueueJobs: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn().mockResolvedValue(true),
});

// Emitter Service Mock
export const createMockEmitterService = () => ({
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  destroy: jest.fn().mockResolvedValue(true),
});