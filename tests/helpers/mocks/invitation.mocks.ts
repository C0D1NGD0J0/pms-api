import { faker } from '@faker-js/faker';
import { ClientSession, Types } from 'mongoose';
import { IUserRole } from '@interfaces/user.interface';
import { EmailFailedPayload, EmailSentPayload, EventTypes } from '@interfaces/events.interface';
import { ExtractedMediaFile, IRequestContext, RequestSource, MailType } from '@interfaces/index';
import {
  IInvitationAcceptance,
  ISendInvitationResult,
  IInvitationListQuery,
  IInvitationDocument,
  IInvitationStats,
  IInvitationData,
} from '@interfaces/invitation.interface';

import {
  createMockCurrentUser,
  createSuccessResponse,
  createMockProfile,
  createMockSession,
  createMockClient,
  createMockUser,
} from '../mockFactories';

// Factory Functions for Invitation-Related Data Structures

/**
 * Creates a mock invitation document with proper interfaces and virtual properties
 */
export const createMockInvitation = (
  overrides: Partial<IInvitationDocument> = {}
): Partial<IInvitationDocument> => ({
  _id: new Types.ObjectId(),
  iuid: faker.string.uuid(),
  inviteeEmail: faker.internet.email().toLowerCase(),
  invitationToken: faker.string.alphanumeric(32),
  personalInfo: {
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    phoneNumber: faker.phone.number(),
  },
  role: faker.helpers.arrayElement(Object.values(IUserRole)),
  status: faker.helpers.arrayElement([
    'draft',
    'pending',
    'accepted',
    'expired',
    'revoked',
    'sent',
  ]),
  invitedBy: new Types.ObjectId(),
  clientId: new Types.ObjectId(),
  expiresAt: faker.date.future(),
  metadata: {
    inviteMessage: faker.lorem.sentences(2),
    expectedStartDate: faker.date.future(),
    remindersSent: faker.number.int({ min: 0, max: 3 }),
    lastReminderSent: faker.date.recent(),
  },
  acceptedBy: undefined,
  revokedBy: undefined,
  acceptedAt: undefined,
  revokedAt: undefined,
  revokeReason: undefined,
  createdAt: faker.date.recent(),
  updatedAt: faker.date.recent(),

  get inviteeFullName() {
    return `${this.personalInfo?.firstName} ${this.personalInfo?.lastName}`;
  },

  isValid: jest.fn().mockReturnValue(true),
  revoke: jest.fn().mockResolvedValue({}),
  accept: jest.fn().mockResolvedValue({}),
  expire: jest.fn().mockResolvedValue({}),

  ...overrides,
});

/**
 * Creates mock invitation data for sending invitations
 */
export const createMockInvitationData = (
  overrides: Partial<IInvitationData> = {}
): IInvitationData => ({
  inviteeEmail: faker.internet.email().toLowerCase(),
  personalInfo: {
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    phoneNumber: faker.phone.number(),
  },
  role: faker.helpers.arrayElement(Object.values(IUserRole)),
  status: faker.helpers.arrayElement(['draft', 'pending']),
  metadata: {
    inviteMessage: faker.lorem.sentences(2),
    expectedStartDate: faker.date.future(),
  },
  ...overrides,
});

/**
 * Creates mock invitation acceptance data
 */
export const createMockInvitationAcceptance = (
  overrides: Partial<IInvitationAcceptance> = {}
): IInvitationAcceptance => ({
  invitationToken: faker.string.alphanumeric(32),
  cuid: faker.string.uuid(),
  userData: {
    password: faker.internet.password(),
    location: faker.location.city(),
    timeZone: faker.location.timeZone(),
    lang: 'en',
    bio: faker.lorem.paragraph(),
    headline: faker.lorem.sentence(),
  },
  ...overrides,
});

/**
 * Creates mock invitation stats
 */
export const createMockInvitationStats = (
  overrides: Partial<IInvitationStats> = {}
): IInvitationStats => ({
  total: faker.number.int({ min: 10, max: 100 }),
  pending: faker.number.int({ min: 0, max: 20 }),
  accepted: faker.number.int({ min: 0, max: 50 }),
  expired: faker.number.int({ min: 0, max: 10 }),
  revoked: faker.number.int({ min: 0, max: 5 }),
  sent: faker.number.int({ min: 0, max: 30 }),
  byRole: {
    [IUserRole.ADMIN]: faker.number.int({ min: 0, max: 5 }),
    [IUserRole.MANAGER]: faker.number.int({ min: 0, max: 10 }),
    [IUserRole.STAFF]: faker.number.int({ min: 0, max: 20 }),
    [IUserRole.VENDOR]: faker.number.int({ min: 0, max: 15 }),
    [IUserRole.TENANT]: faker.number.int({ min: 0, max: 30 }),
  },
  ...overrides,
});

