import 'multer';
import { AwilixContainer } from 'awilix';
import { NextFunction, Response, Request } from 'express';

import { ICurrentUser } from './user.interface';
import { IProperty } from './property.interface';
import { IInvalidCsvProperty } from './csv.interface';
import { ISubscriptionEntitlements } from './subscription.interface';

export enum MailType {
  MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT = 'MAINTENANCE_WORK_ORDER_SUBMITTED_TENANT',
  MAINTENANCE_WORK_ORDER_SUBMITTED = 'MAINTENANCE_WORK_ORDER_SUBMITTED',
  MAINTENANCE_WORK_ORDER_APPROVED = 'MAINTENANCE_WORK_ORDER_APPROVED',
  MAINTENANCE_WORK_ORDER_REJECTED = 'MAINTENANCE_WORK_ORDER_REJECTED',
  MAINTENANCE_INVOICE_SUBMITTED = 'MAINTENANCE_INVOICE_SUBMITTED',
  MAINTENANCE_REQUEST_COMPLETED = 'MAINTENANCE_REQUEST_COMPLETED',
  SUBSCRIPTION_RENEWAL_UPCOMING = 'SUBSCRIPTION_RENEWAL_UPCOMING',
  SUBSCRIPTION_RENEWAL_RECEIPT = 'SUBSCRIPTION_RENEWAL_RECEIPT',
  MAINTENANCE_REQUEST_ACCEPTED = 'MAINTENANCE_REQUEST_ACCEPTED',
  MAINTENANCE_REQUEST_ASSIGNED = 'MAINTENANCE_REQUEST_ASSIGNED',
  MAINTENANCE_REQUEST_DECLINED = 'MAINTENANCE_REQUEST_DECLINED',
  MAINTENANCE_INVOICE_APPROVED = 'MAINTENANCE_INVOICE_APPROVED',
  MAINTENANCE_INVOICE_REJECTED = 'MAINTENANCE_INVOICE_REJECTED',
  MAINTENANCE_REQUEST_CREATED = 'MAINTENANCE_REQUEST_CREATED',
  MAINTENANCE_CHARGE_CREATED = 'MAINTENANCE_CHARGE_CREATED',
  LEASE_APPLICATION_UPDATE = 'LEASE_APPLICATION_UPDATE',
  MAINTENANCE_VENDOR_PAID = 'MAINTENANCE_VENDOR_PAID',
  PAYMENT_REQUEST_CREATED = 'PAYMENT_REQUEST_CREATED',
  LEASE_PAYMENT_REMINDER = 'LEASE_PAYMENT_REMINDER',
  LEASE_SIGNOFF_REQUEST = 'LEASE_SIGNOFF_REQUEST',
  ACCOUNT_DISCONNECTED = 'ACCOUNT_DISCONNECTED',
  SUBSCRIPTION_UPDATE = 'SUBSCRIPTION_UPDATE',
  SUBSCRIPTION_CANCEL = 'SUBSCRIPTION_CANCEL',
  INVITATION_REMINDER = 'INVITATION_REMINDER',
  LEASE_ADMIN_UPDATED = 'LEASE_ADMIN_UPDATED',
  ACCOUNT_ACTIVATION = 'ACCOUNT_ACTIVATION',
  LEASE_ENDING_SOON = 'LEASE_ENDING_SOON',
  USER_REGISTRATION = 'USER_REGISTRATION',
  LEASE_TERMINATED = 'LEASE_TERMINATED',
  PAYMENT_RECEIPT = 'PAYMENT_RECEIPT',
  LEASE_ACTIVATED = 'LEASE_ACTIVATED',
  FORGOT_PASSWORD = 'FORGOT_PASSWORD',
  GUEST_PASS_CODE = 'GUEST_PASS_CODE',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PASSWORD_RESET = 'PASSWORD_RESET',
  ACCOUNT_UPDATE = 'ACCOUNT_UPDATE',
  USER_CREATED = 'USER_CREATED',
  INVITATION = 'INVITATION',
}

