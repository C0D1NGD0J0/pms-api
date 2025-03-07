import { IdentificationType } from '@interfaces/user.interface';
import { ICompanyInfo, IClientSettings, IClientDocument } from '@interfaces/client.interface';

import { dynamic } from './baseDAO.interface';
import { IBaseDAO } from './baseDAO.interface';

/**
 * Data Access Object interface for Client operations.
 */
export interface IClientDAO extends IBaseDAO<IClientDocument> {
  /**
   * Updates a client's identification information.
   *
   * @param clientId - The MongoDB ObjectId of the client to update
   * @param identification - The identification information
   * @returns A promise that resolves to the updated client document or null if not found
   */
  updateIdentification(
    clientId: string,
    identification: IdentificationType
  ): Promise<IClientDocument | null>;

  /**
   * Updates a client's settings.
   *
   * @param clientId - The MongoDB ObjectId of the client to update
   * @param settings - The settings fields to update
   * @returns A promise that resolves to the updated client document or null if not found
   */
  updateClientSettings(
    clientId: string,
    settings: Partial<IClientSettings>
  ): Promise<IClientDocument | null>;

  /**
   * Updates a client's account type (individual / enterprise status).
   *
   * @param clientId - The MongoDB ObjectId of the client to update
   * @param data - {planName: string, planId: string, isEnterprise: boolean} - The account type fields to update
   * @returns A promise that resolves to the updated client document or null if not found
   */
  updateAccountType(
    clientId: string,
    data: IClientDocument['accountType']
  ): Promise<IClientDocument | null>;

  /**
   * Updates a client's company information.
   *
   * @param clientId - The MongoDB ObjectId of the client to update
   * @param companyInfo - The company information fields to update
   * @returns A promise that resolves to the updated client document or null if not found
   */
  updateCompanyInfo(
    clientId: string,
    companyInfo: Partial<ICompanyInfo>
  ): Promise<IClientDocument | null>;

  /**
   * Updates a client's subscription.
   *
   * @param clientId - The MongoDB ObjectId of the client to update
   * @param subscriptionId - The MongoDB ObjectId of the subscription or null to remove
   * @returns A promise that resolves to the updated client document or null if not found
   */
  updateSubscription(
    clientId: string,
    subscriptionId: string | null
  ): Promise<IClientDocument | null>;

  /**
   * Retrieves all clients associated with a specific account admin.
   *
   * @param adminId - The MongoDB ObjectId of the admin user
   * @param opts - Optional parameters for the query (projection, population, etc.)
   * @returns A promise that resolves to an array of client documents
   */
  getClientsByAccountAdmin(adminId: string, opts?: dynamic): Promise<IClientDocument[]>;

  /**
   * Searches for clients matching a search term across various fields.
   *
   * @param searchTerm - The term to search for
   * @param opts - Optional parameters for the query (pagination, sorting, etc.)
   * @returns A promise that resolves to an array of matching client documents
   */
  searchClients(searchTerm: string, opts?: dynamic): Promise<IClientDocument[]>;

  /**
   * Retrieves a client by its unique client ID (cid).
   *
   * @param cid - The unique client identifier
   * @param opts - Optional parameters for the query (projection, population, etc.)
   * @returns A promise that resolves to the client document or null if not found
   */
  getClientByCid(cid: string, opts?: dynamic): Promise<IClientDocument | null>;

  /**
   * Creates a new client in the database.
   *
   * @param clientData - The data for the new client
   * @returns A promise that resolves to the created client document
   */
  createClient(clientData: Partial<IClientDocument>): Promise<IClientDocument>;

  /**
   * Checks if a client with the specified client ID exists.
   *
   * @param cid - The unique client identifier to check
   * @returns A promise that resolves to true if the client exists, false otherwise
   */
  doesClientExist(cid: string): Promise<boolean>;
}
