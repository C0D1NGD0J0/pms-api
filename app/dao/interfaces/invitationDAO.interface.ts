import { ClientSession } from 'mongoose';
import { ListResultWithPagination } from '@interfaces/index';
import {
  IInvitationListQuery,
  IInvitationDocument,
  IInvitationStats,
  IInvitationData,
} from '@interfaces/invitation.interface';

import { IBaseDAO } from './baseDAO.interface';

export interface IInvitationDAO extends IBaseDAO<IInvitationDocument> {
  updateInvitationStatus(
    invitationId: string,
    clientId: string,
    status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'sent',
    session?: ClientSession
  ): Promise<IInvitationDocument | null>;

  revokeInvitation(
    invitationId: string,
    clientId: string,
    revokedBy: string,
    reason?: string,
    session?: ClientSession
  ): Promise<IInvitationDocument | null>;

  createInvitation(
    invitationData: IInvitationData,
    invitedBy: string,
    clientId: string,
    session?: ClientSession
  ): Promise<IInvitationDocument>;

  incrementReminderCount(
    invitationId: string,
    clientId: string,
    session?: ClientSession
  ): Promise<IInvitationDocument | null>;

  acceptInvitation(
    invitationToken: string,
    acceptedBy: string,
    session?: ClientSession
  ): Promise<IInvitationDocument | null>;

  /** Returns pending invitations older than `daysSinceCreated` days that have received fewer than `maxReminders` reminders. */
  getInvitationsNeedingReminders(
    daysSinceCreated: number,
    maxReminders: number
  ): Promise<IInvitationDocument[]>;

  getInvitationsByClient(
    query: IInvitationListQuery
  ): ListResultWithPagination<IInvitationDocument[]>;

  findPendingInvitation(email: string, clientId: string): Promise<IInvitationDocument | null>;

  getInvitationsByEmail(clientId: string, email: string): Promise<IInvitationDocument[]>;

  findByIuid(iuid: string, clientId: string): Promise<IInvitationDocument | null>;

  findByToken(token: string): Promise<IInvitationDocument | null>;

  getInvitationStats(clientId: string): Promise<IInvitationStats>;

  expireInvitations(): Promise<number>;
}
