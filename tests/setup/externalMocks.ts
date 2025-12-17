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
  send: jest.fn(),
};

export const setupS3Mocks = () => {
  // Mock successful upload
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
  sendMail: jest.fn(),
  verify: jest.fn(),
};

export const setupEmailMocks = () => {
  // Mock successful email send
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
  add: jest.fn(),
  process: jest.fn(),
  on: jest.fn(),
  close: jest.fn(),
  getJob: jest.fn(),
  getJobs: jest.fn(),
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
};

export const resetQueueMocks = () => {
  mockQueue.add.mockClear();
  mockQueue.process.mockClear();
  mockQueue.on.mockClear();
  mockQueue.close.mockClear();
  mockQueue.getJob.mockClear();
  mockQueue.getJobs.mockClear();
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
};

/**
 * Reset all external service mocks
 * Call this in beforeEach or afterEach hooks
 */
export const resetAllExternalMocks = () => {
  resetS3Mocks();
  resetEmailMocks();
  resetQueueMocks();
};
