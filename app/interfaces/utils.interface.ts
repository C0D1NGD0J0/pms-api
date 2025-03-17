import 'multer';
import { Response, Request, NextFunction } from 'express';

export enum MailType {
  SUBSCRIPTION_UPDATE = 'SUBSCRIPTION_UPDATE',
  SUBSCRIPTION_CANCEL = 'SUBSCRIPTION_CANCEL',
  ACCOUNT_ACTIVATION = 'ACCOUNT_ACTIVATION',
  USER_REGISTRATION = 'USER_REGISTRATION',
  FORGOT_PASSWORD = 'FORGOT_PASSWORD',
  PASSWORD_RESET = 'PASSWORD_RESET',
  ACCOUNT_UPDATE = 'ACCOUNT_UPDATE',
}

export enum IdentificationType {
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

/**
 * File types that are supported for extraction
 */
export enum FileType {
  DOCUMENT = 'application',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
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

/**
 * Interface defining the structure of pagination metadata
 */
export interface PaginateResult {
  hasMoreResource: boolean;
  currentPage: number;
  totalPages: number;
  perPage: number;
  total: number;
}

export type ExtractedMediaFile = {
  fieldName: string;
  mimeType: string;
  path: string;
  filename: string;
  fileSize: number;
};
export type MulterFile =
  | Express.Multer.File[]
  | {
      [fieldname: string]: Express.Multer.File[];
    }
  | undefined;
export interface IPaginationQuery {
  skip?: number | null;
  sortBy?: string;
  limit?: number;
  page?: number;
}

export interface IEmailOptions<T> {
  emailType: string;
  subject: string;
  to: string;
  data: T;
}

export type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

export interface ISuccessReturnData<T = unknown> {
  success: boolean;
  msg?: string;
  data: T;
}

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

export type IPromiseReturnedData<T = object> = Promise<ISuccessReturnData<T>>;

export type TokenType = 'accessToken' | 'refreshToken';
