/**
 * External Service Mocks
 *
 * Mock only external services (S3, email, queues, payment APIs, etc.)
 * DO NOT mock database, models, or internal services.
 */

import { jest } from '@jest/globals';

// =============================================================================
// AWS S3 Mock
// =============================================================================

export const mockS3Client = {
  send: jest.fn() as any,
};

export const setupS3Mocks = () => {
  mockS3Client.send.mockResolvedValue({
    ETag: '"mock-etag-12345"',
    Location: 'https://mock-bucket.s3.amazonaws.com/mock-key',
  });
};

export const resetS3Mocks = () => {
  mockS3Client.send.mockClear();
};

// =============================================================================
// Email Service Mock (NodeMailer, SendGrid, etc.)
// =============================================================================

export const mockEmailTransporter = {
  sendMail: jest.fn() as any,
  verify: jest.fn() as any,
};

export const setupEmailMocks = () => {
  mockEmailTransporter.sendMail.mockResolvedValue({
    messageId: 'mock-message-id-12345',
    accepted: ['recipient@example.com'],
    rejected: [],
    response: '250 OK',
  });

  mockEmailTransporter.verify.mockResolvedValue(true);
};

export const resetEmailMocks = () => {
  mockEmailTransporter.sendMail.mockClear();
  mockEmailTransporter.verify.mockClear();
};

// =============================================================================
// Queue Mock (Bull/BullMQ)
// =============================================================================

export const mockQueue = {
  add: jest.fn() as any,
  process: jest.fn() as any,
  on: jest.fn() as any,
  close: jest.fn() as any,
  getJob: jest.fn() as any,
  getJobs: jest.fn() as any,
};

export const mockEmailQueue = {
  addToEmailQueue: jest.fn().mockResolvedValue({ success: true }),
  add: jest.fn(),
  process: jest.fn(),
  on: jest.fn(),
  close: jest.fn(),
} as any;

export const mockInvitationQueue = {
  addCsvValidationJob: jest.fn().mockResolvedValue({ jobId: 'job-123' }),
  addCsvImportJob: jest.fn().mockResolvedValue({ jobId: 'job-456' }),
  add: jest.fn(),
  process: jest.fn(),
  on: jest.fn(),
  close: jest.fn(),
} as any;

export const mockQueueFactory = {
  getQueue: jest.fn((queueName: string) => {
    if (queueName.includes('email')) return mockEmailQueue;
    if (queueName.includes('invitation')) return mockInvitationQueue;
    return mockQueue;
  }),
};

export const setupQueueMocks = () => {
  mockQueue.add.mockResolvedValue({
    id: 'mock-job-id',
    data: {},
    opts: {},
  });

  mockQueue.getJob.mockResolvedValue(null);
  mockQueue.getJobs.mockResolvedValue([]);
  mockQueue.close.mockResolvedValue(undefined);

  mockEmailQueue.addToEmailQueue.mockResolvedValue({ success: true });
  mockEmailQueue.add.mockResolvedValue({ id: 'email-job-id' });

  mockInvitationQueue.addCsvValidationJob.mockResolvedValue({ jobId: 'job-123' });
  mockInvitationQueue.addCsvImportJob.mockResolvedValue({ jobId: 'job-456' });
};

export const resetQueueMocks = () => {
  mockQueue.add.mockClear();
  mockQueue.process.mockClear();
  mockQueue.on.mockClear();
  mockQueue.close.mockClear();
  mockQueue.getJob.mockClear();
  mockQueue.getJobs.mockClear();

  mockEmailQueue.addToEmailQueue.mockClear();
  mockEmailQueue.add.mockClear();
  mockEmailQueue.process.mockClear();
  mockEmailQueue.on.mockClear();
  mockEmailQueue.close.mockClear();

  mockInvitationQueue.addCsvValidationJob.mockClear();
  mockInvitationQueue.addCsvImportJob.mockClear();
  mockInvitationQueue.add.mockClear();
  mockInvitationQueue.process.mockClear();
  mockInvitationQueue.on.mockClear();
  mockInvitationQueue.close.mockClear();

  mockQueueFactory.getQueue.mockClear();
};

