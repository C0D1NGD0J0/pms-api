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
  /**
   * Update invitation status
   * @param invitationId - The invitation ID
   * @param clientId - The client ID for security scoping
   * @param status - The new status
   * @param session - Optional MongoDB session for transactions
   * @returns Promise that resolves to the updated invitation or null
   */
  updateInvitationStatus(
    invitationId: string,
    clientId: string,
    status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'sent',
    session?: ClientSession
  ): Promise<IInvitationDocument | null>;

  /**
   * Revoke an invitation
   * @param invitationId - The invitation ID
   * @param clientId - The client ID for security scoping
   * @param revokedBy - The user ID who is revoking the invitation
   * @param reason - Optional reason for revocation
   * @param session - Optional MongoDB session for transactions
   * @returns Promise that resolves to the updated invitation or null
   */
  revokeInvitation(
    invitationId: string,
    clientId: string,
    revokedBy: string,
    reason?: string,
    session?: ClientSession
  ): Promise<IInvitationDocument | null>;

  /**
   * Create a new invitation
   * @param invitationData - The invitation data
   * @param invitedBy - The user ID who is sending the invitation
   * @param clientId - The client ID for the invitation
   * @param session - Optional MongoDB session for transactions
   * @returns Promise that resolves to the created invitation
   */
  createInvitation(
    invitationData: IInvitationData,
    invitedBy: string,
    clientId: string,
    session?: ClientSession
  ): Promise<IInvitationDocument>;

  /**
   * Update reminder count for an invitation
   * @param invitationId - The invitation ID
   * @param clientId - The client ID for security scoping
   * @param session - Optional MongoDB session for transactions
   * @returns Promise that resolves to the updated invitation or null
   */
  incrementReminderCount(
    invitationId: string,
    clientId: string,
    session?: ClientSession
  ): Promise<IInvitationDocument | null>;

  /**
   * Accept an invitation
   * @param invitationToken - The invitation token
   * @param acceptedBy - The user ID who is accepting the invitation
   * @param session - Optional MongoDB session for transactions
   * @returns Promise that resolves to the updated invitation or null
   */
  acceptInvitation(
    invitationToken: string,
    acceptedBy: string,
    session?: ClientSession
  ): Promise<IInvitationDocument | null>;

  /**
   * Get invitations that need reminders (pending and older than X days)
   * @param daysSinceCreated - Number of days since creation to consider for reminder
   * @param maxReminders - Maximum number of reminders already sent
   * @returns Promise that resolves to invitations that need reminders
   */
  getInvitationsNeedingReminders(
    daysSinceCreated: number,
    maxReminders: number
  ): Promise<IInvitationDocument[]>;

  /**
   * Get invitations for a client with filtering options
   * @param query - Query parameters for filtering and pagination
   * @returns Promise that resolves to filtered invitations with pagination
   */
  getInvitationsByClient(
    query: IInvitationListQuery
  ): ListResultWithPagination<IInvitationDocument[]>;

  /**
   * Find pending invitation for an email and client
   * @param email - The invitee email
   * @param clientId - The client ID
   * @returns Promise that resolves to the invitation or null
   */
  findPendingInvitation(email: string, clientId: string): Promise<IInvitationDocument | null>;

  /**
   * Get invitations by invitee email across all clients
   * @param clientId - The client ID for security scoping
   * @param email - The invitee email
   * @returns Promise that resolves to invitations for the email
   */
  getInvitationsByEmail(clientId: string, email: string): Promise<IInvitationDocument[]>;

  /**
   * Find an invitation by its invitation ID
   * @param iuid - The invitation ID
   * @param clientId - The client ID for security scoping
   * @returns Promise that resolves to the invitation or null
   */
  findByIuid(iuid: string, clientId: string): Promise<IInvitationDocument | null>;

  /**
   * Find an invitation by its token
   * @param token - The invitation token
   * @returns Promise that resolves to the invitation or null
   */
  findByToken(token: string): Promise<IInvitationDocument | null>;

  /**
   * Get invitation statistics for a client
   * @param clientId - The client ID
   * @returns Promise that resolves to invitation statistics
   */
  getInvitationStats(clientId: string): Promise<IInvitationStats>;

  /**
   * Mark expired invitations as expired
   * @returns Promise that resolves to the number of invitations updated
   */
  expireInvitations(): Promise<number>;
}
