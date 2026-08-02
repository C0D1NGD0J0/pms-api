import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import { IContactInfoType, IBaseUserProfile, IUserDocument, IAccountType } from './user.interface';

export interface IClient {
  identityVerification?: {
    sessionId?: string;
    sessionStatus?: 'requires_input' | 'stripe_verified';
    documentType?: string;
    issuingCountry?: string;
    expiryDate?: Date | null;
    verifiedBy?: string | Types.ObjectId | null;
    verifiedAt?: Date | null;
  };
  accountAdmin: Types.ObjectId | PopulatedAccountAdmin;
  subscription: Types.ObjectId | null;
  companyProfile?: ICompanyProfile;
  dataProcessingConsent?: boolean;
  lastModifiedBy: Types.ObjectId;
  /** Populated only when explicitly selected via .select('+suspension') */
  suspension?: IClientSuspension;
  settings: IClientSettings;
  accountType: IAccountType;
  displayName: string;
}

export interface IClientSettings {
  notificationPreferences: NotificationPreferences;
  vendorPayoutMode?: 'express' | 'platform_hold';
  tenantFeatures?: ITenantFeatureSettings;
  requireDepositRefundApproval?: boolean; // When true, deposit refunds queue as PENDING_REFUND and require explicit PM/admin release
  defaultCurrency?: string; // ISO 4217 — display preference and property creation pre-fill
  timeZone: string;
  lang: string;
}

export interface IClientDocument extends Document, IClient {
  verificationDeadline?: Date | null; // virtual: createdAt + 3 days, null when isVerified
  isVerified: boolean;
  _id: Types.ObjectId;
  deletedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  cuid: string;
  id: string;
}

export interface IClientUserConnections {
  requiresOnboarding?: boolean;
  primaryRole: IUserRoleType;
  clientDisplayName: string;
  linkedVendorUid?: string;
  isFormerTenant?: boolean;
  roles: IUserRoleType[];
  leaseExpiredAt?: Date;
  isConnected: boolean;
  cuid: string;
}

export interface ICompanyProfile {
  contactInfo?: IContactInfoType;
  registrationNumber?: string;
  legalEntityName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  tradingName?: string;
  website?: string;
  logo?: string;
}

export interface ITenantFeatureSettings {
  maintenanceRequests: boolean;
  tenantPortalActive: boolean;
  smsNotifications: boolean;
  onlinePayments: boolean;
  inspections: boolean;
  guestPass: boolean;
}

export type PopulatedAccountAdmin = Pick<
  IBaseUserProfile,
  'email' | 'firstName' | 'lastName' | 'avatar'
> & {
  _id: Types.ObjectId;
};

export type IPopulatedClientDocument = {
  accountAdmin: IUserDocument | Types.ObjectId;
} & Omit<IClientDocument, 'accountAdmin'>;

export interface IClientSuspension {
  by?: Types.ObjectId;
  isActive: boolean;
  reason?: string;
  at?: Date;
}

export type IClientInfo = {
  clientDisplayName: string;
  id?: string;
} & Pick<IClientDocument, 'cuid'>;

/**
 * ============================================================================
 * RESPONSE INTERFACES
 * ============================================================================
 */

/**
 * Notification Preferences Type
 * Defines all notification channel preferences
 */
export type NotificationPreferences = {
  email: boolean;
  sms: boolean;
  inApp: boolean;
};

/**
 * Type for active account info (used in auth responses)
 * Essential info for user session management
 */
export type IActiveAccountInfo = Pick<IClientUserConnections, 'cuid' | 'clientDisplayName'>;

/**
 * ============================================================================
 * REPORTING INTERFACES
 * ============================================================================
 */

/**
 * Client Statistics Interface
 * Aggregated metrics for client dashboard
 */
export interface IClientStats {
  totalProperties: number;
  totalUsers: number;
}
