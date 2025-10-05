import { FilterQuery } from 'mongoose';
import { IUserRoleType } from '@shared/constants/roles.constants';
import { ListResultWithPagination } from '@interfaces/utils.interface';
import { IInvitationDocument } from '@interfaces/invitation.interface';
import {
  ITenantFilterOptions,
  IPaginatedResult,
  IUserDocument,
  ITenantStats,
} from '@interfaces/user.interface';

import { IFindOptions, dynamic } from './baseDAO.interface';

export interface IUserDAO {
  createBulkUserWithDefaults(
    client: { cuid: string; displayName?: string; id: string },
    userData: {
      email: string;
      firstName: string;
      lastName: string;
      phoneNumber?: string;
      role: IUserRoleType;
      defaultPassword: string;
    },
    linkedVendorUid?: string,
    session?: any
  ): Promise<IUserDocument>;
  createUserFromInvitation(
    client: { cuid: string; displayName?: string },
    invitationData: IInvitationDocument,
    userData: any,
    linkedVendorUid?: string,
    session?: any
  ): Promise<IUserDocument>;
  addUserToClient(
    userId: string,
    role: IUserRoleType,
    client: { cuid: string; displayName?: string; id: string },
    linkedVendorUid?: string,
    session?: any
  ): Promise<IUserDocument | null>;
  getUsersByFilteredType(
    cuid: string,
    filterOptions: IUserFilterOptions,
    paginationOpts?: IFindOptions
  ): Promise<ListResultWithPagination<IUserDocument[]>>;
  getUsersByClientId(
    clientId: string,
    filter?: FilterQuery<IUserDocument>,
    opts?: IFindOptions
  ): ListResultWithPagination<IUserDocument[]>;
  getTenantsByClient(
    cuid: string,
    filters?: ITenantFilterOptions,
    pagination?: IFindOptions
  ): Promise<IPaginatedResult<IUserDocument[]>>;
  getLinkedVendorUsers(
    primaryVendorId: string,
    cuid: string,
    opts?: IFindOptions
  ): Promise<ListResultWithPagination<IUserDocument[]>>;
  getClientTenantDetails(
    cuid: string,
    tenantUid: string
  ): Promise<import('@interfaces/user.interface').IClientTenantDetails | null>;
  getUsersByClientIdAndRole(
    cuid: string,
    role: IUserRoleType,
    opts?: IFindOptions
  ): ListResultWithPagination<IUserDocument[]>;
  listUsers(
    query: Record<string, any>,
    opts?: IFindOptions
  ): ListResultWithPagination<IUserDocument[]>;
  associateUserWithClient(userId: string, clientId: string, role: IUserRoleType): Promise<boolean>;
  createActivationToken(userId?: string, email?: string): Promise<IUserDocument | null>;
  getUserWithClientAccess(email: string, cuid: string): Promise<IUserDocument | null>;
  getTenantStats(cuid: string, filters?: ITenantFilterOptions): Promise<ITenantStats>;
  getActiveUserByEmail(email: string, opts?: dynamic): Promise<IUserDocument | null>;
  verifyCredentials(email: string, password: string): Promise<IUserDocument | null>;
  resetPassword(token: string, newPassword: string): Promise<IUserDocument | null>;
  getUserById(id: string, opts?: IFindOptions): Promise<IUserDocument | null>;
  removeClientAssociation(userId: string, clientId: string): Promise<boolean>;
  getUserWithProfileByEmailOrId(email: string): Promise<IUserDocument | null>;
  getUserByUId(uid: string, opts?: dynamic): Promise<IUserDocument | null>;
  searchUsers(query: string, clientId: string): Promise<IUserDocument[]>;
  createPasswordResetToken(email: string): Promise<IUserDocument | null>;
  getUserClientAssociations(userId: string): Promise<any[]>;
  activateAccount(token: string): Promise<boolean>;
  isEmailUnique(email: string): Promise<boolean>;
}

export interface IUserFilterOptions {
  role?: IUserRoleType | IUserRoleType[];
  status?: 'active' | 'inactive';
  department?: string;
  search?: string;
}