/**
 * Creates mock send invitation result
 */
export const createMockSendInvitationResult = (
  overrides: Partial<ISendInvitationResult> = {}
): ISendInvitationResult => ({
  invitation: createMockInvitation() as IInvitationDocument,
  emailData: {
    to: faker.internet.email(),
    subject: faker.lorem.sentence(),
    data: {
      inviteeName: faker.person.fullName(),
      inviterName: faker.person.fullName(),
      companyName: faker.company.name(),
      role: faker.helpers.arrayElement(Object.values(IUserRole)),
      invitationUrl: faker.internet.url(),
      expiresAt: faker.date.future(),
      customMessage: faker.lorem.sentences(2),
    },
  },
  ...overrides,
});

// DAO Mocks

/**
 * Creates a comprehensive mock for InvitationDAO with all required methods
 */
export const createMockInvitationDAO = () => ({
  findFirst: jest.fn().mockResolvedValue(createMockInvitation()),
  list: jest.fn().mockResolvedValue({
    items: [createMockInvitation()],
    pagination: { total: 1, page: 1, pages: 1, limit: 10 },
  }),
  insert: jest.fn().mockResolvedValue(createMockInvitation()),
  updateById: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  deleteById: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
  startSession: jest.fn().mockImplementation(() => createMockSession()),
  withTransaction: jest
    .fn()
    .mockImplementation(
      async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
        return await callback(session);
      }
    ),

  createInvitation: jest.fn().mockResolvedValue(createMockInvitation()),
  findByToken: jest.fn().mockResolvedValue(createMockInvitation()),
  findByIuid: jest.fn().mockResolvedValue(createMockInvitation()),
  findByIuidUnsecured: jest.fn().mockResolvedValue(createMockInvitation()),
  findPendingInvitation: jest.fn().mockResolvedValue(null),
  getInvitationsByClient: jest.fn().mockResolvedValue({
    items: [createMockInvitation()],
    pagination: { total: 1, page: 1, pages: 1, limit: 10 },
  }),
  getInvitationsByEmail: jest.fn().mockResolvedValue([createMockInvitation()]),
  getInvitationStats: jest.fn().mockResolvedValue(createMockInvitationStats()),
  updateInvitationStatus: jest.fn().mockResolvedValue(createMockInvitation()),
  revokeInvitation: jest.fn().mockResolvedValue(createMockInvitation()),
  acceptInvitation: jest.fn().mockResolvedValue(createMockInvitation()),
  incrementReminderCount: jest.fn().mockResolvedValue(createMockInvitation()),
  getInvitationsNeedingReminders: jest.fn().mockResolvedValue([createMockInvitation()]),
  expireInvitations: jest.fn().mockResolvedValue(5),
  getInvitations: jest.fn().mockResolvedValue({
    items: [createMockInvitation()],
    pagination: { total: 1, page: 1, pages: 1, limit: 10 },
  }),
});

/**
 * Creates a mock for ClientDAO with invitation-related methods
 */
export const createMockClientDAO = () => ({
  findFirst: jest.fn().mockResolvedValue(createMockClient()),
  list: jest.fn().mockResolvedValue({ items: [createMockClient()], pagination: undefined }),
  insert: jest.fn().mockResolvedValue(createMockClient()),
  updateById: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  deleteById: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
  startSession: jest.fn().mockImplementation(() => createMockSession()),
  withTransaction: jest
    .fn()
    .mockImplementation(
      async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
        return await callback(session);
      }
    ),

  getClientBycuid: jest.fn().mockResolvedValue(createMockClient()),
  getClientById: jest.fn().mockResolvedValue(createMockClient()),
});

/**
 * Creates a mock for UserDAO with invitation-related methods
 */