// =============================================================================
// Auth Cache Mock (Redis)
// =============================================================================

export const mockAuthCache = {
  saveRefreshToken: jest.fn().mockResolvedValue({ success: true }),
  getRefreshToken: jest.fn().mockResolvedValue({ success: true }),
  deleteRefreshToken: jest.fn().mockResolvedValue({ success: true }),
  saveCurrentUser: jest.fn().mockResolvedValue({ success: true }),
  getCurrentUser: jest.fn().mockResolvedValue(null),
  deleteCurrentUser: jest.fn().mockResolvedValue({ success: true }),
} as any;

export const setupAuthCacheMocks = () => {
  mockAuthCache.saveRefreshToken.mockResolvedValue({ success: true });
  mockAuthCache.getRefreshToken.mockResolvedValue({ success: true });
  mockAuthCache.deleteRefreshToken.mockResolvedValue({ success: true });
  mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });
  mockAuthCache.getCurrentUser.mockResolvedValue(null);
  mockAuthCache.deleteCurrentUser.mockResolvedValue({ success: true });
};

export const resetAuthCacheMocks = () => {
  mockAuthCache.saveRefreshToken.mockClear();
  mockAuthCache.getRefreshToken.mockClear();
  mockAuthCache.deleteRefreshToken.mockClear();
  mockAuthCache.saveCurrentUser.mockClear();
  mockAuthCache.getCurrentUser.mockClear();
  mockAuthCache.deleteCurrentUser.mockClear();
};

// =============================================================================
// Auth Token Service Mock
// =============================================================================

export const mockTokenService = {
  createJwtTokens: jest.fn().mockReturnValue({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    rememberMe: false,
  }),
  verifyJwtToken: jest.fn().mockResolvedValue({
    success: true,
    data: { sub: 'user-id', csub: 'client-cuid' },
  }),
  generateToken: jest.fn().mockReturnValue('mock-token'),
} as any;

export const setupTokenServiceMocks = () => {
  mockTokenService.createJwtTokens.mockReturnValue({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    rememberMe: false,
  });
  mockTokenService.verifyJwtToken.mockResolvedValue({
    success: true,
    data: { sub: 'user-id', csub: 'client-cuid' },
  });
  mockTokenService.generateToken.mockReturnValue('mock-token');
};

export const resetTokenServiceMocks = () => {
  mockTokenService.createJwtTokens.mockClear();
  mockTokenService.verifyJwtToken.mockClear();
  mockTokenService.generateToken.mockClear();
};

// =============================================================================
// Event Emitter Mock
// =============================================================================

export const mockEventEmitter = {
  emit: jest.fn() as any,
  on: jest.fn() as any,
  off: jest.fn() as any,
};

export const setupEventEmitterMocks = () => {
  mockEventEmitter.emit.mockReturnValue(true);
  mockEventEmitter.on.mockReturnValue(mockEventEmitter);
  mockEventEmitter.off.mockReturnValue(mockEventEmitter);
};

export const resetEventEmitterMocks = () => {
  mockEventEmitter.emit.mockClear();
  mockEventEmitter.on.mockClear();
  mockEventEmitter.off.mockClear();
};

// =============================================================================
// Setup All Mocks
// =============================================================================

/**
 * Initialize all external service mocks
 * Call this in jest.setup.ts
 */
export const setupAllExternalMocks = () => {
  setupS3Mocks();
  setupEmailMocks();
  setupQueueMocks();
  setupAuthCacheMocks();
  setupTokenServiceMocks();
  setupEventEmitterMocks();
};

/**
 * Reset all external service mocks
 * Call this in beforeEach or afterEach hooks
 */
export const resetAllExternalMocks = () => {
  resetS3Mocks();
  resetEmailMocks();
  resetQueueMocks();
  resetAuthCacheMocks();
  resetTokenServiceMocks();
  resetEventEmitterMocks();
};
