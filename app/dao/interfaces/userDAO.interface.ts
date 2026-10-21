import type { QueryFilter, Types } from 'mongoose';
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
  getLinkedVendorUsers(
    vuid: string,
    cuid: string,
    opts?: IFindOptions,
    primaryAccountHolderUserId?: string | Types.ObjectId
  ): Promise<ListResultWithPagination<IUserDocument[]>>;
  setPendingEmail(
    userId: string,
    pendingChange: { pendingEmail: string; tokenHash: string; expiresAt: Date; requestedBy: string }
  ): Promise<IUserDocument | null>;
  getUsersByFilteredType(
    cuid: string,
    filterOptions: IUserFilterOptions,
    paginationOpts?: IFindOptions
  ): Promise<ListResultWithPagination<IUserDocument[]>>;
  getUsersByClientId(
    clientId: string,
    filter?: QueryFilter<IUserDocument>,
    opts?: IFindOptions
  ): ListResultWithPagination<IUserDocument[]>;
  getTenantsByClient(
    cuid: string,
    filters?: ITenantFilterOptions,
    pagination?: IFindOptions
  ): Promise<IPaginatedResult<IUserDocument[]>>;
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
  activateAccount(token: string, consentData: { acceptedBy: string }): Promise<string | null>;
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
  isEmailTaken(email: string, excludeUserId?: string): Promise<boolean>;
  confirmPendingEmail(tokenHash: string): Promise<IUserDocument | null>;
  clearOnboardingFlag(userId: string, cuid: string): Promise<void>;
  clearPendingEmail(userId: string): Promise<IUserDocument | null>;
  getUserClientAssociations(userId: string): Promise<any[]>;
}

export interface IUserFilterOptions {
  role?: IUserRoleType | IUserRoleType[];
  status?: 'active' | 'inactive';
  department?: string;
  search?: string;
}
