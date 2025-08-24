import Logger from 'bunyan';
import { ListResultWithPagination } from '@interfaces/index';
import { generateShortUID, createLogger } from '@utils/index';
import { PipelineStage, FilterQuery, Types, Model } from 'mongoose';
import { IdentificationType, IUserDocument } from '@interfaces/user.interface';
import { ICompanyProfile, IClientSettings, IClientDocument } from '@interfaces/client.interface';

import { BaseDAO } from './baseDAO';
import { IClientDAO } from './interfaces/clientDAO.interface';
import { IFindOptions } from './interfaces/baseDAO.interface';
import { IUserFilterOptions } from './interfaces/userDAO.interface';

export class ClientDAO extends BaseDAO<IClientDocument> implements IClientDAO {
  protected logger: Logger;
  private userModel: Model<IUserDocument>;

  constructor({
    clientModel,
    userModel,
  }: {
    clientModel: Model<IClientDocument>;
    userModel: Model<IUserDocument>;
  }) {
    super(clientModel);
    this.userModel = userModel;
    this.logger = createLogger('ClientDAO');
  }

  /**
   * @inheritdoc
   */
  async getClientByCuid(cuid: string, opts?: IFindOptions): Promise<IClientDocument | null> {
    try {
      const query = { cuid };
      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateAccountType(
    clientId: string,
    data: IClientDocument['accountType']
  ): Promise<IClientDocument | null> {
    try {
      const updateObj: Record<string, any> = {};

      for (const [key, value] of Object.entries(data)) {
        updateObj[`accountType.${key}`] = value;
      }

      return await this.updateById(clientId, { $set: updateObj });
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async createClient(clientData: Partial<IClientDocument>): Promise<IClientDocument> {
    try {
      if (!clientData.cuid) {
        clientData.cuid = generateShortUID();
      }

      return await this.insert(clientData);
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async getClientsByAccountAdmin(
    adminId: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IClientDocument[]> {
    try {
      const query = { accountAdmin: new Types.ObjectId(adminId) };
      return await this.list(query, opts);
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateCompanyInfo(
    clientId: string,
    companyInfo: Partial<ICompanyProfile>
  ): Promise<IClientDocument | null> {
    try {
      // Create an update object that only updates the specified fields
      const updateObj: Record<string, any> = {};

      for (const [key, value] of Object.entries(companyInfo)) {
        updateObj[`companyInfo.${key}`] = value;
      }

      return await this.updateById(clientId, { $set: updateObj });
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateClientSettings(
    clientId: string,
    settings: Partial<IClientSettings>
  ): Promise<IClientDocument | null> {
    try {
      // Create an update object with only the specified settings fields
      const updateObj: Record<string, any> = {};

      for (const [key, value] of Object.entries(settings)) {
        updateObj[`settings.${key}`] = value;
      }

      return await this.updateById(clientId, { $set: updateObj });
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateIdentification(
    clientId: string,
    identification: IdentificationType
  ): Promise<IClientDocument | null> {
    try {
      return await this.updateById(clientId, {
        $set: { identification: identification },
      });
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async updateSubscription(
    clientId: string,
    subscriptionId: string | null
  ): Promise<IClientDocument | null> {
    try {
      const update = subscriptionId
        ? { $set: { subscription: new Types.ObjectId(subscriptionId) } }
        : { $set: { subscription: null } };

      return await this.updateById(clientId, update);
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async doesClientExist(cuid: string): Promise<boolean> {
    try {
      const count = await this.countDocuments({ cuid });
      return count > 0;
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * @inheritdoc
   */
  async searchClients(
    searchTerm: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IClientDocument[]> {
    try {
      // Create a search filter that looks for the term in various fields
      const filter = {
        $or: [
          { cuid: { $regex: searchTerm, $options: 'i' } },
          { 'companyInfo.legalEntityName': { $regex: searchTerm, $options: 'i' } },
          { 'companyInfo.tradingName': { $regex: searchTerm, $options: 'i' } },
          { 'companyInfo.contactInfo.email': { $regex: searchTerm, $options: 'i' } },
          { 'companyInfo.contactInfo.contactPerson': { $regex: searchTerm, $options: 'i' } },
        ],
      };

      return await this.list(filter, opts);
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get user statistics for department and role distribution for a client
   * @param cuid - Client ID
   * @param filterOptions - Filter options (same as getUsersByFilteredType but ignoring pagination)
   * @returns Statistics about the filtered user set for the client
   */
  async getClientUsersStats(
    cuid: string,
    filterOptions: IUserFilterOptions
  ): Promise<{
    departmentDistribution: any[];
    roleDistribution: any[];
    totalFilteredUsers: number;
  }> {
    try {
      const { role, department, status } = filterOptions;

      const query: FilterQuery<IUserDocument> = {
        'cuids.cuid': cuid,
        'cuids.isConnected': true,
        deletedAt: null,
      };

      // Handle active/inactive status
      if (status) {
        query.isActive = status === 'active';
      }

      // Handle role filtering
      if (role) {
        if (Array.isArray(role)) {
          query['cuids.roles'] = { $in: role };
        } else {
          query['cuids.roles'] = role;
        }
      }

      // Base pipeline (same as getUsersByFilteredType)
      const pipeline: PipelineStage[] = [
        { $match: query },
        {
          $lookup: {
            from: 'profiles',
            localField: '_id',
            foreignField: 'user',
            as: 'profile',
          },
        },
        { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
      ];

      // Add department filter if specified
      if (department) {
        pipeline.push({
          $match: {
            'profile.employeeInfo.department': department,
          },
        });
      }

      // Determine if this is a vendor-specific query
      const isVendorQuery =
        role &&
        ((Array.isArray(role) && role.includes('vendor')) ||
          (typeof role === 'string' && role === 'vendor'));

      // Create aggregation pipelines for stats
      const departmentStatsQuery = [
        ...pipeline,
        {
          $group: {
            _id: isVendorQuery
              ? { $ifNull: ['$profile.vendorInfo.businessType', 'unassigned'] }
              : { $ifNull: ['$profile.employeeInfo.department', 'unassigned'] },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            name: { $toUpper: { $substr: ['$_id', 0, 1] } },
            category: { $substr: ['$_id', 1, { $strLenCP: '$_id' }] },
            value: '$count',
          },
        },
        {
          $project: {
            name: { $concat: ['$name', '$category'] },
            value: 1,
          },
        },
      ];

      const roleStatsQuery = [
        ...pipeline,
        {
          $unwind: '$cuids',
        },
        {
          $match: {
            'cuids.cuid': cuid,
          },
        },
        {
          $unwind: '$cuids.roles',
        },
        {
          $group: {
            _id: '$cuids.roles',
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            name: { $toUpper: { $substr: ['$_id', 0, 1] } },
            role: { $substr: ['$_id', 1, { $strLenCP: '$_id' }] },
            value: '$count',
          },
        },
        {
          $project: {
            name: { $concat: ['$name', '$role'] },
            value: 1,
          },
        },
      ];

      const totalCountQuery = [...pipeline, { $count: 'total' }];

      // Execute all queries in parallel using the user model
      const [departmentStats, roleStats, totalCountResult] = await Promise.all([
        this.userModel.aggregate(departmentStatsQuery).exec(),
        this.userModel.aggregate(roleStatsQuery).exec(),
        this.userModel.aggregate(totalCountQuery).exec(),
      ]);

      const totalFilteredUsers =
        totalCountResult.length > 0 ? (totalCountResult[0] as any).total : 0;

      // Calculate percentages for department/service type distribution
      // Note: When filtering by vendor role, this contains service type distribution
      const departmentDistribution = departmentStats
        .map((dept: any) => ({
          name: dept.name,
          value: dept.value,
          percentage:
            totalFilteredUsers > 0 ? Math.round((dept.value / totalFilteredUsers) * 100) : 0,
        }))
        .sort((a: any, b: any) => b.value - a.value);

      // Calculate percentages for role distribution
      const roleDistribution = roleStats
        .map((role: any) => ({
          name: role.name,
          value: role.value,
          percentage:
            totalFilteredUsers > 0 ? Math.round((role.value / totalFilteredUsers) * 100) : 0,
        }))
        .sort((a: any, b: any) => b.value - a.value);

      return {
        departmentDistribution,
        roleDistribution,
        totalFilteredUsers,
      };
    } catch (error) {
      this.logger.error(`Error getting user stats for client ${cuid}:`, error);
      throw this.throwErrorHandler(error);
    }
  }
}