export enum PermissionAction {
  MANAGE_VENDORS = 'manage_vendors',
  ASSIGN_ROLES = 'assign_roles',
  MANAGE_USERS = 'manage_users',
  SETTINGS = 'settings',
  CREATE = 'create',
  DELETE = 'delete',
  INVITE = 'invite',
  REMOVE = 'remove',
  RESEND = 'resend',
  REVOKE = 'revoke',
  UPDATE = 'update',
  MANAGE = 'manage',
  STATS = 'stats',
  LIST = 'list',
  READ = 'read',
  SEND = 'send',
}

export enum PermissionResource {
  SUBSCRIPTION = 'subscription',
  NOTIFICATION = 'notification',
  MAINTENANCE = 'maintenance',
  GUEST_PASS = 'guest-pass',
  INVITATION = 'invitation',
  PROPERTY = 'property',
  BILLING = 'billing',
  PAYMENT = 'payment',
  CLIENT = 'client',
  TENANT = 'tenant',
  VENDOR = 'vendor',
  REPORT = 'report',
  LEASE = 'lease',
  USER = 'user',
}

export enum CURRENCIES {
  // Major / Stripe-supported
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  CAD = 'CAD',
  AUD = 'AUD',
  JPY = 'JPY',
  AED = 'AED',
  CNY = 'CNY',
  // Africa
  NGN = 'NGN',
  ZAR = 'ZAR',
  // Europe (non-EUR)
  CHF = 'CHF',
  // Asia-Pacific
  INR = 'INR',
  // South America
  BRL = 'BRL',
}

export enum ResourceContext {
  SERVICE_REQUEST = 'service-request',
  TENANT_PROFILE = 'tenant-profile',
  USER_PROFILE = 'user-profile',
  MAINTENANCE = 'maintenance',
  GUEST_PASS = 'guest-pass',
  PROPERTY = 'property',
  PAYMENT = 'payment',
  CLIENT = 'client',
  VENDOR = 'vendor',
  LEASE = 'lease',
}

export enum PermissionScope {
  AVAILABLE = 'available',
  ASSIGNED = 'assigned',
  MINE = 'mine',
  ANY = 'any',
}

/**
 * File types that are supported for extraction
 */
export enum FileType {
  DOCUMENT = 'application',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
}

export enum RequestSource {
  UNKNOWN = 'unknown',
  MOBILE = 'mobile',
  WEB = 'web',
  API = 'api',
}
export interface IRequestContext {
  userAgent: {
    browser?: string;
    version?: string;
    os?: string;
    raw?: string;
    isMobile: boolean;
    isBot: boolean;
  };
  request: {
    path: string;
    method: string;
    params: Record<string, any>;
    url: string;
    query: Record<string, any>;
  };
  permission?: {
    resource: string;
    action: string;
    granted: boolean;
    attributes: string[];
  };
  langSetting: {
    lang: string;
    t?: (key: string, options?: Record<string, any>) => string;
  };
  timing: {
    startTime: number;
    endTime?: number;
    duration?: number;
  };
  entitlements?: ISubscriptionEntitlements;
  currentuser: ICurrentUser;
  service: { env: string };
  source: RequestSource;
  requestId: string;
  timestamp: Date;
  ip?: string;
}

export interface RateLimitOptions {
  delayMs?: number | ((numRequests: number) => number); // delay in ms to add
  keyGenerator?: (req: any) => string; // custom key generator for tracking (e.g., by token, user ID, or IP)
  skip?: (req: any) => boolean; // function to skip rate limiting for certain requests
  enableSpeedLimit?: boolean;
  enableRateLimit?: boolean;
  delayAfter?: number; // number of requests before adding delay
  windowMs?: number; // time window in milliseconds
  message?: string; // custom message on rate limit exceeded
  max?: number; // max requests per window
}

export interface IAWSFileUploadResponse {
  serverSideEncryption: string | null;
  contentDisposition: string | null;
  contentEncoding: string | null;
  metadata: string | null;
  originalname: string;
  storageClass: string;
  contentType: string;
  versionId?: string;
  fieldname: string;
  encoding: string;
  mimetype: string;
  location: string;
  bucket: string;
  size: number;
  acl?: string;
  etag: string;
  key: string;
}

