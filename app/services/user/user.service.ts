import Logger from 'bunyan';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { ClientDAO, UserDAO } from '@dao/index';
import { IFindOptions } from '@dao/interfaces/baseDAO.interface';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors/index';
import { ISuccessReturnData, IRequestContext, PaginateResult } from '@interfaces/utils.interface';
import { IUserRoleType, ICurrentUser, FilteredUser, IUserRole } from '@interfaces/user.interface';

interface IConstructor {
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class UserService {
  private readonly log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;

  constructor({ clientDAO, userDAO }: IConstructor) {
    this.log = createLogger('UserService');
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
  }

  async getClientUsers(cxt: IRequestContext): Promise<ISuccessReturnData<{ users: any[] }>> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    const usersResult = await this.userDAO.getUsersByClientId(
      clientId,
      {},
      {
        limit: 100,
        skip: 0,
        populate: 'profile',
      }
    );

    const users = usersResult.items.map((user) => {
      const clientConnection = user.cuids.find((c) => c.cuid === clientId);
      return {
        id: user._id.toString(),
        email: user.email,
        displayName: clientConnection?.displayName || '',
        roles: clientConnection?.roles || [],
        isConnected: clientConnection?.isConnected || false,
        profile: user.profile,
      };
    });

    return {
      success: true,
      data: { users },
      message: t('client.success.usersRetrieved'),
    };
  }

  async getUsersByRole(
    cxt: IRequestContext,
    role: IUserRoleType
  ): Promise<ISuccessReturnData<{ users: any[] }>> {
    const currentuser = cxt.currentuser!;
    const clientId = cxt.request.params.cuid || currentuser.client.cuid;

    if (!Object.values(IUserRole).includes(role as IUserRole)) {
      throw new BadRequestError({ message: t('client.errors.invalidRole') });
    }

    // Use the getFilteredUsers method with role filter
    const result = await this.getFilteredUsers(
      clientId,
      currentuser,
      { role },
      {
        limit: 100,
        skip: 0,
        populate: [{ path: 'profile', select: 'personalInfo vendorInfo clientRoleInfo' }],
      }
    );

    return {
      success: true,
      data: { users: result.data.items },
      message: t('client.success.usersByRoleRetrieved', { role }),
    };
  }

  /**
   * Get users filtered by type (employee, tenant, vendor) and other criteria
   * This method powers the unified API endpoint that supports querying users by different types
   *
   * @param cuid - Client ID to fetch users for
   * @param currentUser - Current authenticated user
   * @param filterOptions - Options to filter users by (type, role, department, status, search)
   * @param paginationOpts - Pagination options
   * @returns A promise that resolves to filtered users with pagination info
   */
  async getFilteredUsers(
    cuid: string,
    currentUser: ICurrentUser,
    filterOptions: IUserFilterOptions,
    paginationOpts: IFindOptions
  ): Promise<ISuccessReturnData<{ items: FilteredUser[]; pagination: PaginateResult }>> {
    try {
      if (!cuid) {
        throw new BadRequestError({ message: t('client.errors.clientIdRequired') });
      }

      // Validate client exists
      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      // Format role parameter
      if (filterOptions.role && typeof filterOptions.role === 'string') {
        filterOptions.role = [filterOptions.role as IUserRoleType];
      }

      const result = await this.userDAO.getUsersByFilteredType(cuid, filterOptions, paginationOpts);

      // Prepare user data for response
      const users = result.items.map((user: any) => {
        console.dir(user, { depth: null });
        const clientConnection = user.cuids?.find((c: any) => c.cuid === cuid);

        // Basic user info
        const userData: any = {
          uid: user.uid,
          email: user.email,
          displayName: clientConnection?.displayName || '',
          roles: clientConnection?.roles || [],
          isConnected: clientConnection?.isConnected || false,
          createdAt: user.createdAt,
          isActive: user.isActive,
        };

        // Include profile info if available
        if (user.profile) {
          userData.firstName = user.profile.personalInfo?.firstName || '';
          userData.lastName = user.profile.personalInfo?.lastName || '';
          userData.fullName = `${userData.firstName} ${userData.lastName}`.trim();
          userData.avatar = user.profile.personalInfo?.avatar || '';
          userData.phoneNumber = user.profile.personalInfo?.phoneNumber || '';

          // Determine user type based on roles
          const roles = clientConnection?.roles || [];

          if (roles.some((r: string) => ['manager', 'admin', 'staff'].includes(r))) {
            userData.employeeInfo = user.profile.employeeInfo || {};
            userData.userType = 'employee';
            delete userData.vendorInfo;
          } else if (roles.includes('vendor')) {
            userData.vendorInfo = user.profile.vendorInfo || {};
            userData.userType = 'vendor';

            // Add linkedVendorId info for vendors
            if (clientConnection?.linkedVendorId) {
              userData.vendorInfo = {
                ...userData.vendorInfo,
                isLinkedAccount: true,
                linkedVendorId: clientConnection.linkedVendorId,
              };
            } else {
              userData.vendorInfo = {
                ...userData.vendorInfo,
                isPrimaryVendor: true,
              };
            }

            delete userData.employeeInfo;
          } else if (roles.includes('tenant')) {
            userData.tenantInfo = user.profile.tenantInfo || {};
            userData.userType = 'tenant';
            delete userData.vendorInfo;
            delete userData.employeeInfo;
          }
        }

        return userData;
      });

      return {
        success: true,
        data: {
          items: users,
          pagination: result.pagination!,
        },
        message: t('client.success.filteredUsersRetrieved'),
      };
    } catch (error) {
      this.log.error('Error getting filtered users:', {
        cuid,
        filterOptions,
        error: error.message || error,
      });
      throw error;
    }
  }
}
