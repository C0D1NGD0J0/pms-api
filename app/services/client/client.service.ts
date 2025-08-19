import Logger from 'bunyan';
import { t } from '@shared/languages';
import { PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { getRequestDuration, createLogger } from '@utils/index';
import { IFindOptions } from '@dao/interfaces/baseDAO.interface';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors/index';
import { ISuccessReturnData, IRequestContext, PaginateResult } from '@interfaces/utils.interface';
import { IUserRoleType, ICurrentUser, FilteredUser, IUserRole } from '@interfaces/user.interface';
import { PopulatedAccountAdmin, IClientDocument, IClientStats } from '@interfaces/client.interface';

interface IConstructor {
  propertyDAO: PropertyDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class ClientService {
  private readonly log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly userDAO: UserDAO;

  constructor({ clientDAO, propertyDAO, userDAO }: IConstructor) {
    this.log = createLogger('ClientService');
    this.clientDAO = clientDAO;
    this.propertyDAO = propertyDAO;
    this.userDAO = userDAO;
  }

  async updateClientDetails(
    cxt: IRequestContext,
    updateData: Partial<IClientDocument>
  ): Promise<ISuccessReturnData<IClientDocument>> {
    const currentuser = cxt.currentuser!;
    const start = process.hrtime.bigint();
    const { cuid } = cxt.request.params;

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          data: JSON.stringify(updateData),
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.errors.notFound')
      );
      throw new NotFoundError({ message: t('client.errors.notFound') });
    }

    const validationErrors: string[] = [];
    let requiresReVerification = false;

    const isValidEmail = (email: string): boolean => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    };

    if (updateData.identification) {
      if (
        updateData.identification.idType &&
        client.identification?.idType &&
        updateData.identification.idType !== client.identification.idType
      ) {
        requiresReVerification = true;
        this.log.info(
          {
            cuid,
            oldIdType: client.identification.idType,
            newIdType: updateData.identification.idType,
            userId: currentuser.sub,
          },
          t('client.logging.idTypeChanged')
        );
      }

      if (updateData.identification.idType && !updateData.identification.idNumber) {
        validationErrors.push(t('client.validation.idNumberRequired'));
      }
      if (updateData.identification.idType && !updateData.identification.authority) {
        validationErrors.push(t('client.validation.authorityRequired'));
      }
      if (updateData.identification.idNumber && !updateData.identification.idType) {
        validationErrors.push(t('client.validation.idTypeRequired'));
      }
    }

    if (updateData.companyProfile) {
      if (
        updateData.companyProfile.companyEmail &&
        !isValidEmail(updateData.companyProfile.companyEmail)
      ) {
        validationErrors.push(t('client.validation.invalidEmailFormat'));
      }

      if (
        updateData.companyProfile.legalEntityName &&
        updateData.companyProfile.legalEntityName !== client.companyProfile?.legalEntityName
      ) {
        requiresReVerification = true;
      }
      if (
        updateData.companyProfile.registrationNumber &&
        updateData.companyProfile.registrationNumber !== client.companyProfile?.registrationNumber
      ) {
        requiresReVerification = true;
      }
    }

    if (updateData.displayName) {
      if (updateData.displayName.trim().length === 0) {
        validationErrors.push(t('client.validation.displayNameEmpty'));
      }
      if (updateData.displayName !== client.displayName) {
        requiresReVerification = true;
      }
    }

    if (requiresReVerification) {
      updateData.isVerified = false;
    }

    const changedFields = Object.keys(updateData);
    this.log.info(
      {
        cuid,
        userId: currentuser.sub,
        requestId: cxt.requestId,
        changedFields: JSON.stringify(changedFields),
        requiresReVerification,
      },
      t('client.logging.validationCompleted')
    );

    if (validationErrors.length > 0) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          validationErrors,
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.logging.validationFailed')
      );
      throw new BadRequestError({
        message: t('client.errors.validationFailed'),
        errorInfo: { validationErrors },
      });
    }

    const session = await this.clientDAO.startSession();
    const result = await this.clientDAO.withTransaction(session, async (session) => {
      delete updateData.accountAdmin;
      delete updateData.accountType;
      delete updateData.isVerified;
      delete updateData.cuid;

      const updatedClient = await this.clientDAO.updateById(
        client._id.toString(),
        {
          $set: {
            ...updateData,
            lastModifiedBy: currentuser.sub,
          },
        },
        undefined,
        session
      );
      if (!updatedClient) {
        this.log.error(
          {
            cuid,
            url: cxt.request.url,
            userId: currentuser?.sub,
            requestId: cxt.requestId,
            data: JSON.stringify(updateData),
            duration: getRequestDuration(start).durationInMs,
          },
          t('client.logging.updateFailed')
        );
        throw new BadRequestError({ message: t('client.errors.updateFailed') });
      }

      return { updatedClient };
    });

    return {
      success: true,
      data: result.updatedClient,
      message: t('client.success.updated'),
    };
  }

  async getClientDetails(
    cxt: IRequestContext
  ): Promise<ISuccessReturnData<{ clientStats: IClientStats } & IClientDocument>> {
    const currentuser = cxt.currentuser!;
    const start = process.hrtime.bigint();
    const { cuid } = cxt.request.params;
    if (!cuid) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.logging.missingParameters')
      );
      throw new BadRequestError({ message: t('client.errors.fetchFailed') });
    }

    const [client, usersResult, propertiesResult] = await Promise.all([
      this.clientDAO.getClientByCuid(cuid, {
        populate: {
          path: 'accountAdmin',
          select: 'email',
          populate: {
            path: 'profile',
            select:
              'personalInfo.firstName personalInfo.lastName personalInfo.phoneNumber personalInfo.avatar',
          },
        },
        limit: 1,
        skip: 0,
      }),
      this.userDAO.getUsersByClientId(cuid, {}, { limit: 1000, skip: 0 }),
      this.propertyDAO.countDocuments({ cuid, deletedAt: null }),
    ]);

    if (!client) {
      this.log.error(
        {
          cuid,
          url: cxt.request.url,
          userId: currentuser?.sub,
          requestId: cxt.requestId,
          duration: getRequestDuration(start).durationInMs,
        },
        t('client.logging.detailsNotFound')
      );
      throw new NotFoundError({ message: t('client.errors.detailsNotFound') });
    }

    const clientWithStats = client.toObject() as { clientStats: IClientStats } & IClientDocument;
    clientWithStats.clientStats = {
      totalProperties: propertiesResult,
      totalUsers: usersResult.pagination?.total || 0,
    };

    clientWithStats.accountAdmin = {
      email: (client.accountAdmin as any)?.email || '',
      id: (client.accountAdmin as any)?._id?.toString() || '',
      firstName: (client.accountAdmin as any)?.profile?.personalInfo?.firstName || '',
      lastName: (client.accountAdmin as any)?.profile?.personalInfo?.lastName || '',
      phoneNumber: (client.accountAdmin as any)?.profile?.personalInfo?.phoneNumber || '',
      avatar: (client.accountAdmin as any)?.profile?.personalInfo?.avatar || '',
    } as unknown as PopulatedAccountAdmin;

    return {
      data: clientWithStats,
      success: true,
      message: t('client.success.retrieved'),
    };
  }

  async assignUserRole(
    cxt: IRequestContext,
    targetUserId: string,
    role: IUserRoleType
  ): Promise<ISuccessReturnData> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    if (!Object.values(IUserRole).includes(role as IUserRole)) {
      throw new BadRequestError({ message: t('client.errors.invalidRole') });
    }

    const user = await this.userDAO.getUserById(targetUserId);
    if (!user) {
      throw new NotFoundError({ message: t('client.errors.userNotFound') });
    }

    const clientConnection = user.cuids.find((c) => c.cuid === clientId);
    if (!clientConnection) {
      throw new NotFoundError({ message: t('client.errors.userNotInClient') });
    }

    if (clientConnection.roles.includes(role as IUserRole)) {
      throw new BadRequestError({ message: t('client.errors.userAlreadyHasRole', { role }) });
    }

    await this.userDAO.updateById(
      targetUserId,
      {
        $addToSet: { 'cuids.$[elem].roles': role },
      },
      {
        arrayFilters: [{ 'elem.cuid': clientId }],
      }
    );

    this.log.info(
      {
        adminId: currentuser.sub,
        targetUserId,
        clientId,
        role,
        action: 'assignRole',
      },
      t('client.logging.roleAssigned')
    );

    return {
      success: true,
      data: null,
      message: t('client.success.roleAssigned', { role }),
    };
  }

  async removeUserRole(
    cxt: IRequestContext,
    targetUserId: string,
    role: IUserRoleType
  ): Promise<ISuccessReturnData> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    if (role === 'admin') {
      const adminUsers = await this.userDAO.getUsersByClientId(clientId, {
        'cuids.roles': 'admin',
        'cuids.isConnected': true,
      });

      if (adminUsers.items.length <= 1) {
        throw new ForbiddenError({ message: t('client.errors.cannotRemoveLastAdmin') });
      }
    }

    await this.userDAO.updateById(
      targetUserId,
      {
        $pull: { 'cuids.$[elem].roles': role },
      },
      {
        arrayFilters: [{ 'elem.cuid': clientId }],
      }
    );

    this.log.info(
      {
        adminId: currentuser.sub,
        targetUserId,
        clientId,
        role,
        action: 'removeRole',
      },
      t('client.logging.roleRemoved')
    );

    return {
      success: true,
      data: null,
      message: t('client.success.roleRemoved', { role }),
    };
  }

  async getUserRoles(
    cxt: IRequestContext,
    targetUserId: string
  ): Promise<ISuccessReturnData<{ roles: IUserRoleType[] }>> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    const user = await this.userDAO.getUserById(targetUserId);
    if (!user) {
      throw new NotFoundError({ message: t('client.errors.userNotFound') });
    }

    const clientConnection = user.cuids.find((c) => c.cuid === clientId);
    if (!clientConnection) {
      throw new NotFoundError({ message: t('client.errors.userNotInClient') });
    }

    return {
      success: true,
      data: { roles: clientConnection.roles },
      message: t('client.success.rolesRetrieved'),
    };
  }

  async disconnectUser(cxt: IRequestContext, targetUserId: string): Promise<ISuccessReturnData> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    const user = await this.userDAO.getUserById(targetUserId);
    if (!user) {
      throw new NotFoundError({ message: t('client.errors.userNotFound') });
    }

    const clientConnection = user.cuids.find((c) => c.cuid === clientId);
    if (!clientConnection) {
      throw new NotFoundError({ message: t('client.errors.userNotInClient') });
    }

    if (clientConnection.roles.includes(IUserRole.ADMIN)) {
      const connectedAdmins = await this.userDAO.getUsersByClientId(clientId, {
        'cuids.roles': 'admin',
        'cuids.isConnected': true,
      });

      if (connectedAdmins.items.length <= 1) {
        throw new ForbiddenError({ message: t('client.errors.cannotDisconnectLastAdmin') });
      }
    }

    await this.userDAO.updateById(
      targetUserId,
      {
        $set: { 'cuids.$[elem].isConnected': false },
      },
      {
        arrayFilters: [{ 'elem.cuid': clientId }],
      }
    );

    this.log.info(
      {
        adminId: currentuser.sub,
        targetUserId,
        clientId,
        action: 'disconnectUser',
      },
      t('client.logging.userDisconnected')
    );

    return {
      success: true,
      data: null,
      message: t('client.success.userDisconnected'),
    };
  }

  async reconnectUser(cxt: IRequestContext, targetUserId: string): Promise<ISuccessReturnData> {
    const currentuser = cxt.currentuser!;
    const clientId = currentuser.client.cuid;

    await this.userDAO.updateById(
      targetUserId,
      {
        $set: { 'cuids.$[elem].isConnected': true },
      },
      {
        arrayFilters: [{ 'elem.cuid': clientId }],
      }
    );

    this.log.info(
      {
        adminId: currentuser.sub,
        targetUserId,
        clientId,
        action: 'reconnectUser',
      },
      t('client.logging.userReconnected')
    );

    return {
      success: true,
      data: null,
      message: t('client.success.userReconnected'),
    };
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
