import dayjs from 'dayjs';
import { Invitation } from '@models/index';
import { hashGenerator } from '@utils/index';
import { ClientSession, FilterQuery, Types } from 'mongoose';
import { ListResultWithPagination } from '@interfaces/index';
import {
  IInvitationListQuery,
  IInvitationDocument,
  IInvitationStats,
  IInvitationData,
} from '@interfaces/invitation.interface';

import { BaseDAO } from './baseDAO';
import { IInvitationDAO } from './interfaces/invitationDAO.interface';

interface IInvitationAggregationResult {
  roleStats: Array<{
    _id: string;
    count: number;
  }>;
  accepted: number;
  expired: number;
  pending: number;
  revoked: number;
  total: number;
  sent: number;
  _id: null;
}

export class InvitationDAO extends BaseDAO<IInvitationDocument> implements IInvitationDAO {
  constructor() {
    super(Invitation);
  }

  /**
   * Create a new invitation
   */
  async createInvitation(
    invitationData: IInvitationData,
    invitedBy: string,
    clientId: string,
    session?: ClientSession
  ): Promise<IInvitationDocument> {
    try {
      const invitationToken = hashGenerator({ _usenano: true });
      const expiresAt = dayjs().add(1, 'day').toDate();

      const invitationToInsert: any = {
        ...invitationData,
        invitedBy: new Types.ObjectId(invitedBy),
        inviteeEmail: invitationData.inviteeEmail.toLowerCase(),
        clientId: new Types.ObjectId(clientId),
        role: invitationData.role,
        invitationToken,
        expiresAt,
        personalInfo: invitationData.personalInfo,
        metadata: {
          ...invitationData.metadata,
          remindersSent: 0,
        },
      };

      if (invitationData.linkedVendorUid) {
        invitationToInsert.linkedVendorUid = new Types.ObjectId(invitationData.linkedVendorUid);
      }

      const invitation = await this.insert(invitationToInsert, session);

      return invitation;
    } catch (error) {
      this.logger.error('Error creating invitation:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find an invitation by its token
   */
  async findByToken(token: string): Promise<IInvitationDocument | null> {
    try {
      return await this.findFirst(
        { invitationToken: token },
        {
          populate: [
            {
              path: 'invitedBy',
              select: 'email',
              populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' },
            },
            { path: 'revokedBy', select: 'email fullname' },
          ],
        }
      );
    } catch (error) {
      this.logger.error('Error finding invitation by token:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find an invitation by its invitation ID
   */
  async findByIuid(iuid: string, clientId: string): Promise<IInvitationDocument | null> {
    try {
      return await this.findFirst(
        { iuid, clientId },
        {
          populate: [
            { path: 'invitedBy', select: 'email fullname' },
            { path: 'acceptedBy', select: 'email fullname' },
            { path: 'revokedBy', select: 'email fullname' },
          ],
        }
      );
    } catch (error) {
      this.logger.error('Error finding invitation by ID:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find an invitation by its invitation ID (unsecured - for internal use only)
   * @internal This method should only be used internally when clientId validation happens at service layer
   */
  async findByIuidUnsecured(iuid: string): Promise<IInvitationDocument | null> {
    try {
      return await this.findFirst(
        { iuid },
        {
          populate: [
            { path: 'invitedBy', select: 'email fullname' },
            { path: 'acceptedBy', select: 'email fullname' },
            { path: 'revokedBy', select: 'email fullname' },
          ],
        }
      );
    } catch (error) {
      this.logger.error('Error finding invitation by ID (unsecured):', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find pending invitation for an email and client
   */
  async findPendingInvitation(
    email: string,
    clientId: string
  ): Promise<IInvitationDocument | null> {
    try {
      return await this.findFirst({
        inviteeEmail: email.toLowerCase(),
        clientId,
        status: { $in: ['pending', 'sent'] },
        expiresAt: { $gt: new Date() },
      });
    } catch (error) {
      this.logger.error('Error finding pending invitation:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get invitations for a client with filtering options
   */
  async getInvitationsByClient(
    query: IInvitationListQuery
  ): ListResultWithPagination<IInvitationDocument[]> {
    try {
      const filter: FilterQuery<IInvitationDocument> = {
        cuid: query.cuid,
      };

      if (query.status) {
        filter.status = query.status;
      }

      if (query.role) {
        filter.role = query.role;
      }

      const page = query.page || 1;
      const limit = query.limit || 20;
      const skip = (page - 1) * limit;

      // build sort object
      const sortBy = query.sortBy || 'createdAt';
      const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
      const sort = { [sortBy]: sortOrder } as Record<string, 1 | -1>;

      const options = {
        skip,
        limit,
        sort,
        populate: [
          { path: 'invitedBy', select: 'email fullname' },
          { path: 'acceptedBy', select: 'email fullname' },
          { path: 'revokedBy', select: 'email fullname' },
        ],
      };

      const result = await this.list(filter, options);
      return {
        items: result.items,
        pagination: result.pagination,
      };
    } catch (error) {
      this.logger.error('Error getting invitations by client:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update invitation details
   */
  async updateInvitation(
    iuid: string,
    clientId: string,
    invitationData: IInvitationData,
    session?: ClientSession
  ): Promise<IInvitationDocument | null> {
    try {
      const updateData: any = {
        $set: {
          inviteeEmail: invitationData.inviteeEmail.toLowerCase(),
          role: invitationData.role,
          status: invitationData.status,
          personalInfo: invitationData.personalInfo,
          metadata: {
            ...invitationData.metadata,
            remindersSent: 0,
            lastReminderSent: undefined,
          },
        },
      };

      if (invitationData.linkedVendorUid) {
        updateData.$set.linkedVendorUid = new Types.ObjectId(invitationData.linkedVendorUid);
      } else {
        // If linkedVendorUid is explicitly set to null or undefined, remove the field
        updateData.$unset = { linkedVendorUid: 1 };
      }

      return await this.update({ iuid, clientId }, updateData, { session });
    } catch (error) {
      this.logger.error('Error updating invitation:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update invitation status
   */
  async updateInvitationStatus(
    invitationId: string,
    clientId: string,
    status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'sent'
  ): Promise<IInvitationDocument | null> {
    try {
      return await this.update(
        { _id: new Types.ObjectId(invitationId), clientId: new Types.ObjectId(clientId) },
        { $set: { status } }
      );
    } catch (error) {
      this.logger.error('Error updating invitation status:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Revoke an invitation
   */
  async revokeInvitation(
    iuid: string,
    clientId: string,
    revokedBy: string,
    reason?: string,
    session?: ClientSession
  ): Promise<IInvitationDocument | null> {
    try {
      const updateData: any = {
        $set: {
          status: 'revoked',
          revokedAt: new Date(),
          revokedBy: new Types.ObjectId(revokedBy),
        },
      };

      if (reason) {
        updateData.$set.revokeReason = reason;
      }

      return await this.update({ iuid, clientId }, updateData, { session });
    } catch (error) {
      this.logger.error('Error revoking invitation:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Decline an invitation
   */
  async declineInvitation(
    iuid: string,
    clientId: string,
    reason?: string,
    session?: ClientSession
  ): Promise<IInvitationDocument | null> {
    try {
      const updateData: any = {
        $set: {
          status: 'declined',
          declineReason: reason || '',
          declinedAt: new Date(),
        },
        $unset: {
          invitationToken: 1,
        },
      };

      if (reason) {
        updateData.$set.declineReason = reason;
      }

      return await this.update({ iuid, clientId }, updateData, { session });
    } catch (error) {
      this.logger.error('Error declining invitation:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Accept an invitation
   */
  async acceptInvitation(
    invitationToken: string,
    acceptedBy: string,
    session?: ClientSession
  ): Promise<IInvitationDocument | null> {
    try {
      return await this.update(
        { invitationToken },
        {
          $set: {
            status: 'accepted',
            acceptedAt: new Date(),
            acceptedBy: new Types.ObjectId(acceptedBy),
          },
          $unset: {
            invitationToken: 1,
          },
        },
        { session }
      );
    } catch (error) {
      this.logger.error('Error accepting invitation:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Mark expired invitations as expired
   */
  async expireInvitations(): Promise<number> {
    try {
      const result = await this.updateMany(
        {
          status: { $in: ['pending', 'sent'] },
          expiresAt: { $lte: new Date() },
        },
        { $set: { status: 'expired' } }
      );

      this.logger.info(`Expired ${result.modifiedCount} invitations`);
      return result.modifiedCount || 0;
    } catch (error) {
      this.logger.error('Error expiring invitations:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get invitation statistics for a client
   */
  async getInvitationStats(clientId: string): Promise<IInvitationStats> {
    try {
      const pipeline = [
        {
          $match: { clientId },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pending: {
              $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] },
            },
            accepted: {
              $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] },
            },
            expired: {
              $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] },
            },
            revoked: {
              $sum: { $cond: [{ $eq: ['$status', 'revoked'] }, 1, 0] },
            },
            sent: {
              $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] },
            },
          },
        },
        {
          $lookup: {
            from: 'invitations',
            pipeline: [
              { $match: { clientId } },
              {
                $group: {
                  _id: '$role',
                  count: { $sum: 1 },
                },
              },
            ],
            as: 'roleStats',
          },
        },
      ];

      const result = (await this.aggregate(pipeline)) as unknown as IInvitationAggregationResult[];

      if (result.length === 0) {
        return {
          total: 0,
          pending: 0,
          accepted: 0,
          expired: 0,
          revoked: 0,
          sent: 0,
          byRole: {} as any,
        };
      }

      const stats = result[0];
      const byRole: any = {};

      if (stats.roleStats) {
        stats.roleStats.forEach((roleStat: any) => {
          byRole[roleStat._id] = roleStat.count;
        });
      }

      return {
        total: stats.total || 0,
        pending: stats.pending || 0,
        accepted: stats.accepted || 0,
        expired: stats.expired || 0,
        revoked: stats.revoked || 0,
        sent: stats.sent || 0,
        byRole,
      };
    } catch (error) {
      this.logger.error('Error getting invitation stats:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update reminder count for an invitation
   */
  async incrementReminderCount(
    invitationId: string,
    clientId: string,
    session?: ClientSession
  ): Promise<IInvitationDocument | null> {
    try {
      return await this.update(
        { id: invitationId, clientId },
        {
          $inc: { 'metadata.remindersSent': 1 },
          $set: { 'metadata.lastReminderSent': new Date() },
        },
        { session }
      );
    } catch (error) {
      this.logger.error('Error incrementing reminder count:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get invitations that need reminders
   */
  async getInvitationsNeedingReminders(
    daysSinceCreated: number,
    maxReminders: number
  ): Promise<IInvitationDocument[]> {
    try {
      const cutoffDate = new Date(Date.now() - daysSinceCreated * 24 * 60 * 60 * 1000);

      const filter = {
        status: { $in: ['pending', 'sent'] },
        expiresAt: { $gt: new Date() },
        createdAt: { $lte: cutoffDate },
        'metadata.remindersSent': { $lt: maxReminders },
      };

      const result = await this.list(filter, {
        populate: [{ path: 'invitedBy', select: 'email fullname' }],
      });

      return result.items;
    } catch (error) {
      this.logger.error('Error getting invitations needing reminders:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get invitations by invitee email across all clients
   */
  async getInvitationsByEmail(clientId: string, email: string): Promise<IInvitationDocument[]> {
    try {
      const result = await this.list(
        { inviteeEmail: email.toLowerCase(), clientId },
        {
          sort: { createdAt: -1 },
          populate: [
            { path: 'invitedBy', select: 'email fullname' },
            { path: 'acceptedBy', select: 'email fullname' },
            { path: 'revokedBy', select: 'email fullname' },
          ],
        }
      );

      return result.items;
    } catch (error) {
      this.logger.error('Error getting invitations by email:', error);
      throw this.throwErrorHandler(error);
    }
  }
}
