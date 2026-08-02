import { Document, Types } from 'mongoose';
import { IUserRole } from '@shared/constants/roles.constants';

import { IUserDocument } from './user.interface';
import { EmployeeInfo, TenantInfo, VendorInfo } from './profile.interface';

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

export interface IInvitationDocument extends IInvitation, Document {
  revoke(revokedBy: string, reason?: string): Promise<IInvitationDocument>;
  accept(acceptedBy: string): Promise<IInvitationDocument>;
  expire(): Promise<IInvitationDocument>;
  inviteeFullName: string;
  declineReason?: string;
  _id: Types.ObjectId;
  isValid(): boolean;
  declinedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInvitationAcceptance {
  newsletterOptIn: boolean;
  confirmPassword: string;
  termsAccepted: boolean;
  phoneNumber?: string;
  consentDate?: string;
  firstName?: string;
  location?: string;
  lastName?: string;
  password: string;
  timeZone: string;
  email: string;
  token: string;
  lang: string;
  cuid: string;
}

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

export interface IInvitationData {
  personalInfo: IInvitationPersonalInfo;
  metadata?: IInvitationMetadataInput;
  status: InitialInvitationStatus;
  linkedVendorUid?: string; // ID of an existing vendor user to link this invitation to
  inviteeEmail: string;
  role: IUserRole;
}

export interface IInvitationMetadata {
  employeeInfo?: EmployeeInfo;
  expectedStartDate?: Date;
  vendorInfo?: VendorInfo;
  tenantInfo?: TenantInfo;
  lastReminderSent?: Date;
  inviteMessage?: string;
  remindersSent: number;
}

export type IInvitationDocumentPopulated = {
  invitedBy: Partial<IUserDocument>;
  acceptedBy?: Partial<IUserDocument>;
  revokedBy?: Partial<IUserDocument>;
} & Omit<IInvitationDocument, 'invitedBy' | 'acceptedBy' | 'revokedBy'>;

export interface IInvitationStats {
  byRole: Record<IUserRole, number>;
  accepted: number;
  expired: number;
  pending: number;
  revoked: number;
  total: number;
  sent: number;
}

export interface ISendInvitationResult {
  emailData: {
    to: string;
    subject: string;
    data: any;
  } | null;
  invitation: IInvitationDocument;
}

export type InvitationStatus =
  | 'draft'
  | 'pending'
  | 'accepted'
  | 'expired'
  | 'revoked'
  | 'sent'
  | 'declined';

export interface IInvitationValidation {
  invitation?: IInvitationDocument;
  isValid: boolean;
  error?: string;
}

export interface IInvitationPersonalInfo {
  phoneNumber?: string;
  firstName: string;
  lastName: string;
}

export type IInvitationMetadataInput = Omit<
  IInvitationMetadata,
  'remindersSent' | 'lastReminderSent'
>;

export interface IResendInvitationData {
  customMessage?: string;
  iuid: string;
}

export type InitialInvitationStatus = 'draft' | 'pending';
