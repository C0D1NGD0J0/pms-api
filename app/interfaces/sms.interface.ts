import { Document, Types } from 'mongoose';

export enum SMSMessageType {
  MAINTENANCE_UPDATE = 'maintenance_update',
  PAYMENT_REMINDER = 'payment_reminder',
  LEASE_REMINDER = 'lease_reminder',
  VISITOR_PASS = 'visitor_pass',
  SYSTEM = 'system',
  OTP = 'otp',
}

export const TRANSACTIONAL_SMS_TYPES: SMSMessageType[] = [
  SMSMessageType.OTP,
  SMSMessageType.SYSTEM,
  SMSMessageType.VISITOR_PASS,
  SMSMessageType.PAYMENT_REMINDER,
];

export enum SMSStatus {
  DELIVERED = 'delivered',
  QUEUED = 'queued',
  FAILED = 'failed',
  SENT = 'sent',
}

export interface ISMSLog {
  messageType: SMSMessageType;
  sentBy?: Types.ObjectId;
  recipientPhone: string;
  twilioSid?: string;
  errorCode?: string;
  status: SMSStatus;
  smsuid: string;
  cuid: string;
  sentAt: Date;
}

export interface ISMSUsageSummary {
  byType: Record<string, number>;
  monthlyLimit: number;
  currentMonth: number;
  percentUsed: number;
  remaining: number;
  resetDate: Date;
  plan: string;
}

export interface ISendSMSInput {
  messageType: SMSMessageType;
  recipientUserId?: string;
  sentBy?: string;
  cuid: string;
  body: string;
  to: string; // E.164 format
}

export interface IQuotaStatus {
  percentUsed: number;
  remaining: number;
  enabled: boolean;
  resetDate: Date;
  limit: number;
  used: number;
}

export interface ISendSMSResult {
  twilioSid?: string;
  remaining?: number;
  message?: string;
  error?: SMSError;
  success: boolean;
}

export interface ISMSLogDocument extends Document, ISMSLog {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPhoneVerification {
  verifiedAt: Date | null;
  verifiedPhone: string;
  verified: boolean;
}

export interface ISMSConsent {
  consentedAt: Date | null;
  revokedAt: Date | null;
  consented: boolean;
}

type SMSError =
  | 'quota_exceeded'
  | 'sms_disabled'
  | 'delivery_failed'
  | 'opted_out'
  | 'unverified_phone'
  | 'rate_limited';

export function isTransactionalSMS(type: SMSMessageType): boolean {
  return TRANSACTIONAL_SMS_TYPES.includes(type);
}
