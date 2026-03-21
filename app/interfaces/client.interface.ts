import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import { IContactInfoType, IBaseUserProfile, IUserDocument, IAccountType } from './user.interface';

/**
 * ============================================================================
 * BASE TYPE DEFINITIONS (Single Source of Truth)
 * ============================================================================
 */

/**
 * Main Client Interface
 * Core client data structure
 */
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
  settings: IClientSettings;
  accountType: IAccountType;
  displayName: string;
}

/**
 * ============================================================================
 * CORE INTERFACES (Single Source of Truth)
 * ============================================================================
 */

/**
 * Client Document Interface (extends Mongoose Document)
 * Extends IClient with MongoDB document properties
 */
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

/**
 * Company Profile Interface
 * Business entity information for corporate clients
 */
export interface ICompanyProfile {
  contactInfo?: IContactInfoType;
  registrationNumber?: string;
  legalEntityName?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  tradingName?: string;
  industry?: string;
  website?: string;
}

/**
 * Client User Connections Interface
 * Represents the connection between a user and a client
 */
export interface IClientUserConnections {
  requiresOnboarding?: boolean;
  primaryRole: IUserRoleType;
  clientDisplayName: string;
  linkedVendorUid?: string;
  roles: IUserRoleType[];
  isConnected: boolean;
  cuid: string;
}

/**
 * Populated Account Admin Type
 * Essential user information for client admin
 */
export type PopulatedAccountAdmin = Pick<
  IBaseUserProfile,
  'email' | 'firstName' | 'lastName' | 'avatar'
> & {
  _id: Types.ObjectId;
};

/**
 * ============================================================================
 * POPULATED/ENRICHED INTERFACES
 * ============================================================================
 */

/**
 * Populated Client Document Type
 * Client document with fully populated account admin
 */
export type IPopulatedClientDocument = {
  accountAdmin: IUserDocument | Types.ObjectId;
} & Omit<IClientDocument, 'accountAdmin'>;

/**
 * ============================================================================
 * DOCUMENT INTERFACES (Mongoose Extensions)
 * ============================================================================
 */

/**
 * Client Settings Interface
 * User preferences and configuration
 */
export interface IClientSettings {
  notificationPreferences: NotificationPreferences;
  timeZone: string;
  lang: string;
}

/**
 * Simplified client info for passing around client context
 * Minimal client data for request context
 */
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