export interface ResourceInfo {
  resourceName:
    | 'property'
    | 'profile'
    | 'client'
    | 'lease'
    | 'maintenance'
    | 'payment-invoice'
    | 'guest-pass'; //name of the resource
  resourceType: 'image' | 'video' | 'document' | 'unknown'; //type of the file
  resourceId: string; //id of the resource
  fieldName: string; //name of the field
  actorId: string; //user who uploaded the file
}

export interface UploadResult {
  mediatype?: 'image' | 'video' | 'document';
  documentName?: string;
  resourceName?: string;
  resourceId: string;
  fieldName: string;
  publicuid: string;
  mimeType?: string;
  actorId?: string;
  filename: string;
  size?: number;
  key?: string;
  url: string;
}

export interface IPermissionCheck {
  context?: {
    clientId: string;
    userId: string;
    resourceId?: string;
    resourceOwnerId?: string;
    assignedUsers?: string[];
    userClientId?: string;
  };
  resource: PermissionResource;
  action: string;
  scope?: string;
  role: string;
}

export type ExtractedMediaFile = {
  originalFileName: string;
  fieldName: string;
  mimeType: string;
  path: string;
  url?: string;
  key?: string;
  status: 'pending' | 'active' | 'inactive' | 'deleted';
  filename: string;
  fileSize: number;
  uploadedAt: Date;
  uploadedBy: string;
};

export interface IPermissionConfig {
  resources: Record<
    string,
    {
      actions: string[];
      scopes: string[];
      description: string;
    }
  >;
  scopes: Record<
    string,
    {
      description: string;
    }
  >;
  roles: Record<string, IRoleConfig>;
}

export interface IRoleConfig {
  [resource: string]: string[] | Record<string, Record<string, string[]>> | undefined;
  departments?: Record<string, Record<string, string[]>>;
  $extend?: string[];
}

export interface IPaginateResult {
  hasMoreResource: boolean;
  currentPage: number;
  totalPages: number;
  nextPage?: string;
  prevPage?: string;
  perPage: number;
  total: number;
}

export type ISuccessReturnData<T = any> = {
  errors?: [{ path: string; message: string }];
  routeToCard?: boolean;
  success: boolean;
  message?: string;
  error?: string;
  data: T;
};

export interface IPaginationQuery {
  sort?: string | Record<string, 1 | -1 | { $meta: 'textScore' }>;
  sortBy?: string;
  limit?: number;
  page?: number;
  skip?: number;
}

export interface AppRequest extends Request {
  scannedFiles?: ExtractedMediaFile[];
  container: AwilixContainer;
  context: IRequestContext;
  rawBody: Buffer;
}

export interface UploadedFile {
  originalFileName?: string;
  fileSize?: number;
  fieldName: string;
  mimeType?: string;
  fileName: string;
  path: string;
}

export interface IEmailOptions<T> {
  client?: { cuid: string; id: string };
  emailType: string;
  subject: string;
  to: string;
  data: T;
}

export type MulterFile =
  | Express.Multer.File[]
  | {
      [fieldname: string]: Express.Multer.File[];
    }
  | undefined;

export type AsyncRequestHandler = (
  req: AppRequest,
  res: Response,
  next: NextFunction
) => Promise<any>;

export interface IPermissionResult {
  attributes?: string[];
  granted: boolean;
  reason?: string;
}

export type CsvProcessReturnData = {
  data: IProperty[];
  errors?: IInvalidCsvProperty[] | null;
};

export type ListResultWithPagination<T> = Promise<{
  items: T;
  pagination?: IPaginateResult;
}>;

export interface ICacheResponse<T = any> {
  success: boolean;
  error?: string;
  data?: T;
}

export interface IUploadFileInterface {
  filename?: string;
  key?: string;
  url: string;
}

export type UploadJobData = {
  resource: ResourceInfo;
  files: ExtractedMediaFile[];
};

export type IPromiseReturnedData<T = object> = Promise<ISuccessReturnData<T>>;

export type TokenType = 'accessToken' | 'refreshToken';