export const createMockUserDAO = () => ({
  findFirst: jest.fn().mockResolvedValue(createMockUser()),
  list: jest.fn().mockResolvedValue({ items: [createMockUser()], pagination: undefined }),
  insert: jest.fn().mockResolvedValue(createMockUser()),
  updateById: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  deleteById: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
  startSession: jest.fn().mockImplementation(() => createMockSession()),
  withTransaction: jest
    .fn()
    .mockImplementation(
      async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
        return await callback(session);
      }
    ),

  getUserById: jest.fn().mockResolvedValue(createMockUser()),
  getUserByUId: jest.fn().mockResolvedValue(createMockUser()),

  createUserFromInvitation: jest.fn().mockResolvedValue(createMockUser()),
  addUserToClient: jest.fn().mockResolvedValue(createMockUser()),
});

/**
 * Creates a mock for ProfileDAO with invitation-related methods
 */
export const createMockProfileDAO = () => ({
  findFirst: jest.fn().mockResolvedValue(createMockProfile()),
  list: jest.fn().mockResolvedValue({ items: [createMockProfile()], pagination: undefined }),
  insert: jest.fn().mockResolvedValue(createMockProfile()),
  updateById: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  deleteById: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
  startSession: jest.fn().mockImplementation(() => createMockSession()),
  withTransaction: jest
    .fn()
    .mockImplementation(
      async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
        return await callback(session);
      }
    ),

  createUserProfile: jest.fn().mockResolvedValue(createMockProfile()),
  getUserProfile: jest.fn().mockResolvedValue(createMockProfile()),
  updateProfile: jest.fn().mockResolvedValue(createMockProfile()),
  generateCurrentUserInfo: jest.fn().mockResolvedValue(createMockCurrentUser()),
});

// Queue Mocks

/**
 * Creates a mock for EmailQueue with invitation-related functionality
 */
export const createMockEmailQueue = () => ({
  addToEmailQueue: jest.fn().mockReturnValue(undefined),
  processQueueJobs: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn().mockResolvedValue(true),

  addJobToQueue: jest.fn().mockResolvedValue({ id: faker.string.uuid() }),
  getQueueHealth: jest.fn().mockReturnValue({ waiting: 0, active: 0, completed: 10, failed: 0 }),
});

/**
 * Creates a mock for InvitationQueue with CSV processing functionality
 */
export const createMockInvitationQueue = () => ({
  addToQueue: jest.fn().mockResolvedValue(true),
  processQueueJobs: jest.fn().mockResolvedValue(true),
  shutdown: jest.fn().mockResolvedValue(true),

  addCsvValidationJob: jest.fn().mockResolvedValue({ id: faker.string.uuid() }),
  addCsvImportJob: jest.fn().mockResolvedValue({ id: faker.string.uuid() }),

  addJobToQueue: jest.fn().mockResolvedValue({ id: faker.string.uuid() }),
  getQueueHealth: jest.fn().mockReturnValue({ waiting: 0, active: 0, completed: 10, failed: 0 }),
});

/**
 * Creates a mock for EventEmitterService with proper typing
 */
export const createMockEventEmitterService = () => ({
  emit: jest.fn().mockReturnValue(true),
  on: jest.fn().mockReturnValue(undefined),
  off: jest.fn().mockReturnValue(undefined),
  destroy: jest.fn().mockResolvedValue(undefined),

  listenerCount: jest.fn().mockReturnValue(1),
  removeAllListeners: jest.fn().mockReturnValue(undefined),
});

/**
 * Creates a comprehensive mock for InvitationService with all methods properly typed
 */
export const createMockInvitationService = () => ({
  sendInvitation: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse(createMockSendInvitationResult(), 'Invitation sent successfully')
    ),

  acceptInvitation: jest.fn().mockResolvedValue(
    createSuccessResponse(
      {
        user: createMockUser(),
        invitation: createMockInvitation(),
      },
      'Invitation accepted successfully'
    )
  ),

  getInvitationByIuid: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse(createMockInvitation(), 'Invitation retrieved successfully')
    ),

  validateInvitationByToken: jest.fn().mockResolvedValue(
    createSuccessResponse(
      {
        invitation: createMockInvitation(),
        isValid: true,
        client: {
          cuid: faker.string.uuid(),
          displayName: faker.company.name(),
          companyName: faker.company.name(),
        },
      },
      'Invitation token is valid'
    )
  ),

  revokeInvitation: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse(createMockInvitation(), 'Invitation revoked successfully')
    ),

  resendInvitation: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse(createMockSendInvitationResult(), 'Invitation resent successfully')
    ),

  getInvitations: jest.fn().mockResolvedValue(
    createSuccessResponse(
      {
        items: [createMockInvitation()],
        pagination: { total: 1, page: 1, pages: 1, limit: 10 },
      },
      'Invitations retrieved successfully'
    )
  ),

  getInvitationStats: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse(createMockInvitationStats(), 'Statistics retrieved successfully')
    ),

  expireInvitations: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse({ expiredCount: 5 }, 'Invitations expired successfully')
    ),

  validateInvitationCsv: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse({ processId: faker.string.uuid() }, 'CSV validation started')
    ),

  importInvitationsFromCsv: jest
    .fn()
    .mockResolvedValue(
      createSuccessResponse({ processId: faker.string.uuid() }, 'CSV import started')
    ),

  processPendingInvitations: jest.fn().mockResolvedValue(
    createSuccessResponse(
      {
        processed: 10,
        failed: 0,
        skipped: 0,
        totalFound: 10,
        errors: undefined,
      },
      'Pending invitations processed successfully'
    )
  ),

  destroy: jest.fn().mockReturnValue(undefined),
});

