import { Invitation } from '@models/index';
import { hashGenerator } from '@utils/index';
import { ClientSession, FilterQuery, Types } from 'mongoose';
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
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const invitation = await this.insert(
        {
          invitedBy: new Types.ObjectId(invitedBy),
          inviteeEmail: invitationData.inviteeEmail.toLowerCase(),
          clientId,
          role: invitationData.role,
          invitationToken,
          expiresAt,
          personalInfo: invitationData.personalInfo,
          metadata: {
            ...invitationData.metadata,
            remindersSent: 0,
          },
        },
        session
      );

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
            { path: 'invitedBy', select: 'email' },
            { path: 'acceptedBy', select: 'email' },
            { path: 'revokedBy', select: 'email' },
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
  async findByInvitationId(invitationId: string): Promise<IInvitationDocument | null> {
    try {
      return await this.findFirst(
        { invitationId },
        {
          populate: [
            { path: 'invitedBy', select: 'email' },
            { path: 'acceptedBy', select: 'email' },
            { path: 'revokedBy', select: 'email' },
          ],
        }
      );
    } catch (error) {
      this.logger.error('Error finding invitation by ID:', error);
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
        status: 'pending',
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
  async getInvitationsByClient(query: IInvitationListQuery): Promise<{
    items: IInvitationDocument[];
    pagination?: {
      total: number;
      page: number;
      pages: number;
      limit: number;
    };
  }> {
    try {
      const filter: FilterQuery<IInvitationDocument> = {
        clientId: query.clientId,
      };

      // Add status filter if provided
      if (query.status) {
        filter.status = query.status;
      }

      // Add role filter if provided
      if (query.role) {
        filter.role = query.role;
      }

      const page = query.page || 1;
      const limit = query.limit || 20;
      const skip = (page - 1) * limit;

      // Build sort object
      const sortBy = query.sortBy || 'createdAt';
      const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
      const sort = { [sortBy]: sortOrder } as Record<string, 1 | -1>;

      const options = {
        skip,
        limit,
        sort,
        populate: [
          { path: 'invitedBy', select: 'email' },
          { path: 'acceptedBy', select: 'email' },
          { path: 'revokedBy', select: 'email' },
        ],
      };

      const result = await this.list(filter, options);

      // Transform the result to match interface expectations
      return {
        items: result.items,
        pagination: result.pagination
          ? {
              total: result.pagination.total,
              page: page,
              pages: Math.ceil(result.pagination.total / limit),
              limit: limit,
            }
          : undefined,
      };
    } catch (error) {
      this.logger.error('Error getting invitations by client:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update invitation status
   */
  async updateInvitationStatus(
    invitationId: string,
    status: 'pending' | 'accepted' | 'expired' | 'revoked',
    session?: ClientSession
  ): Promise<IInvitationDocument | null> {
    try {
      return await this.update({ invitationId }, { $set: { status } }, { session });
    } catch (error) {
      this.logger.error('Error updating invitation status:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Revoke an invitation
   */
  async revokeInvitation(
    invitationId: string,
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

      return await this.update({ invitationId }, updateData, { session });
    } catch (error) {
      this.logger.error('Error revoking invitation:', error);
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
          status: 'pending',
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
    session?: ClientSession
  ): Promise<IInvitationDocument | null> {
    try {
      return await this.update(
        { invitationId },
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
        status: 'pending',
        expiresAt: { $gt: new Date() },
        createdAt: { $lte: cutoffDate },
        'metadata.remindersSent': { $lt: maxReminders },
      };

      const result = await this.list(filter, {
        populate: [{ path: 'invitedBy', select: 'email' }],
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
  async getInvitationsByEmail(email: string): Promise<IInvitationDocument[]> {
    try {
      const result = await this.list(
        { inviteeEmail: email.toLowerCase() },
        {
          sort: { createdAt: -1 },
          populate: [
            { path: 'invitedBy', select: 'email' },
            { path: 'acceptedBy', select: 'email' },
            { path: 'revokedBy', select: 'email' },
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
