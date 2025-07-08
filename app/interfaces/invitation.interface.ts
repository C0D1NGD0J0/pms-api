import { Document, Types } from 'mongoose';

import { IUserRole } from './user.interface';

export interface IInvitation {
  metadata: {
    inviteMessage?: string;
    expectedStartDate?: Date;
    remindersSent: number;
    lastReminderSent?: Date;
  };
  personalInfo: {
    firstName: string;
    lastName: string;
    phoneNumber?: string;
  };
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  acceptedBy?: Types.ObjectId;
  revokedBy?: Types.ObjectId;
  invitedBy: Types.ObjectId;
  invitationToken: string;
  revokeReason?: string;
  inviteeEmail: string;
  acceptedAt?: Date;
  clientId: string;
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

export interface IInvitationListQuery {
  status?: 'pending' | 'accepted' | 'expired' | 'revoked';
  sortBy?: 'createdAt' | 'expiresAt' | 'inviteeEmail';
  sortOrder?: 'asc' | 'desc';
  clientId: string;
  role?: IUserRole;
  limit?: number;
  page?: number;
}

export interface IInvitationData {
  personalInfo: {
    firstName: string;
    lastName: string;
    phoneNumber?: string;
  };
  metadata?: {
    inviteMessage?: string;
    expectedStartDate?: Date;
  };
  inviteeEmail: string;
  role: IUserRole;
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
}

export interface IInvitationStats {
  byRole: Record<IUserRole, number>;
  accepted: number;
  pending: number;
  expired: number;
  revoked: number;
  total: number;
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
