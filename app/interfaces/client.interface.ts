import { Document, Types } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';

import {
  IdentificationType,
  IContactInfoType,
  IUserDocument,
  IAccountType,
} from './user.interface';

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
  accountAdmin: Types.ObjectId | PopulatedAccountAdmin;
  identification?: IdentificationType;
  subscription: Types.ObjectId | null;
  companyProfile?: ICompanyProfile;
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
 * Client Document Interface (extends Mongoose Document)
 * Extends IClient with MongoDB document properties
 */
export interface IClientDocument extends Document, IClient {
  verifiedBy: string | Types.ObjectId;
  isVerified: boolean;
  _id: Types.ObjectId;
  deletedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  cuid: string;
  id: string;
}

/**
 * Client User Connections Interface
 * Represents the connection between a user and a client
 */
export interface IClientUserConnections {
  clientDisplayName: string;
  linkedVendorUid?: string;
  roles: IUserRoleType[];
  isConnected: boolean;
  cuid: string;
}

/**
 * Populated Client Document Type
 * Client document with fully populated account admin
 */
export type IPopulatedClientDocument = {
  accountAdmin: IUserDocument | Types.ObjectId;
} & Omit<IClientDocument, 'accountAdmin'>;

/**
 * ============================================================================
 * POPULATED/ENRICHED INTERFACES
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
 * ============================================================================
 * DOCUMENT INTERFACES (Mongoose Extensions)
 * ============================================================================
 */

/**
 * Populated Account Admin Type
 * Essential user information for client admin
 */
export type PopulatedAccountAdmin = Pick<
  IUserDocument,
  '_id' | 'email' | 'firstName' | 'lastName' | 'avatar'
>;

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
