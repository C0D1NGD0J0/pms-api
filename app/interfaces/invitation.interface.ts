import { Document, Types } from 'mongoose';

import { IUserDocument, IUserRole } from './user.interface';
import { EmployeeInfo, VendorInfo } from './profile.interface';

export interface IInvitation {
  metadata: {
    inviteMessage?: string;
    expectedStartDate?: Date;
    employeeInfo?: EmployeeInfo;
    vendorInfo?: VendorInfo;
    remindersSent: number;
    lastReminderSent?: Date;
  };
  personalInfo: {
    firstName: string;
    lastName: string;
    phoneNumber?: string;
  };
  status: 'draft' | 'pending' | 'accepted' | 'expired' | 'revoked' | 'sent' | 'declined';
  linkedVendorId?: Types.ObjectId;
  acceptedBy?: Types.ObjectId;
  revokedBy?: Types.ObjectId;
  invitedBy: Types.ObjectId;
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
  inviteeFullName: string; // virtual property
  declineReason?: string; // optional field for decline reason
  _id: Types.ObjectId;
  isValid(): boolean;
  declinedAt?: Date; // optional field for declined invitations
  createdAt: Date;
  updatedAt: Date;
}

export interface IInvitationData {
  metadata?: {
    inviteMessage?: string;
    expectedStartDate?: Date;
    employeeInfo?: EmployeeInfo;
    vendorInfo?: VendorInfo;
  };
  personalInfo: {
    firstName: string;
    lastName: string;
    phoneNumber?: string;
  };
  status: 'draft' | 'pending';
  linkedVendorId?: string; // ID of an existing vendor user to link this invitation to
  inviteeEmail: string;
  role: IUserRole;
}

export interface IInvitationListQuery {
  status?: 'draft' | 'pending' | 'accepted' | 'expired' | 'revoked' | 'sent' | 'declined';
  sortBy?: 'createdAt' | 'expiresAt' | 'inviteeEmail';
  sortOrder?: 'asc' | 'desc';
  role?: IUserRole;
  limit?: number;
  page?: number;
  cuid: string;
}

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

export interface IInvitationValidation {
  invitation?: IInvitationDocument;
  isValid: boolean;
  error?: string;
}

export interface IResendInvitationData {
  customMessage?: string;
  iuid: string;
}
