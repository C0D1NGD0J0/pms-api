import { type ZodTypeAny, z } from 'zod';

import { StandardSuccessSchema, StandardErrorSchema, openApiRegistry } from './registry';
import {
  MaintenanceRequestSummarySchema,
  MaintenanceRequestDetailSchema,
  InvitationSummarySchema,
  InspectionSummarySchema,
  InspectionDetailSchema,
  PropertySummarySchema,
  PaginationMetaSchema,
  PropertyDetailSchema,
  PaymentSummarySchema,
  LeaseSummarySchema,
  TenantDetailSchema,
  VendorDetailSchema,
  LeaseDetailSchema,
  UserProfileSchema,
} from './schemas';

// ─── Typed response helpers ───────────────────────────────────────────

function paginatedWith(schema: ZodTypeAny, name: string) {
  return {
    200: {
      description: 'Success',
      content: {
        'application/json': {
          schema: z
            .object({
              success: z.literal(true),
              data: z.object({
                items: z.array(schema),
                pagination: PaginationMetaSchema,
              }),
            })
            .openapi(`${name}ListResponse`),
        },
      },
    },
  } as const;
}

function successWith(schema: ZodTypeAny, name: string) {
  return {
    200: {
      description: 'Success',
      content: {
        'application/json': {
          schema: z
            .object({
              success: z.literal(true),
              message: z.string().optional(),
              data: schema,
            })
            .openapi(`${name}Response`),
        },
      },
    },
  } as const;
}

// ─── Security scheme ────────────────────────────────────────────────
openApiRegistry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'accessToken',
  description: 'JWT stored in an httpOnly cookie',
});

// ─── Shared parameter ──────────────────────────────────────────────
const _CuidParam = openApiRegistry.registerParameter(
  'cuid',
  z.string().openapi({
    param: { name: 'cuid', in: 'path' },
    description: 'Client unique ID (tenant isolation)',
  })
);

// ─── Helpers ───────────────────────────────────────────────────────
const cuidParams = z.object({ cuid: z.string() });

const ok200 = {
  200: {
    description: 'Success',
    content: { 'application/json': { schema: StandardSuccessSchema } },
  },
} as const;

const created201 = {
  201: {
    description: 'Created',
    content: { 'application/json': { schema: StandardSuccessSchema } },
  },
} as const;

const err400 = {
  400: {
    description: 'Bad request',
    content: { 'application/json': { schema: StandardErrorSchema } },
  },
} as const;

const err401 = {
  401: {
    description: 'Not authenticated',
    content: { 'application/json': { schema: StandardErrorSchema } },
  },
} as const;

const err403 = {
  403: {
    description: 'Forbidden',
    content: { 'application/json': { schema: StandardErrorSchema } },
  },
} as const;

const err404 = {
  404: {
    description: 'Not found',
    content: { 'application/json': { schema: StandardErrorSchema } },
  },
} as const;

const err422 = {
  422: {
    description: 'Validation error',
    content: { 'application/json': { schema: StandardErrorSchema } },
  },
} as const;

const paginationQuery = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  search: z.string().optional(),
});

