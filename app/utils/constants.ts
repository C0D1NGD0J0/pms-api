import { IUserRole } from '@shared/constants/roles.constants';
import { IPropertyFilterQuery, EmployeeDepartment } from '@interfaces/index';

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
  NOT_IMPLEMENTED: 501,
};

export const JWT_KEY_NAMES = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
};

export const SLUGIFY_CONFIG = { lower: true, strict: true, replacement: '_', trim: true };
export const EMPLOYEE_ROLE = 'employee';

export const EMAIL_TEMPLATES = {
  PASSWORD_RESET: 'password-reset',
  FORGOT_PASSWORD: 'forgot-password',
  ACCOUNT_ACTIVATION: 'account-activation',
};

export const QUEUE_NAMES = {
  CRON_QUEUE: 'cronQueue',
  MEDIA_QUEUE: 'mediaQueue',
  EMAIL_QUEUE: 'emailQueue',
  PROPERTY_QUEUE: 'propertyQueue',
  EVENT_BUS_QUEUE: 'eventBusQueue',
  INVITATION_QUEUE: 'invitationQueue',
  PROPERTY_UNIT_QUEUE: 'propertyUnitQueue',
  PDF_GENERATION_QUEUE: 'pdfGenerationQueue',
  ACCOUNT_ACTIVATION_QUEUE: 'accountActivationQueue',
  DOCUMENT_PROCESSING_QUEUE: 'documentProcessingQueue',
  LEASE_SIGNATURE_REQUEST_QUEUE: 'leaseSignatureRequestQueue',
  PROPERTY_MEDIA_PROCESSING_QUEUE: 'propertyMediaProcessingQueue',
};

export const JOB_NAME = {
  CSV_IMPORT_JOB: 'csv_import',
  INVITATION_JOB: 'invitationJob',
  USER_CREATED_JOB: 'userCreatedJob',
  MEDIA_UPLOAD_JOB: 'mediaUploadJob',
  CSV_VALIDATION_JOB: 'csv_validation',
  MEDIA_REMOVAL_JOB: 'mediaRemovalJob',
  PDF_GENERATION_JOB: 'pdfGenerationJob',
  REQUEST_SIGNATURE: 'request_signature',
  PROPERTY_UPDATE_JOB: 'propertyUpdateJob',
  PROPERTY_DELETE_JOB: 'propertyDeleteJob',
  DOCUMENT_UPDATE_JOB: 'documentUpdateJob',
  PROPERTY_CREATE_JOB: 'propertyCreateJob',
  DOCUMENT_FAILURE_JOB: 'documentFailureJob',
  UNIT_BATCH_CREATION_JOB: 'unitBatchCreation',
  ACCOUNT_ACTIVATION_JOB: 'accountActivationJob',
  INVITATION_REMINDER_JOB: 'invitationReminderJob',
  INVITATION_CSV_IMPORT_JOB: 'invitation_csv_import',
  INVITATION_CSV_VALIDATION_JOB: 'invitation_csv_validation',
  INVITATION_BULK_USER_IMPORT_JOB: 'invitation_bulk_user_import',
  INVITATION_BULK_USER_VALIDATION_JOB: 'invitation_bulk_user_validation',
  LEASE_ENDING_SOON_JOB: 'leaseEndingSoonJob',
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

/**
 * Departments allowed to create properties (with approval required)
 */
export const PROPERTY_CREATION_ALLOWED_DEPARTMENTS: EmployeeDepartment[] = [
  EmployeeDepartment.OPERATIONS,
  EmployeeDepartment.MANAGEMENT,
];

/**
 * Roles that can approve/reject properties immediately
 */
export const PROPERTY_APPROVAL_ROLES = [IUserRole.ADMIN, IUserRole.MANAGER];

/**
 * Roles that require approval for property creation
 */
export const PROPERTY_STAFF_ROLES = [IUserRole.STAFF];

/**
 * Unit fields that require approval when modified (high-impact changes)
 */
export const HIGH_IMPACT_UNIT_FIELDS = [
  'fees.rentAmount',
  'fees.securityDeposit',
  'status',
  'unitNumber',
  'specifications.bedrooms',
  'specifications.rooms',
  'specifications.bathrooms',
  'specifications.totalArea',
  'currentLease',
  'floor', // if changing floor affects rent
];

/**
 * Unit fields that can be modified without approval (operational changes)
 */
export const OPERATIONAL_UNIT_FIELDS = [
  'notes',
  'description',
  'inspections',
  'documents',
  'media.photos',
  'amenities',
  'utilities',
  'deletedAt',
  'lastModifiedBy',
];

/**
 * Lease fields that require approval when modified (high-impact changes)
 */
export const HIGH_IMPACT_LEASE_FIELDS = [
  'fees',
  'duration',
  'status',
  'type',
  'tenantId',
  'property',
];

/**
 * Lease fields that can be modified without approval (operational changes)
 */
export const OPERATIONAL_LEASE_FIELDS = [
  'internalNotes',
  'petPolicy',
  'utilitiesIncluded',
  'legalTerms',
  'renewalOptions',
  'coTenants',
];

/**
 * Immutable lease fields that cannot be changed after creation (top-level only)
 */
export const IMMUTABLE_LEASE_FIELDS = [
  'tenantId',
  'cuid',
  'luid',
  'leaseNumber',
  'createdAt',
  'createdBy',
  'tenantInfo',
];

/**
 * Fields that when modified invalidate existing signatures (top-level only)
 */
export const SIGNATURE_INVALIDATING_LEASE_FIELDS = ['fees', 'duration', 'petPolicy', 'type'];

/**
 * Editable fields by lease status (top-level only)
 * Note: If a field is in the list, the ENTIRE field object can be updated
 */
export const EDITABLE_FIELDS_BY_LEASE_STATUS: Record<string, string[]> = {
  draft: ['*'], // All fields editable in draft
  pending_signature: ['internalNotes'],
  active: ['internalNotes', 'renewalOptions'],
  expired: ['internalNotes'], // Admin/Manager only
  terminated: ['internalNotes'], // Admin/Manager only
  cancelled: ['internalNotes'], // Admin/Manager only
};

/**
 * Constants for lease thresholds and configuration
 */
export const LEASE_CONSTANTS = {
  EXPIRY_THRESHOLDS: [
    { days: 30, name: '30_day_notice' },
    { days: 14, name: '14_day_notice' },
    { days: 7, name: '7_day_notice' },
  ],
  GRACE_PERIOD_DAYS: 7,
  DEFAULT_RENEWAL_DAYS_BEFORE_EXPIRY: 30,
  DEFAULT_SEND_FOR_SIGNATURE_DAYS: 14,
  MINIMUM_ACTIVE_DURATION_DAYS: 30,
} as const;
