import { IPropertyFilterQuery } from '@interfaces/index';

export const httpStatusCodes = {
  OK: 200,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  UNPROCESSABLE: 422,
  UNAUTHORIZED: 401,
  RATE_LIMITER: 429,
  EXPIRED_AUTH_TOKEN: 419,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_SERVER_ERROR: 500,
};

export const JWT_KEY_NAMES = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
};

export const SLUGIFY_CONFIG = { lower: true, strict: true, replacement: '_', trim: true };

export const EMAIL_TEMPLATES = {
  PASSWORD_RESET: 'password-reset',
  FORGOT_PASSWORD: 'forgot-password',
  ACCOUNT_ACTIVATION: 'account-activation',
};

export const MAIL_TYPES = {
  SUBSCRIPTION_UPDATE: 'subscriptionUpdate',
  SUBSCRIPTION_CANCEL: 'subscriptionCancel',
  ACCOUNT_ACTIVATION: 'accountActivation',
  TENANT_REGISTRATION: 'tenantRegistration',
  FORGOT_PASSWORD: 'forgotPassword',
  PASSWORD_RESET: 'passwordReset',
  ACCOUNT_UPDATE: 'accountUpdate',
};

export const QUEUE_NAMES = {
  MEDIA_QUEUE: 'mediaQueue',
  EMAIL_QUEUE: 'emailQueue',
  PROPERTY_QUEUE: 'propertyQueue',
  PROPERTY_UNIT_QUEUE: 'propertyUnitQueue',
  EVENT_BUS_QUEUE: 'eventBusQueue',
  ACCOUNT_ACTIVATION_QUEUE: 'accountActivationQueue',
  PROPERTY_MEDIA_PROCESSING_QUEUE: 'propertyMediaProcessingQueue',
  DOCUMENT_PROCESSING_QUEUE: 'documentProcessingQueue',
};

export const JOB_NAME = {
  CSV_IMPORT_JOB: 'csv_import',
  MEDIA_UPLOAD_JOB: 'mediaUploadJob',
  CSV_VALIDATION_JOB: 'csv_validation',
  MEDIA_REMOVAL_JOB: 'mediaRemovalJob',
  PROPERTY_CREATE_JOB: 'propertyCreateJob',
  PROPERTY_UPDATE_JOB: 'propertyUpdateJob',
  PROPERTY_DELETE_JOB: 'propertyDeleteJob',
  ACCOUNT_ACTIVATION_JOB: 'accountActivationJob',
  DOCUMENT_UPDATE_JOB: 'documentUpdateJob',
  DOCUMENT_FAILURE_JOB: 'documentFailureJob',
  UNIT_BATCH_CREATION_JOB: 'unitBatchCreation',
};

export const defaultPagination: IPropertyFilterQuery = {
  pagination: {
    page: 1,
    limit: 10,
    sortBy: 'createdAt',
    sort: {
      createdAt: -1,
    },
    skip: 0,
  },
  filters: null,
};
