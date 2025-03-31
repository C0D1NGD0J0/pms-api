// clientDAO.ts
import Logger from 'bunyan';
import { Types, Model } from 'mongoose';
import { generateShortUID, createLogger } from '@utils/index';
import { IdentificationType } from '@interfaces/user.interface';
import { ICompanyProfile, IClientSettings, IClientDocument } from '@interfaces/client.interface';

import { BaseDAO } from './baseDAO';
import { dynamic } from './interfaces/baseDAO.interface';
import { IClientDAO } from './interfaces/clientDAO.interface';

export class ClientDAO extends BaseDAO<IClientDocument> implements IClientDAO {
  protected logger: Logger;

  constructor({ clientModel }: { clientModel: Model<IClientDocument> }) {
    super(clientModel);
    this.logger = createLogger('ClientDAO');
  }

  /**
   * @inheritdoc
   */
  async getClientByCid(cid: string, opts?: dynamic): Promise<IClientDocument | null> {
    try {
      const query = { cid };
      return await this.findFirst(query, opts);
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Updates a client's account type settings.
   *
   * @param clientId - The MongoDB ObjectId of the client to update
   * @param data - Account type information including plan details and enterprise status
   * @returns A promise that resolves to the updated client document or null if not found
   * @throws Error if an error occurs during the update
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
   * Creates a new client in the database.
   * Generates a unique client ID (cid) if one is not provided.
   *
   * @param clientData - The data for the new client
   * @returns A promise that resolves to the created client document
   * @throws Error if an error occurs during client creation
   */
  async createClient(clientData: Partial<IClientDocument>): Promise<IClientDocument> {
    try {
      if (!clientData.cid) {
        clientData.cid = generateShortUID();
      }

      return await this.insert(clientData);
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Retrieves all clients associated with a specific account admin.
   *
   * @param adminId - The MongoDB ObjectId of the admin user
   * @param opts - Optional parameters for the query (projection, population, etc.)
   * @returns A promise that resolves to an array of client documents
   * @throws Error if an error occurs during the query
   */
  async getClientsByAccountAdmin(adminId: string, opts?: dynamic): Promise<IClientDocument[]> {
    try {
      const query = { accountAdmin: new Types.ObjectId(adminId) };
      return await this.list(query, opts);
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Updates a client's company information.
   * Only updates the fields that are provided in the companyInfo parameter.
   *
   * @param clientId - The MongoDB ObjectId of the client to update
   * @param companyInfo - The company information fields to update
   * @returns A promise that resolves to the updated client document or null if not found
   * @throws Error if an error occurs during the update
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
   * Updates a client's settings.
   * Only updates the fields that are provided in the settings parameter.
   *
   * @param clientId - The MongoDB ObjectId of the client to update
   * @param settings - The settings fields to update
   * @returns A promise that resolves to the updated client document or null if not found
   * @throws Error if an error occurs during the update
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
   * Updates a client's identification information.
   *
   * @param clientId - The MongoDB ObjectId of the client to update
   * @param identification - The identification information
   * @returns A promise that resolves to the updated client document or null if not found
   * @throws Error if an error occurs during the update
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
   * Updates a client's subscription.
   * Can set a new subscription or remove an existing one.
   *
   * @param clientId - The MongoDB ObjectId of the client to update
   * @param subscriptionId - The MongoDB ObjectId of the subscription or null to remove
   * @returns A promise that resolves to the updated client document or null if not found
   * @throws Error if an error occurs during the update
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
   * Checks if a client with the specified client ID exists.
   *
   * @param cid - The unique client identifier to check
   * @returns A promise that resolves to true if the client exists, false otherwise
   * @throws Error if an error occurs during the check
   */
  async doesClientExist(cid: string): Promise<boolean> {
    try {
      const count = await this.countDocuments({ cid });
      return count > 0;
    } catch (error) {
      this.logger.error(error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Searches for clients matching a search term across various fields.
   * Performs a case-insensitive search on cid, company names, and contact information.
   *
   * @param searchTerm - The term to search for
   * @param opts - Optional parameters for the query (pagination, sorting, etc.)
   * @returns A promise that resolves to an array of matching client documents
   * @throws Error if an error occurs during the search
   */
  async searchClients(searchTerm: string, opts?: dynamic): Promise<IClientDocument[]> {
    try {
      // Create a search filter that looks for the term in various fields
      const filter = {
        $or: [
          { cid: { $regex: searchTerm, $options: 'i' } },
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
