import { ListResultWithPagination } from '@interfaces/utils.interface';
import { ICompanyProfile, IClientSettings, IClientDocument } from '@interfaces/client.interface';

import { IBaseDAO } from './baseDAO.interface';
import { IFindOptions } from './baseDAO.interface';
import { IUserFilterOptions } from './userDAO.interface';

export interface IClientDAO extends IBaseDAO<IClientDocument> {
  getClientUsersStats(
    cuid: string,
    filterOptions: IUserFilterOptions
  ): Promise<{
    departmentDistribution: any[];
    roleDistribution: any[];
    totalFilteredUsers: number;
  }>;

  updateClientSettings(
    clientId: string,
    settings: Partial<IClientSettings>
  ): Promise<IClientDocument | null>;

  updateCompanyInfo(
    clientId: string,
    companyInfo: Partial<ICompanyProfile>
  ): Promise<IClientDocument | null>;

  getClientsByAccountAdmin(
    adminId: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IClientDocument[]>;

  updateAccountType(
    clientId: string,
    data: IClientDocument['accountType']
  ): Promise<IClientDocument | null>;

  updateSubscription(
    clientId: string,
    subscriptionId: string | null
  ): Promise<IClientDocument | null>;

  searchClients(
    searchTerm: string,
    opts?: IFindOptions
  ): ListResultWithPagination<IClientDocument[]>;

  updateDataProcessingConsent(clientId: string, consent: boolean): Promise<IClientDocument | null>;

  getClientByCuid(cuid: string, opts?: IFindOptions): Promise<IClientDocument | null>;

  createClient(clientData: Partial<IClientDocument>): Promise<IClientDocument>;

  doesClientExist(cuid: string): Promise<boolean>;
}
