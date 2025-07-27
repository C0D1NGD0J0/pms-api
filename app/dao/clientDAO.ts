import Logger from 'bunyan';
import { Types, Model } from 'mongoose';
import { ListResultWithPagination } from '@interfaces/index';
import { generateShortUID, createLogger } from '@utils/index';
import { IdentificationType } from '@interfaces/user.interface';
import { ICompanyProfile, IClientSettings, IClientDocument } from '@interfaces/client.interface';

import { BaseDAO } from './baseDAO';
import { IClientDAO } from './interfaces/clientDAO.interface';
import { IFindOptions } from './interfaces/baseDAO.interface';

export class ClientDAO extends BaseDAO<IClientDocument> implements IClientDAO {
  protected logger: Logger;

  constructor({ clientModel }: { clientModel: Model<IClientDocument> }) {
    super(clientModel);
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
}
