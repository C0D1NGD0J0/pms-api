// Export all mock factories from mockFactories.ts
export {
  createValidObjectIdString,
  createMockRequestContext,
  createMockVendorDocument,
  createMockCompanyProfile,
  createMockPropertyUnit,
  createMockTokenPayload,
  createMockCurrentUser,
  createMockNewProperty,
  createSuccessResponse,
  createMockSignupData,
  createMockInvitation,
  createMockJWTTokens,
  createMockEmailData,
  createErrorResponse,
  createMockNewVendor,
  createMockProperty,
  createMockProfile,
  createMockSession,
  createMockClient,
  createMockVendor,
  createMockUser,
  createMockFile,
  createObjectId,
} from './mockFactories';

export {
  createMockPropertyValidationService,
  createMockPropertyUnitCsvProcessor,
  createMockPropertyValidationRules,
  createMockPropertyCsvProcessor,
  createMockUnitNumberingService,
  createMockPropertyUnitService,
  createMockPropertyUnitQueue,
  createMockValidationResult,
  createMockPropertyService,
  createMockPropertyUnitDAO,
  createMockGeoCoderService,
  createMockPropertyCache,
  createMockPropertyQueue,
  createMockPropertyDAO,
  createMockUploadQueue,
} from './mocks/property.mocks';

// Export all invitation-related mocks
export {
  createMockInvitationRequestContext,
  createMockInvitationAcceptance,
  createMockSendInvitationResult,
  createMockEventEmitterService,
  createMockInvitationListQuery,
  createMockExtractedMediaFile,
  createMockEmailFailedPayload,
  createMockEmailSentPayload,
  createMockInvitationStats,
  createMockInvitationQueue,
  createMockInvitationData,
  createMockInvitationDAO,
  createMockEmailQueue,
  EventTypes,
  MailType,
} from './mocks/invitation.mocks';

// Export notification mocks
export {
  createMockCreateNotificationRequest,
  createMockNotificationListResponse,
  createNotificationSuccessResponse,
  createMockNotificationResponse,
  createMockNotificationService,
  createMockUnreadCountResponse,
  createMockNotificationDAO,
  createMockSSEService,
  createMockSSESession,
  createMockSSEMessage,
} from './mocks/notification.mocks';

// Export all client-related mocks (excluding InvitationDAO which is better implemented in invitation.mocks.ts)
// ProfileDAO is exported from profile.mocks.ts instead for more complete implementation
export {
  createMockInvitationService,
  createMockClientService,
  mockGetRequestDuration,
  createMockCustomErrors,
  createMockClientDAO,
  createMockUserDAO,
  createMockLogger,
  mockCreateLogger,
  mockTranslation,
} from './mocks/client.mocks';

export {
  createMockDocumentProcessingQueue,
  createMockDatabaseService,
  createMockEmitterService,
  createMockEventBusQueue,
  createMockRedisService,
  createMockS3Service,
} from './mocks/infrastructure.mocks';

export {
  createMockTranslationFunction,
  createMockProfileValidations,
  createMockProfileService,
  createMockEmployeeInfo,
  createMockProfileDAO,
  createMockVendorInfo,
} from './mocks/profile.mocks';

// Export additional mocks that might be needed
export {
  createMockPermissionService,
  createMockAuthTokenService,
  createMockAuthService,
  createMockAuthCache,
} from './mocks/auth.mocks';

export {
  createMockMediaUploadService,
  createMockAssetService,
  createMockUploadResult,
} from './mocks/mediaUpload.mocks';

export {
  createMockAwilixContainer,
  createScopedTestContainer,
  setupTestContainer,
} from './mocks/container.mocks';

export { createMockVendorService, createMockVendorDAO } from './mocks/vendor.mocks';

export * from './mocks/services.mocks';

// Centralized base mocks
export * from './mocks/baseDAO.mocks';
export * from './mocks/models.mocks';
// API test helpers
export * from './apiTestHelper';

export * from './testUtils';
