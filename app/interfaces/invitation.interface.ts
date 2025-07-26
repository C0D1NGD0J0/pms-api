import { Document, Types } from 'mongoose';

import { IUserRole } from './user.interface';
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
  status: 'draft' | 'pending' | 'accepted' | 'expired' | 'revoked' | 'sent';
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

  _id: Types.ObjectId;
  // Instance methods
  isValid(): boolean;
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
  inviteeEmail: string;
  role: IUserRole;
}

export interface IInvitationListQuery {
  status?: 'draft' | 'pending' | 'accepted' | 'expired' | 'revoked' | 'sent';
  sortBy?: 'createdAt' | 'expiresAt' | 'inviteeEmail';
  sortOrder?: 'asc' | 'desc';
  role?: IUserRole;
  limit?: number;
  page?: number;
  cuid: string;
}

export interface IInvitationAcceptance {
  userData: {
    password: string;
    location?: string;
    timeZone?: string;
    lang?: string;
    bio?: string;
    headline?: string;
  };
  invitationToken: string;
  cuid: string;
}

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
  };
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
