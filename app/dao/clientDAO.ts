import Logger from 'bunyan';
import { IUserDocument } from '@interfaces/user.interface';
import { ListResultWithPagination } from '@interfaces/index';
import { IUserRole } from '@shared/constants/roles.constants';
import { PipelineStage, FilterQuery, Types, Model } from 'mongoose';
import { generateShortUID, createLogger, escapeRegExp } from '@utils/index';
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

  private buildNestedUpdate(prefix: string, data: Record<string, any>): Record<string, any> {
    const updateObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      updateObj[`${prefix}.${key}`] = value;
    }
    return updateObj;
  }

  async getClientByCuid(cuid: string, opts?: IFindOptions): Promise<IClientDocument | null> {
    try {
      const query = { cuid };
      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  async updateAccountType(
    clientId: string,
    data: IClientDocument['accountType']
  ): Promise<IClientDocument | null> {
    try {
      return await this.updateById(clientId, { $set: this.buildNestedUpdate('accountType', data) });
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

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

  async updateCompanyInfo(
    clientId: string,
    companyInfo: Partial<ICompanyProfile>
  ): Promise<IClientDocument | null> {
    try {
      return await this.updateById(clientId, {
        $set: this.buildNestedUpdate('companyProfile', companyInfo),
      });
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  async updateClientSettings(
    clientId: string,
    settings: Partial<IClientSettings>
  ): Promise<IClientDocument | null> {
    try {
      return await this.updateById(clientId, {
        $set: this.buildNestedUpdate('settings', settings),
      });
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  async updateDataProcessingConsent(
    clientId: string,
    consent: boolean
  ): Promise<IClientDocument | null> {
    try {
      return await this.updateById(clientId, {
        $set: { dataProcessingConsent: consent },
      });
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

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

  async doesClientExist(cuid: string): Promise<boolean> {
    try {
      const count = await this.countDocuments({ cuid });
      return count > 0;
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  async searchClients(
    searchTerm: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IClientDocument[]> {
    try {
      const filter = {
        $or: [
          { cuid: { $regex: escapeRegExp(searchTerm), $options: 'i' } },
          { 'companyInfo.legalEntityName': { $regex: escapeRegExp(searchTerm), $options: 'i' } },
          { 'companyInfo.tradingName': { $regex: escapeRegExp(searchTerm), $options: 'i' } },
          { 'companyInfo.contactInfo.email': { $regex: escapeRegExp(searchTerm), $options: 'i' } },
          {
            'companyInfo.contactInfo.contactPerson': {
              $regex: escapeRegExp(searchTerm),
              $options: 'i',
            },
          },
        ],
      };

      return await this.list(filter, opts);
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Get user statistics for employee roles (staff/admin/manager)
   * @param cuid - Client ID
   * @param filterOptions - Filter options
   * @returns Statistics about employees for the client
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
      const { status, department, role } = filterOptions;
      const employeeRoles: string[] = [IUserRole.STAFF, IUserRole.ADMIN, IUserRole.MANAGER];

      let rolesToQuery: string[];
      if (role) {
        const rolesArray = Array.isArray(role) ? role : [role];
        rolesToQuery = rolesArray.filter((r) => employeeRoles.includes(r));
        if (rolesToQuery.length === 0) {
          return {
            totalFilteredUsers: 0,
            roleDistribution: [],
            departmentDistribution: [],
          };
        }
      } else {
        rolesToQuery = employeeRoles;
      }

      const baseQuery: FilterQuery<IUserDocument> = {
        'cuids.cuid': cuid,
        'cuids.isConnected': true,
        deletedAt: null,
        'cuids.roles': { $in: rolesToQuery },
        ...(status && { isActive: status === 'active' }),
      };

      const statsQuery = [
        { $match: baseQuery },
        {
          $facet: {
            total: [{ $count: 'count' }],
            roleStats: [
              { $unwind: '$cuids' },
              {
                $match: {
                  'cuids.cuid': cuid,
                  'cuids.roles': { $in: rolesToQuery },
                },
              },
              { $unwind: '$cuids.roles' },
              {
                $match: {
                  'cuids.roles': { $in: rolesToQuery },
                },
              },
              {
                $group: {
                  _id: '$cuids.roles',
                  count: { $sum: 1 },
                },
              },
            ],
          },
        },
      ];

      const [statsResult] = await this.userModel.aggregate(statsQuery).exec();
      const totalEmployees = statsResult.total[0]?.count || 0;

      const roleCountMap: Record<string, number> = {};
      statsResult.roleStats.forEach((stat: any) => {
        roleCountMap[stat._id] = stat.count;
      });

      const departmentPipeline: PipelineStage[] = [
        { $match: baseQuery },
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

      if (department) {
        departmentPipeline.push({
          $match: { 'profile.employeeInfo.department': department },
        });
      }

      departmentPipeline.push({
        $group: {
          _id: { $ifNull: ['$profile.employeeInfo.department', 'unassigned'] },
          count: { $sum: 1 },
        },
      });

      const departmentStats = await this.userModel.aggregate(departmentPipeline).exec();
      const roleDistribution = rolesToQuery
        .map((roleName) => ({
          name: roleName.charAt(0).toUpperCase() + roleName.slice(1),
          value: roleCountMap[roleName] || 0,
          percentage:
            totalEmployees > 0 ? Math.round((roleCountMap[roleName] / totalEmployees) * 100) : 0,
        }))
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value);

      const departmentDistribution = departmentStats
        .map((dept: any) => ({
          name: dept._id.charAt(0).toUpperCase() + dept._id.slice(1),
          value: dept.count,
          percentage: totalEmployees > 0 ? Math.round((dept.count / totalEmployees) * 100) : 0,
        }))
        .sort((a, b) => b.value - a.value);

      return {
        totalFilteredUsers: totalEmployees,
        roleDistribution,
        departmentDistribution,
      };
    } catch (error) {
      this.logger.error(`Error getting employee stats for client ${cuid}:`, error);
      throw this.throwErrorHandler(error);
    }
  }
}
