import { Document, Types } from 'mongoose';
import { IUserRole } from '@shared/constants/roles.constants';

import { IUserDocument } from './user.interface';
import { EmployeeInfo, TenantInfo, VendorInfo } from './profile.interface';

/**
 * ============================================================================
 * BASE TYPE DEFINITIONS (Single Source of Truth)
 * ============================================================================
 */

/**
 * Invitation Document Interface
 * Extends IInvitation with MongoDB document properties and methods
 */
export interface IInvitationDocument extends IInvitation, Document {
  // Instance methods
  revoke(revokedBy: string, reason?: string): Promise<IInvitationDocument>;
  accept(acceptedBy: string): Promise<IInvitationDocument>;
  expire(): Promise<IInvitationDocument>;
  // Virtual properties (computed)
  inviteeFullName: string;

  // Optional fields
  declineReason?: string;

  // MongoDB fields
  _id: Types.ObjectId;
  isValid(): boolean;

  declinedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Main Invitation Interface
 * Core invitation data structure
 */
export interface IInvitation {
  personalInfo: IInvitationPersonalInfo;
  linkedVendorUid?: Types.ObjectId;
  metadata: IInvitationMetadata;
  acceptedBy?: Types.ObjectId;
  revokedBy?: Types.ObjectId;
  invitedBy: Types.ObjectId;
  status: InvitationStatus;
  clientId: Types.ObjectId;
  invitationToken: string;
  revokeReason?: string;
  inviteeEmail: string;
  acceptedAt?: Date;
  revokedAt?: Date;
  role: IUserRole;
  expiresAt: Date;
  iuid: string;
}

/**
 * ============================================================================
 * CORE INTERFACES (Single Source of Truth)
 * ============================================================================
 */

/**
 * Invitation List Query Interface
 * Used for querying and filtering invitations
 */
export interface IInvitationListQuery {
  sortBy?: 'createdAt' | 'expiresAt' | 'inviteeEmail';
  sortOrder?: 'asc' | 'desc';
  status?: InvitationStatus;
  clientId?: string; // Resolved from cuid by service before calling DAO
  role?: IUserRole;
  limit?: number;
  page?: number;
  cuid: string;
}

/**
 * Invitation Form Data Interface
 * Used for creating new invitations via API
 */
export interface IInvitationData {
  personalInfo: IInvitationPersonalInfo;
  metadata?: IInvitationMetadataInput;
  status: InitialInvitationStatus;
  linkedVendorUid?: string; // ID of an existing vendor user to link this invitation to
  inviteeEmail: string;
  role: IUserRole;
}

/**
 * Invitation Acceptance Data Interface
 * Used when accepting an invitation
 */
export interface IInvitationAcceptance {
  newsletterOptIn: boolean;
  confirmPassword: string;
  termsAccepted: boolean;
  phoneNumber?: string;
  location?: string;
  password: string;
  timeZone: string;
  email: string;
  token: string;
  lang: string;
  cuid: string;
}

/**
 * Invitation Metadata Interface
 * Additional invitation context and tracking
 */
export interface IInvitationMetadata {
  employeeInfo?: EmployeeInfo;
  expectedStartDate?: Date;
  vendorInfo?: VendorInfo;
  tenantInfo?: TenantInfo;
  lastReminderSent?: Date;
  inviteMessage?: string;
  remindersSent: number;
}

/**
 * ============================================================================
 * DOCUMENT INTERFACES (Mongoose Extensions)
 * ============================================================================
 */

/**
 * Populated Invitation Document Interface
 * Invitation with populated user references
 */
export type IInvitationDocumentPopulated = {
  invitedBy: Partial<IUserDocument>;
  acceptedBy?: Partial<IUserDocument>;
  revokedBy?: Partial<IUserDocument>;
} & Omit<IInvitationDocument, 'invitedBy' | 'acceptedBy' | 'revokedBy'>;

/**
 * ============================================================================
 * FORM DATA INTERFACES
 * ============================================================================
 */

/**
 * Invitation Stats Interface
 * Statistics for invitation reporting
 */
export interface IInvitationStats {
  byRole: Record<IUserRole, number>;
  accepted: number;
  expired: number;
  pending: number;
  revoked: number;
  total: number;
  sent: number;
}

/**
 * Send Invitation Result Interface
 * Result of sending an invitation email
 */
export interface ISendInvitationResult {
  emailData: {
    to: string;
    subject: string;
    data: any;
  } | null;
  invitation: IInvitationDocument;
}

/**
 * Invitation Status Type
 * Represents the current state of an invitation
 */
export type InvitationStatus =
  | 'draft'
  | 'pending'
  | 'accepted'
  | 'expired'
  | 'revoked'
  | 'sent'
  | 'declined';

/**
 * ============================================================================
 * POPULATED/ENRICHED INTERFACES
 * ============================================================================
 */

/**
 * Invitation Validation Result Interface
 * Result of validating an invitation token
 */
export interface IInvitationValidation {
  invitation?: IInvitationDocument;
  isValid: boolean;
  error?: string;
}

/**
 * ============================================================================
 * QUERY & FILTER INTERFACES
 * ============================================================================
 */

/**
 * Personal Information Interface
 * Basic personal details for invitation recipients
 */
export interface IInvitationPersonalInfo {
  phoneNumber?: string;
  firstName: string;
  lastName: string;
}

/**
 * ============================================================================
 * RESPONSE INTERFACES
 * ============================================================================
 */

/**
 * Invitation Metadata Input Interface
 * Metadata structure for creating/updating invitations (without tracking fields)
 */
export type IInvitationMetadataInput = Omit<
  IInvitationMetadata,
  'remindersSent' | 'lastReminderSent'
>;

/**
 * Resend Invitation Data Interface
 * Used when resending an invitation
 */
export interface IResendInvitationData {
  customMessage?: string;
  iuid: string;
}

/**
 * Draft/Initial Invitation Status Type
 * Used when creating new invitations
 */
export type InitialInvitationStatus = 'draft' | 'pending';
