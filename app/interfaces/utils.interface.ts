import 'multer';
import { AwilixContainer } from 'awilix';
import { NextFunction, Response, Request } from 'express';

import { ICurrentUser } from './user.interface';
import { IProperty } from './property.interface';
import { IInvalidCsvProperty } from './csv.interface';

export enum MailType {
  SUBSCRIPTION_UPDATE = 'SUBSCRIPTION_UPDATE',
  SUBSCRIPTION_CANCEL = 'SUBSCRIPTION_CANCEL',
  INVITATION_REMINDER = 'INVITATION_REMINDER',
  ACCOUNT_ACTIVATION = 'ACCOUNT_ACTIVATION',
  USER_REGISTRATION = 'USER_REGISTRATION',
  FORGOT_PASSWORD = 'FORGOT_PASSWORD',
  PASSWORD_RESET = 'PASSWORD_RESET',
  ACCOUNT_UPDATE = 'ACCOUNT_UPDATE',
  INVITATION = 'INVITATION',
}

export enum PermissionAction {
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
  STATS = 'stats',
  LIST = 'list',
  READ = 'read',
  SEND = 'send',
}

export enum PermissionResource {
  MAINTENANCE = 'maintenance',
  INVITATION = 'invitation',
  PROPERTY = 'property',
  PAYMENT = 'payment',
  CLIENT = 'client',
  REPORT = 'report',
  LEASE = 'lease',
  USER = 'user',
}

export enum IdentificationEnumType {
  CORPORATION_LICENSE = 'corporation-license',
  DRIVERS_LICENSE = 'drivers-license',
  NATIONAL_ID = 'national-id',
  PASSPORT = 'passport',
}

export enum CURRENCIES {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  AUD = 'AUD',
  CAD = 'CAD',
  NZD = 'NZD',
  JPY = 'JPY',
  CNY = 'CNY',
  NGN = 'NGN',
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
  currentuser?: ICurrentUser | null;
  service: { env: string };
  source: RequestSource;
  requestId: string;
  timestamp: Date;
  ip?: string;
}

export interface RateLimitOptions {
  delayMs?: number | ((numRequests: number) => number); // delay in ms to add
  enableSpeedLimit?: boolean;
  enableRateLimit?: boolean;

  // speed limiting params
  delayAfter?: number; // number of requests before adding delay
  // rate limiting params
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
  resourceType: 'image' | 'video' | 'document' | 'unknown'; //type of the file
  resourceName: 'property' | 'profile'; //name of the resource
  resourceId: string; //id of the resource
  fieldName: string; //name of the field
  actorId: string; //user who uploaded the file
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
  roles: Record<string, Record<string, string[]>>;
}

export interface UploadResult {
  mediatype?: 'image' | 'video' | 'document';
  documentName?: string;
  resourceName?: string;
  resourceId: string;
  fieldName: string;
  publicuid: string;
  actorId?: string;
  filename: string;
  size?: number;
  key?: string;
  url: string;
}

export interface PaginateResult {
  hasMoreResource: boolean;
  currentPage: number;
  totalPages: number;
  nextPage?: string;
  prevPage?: string;
  perPage: number;
  total: number;
}

export interface IPaginationQuery {
  sort?: string | Record<string, 1 | -1 | { $meta: 'textScore' }>;
  sortBy?: string;
  limit?: number;
  page?: number;
  skip?: number;
}

export type ISuccessReturnData<T = any> = {
  errors?: [{ path: string; message: string }];
  success: boolean;
  message?: string;
  error?: string;
  data: T;
};

export interface UploadedFile {
  originalname?: string;
  fieldName: string;
  mimetype?: string;
  filename: string;
  size?: number;
  path: string;
}

export type MulterFile =
  | Express.Multer.File[]
  | {
      [fieldname: string]: Express.Multer.File[];
    }
  | undefined;

export interface AppRequest extends Request {
  container: AwilixContainer;
  context: IRequestContext;
  rawBody: Buffer;
}

export interface IEmailOptions<T> {
  emailType: string;
  subject: string;
  to: string;
  data: T;
}

export interface IPermissionResult {
  attributes?: string[];
  granted: boolean;
  reason?: string;
}

export type CsvProcessReturnData = {
  data: IProperty[];
  errors?: IInvalidCsvProperty[] | null;
};

export type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

export type ListResultWithPagination<T> = Promise<{
  items: T;
  pagination?: PaginateResult;
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