// Event Payload Factories

/**
 * Creates mock email sent payload for event testing
 */
export const createMockEmailSentPayload = (
  overrides: Partial<EmailSentPayload> = {}
): EmailSentPayload => ({
  emailType: MailType.INVITATION,
  jobData: {
    invitationId: new Types.ObjectId().toString(),
    data: {
      clientId: new Types.ObjectId().toString(),
    },
  },
  sentAt: new Date(),
  ...overrides,
});

/**
 * Creates mock email failed payload for event testing
 */
export const createMockEmailFailedPayload = (
  overrides: Partial<EmailFailedPayload> = {}
): EmailFailedPayload => ({
  emailType: MailType.INVITATION,
  to: faker.internet.email(),
  subject: faker.lorem.sentence(),
  error: {
    message: 'Email delivery failed',
    code: 'EMAIL_DELIVERY_FAILED',
  },
  jobData: {
    invitationId: new Types.ObjectId().toString(),
  },
  ...overrides,
});

// Helper Functions

/**
 * Creates a mock invitation list query with default values
 */
export const createMockInvitationListQuery = (
  overrides: Partial<IInvitationListQuery> = {}
): IInvitationListQuery => ({
  clientId: faker.string.uuid(),
  status: faker.helpers.arrayElement([
    'draft',
    'pending',
    'accepted',
    'expired',
    'revoked',
    'sent',
  ]),
  sortBy: 'createdAt',
  sortOrder: 'desc',
  limit: 10,
  page: 1,
  ...overrides,
});

export const createMockExtractedMediaFile = (
  overrides: Partial<ExtractedMediaFile> = {}
): ExtractedMediaFile => ({
  originalFileName: faker.system.fileName(),
  fieldName: faker.helpers.arrayElement(['document', 'image', 'avatar', 'attachment', 'media']),
  mimeType: faker.helpers.arrayElement([
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ]),
  path: faker.system.filePath(),
  url: faker.internet.url(),
  key: faker.string.alphanumeric(32),
  status: faker.helpers.arrayElement(['pending', 'active', 'inactive', 'deleted']),
  filename: faker.system.fileName(),
  fileSize: faker.number.int({ min: 1000, max: 10 * 1024 * 1024 }),
  uploadedAt: faker.date.recent(),
  uploadedBy: new Types.ObjectId().toString(),
  ...overrides,
});

/**
 * Creates a mock request context for invitation testing
 */
export const createMockInvitationRequestContext = (
  overrides: Partial<IRequestContext> = {}
): IRequestContext => ({
  userAgent: {
    browser: 'Chrome',
    version: '91.0',
    os: 'Windows',
    raw: 'Mozilla/5.0...',
    isMobile: false,
    isBot: false,
  },
  request: {
    path: '/api/v1/invitations',
    method: 'POST',
    params: { cuid: faker.string.uuid() },
    url: '/api/v1/invitations',
    query: {},
  },
  langSetting: {
    lang: 'en',
    t: jest.fn().mockImplementation((key: string) => key),
  },
  timing: {
    startTime: Date.now(),
  },
  currentuser: createMockCurrentUser(),
  service: { env: 'test' },
  source: RequestSource.WEB,
  requestId: faker.string.uuid(),
  timestamp: new Date(),
  ip: faker.internet.ip(),
  ...overrides,
});

export { EventTypes, MailType };
