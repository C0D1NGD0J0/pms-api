import { NextFunction, Response, Request } from 'express';

/**
 * Interface defining the structure of pagination metadata
 */
export interface PaginateResult {
  total: number;
  perPage: number;
  hasMoreResource: boolean;
  totalPages: number;
  currentPage: number;
}

/**
 * File types that are supported for extraction
 */
export enum FileType {
  IMAGE = 'image',
  VIDEO = 'video',
  DOCUMENT = 'application',
  AUDIO = 'audio',
}

export interface IUploadFileInterface {
  filename?: string;
  key?: string;
  url: string;
}

export interface IEmailOptions<T = unknown> {
  subject: string;
  to: string;
  data: T;
  emailType: string;
}

export interface ISuccessReturnData<T = unknown> {
  data: T;
  msg?: string;
  success: boolean;
}

export type TokenType = 'accessToken' | 'refreshToken';
export type IPromiseReturnedData<T = object> = Promise<ISuccessReturnData<T>>;
export type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<any>;

export type MulterFile =
  | Express.Multer.File[]
  | {
      [fieldname: string]: Express.Multer.File[];
    }
  | undefined;

export type ExtractedMediaFile = {
  fieldName: string;
  mimeType: string;
  path: string;
  filename: string;
  fileSize: number;
};

export interface IAWSFileUploadResponse {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  bucket: string;
  key: string;
  acl?: string;
  contentType: string;
  contentDisposition: string | null;
  contentEncoding: string | null;
  storageClass: string;
  serverSideEncryption: string | null;
  metadata: string | null;
  location: string;
  etag: string;
  versionId?: string;
}

export interface IPaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  skip?: number | null;
}
