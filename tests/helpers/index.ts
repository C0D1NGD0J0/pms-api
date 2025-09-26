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

// Export all mock factories from mockFactories.ts
export {
  createValidObjectIdString,
  createMockRequestContext,
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
  createMockProperty,
  createMockProfile,
  createMockSession,
  createMockClient,
  createMockUser,
  createMockFile,
  createObjectId,
  createMockVendor,
  createMockVendorDocument,
  createMockNewVendor,
  createMockCompanyProfile,
} from './mockFactories';

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
  createMockAwilixContainer,
  createScopedTestContainer,
  setupTestContainer,
} from './mocks/container.mocks';

export {
  createMockVendorDAO,
  createMockVendorService,
} from './mocks/vendor.mocks';

export {
  createMockAssetService,
  createMockMediaUploadService,
  createMockUploadResult,
} from './mocks/mediaUpload.mocks';


export * from './testUtils';

// Centralized base mocks
export * from './mocks/baseDAO.mocks';
export * from './mocks/models.mocks';
export * from './mocks/services.mocks';
