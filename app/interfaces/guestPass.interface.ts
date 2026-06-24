import { Document, Types } from 'mongoose';

import { ISuccessReturnData, IPaginateResult } from './utils.interface';

export enum GuestPassStatus {
  PENDING = 'pending',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
  ACTIVE = 'active',
  USED = 'used',
}

export enum DeliveryStatusEnum {
  PENDING = 'pending',
  FAILED = 'failed',
  SENT = 'sent',
}

export enum DeliveryMethod {
  EMAIL = 'email',
  SMS = 'sms',
}

export interface IGuestPassService {
  validateCode(
    cuid: string,
    userId: string,
    data: IValidateGuestPassRequest
  ): Promise<ISuccessReturnData<IGuestPassValidationResult>>;
  bulkAcknowledgePasses(
    cuid: string,
    userId: string,
    passIds: string[]
  ): Promise<ISuccessReturnData<{ acknowledged: number }>>;
  getUnacknowledgedPasses(
    cuid: string,
    userId: string,
    propertyId: string
  ): Promise<ISuccessReturnData<IGuestPassDocument[]>>;
  getMyPasses(
    cuid: string,
    userId: string,
    filters: IGuestPassFilters
  ): Promise<ISuccessReturnData<IGuestPassListResponse>>;
  getUnacknowledgedCount(
    cuid: string,
    userId: string,
    propertyId?: string
  ): Promise<ISuccessReturnData<{ count: number }>>;
  createPass(
    cuid: string,
    userId: string,
    data: ICreateGuestPassInput
  ): Promise<ISuccessReturnData<IGuestPassDocument>>;
  getExpectedVisitors(
    cuid: string,
    filters: IGuestPassFilters
  ): Promise<ISuccessReturnData<IGuestPassListResponse>>;
  acknowledgePass(
    cuid: string,
    userId: string,
    passId: string
  ): Promise<ISuccessReturnData<IGuestPassDocument>>;
  revokePass(
    cuid: string,
    userId: string,
    vpuid: string
  ): Promise<ISuccessReturnData<IGuestPassDocument>>;
  getStats(cuid: string, propertyId?: string): Promise<ISuccessReturnData<IGuestPassStats>>;
}

export interface IGuestPass {
  deliveryStatus: {
    sms?: DeliveryStatusEnum;
    email?: DeliveryStatusEnum;
  };
  visitorInfo: {
    name: string;
    phone?: string;
    email?: string;
  };
  acknowledgedBy?: Types.ObjectId;
  propertyUnitId?: Types.ObjectId;
  validatedBy?: Types.ObjectId;
  propertyId: Types.ObjectId;
  revokedBy?: Types.ObjectId;
  createdBy: Types.ObjectId;

  sentVia: DeliveryMethod[];
  status: GuestPassStatus;
  isAcknowledged: boolean;
  expiryMinutes: number;
  acknowledgedAt?: Date;

  entryNotes?: string;
  revokedAt?: Date;
  note?: string;
}

export interface IGuestPassDocument extends IGuestPass, Document {
  minutesRemaining: number;
  _id: Types.ObjectId;
  entryNotes?: string;
  isExpired: boolean;
  isValid(): boolean;
  purpose?: string;
  validUntil: Date;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  vpuid: string;
  usedAt?: Date;
  sentAt?: Date;
  cuid: string;
}

export interface ICreateGuestPassInput {
  notifySecurity?: boolean;
  expiryMinutes?: number;
  visitorPhone?: string;
  visitorEmail?: string;
  sendViaEmail: boolean;
  visitorName: string;
  sendViaSms: boolean;
  propertyId: string;
  hostPhone?: string;
  purpose?: string;
  hostName: string;
  unitId?: string;
}

export interface IGuestPassFilters {
  timeWindow?: 'next_hour' | 'today' | 'all';
  status?: GuestPassStatus;
  propertyId?: string;
  limit?: number;
  page?: number;
}

export interface IGuestPassStats {
  unacknowledged: number;
  pending: number;
  expired: number;
  revoked: number;
  active: number;
  total: number;
  used: number;
}

export interface IGuestPassValidationResult {
  pass?: IGuestPassDocument;
  reason?: string;
  valid: boolean;
}

export interface IGuestPassListResponse {
  passes: IGuestPassDocument[];
  pagination?: IPaginateResult;
}

export interface IValidateGuestPassRequest {
  entryNotes?: string;
  propertyId: string;
  code: string;
}