// ════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/signup',
  summary: 'Register a new user and create a client account',
  tags: ['Auth'],
  security: [],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              firstName: z.string().min(2).max(25),
              lastName: z.string().min(2).max(25),
              email: z.string().email(),
              password: z.string().min(8).max(15),
              cpassword: z.string().min(8),
              location: z.string().min(2).max(100),
              phoneNumber: z.string().optional(),
              accountType: z.object({
                planId: z.string(),
                lookUpKey: z.string().optional(),
                category: z.enum(['business', 'individual']),
                planName: z.enum(['essential', 'growth', 'portfolio', 'enterprise']),
                billingInterval: z.enum(['monthly', 'annual']),
              }),
              companyProfile: z
                .object({
                  tradingName: z.string(),
                  legalEntityName: z.string(),
                  registrationNumber: z.string(),
                })
                .partial()
                .optional(),
            })
            .openapi('UserSignupRequest'),
        },
      },
    },
  },
  responses: {
    ...created201,
    ...err422,
    429: { description: 'Rate limit exceeded' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/login',
  summary: 'Authenticate and receive session cookies',
  tags: ['Auth'],
  security: [],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              email: z.string().email(),
              password: z.string().min(6).max(20).optional(),
              otp: z.string().length(6).optional(),
              rememberMe: z.boolean().optional(),
            })
            .openapi('LoginRequest'),
        },
      },
    },
  },
  responses: {
    ...ok200,
    ...err401,
    429: { description: 'Rate limit exceeded' },
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/auth/{cuid}/me',
  summary: 'Get current authenticated user',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/auth/{cuid}/account_activation',
  summary: 'Activate account with token and consent',
  tags: ['Auth'],
  security: [],
  request: {
    params: cuidParams,
    query: z.object({ t: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              firstName: z.string(),
              lastName: z.string(),
              consentDate: z.string(),
            })
            .openapi('AccountActivationRequest'),
        },
      },
    },
  },
  responses: { ...ok200, ...err400, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/auth/resend_activation_link',
  summary: 'Resend account activation email',
  tags: ['Auth'],
  security: [],
  responses: { ...ok200, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/auth/switch_client_account',
  summary: 'Switch active client account context',
  tags: ['Auth'],
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/auth/forgot_password',
  summary: 'Request password reset email',
  tags: ['Auth'],
  security: [],
  responses: { ...ok200 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/auth/reset_password',
  summary: 'Reset password with token',
  tags: ['Auth'],
  security: [],
  responses: { ...ok200, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/auth/change_password',
  summary: 'Change password for authenticated user',
  tags: ['Auth'],
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/auth/{cuid}/logout',
  summary: 'Logout and clear session cookies',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/{cuid}/feedback',
  summary: 'Submit user feedback',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/refresh_token',
  summary: 'Refresh access token using refresh token cookie',
  tags: ['Auth'],
  security: [],
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/{cuid}/complete_onboarding',
  summary: 'Complete user onboarding flow',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/{cuid}/charge_first_payment',
  summary: 'Charge the first subscription payment',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/{cuid}/setup_payment_intent',
  summary: 'Create a Stripe SetupIntent for payment method',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/auth/{cuid}/payment_method',
  summary: 'Get saved payment method details',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/auth/{cuid}/payment_method',
  summary: 'Remove saved payment method',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/auth/passkeys/auth_options',
  summary: 'Get passkey authentication options',
  tags: ['Auth'],
  security: [],
  responses: { ...ok200 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/passkeys/auth_verify',
  summary: 'Verify passkey authentication response',
  tags: ['Auth'],
  security: [],
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/auth/{cuid}/passkeys',
  summary: 'List registered passkeys',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/auth/{cuid}/passkeys/registration_options',
  summary: 'Get passkey registration options',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/{cuid}/passkeys/registration_verify',
  summary: 'Verify passkey registration response',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/auth/{cuid}/passkeys',
  summary: 'Delete a registered passkey',
  tags: ['Auth'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

// ════════════════════════════════════════════════════════════════════
// CLIENTS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/clients/{cuid}',
  summary: 'Get client account details',
  tags: ['Clients'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/clients/{cuid}',
  summary: 'Update client account details',
  tags: ['Clients'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/clients/{cuid}/users/{uid}/disconnect',
  summary: 'Disconnect a user from the client',
  tags: ['Clients'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/clients/{cuid}/users/{uid}/reconnect',
  summary: 'Reconnect a previously disconnected user',
  tags: ['Clients'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/clients/{cuid}/users/{uid}/department',
  summary: 'Update user department assignment',
  tags: ['Clients'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/clients/{cuid}/verify-account',
  summary: 'Initiate client account verification',
  tags: ['Clients'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/clients/{cuid}/identity_verification/session',
  summary: 'Create identity verification session',
  tags: ['Clients'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/clients/{cuid}/settings/tenant-features',
  summary: 'Update tenant-facing feature settings',
  tags: ['Clients'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err403 },
});

// ════════════════════════════════════════════════════════════════════
// PROPERTIES
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/properties/property_form_metadata',
  summary: 'Get property form metadata (types, amenities, etc.)',
  tags: ['Properties'],
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/properties/{cuid}',
  summary: 'Create a new property',
  tags: ['Properties'],
  request: { params: cuidParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/properties/{cuid}/csv/validate',
  summary: 'Validate a CSV file before property import (multipart/form-data)',
  tags: ['Properties'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err400, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/properties/{cuid}/csv/import',
  summary: 'Import properties from CSV (multipart/form-data)',
  tags: ['Properties'],
  request: { params: cuidParams },
  responses: { ...created201, ...err400, ...err422 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/properties/{cuid}',
  summary: 'List properties for a client',
  tags: ['Properties'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...paginatedWith(PropertySummarySchema, 'Property'), ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/properties/{cuid}/{pid}',
  summary: 'Get a single property by ID',
  tags: ['Properties'],
  request: { params: z.object({ cuid: z.string(), pid: z.string() }) },
  responses: { ...successWith(PropertyDetailSchema, 'PropertyDetail'), ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/properties/{cuid}/properties/pending',
  summary: 'List pending property requests',
  tags: ['Properties'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/properties/{cuid}/properties/{pid}/approve',
  summary: 'Approve a pending property request',
  tags: ['Properties'],
  request: { params: z.object({ cuid: z.string(), pid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/properties/{cuid}/properties/{pid}/reject',
  summary: 'Reject a pending property request',
  tags: ['Properties'],
  request: { params: z.object({ cuid: z.string(), pid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/properties/{cuid}/properties/bulk-approve',
  summary: 'Bulk approve pending property requests',
  tags: ['Properties'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/properties/{cuid}/properties/bulk-reject',
  summary: 'Bulk reject pending property requests',
  tags: ['Properties'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/properties/{cuid}/properties/my-requests',
  summary: 'List my property requests',
  tags: ['Properties'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/properties/{cuid}/leaseable',
  summary: 'List properties available for leasing',
  tags: ['Properties'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/properties/{cuid}/{pid}/staff',
  summary: 'Assign staff to a property',
  tags: ['Properties'],
  request: { params: z.object({ cuid: z.string(), pid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/properties/{cuid}/{pid}/staff/remove',
  summary: 'Unassign staff from a property',
  tags: ['Properties'],
  request: { params: z.object({ cuid: z.string(), pid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/properties/{cuid}/{pid}',
  summary: 'Update a property',
  tags: ['Properties'],
  request: { params: z.object({ cuid: z.string(), pid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/properties/{cuid}/{pid}/media/remove',
  summary: 'Remove media from a property',
  tags: ['Properties'],
  request: { params: z.object({ cuid: z.string(), pid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/properties/{cuid}/{pid}',
  summary: 'Delete a property',
  tags: ['Properties'],
  request: { params: z.object({ cuid: z.string(), pid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

// ════════════════════════════════════════════════════════════════════
// PROPERTY UNITS
// ════════════════════════════════════════════════════════════════════

const unitBaseParams = z.object({ cuid: z.string(), pid: z.string() });
const unitItemParams = z.object({ cuid: z.string(), pid: z.string(), puid: z.string() });
const unitBasePath = '/properties/{cuid}/{pid}/units';

openApiRegistry.registerPath({
  method: 'post',
  path: unitBasePath,
  summary: 'Create a property unit',
  tags: ['PropertyUnits'],
  request: { params: unitBaseParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: unitBasePath,
  summary: 'List units for a property',
  tags: ['PropertyUnits'],
  request: { params: unitBaseParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: `${unitBasePath}/{puid}`,
  summary: 'Get a single property unit',
  tags: ['PropertyUnits'],
  request: { params: unitItemParams },
  responses: { ...ok200, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: `${unitBasePath}/{puid}`,
  summary: 'Update a property unit',
  tags: ['PropertyUnits'],
  request: { params: unitItemParams },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: `${unitBasePath}/{puid}`,
  summary: 'Delete a property unit',
  tags: ['PropertyUnits'],
  request: { params: unitItemParams },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: `${unitBasePath}/update_status/{puid}`,
  summary: 'Update property unit status',
  tags: ['PropertyUnits'],
  request: { params: unitItemParams },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: `${unitBasePath}/setup_inspection/{puid}`,
  summary: 'Set up inspection for a property unit',
  tags: ['PropertyUnits'],
  request: { params: unitItemParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: `${unitBasePath}/upload_media/{puid}`,
  summary: 'Upload media for a property unit (multipart/form-data)',
  tags: ['PropertyUnits'],
  request: { params: unitItemParams },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: `${unitBasePath}/validate_csv`,
  summary: 'Validate CSV for unit import (multipart/form-data)',
  tags: ['PropertyUnits'],
  request: { params: unitBaseParams },
  responses: { ...ok200, ...err400, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: `${unitBasePath}/import_csv`,
  summary: 'Import units from CSV (multipart/form-data)',
  tags: ['PropertyUnits'],
  request: { params: unitBaseParams },
  responses: { ...created201, ...err400, ...err422 },
});

// ════════════════════════════════════════════════════════════════════
// LEASES
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/stats',
  summary: 'Get lease statistics',
  tags: ['Leases'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/expiring',
  summary: 'List expiring leases',
  tags: ['Leases'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/templates',
  summary: 'List lease templates',
  tags: ['Leases'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/vacate-requests',
  summary: 'List vacate requests',
  tags: ['Leases'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/active-offboardings',
  summary: 'List active tenant offboardings',
  tags: ['Leases'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}',
  summary: 'List leases for a client',
  tags: ['Leases'],
  request: {
    params: cuidParams,
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      status: z.string().optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    }),
  },
  responses: { ...paginatedWith(LeaseSummarySchema, 'Lease'), ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}',
  summary: 'Create a new lease',
  tags: ['Leases'],
  request: { params: cuidParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}/{luid}/pdf',
  summary: 'Generate lease PDF',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/pdf-status/{jobId}',
  summary: 'Check lease PDF generation status',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), jobId: z.string() }) },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/closure-preflight',
  summary: 'Preflight check for account closure',
  tags: ['Leases'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/closure-status',
  summary: 'Get account closure status',
  tags: ['Leases'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/{luid}',
  summary: 'Get a single lease',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...successWith(LeaseDetailSchema, 'LeaseDetail'), ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/leases/{cuid}/{luid}',
  summary: 'Update a lease',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/leases/{cuid}/{luid}',
  summary: 'Delete a lease',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}/{luid}/activate',
  summary: 'Activate a lease',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}/{luid}/terminate',
  summary: 'Terminate a lease',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}/{luid}/document',
  summary: 'Upload a lease document (multipart/form-data)',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/{luid}/document',
  summary: 'Get lease documents',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/leases/{cuid}/{luid}/document',
  summary: 'Delete a lease document',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}/{luid}/signature_request',
  summary: 'Send lease for e-signature',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/{luid}/signature_request',
  summary: 'Get signature request status',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/{luid}/pdf/download',
  summary: 'Download lease PDF',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/{luid}/preview_lease',
  summary: 'Preview lease content',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/{luid}/lease_renewal',
  summary: 'Get lease renewal details',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}/{luid}/lease_renewal',
  summary: 'Initiate lease renewal',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}/{luid}/vacate-request',
  summary: 'Submit a vacate request',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/leases/{cuid}/{luid}/vacate-request',
  summary: 'Update a vacate request (approve/deny)',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}/{luid}/renewal-request',
  summary: 'Submit a renewal request',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/leases/{cuid}/{luid}/renewal-request',
  summary: 'Update a renewal request (approve/deny)',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/leases/{cuid}/{luid}/offboarding-status',
  summary: 'Get tenant offboarding status',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}/close-account',
  summary: 'Initiate account closure with lease wind-down',
  tags: ['Leases'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}/{luid}/approve',
  summary: 'Approve a lease',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/leases/{cuid}/{luid}/reject',
  summary: 'Reject a lease',
  tags: ['Leases'],
  request: { params: z.object({ cuid: z.string(), luid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

// ════════════════════════════════════════════════════════════════════
// PAYMENTS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/payments/{cuid}/stats',
  summary: 'Get payment statistics',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/payments/{cuid}/vendor-earnings',
  summary: 'Get vendor earnings summary',
  tags: ['Payments'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}/{pytuid}/invoice',
  summary: 'Generate invoice for a payment',
  tags: ['Payments'],
  request: { params: z.object({ cuid: z.string(), pytuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/payments/{cuid}/{pytuid}',
  summary: 'Get a single payment',
  tags: ['Payments'],
  request: { params: z.object({ cuid: z.string(), pytuid: z.string() }) },
  responses: { ...successWith(PaymentSummarySchema, 'PaymentDetail'), ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/payments/{cuid}',
  summary: 'List payments for a client',
  tags: ['Payments'],
  request: {
    params: cuidParams,
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      status: z.string().optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
    }),
  },
  responses: { ...paginatedWith(PaymentSummarySchema, 'Payment'), ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}/maintenance-charge',
  summary: 'Create a maintenance charge payment',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}/maintenance-charge/ensure',
  summary: 'Ensure maintenance charge exists (idempotent)',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}',
  summary: 'Create a new payment',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}/vendor-payout/{mruid}',
  summary: 'Initiate vendor payout for a maintenance request',
  tags: ['Payments'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}/scan-receipt',
  summary: 'Scan a receipt using AI (multipart/form-data)',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}/manual_entry',
  summary: 'Record a manual payment entry',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/payments/{cuid}/{pytuid}/cancel',
  summary: 'Cancel a payment',
  tags: ['Payments'],
  request: { params: z.object({ cuid: z.string(), pytuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}/{pytuid}/refund',
  summary: 'Refund a payment',
  tags: ['Payments'],
  request: { params: z.object({ cuid: z.string(), pytuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}/{pytuid}/release-deposit',
  summary: 'Release a security deposit',
  tags: ['Payments'],
  request: { params: z.object({ cuid: z.string(), pytuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/payments/{cuid}/{pytuid}/review',
  summary: 'Review a payment (approve/reject)',
  tags: ['Payments'],
  request: { params: z.object({ cuid: z.string(), pytuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}/{pytuid}/card-checkout',
  summary: 'Create a card checkout session for a payment',
  tags: ['Payments'],
  request: { params: z.object({ cuid: z.string(), pytuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}/{pytuid}/pay',
  summary: 'Process payment via saved method',
  tags: ['Payments'],
  request: { params: z.object({ cuid: z.string(), pytuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/payments/{cuid}/payout-account',
  summary: 'Create a payout account (Stripe Connect)',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/payments/{cuid}/payout-account/onboard',
  summary: 'Get payout account onboarding link',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/payments/{cuid}/payout-account/update',
  summary: 'Get payout account update link',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/payments/{cuid}/payout-account/dashboard',
  summary: 'Get payout account dashboard link',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/payments/{cuid}/payout-account/balance',
  summary: 'Get payout account balance',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/payments/{cuid}/payout-account/history',
  summary: 'Get payout history',
  tags: ['Payments'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/payments/{cuid}/payout-account/schedule',
  summary: 'Get payout schedule',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/payments/{cuid}/payout-account/schedule',
  summary: 'Update payout schedule',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/payments/{cuid}/payout-account/unblock',
  summary: 'Unblock a payout account',
  tags: ['Payments'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err403 },
});

// ════════════════════════════════════════════════════════════════════
// USERS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/users',
  summary: 'List users for a client',
  tags: ['Users'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/filtered-users',
  summary: 'List users with filters',
  tags: ['Users'],
  request: {
    params: cuidParams,
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      role: z.string().optional(),
      status: z.string().optional(),
      search: z.string().optional(),
    }),
  },
  responses: { ...paginatedWith(UserProfileSchema, 'User'), ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/users/stats',
  summary: 'Get user statistics',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/users/by-role',
  summary: 'Get users grouped by role',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/users/{uid}/roles',
  summary: 'Get roles for a user',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/users/{cuid}/users/{uid}/roles',
  summary: 'Assign a role to a user',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/users/{cuid}/users/{uid}/roles/{role}',
  summary: 'Remove a role from a user',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string(), role: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/assignable-users',
  summary: 'List property managers',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/profile-completion',
  summary: 'Get profile completion status',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/profile',
  summary: 'Get current user profile details',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/{uid}',
  summary: 'Get details for a specific user',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...successWith(UserProfileSchema, 'UserDetail'), ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/users/{cuid}/profile',
  summary: 'Update current user profile',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/notification-preferences',
  summary: 'Get notification preferences',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/users/{cuid}/verify-phone',
  summary: 'Initiate phone number verification',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/users/{cuid}/confirm-otp',
  summary: 'Confirm phone OTP',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/users/{cuid}/sms-consent',
  summary: 'Update SMS consent preference',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/users/{cuid}/tours/complete',
  summary: 'Mark a product tour as complete',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/users/{cuid}/tours',
  summary: 'Reset product tours',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/filtered-tenants',
  summary: 'List tenants with filters',
  tags: ['Users'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/available-tenants',
  summary: 'List tenants available for lease assignment',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/stats',
  summary: 'Get tenant/user stats',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/tenants/{uid}/details',
  summary: 'Get client tenant details',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...successWith(TenantDetailSchema, 'TenantDetail'), ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/tenants/{uid}',
  summary: 'Get full tenant details',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/users/{cuid}/tenants/{uid}',
  summary: 'Update tenant details',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/users/{cuid}/tenants/{uid}',
  summary: 'Delete a tenant',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/users/{cuid}/{uid}',
  summary: 'Delete a user',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/dsar/{uid}/preflight',
  summary: 'DSAR preflight check (data subject access request)',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err403 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/users/{cuid}/dsar/{uid}/export',
  summary: 'Export user data (DSAR)',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err403 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/users/{cuid}/dsar/{uid}/anonymise',
  summary: 'Anonymise user data (DSAR)',
  tags: ['Users'],
  request: { params: z.object({ cuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err403 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/users/{cuid}/initialize-queues',
  summary: 'Initialize background queues for the client',
  tags: ['Users'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err403 },
});

// ════════════════════════════════════════════════════════════════════
// VENDORS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/vendors/{cuid}/vendors/stats',
  summary: 'Get vendor statistics',
  tags: ['Vendors'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/vendors/{cuid}',
  summary: 'List vendors with filters',
  tags: ['Vendors'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...paginatedWith(VendorDetailSchema, 'Vendor'), ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/vendors/{cuid}/{vuid}',
  summary: 'Get vendor details',
  tags: ['Vendors'],
  request: { params: z.object({ cuid: z.string(), vuid: z.string() }) },
  responses: { ...successWith(VendorDetailSchema, 'VendorDetail'), ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/vendors/{cuid}/{vuid}/team',
  summary: 'Get vendor team members',
  tags: ['Vendors'],
  request: { params: z.object({ cuid: z.string(), vuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/vendors/{cuid}/{vuid}/form',
  summary: 'Get vendor data for editing',
  tags: ['Vendors'],
  request: { params: z.object({ cuid: z.string(), vuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/vendors/{cuid}/{vuid}/team/{uid}',
  summary: 'Update a vendor team member',
  tags: ['Vendors'],
  request: { params: z.object({ cuid: z.string(), vuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/vendors/{cuid}/{vuid}/team/{uid}/status',
  summary: 'Update vendor team member status',
  tags: ['Vendors'],
  request: { params: z.object({ cuid: z.string(), vuid: z.string(), uid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/vendors/{cuid}/vendor/{vuid}',
  summary: 'Update vendor details',
  tags: ['Vendors'],
  request: { params: z.object({ cuid: z.string(), vuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/vendors/{cuid}/vendor/{vuid}/reviews',
  summary: 'Get vendor reviews',
  tags: ['Vendors'],
  request: { params: z.object({ cuid: z.string(), vuid: z.string() }) },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/vendors/{cuid}/vendor/{vuid}/payout_account/initiate',
  summary: 'Initiate vendor payout account setup',
  tags: ['Vendors'],
  request: { params: z.object({ cuid: z.string(), vuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/vendors/{cuid}/vendor/{vuid}/payout_account/link',
  summary: 'Get vendor payout account onboarding link',
  tags: ['Vendors'],
  request: { params: z.object({ cuid: z.string(), vuid: z.string() }) },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/vendors/{cuid}/vendor/{vuid}/payout_account/sync',
  summary: 'Sync vendor payout account status',
  tags: ['Vendors'],
  request: { params: z.object({ cuid: z.string(), vuid: z.string() }) },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/vendors/{cuid}/vendor/{vuid}/payout_account/dashboard',
  summary: 'Get vendor payout account dashboard link',
  tags: ['Vendors'],
  request: { params: z.object({ cuid: z.string(), vuid: z.string() }) },
  responses: { ...ok200, ...err401 },
});

// ════════════════════════════════════════════════════════════════════
// INVITATIONS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/invites/{cuid}/validate_token',
  summary: 'Validate an invitation token',
  tags: ['Invitations'],
  security: [],
  request: { params: cuidParams, query: z.object({ token: z.string() }) },
  responses: { ...ok200, ...err400, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/invites/{cuid}/accept/{token}',
  summary: 'Accept an invitation',
  tags: ['Invitations'],
  security: [],
  request: { params: z.object({ cuid: z.string(), token: z.string() }) },
  responses: { ...ok200, ...err400, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/invites/{cuid}/decline/{token}',
  summary: 'Decline an invitation',
  tags: ['Invitations'],
  security: [],
  request: { params: z.object({ cuid: z.string(), token: z.string() }) },
  responses: { ...ok200, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/invites/{cuid}',
  summary: 'Send an invitation',
  tags: ['Invitations'],
  request: { params: cuidParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/invites/clients/{cuid}',
  summary: 'List invitations for a client',
  tags: ['Invitations'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...paginatedWith(InvitationSummarySchema, 'Invitation'), ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/invites/clients/{cuid}/stats',
  summary: 'Get invitation statistics',
  tags: ['Invitations'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/invites/{iuid}',
  summary: 'Get a single invitation',
  tags: ['Invitations'],
  request: { params: z.object({ iuid: z.string() }) },
  responses: { ...successWith(InvitationSummarySchema, 'InvitationDetail'), ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/invites/{cuid}/revoke/{iuid}',
  summary: 'Revoke an invitation',
  tags: ['Invitations'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/invites/{cuid}/{iuid}',
  summary: 'Update an invitation',
  tags: ['Invitations'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/invites/{cuid}/resend/{iuid}',
  summary: 'Resend an invitation email',
  tags: ['Invitations'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/invites/by-email/{email}',
  summary: 'Look up invitations by email',
  tags: ['Invitations'],
  request: { params: z.object({ email: z.string() }) },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/invites/{cuid}/csv/validate',
  summary: 'Validate CSV for bulk invitations (multipart/form-data)',
  tags: ['Invitations'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err400, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/invites/{cuid}/csv/import',
  summary: 'Import invitations from CSV (multipart/form-data)',
  tags: ['Invitations'],
  request: { params: cuidParams },
  responses: { ...created201, ...err400, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/invites/{cuid}/process-pending',
  summary: 'Process pending invitations',
  tags: ['Invitations'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

// ════════════════════════════════════════════════════════════════════
// EXPENSES
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/expenses/{cuid}/summary',
  summary: 'Get expense summary/analytics',
  tags: ['Expenses'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/expenses/{cuid}',
  summary: 'List expenses',
  tags: ['Expenses'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/expenses/{cuid}',
  summary: 'Create an expense',
  tags: ['Expenses'],
  request: { params: cuidParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/expenses/{cuid}/{expuid}',
  summary: 'Get a single expense',
  tags: ['Expenses'],
  request: { params: z.object({ cuid: z.string(), expuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/expenses/{cuid}/{expuid}',
  summary: 'Update an expense',
  tags: ['Expenses'],
  request: { params: z.object({ cuid: z.string(), expuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/expenses/{cuid}/{expuid}/receipt',
  summary: 'Upload expense receipt (multipart/form-data)',
  tags: ['Expenses'],
  request: { params: z.object({ cuid: z.string(), expuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/expenses/{cuid}/{expuid}',
  summary: 'Delete an expense',
  tags: ['Expenses'],
  request: { params: z.object({ cuid: z.string(), expuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

// ════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'patch',
  path: '/notifications/{cuid}/mark-all-read',
  summary: 'Mark all notifications as read',
  tags: ['Notifications'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/notifications/{cuid}/mark-read/{nuid}',
  summary: 'Mark a single notification as read',
  tags: ['Notifications'],
  request: { params: z.object({ cuid: z.string(), nuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/notifications/{cuid}/archive/{nuid}',
  summary: 'Archive a notification',
  tags: ['Notifications'],
  request: { params: z.object({ cuid: z.string(), nuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/notifications/{cuid}/archive-all-read',
  summary: 'Archive all read notifications',
  tags: ['Notifications'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/notifications/{cuid}/my-notifications/stream',
  summary: 'Stream personal notifications (SSE - text/event-stream)',
  tags: ['Notifications'],
  request: { params: cuidParams },
  responses: {
    200: {
      description: 'SSE stream of notifications',
      content: { 'text/event-stream': { schema: z.string() } },
    },
    ...err401,
  },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/notifications/{cuid}/announcements/stream',
  summary: 'Stream announcements (SSE - text/event-stream)',
  tags: ['Notifications'],
  request: { params: cuidParams },
  responses: {
    200: {
      description: 'SSE stream of announcements',
      content: { 'text/event-stream': { schema: z.string() } },
    },
    ...err401,
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/notifications/{cuid}/push/subscribe',
  summary: 'Subscribe to push notifications',
  tags: ['Notifications'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/notifications/{cuid}/push/unsubscribe',
  summary: 'Unsubscribe from push notifications',
  tags: ['Notifications'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

// ════════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/subscriptions/plans',
  summary: 'List available subscription plans',
  tags: ['Subscriptions'],
  security: [],
  responses: { ...ok200 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/subscriptions/{cuid}/plan-usage',
  summary: 'Get current plan usage and limits',
  tags: ['Subscriptions'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/subscriptions/{cuid}/checkout',
  summary: 'Initialize subscription payment flow',
  tags: ['Subscriptions'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/subscriptions/{cuid}',
  summary: 'Cancel subscription',
  tags: ['Subscriptions'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/subscriptions/{cuid}/seats',
  summary: 'Update subscription seat count',
  tags: ['Subscriptions'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/subscriptions/{cuid}/sync',
  summary: 'Sync subscription state from Stripe',
  tags: ['Subscriptions'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/subscriptions/{cuid}/entitlements',
  summary: 'Get subscription entitlements',
  tags: ['Subscriptions'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/subscriptions/{cuid}/sms-quota',
  summary: 'Get SMS quota usage',
  tags: ['Subscriptions'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/subscriptions/{cuid}/sms-logs',
  summary: 'Get SMS logs',
  tags: ['Subscriptions'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

// ════════════════════════════════════════════════════════════════════
// METRICS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/metrics/{cuid}/dashboard',
  summary: 'Get dashboard metrics',
  tags: ['Metrics'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/metrics/{cuid}/history/{metricType}',
  summary: 'Get metric history for a specific type',
  tags: ['Metrics'],
  request: { params: z.object({ cuid: z.string(), metricType: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/metrics/{cuid}/trend/{metricType}',
  summary: 'Get metric trend for a specific type',
  tags: ['Metrics'],
  request: { params: z.object({ cuid: z.string(), metricType: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

// ════════════════════════════════════════════════════════════════════
// INSPECTIONS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'post',
  path: '/inspections/{cuid}',
  summary: 'Create an inspection',
  tags: ['Inspections'],
  request: { params: cuidParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/inspections/{cuid}',
  summary: 'List inspections',
  tags: ['Inspections'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...paginatedWith(InspectionSummarySchema, 'Inspection'), ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/inspections/{cuid}/{iuid}/ai-analysis',
  summary: 'Get AI analysis for an inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/inspections/{cuid}/{iuid}/ai-analysis',
  summary: 'Trigger AI analysis for an inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/inspections/{cuid}/{iuid}/notes',
  summary: 'Add notes to an inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/inspections/{cuid}/{iuid}/report',
  summary: 'Generate inspection report',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/inspections/{cuid}/{iuid}',
  summary: 'Get a single inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...successWith(InspectionDetailSchema, 'InspectionDetail'), ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/inspections/{cuid}/{iuid}',
  summary: 'Update an inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/inspections/{cuid}/{iuid}',
  summary: 'Delete an inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/inspections/{cuid}/{iuid}/submit',
  summary: 'Submit an inspection with media (multipart/form-data)',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/inspections/{cuid}/{iuid}/review',
  summary: 'Review an inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/inspections/{cuid}/{iuid}/approve',
  summary: 'Approve an inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/inspections/{cuid}/{iuid}/reject',
  summary: 'Reject an inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/inspections/{cuid}/{iuid}/acknowledge',
  summary: 'Acknowledge an inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/inspections/{cuid}/{iuid}/dispute',
  summary: 'Dispute an inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/inspections/{cuid}/{iuid}/cancel',
  summary: 'Cancel an inspection',
  tags: ['Inspections'],
  request: { params: z.object({ cuid: z.string(), iuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

// ════════════════════════════════════════════════════════════════════
// MAINTENANCE REQUESTS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'post',
  path: '/maintenance_requests/{cuid}',
  summary: 'Create a maintenance request',
  tags: ['MaintenanceRequests'],
  request: { params: cuidParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/maintenance_requests/{cuid}',
  summary: 'List maintenance requests',
  tags: ['MaintenanceRequests'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...paginatedWith(MaintenanceRequestSummarySchema, 'MaintenanceRequest'), ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/maintenance_requests/{cuid}/stats',
  summary: 'Get maintenance request statistics',
  tags: ['MaintenanceRequests'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/maintenance_requests/{cuid}/{mruid}',
  summary: 'Get a single maintenance request',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: {
    ...successWith(MaintenanceRequestDetailSchema, 'MaintenanceRequestDetail'),
    ...err401,
    ...err404,
  },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}/vendor',
  summary: 'Assign a vendor to a maintenance request',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}/assignment',
  summary: 'Assign staff to a maintenance request',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}/status',
  summary: 'Update maintenance request status',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}',
  summary: 'Update maintenance request details',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}/completion',
  summary: 'Mark maintenance work as done',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}/finalize',
  summary: 'Finalize a maintenance request',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}/feedback',
  summary: 'Submit tenant feedback for maintenance work',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}/ai-suggestion/accept',
  summary: 'Accept AI suggestion for maintenance request',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}/ai-suggestion/dismiss',
  summary: 'Dismiss AI suggestion for maintenance request',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}/cancel',
  summary: 'Cancel a maintenance request',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/maintenance_requests/{cuid}/{mruid}/work_order',
  summary: 'Create a work order for maintenance request',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}/work-order/review',
  summary: 'Review a work order',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/maintenance_requests/{cuid}/{mruid}/invoice-scan',
  summary: 'Scan an invoice using AI (multipart/form-data)',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/maintenance_requests/{cuid}/{mruid}/invoices',
  summary: 'Create an invoice for a maintenance request',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/maintenance_requests/{cuid}/{mruid}/invoices/review',
  summary: 'Review a maintenance invoice',
  tags: ['MaintenanceRequests'],
  request: { params: z.object({ cuid: z.string(), mruid: z.string() }) },
  responses: { ...ok200, ...err401, ...err400 },
});

// ════════════════════════════════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'post',
  path: '/reports/{cuid}',
  summary: 'Generate a report',
  tags: ['Reports'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/reports/{cuid}/{reportId}/status',
  summary: 'Get report generation status',
  tags: ['Reports'],
  request: { params: z.object({ cuid: z.string(), reportId: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/reports/{cuid}',
  summary: 'List reports',
  tags: ['Reports'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/reports/{cuid}/schedule',
  summary: 'Schedule a recurring report',
  tags: ['Reports'],
  request: { params: cuidParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/reports/{cuid}/schedule',
  summary: 'Get report schedules',
  tags: ['Reports'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/reports/{cuid}/schedule',
  summary: 'Delete a report schedule',
  tags: ['Reports'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/reports/{cuid}/{reportId}',
  summary: 'Delete a report',
  tags: ['Reports'],
  request: { params: z.object({ cuid: z.string(), reportId: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

// ════════════════════════════════════════════════════════════════════
// GUEST PASSES
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/guest-passes/{cuid}/stats',
  summary: 'Get guest pass statistics',
  tags: ['GuestPasses'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/guest-passes/{cuid}/expected',
  summary: 'List expected guest arrivals',
  tags: ['GuestPasses'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/guest-passes/{cuid}/unacknowledged-count',
  summary: 'Get count of unacknowledged guest passes',
  tags: ['GuestPasses'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/guest-passes/{cuid}/property/{propertyId}/unacknowledged',
  summary: 'List unacknowledged guest passes for a property',
  tags: ['GuestPasses'],
  request: { params: z.object({ cuid: z.string(), propertyId: z.string() }) },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/guest-passes/{cuid}',
  summary: 'List guest passes',
  tags: ['GuestPasses'],
  request: { params: cuidParams, query: paginationQuery },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/guest-passes/{cuid}',
  summary: 'Create a guest pass',
  tags: ['GuestPasses'],
  request: { params: cuidParams },
  responses: { ...created201, ...err401, ...err422 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/guest-passes/{cuid}/validate',
  summary: 'Validate a guest pass',
  tags: ['GuestPasses'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/guest-passes/{cuid}/bulk-acknowledge',
  summary: 'Bulk acknowledge guest passes',
  tags: ['GuestPasses'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/guest-passes/{cuid}/{vpuid}/acknowledge',
  summary: 'Acknowledge a guest pass',
  tags: ['GuestPasses'],
  request: { params: z.object({ cuid: z.string(), vpuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'delete',
  path: '/guest-passes/{cuid}/{vpuid}',
  summary: 'Delete a guest pass',
  tags: ['GuestPasses'],
  request: { params: z.object({ cuid: z.string(), vpuid: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

// ════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/email-templates',
  summary: 'List available email template types',
  tags: ['EmailTemplates'],
  responses: { ...ok200, ...err401 },
});

openApiRegistry.registerPath({
  method: 'get',
  path: '/email-templates/{cuid}/{templateType}',
  summary: 'Get an email template by type',
  tags: ['EmailTemplates'],
  request: { params: z.object({ cuid: z.string(), templateType: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/email-templates/{cuid}/{templateType}/render',
  summary: 'Render an email template with sample data',
  tags: ['EmailTemplates'],
  request: { params: z.object({ cuid: z.string(), templateType: z.string() }) },
  responses: { ...ok200, ...err401, ...err404 },
});

// ════════════════════════════════════════════════════════════════════
// WEBHOOKS
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'post',
  path: '/webhooks/boldsign',
  summary: 'BoldSign e-signature webhook',
  tags: ['Webhooks'],
  security: [],
  responses: {
    200: { description: 'Webhook processed' },
    400: { description: 'Invalid signature' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/webhooks/stripe',
  summary: 'Stripe webhook endpoint',
  tags: ['Webhooks'],
  security: [],
  responses: {
    200: { description: 'Webhook processed' },
    400: { description: 'Invalid signature' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/webhooks/stripe/connect',
  summary: 'Stripe Connect webhook endpoint',
  tags: ['Webhooks'],
  security: [],
  responses: {
    200: { description: 'Webhook processed' },
    400: { description: 'Invalid signature' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/webhooks/invoices/{source}',
  summary: 'Invoice webhook from external source',
  tags: ['Webhooks'],
  security: [],
  request: { params: z.object({ source: z.string() }) },
  responses: {
    200: { description: 'Webhook processed' },
    400: { description: 'Invalid payload' },
  },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/webhooks/twilio/status',
  summary: 'Twilio SMS status callback',
  tags: ['Webhooks'],
  security: [],
  responses: {
    200: { description: 'Status callback processed' },
    400: { description: 'Invalid payload' },
  },
});

// ════════════════════════════════════════════════════════════════════
// BRANDING
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/branding/{cuid}',
  summary: 'Get client branding configuration',
  tags: ['Branding'],
  security: [],
  request: { params: cuidParams },
  responses: { ...ok200, ...err404 },
});

// ════════════════════════════════════════════════════════════════════
// ADMIN
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'post',
  path: '/admin/cache/invalidate',
  summary: 'Invalidate cache (root admin only)',
  tags: ['Admin'],
  responses: { ...ok200, ...err401, ...err403 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/admin/clients/{cuid}/suspend',
  summary: 'Suspend a client account (root admin only)',
  tags: ['Admin'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err403, ...err404 },
});

openApiRegistry.registerPath({
  method: 'patch',
  path: '/admin/clients/{cuid}/unsuspend',
  summary: 'Unsuspend a client account (root admin only)',
  tags: ['Admin'],
  request: { params: cuidParams },
  responses: { ...ok200, ...err401, ...err403, ...err404 },
});

openApiRegistry.registerPath({
  method: 'post',
  path: '/admin/maintenance/finalize-paid',
  summary: 'Finalize paid maintenance requests (root admin only)',
  tags: ['Admin'],
  responses: { ...ok200, ...err401, ...err403 },
});

// ════════════════════════════════════════════════════════════════════
// SYSTEM
// ════════════════════════════════════════════════════════════════════

openApiRegistry.registerPath({
  method: 'get',
  path: '/healthcheck',
  summary: 'Health check endpoint',
  tags: ['System'],
  security: [],
  responses: {
    200: {
      description: 'System health status',
      content: {
        'application/json': {
          schema: z
            .object({
              uptime: z.number(),
              message: z.enum(['OK', 'Unhealthy']),
              timestamp: z.number(),
              environment: z.string(),
              processType: z.string(),
              database: z.enum(['Connected', 'Disconnected']),
              redis: z.object({}).passthrough(),
            })
            .openapi('HealthCheckResponse'),
        },
      },
    },
  },
});
