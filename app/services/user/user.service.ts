import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { UserCache } from '@caching/user.cache';
import { VendorService } from '@services/index';
import { IFindOptions } from '@dao/interfaces/baseDAO.interface';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';
import { PropertyDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { PermissionService } from '@services/permission/permission.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors/index';
import { IUserRoleType, ROLE_GROUPS, IUserRole, ROLES } from '@shared/constants/roles.constants';
import { ISuccessReturnData, IRequestContext, IPaginateResult } from '@interfaces/utils.interface';
import {
  IUserPopulatedDocument,
  FilteredUserTableData,
  ITenantFilterOptions,
  IUserDetailResponse,
  IEmployeeDetailInfo,
  IVendorDetailInfo,
  ITenantDetailInfo,
  IPaginatedResult,
  IUserProperty,
  ICurrentUser,
  IUserStats,
} from '@interfaces/user.interface';

interface IConstructor {
  permissionService: PermissionService;
  vendorService: VendorService;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  userCache: UserCache;
  userDAO: UserDAO;
}

export class UserService {
  private readonly log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly userCache: UserCache;
  private readonly permissionService: PermissionService;
  private readonly vendorService: VendorService;

  constructor({
    clientDAO,
    userDAO,
    propertyDAO,
    profileDAO,
    userCache,
    permissionService,
    vendorService,
  }: IConstructor) {
    this.log = createLogger('UserService');
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.propertyDAO = propertyDAO;
    this.profileDAO = profileDAO;
    this.userCache = userCache;
    this.permissionService = permissionService;
    this.vendorService = vendorService;
  }

  private async fetchAndValidateUser(
    uid: string,
    currentuser: ICurrentUser
  ): Promise<IUserPopulatedDocument> {
    const user = (await this.userDAO.getUserByUId(uid, {
      populate: [
        {
          path: 'profile',
          select: 'personalInfo employeeInfo vendorInfo contactInfo preferences',
        },
      ],
    })) as IUserPopulatedDocument | null;

    if (!user) {
      throw new NotFoundError({ message: t('client.errors.userNotFound') });
    }

    const targetUser = {
      _id: user._id,
      uid: user.uid,
      activecuid: user.activecuid,
      cuids: user.cuids,
      profile: user.profile,
    };

    if (!this.permissionService.canUserAccessUser(currentuser, targetUser)) {
      throw new ForbiddenError({
        message: t('client.errors.insufficientPermissions', {
          action: 'view',
          resource: 'user',
        }),
      });
    }

    return user;
  }

  private async checkUserDetailCache(
    clientId: string,
    uid: string
  ): Promise<ISuccessReturnData<IUserDetailResponse> | null> {
    const cachedData = await this.userCache.getUserDetail(clientId, uid);
    if (cachedData.success && cachedData.data) {
      this.log.info('User detail retrieved from cache', { clientId, uid });
      return {
        success: true,
        data: cachedData.data,
        message: t('client.success.userRetrieved'),
      };
    }
    return null;
  }

  private async buildAndCacheUserDetail(
    user: IUserPopulatedDocument,
    clientId: string,
    uid: string
  ): Promise<IUserDetailResponse> {
    const clientConnection = user.cuids?.find((c: any) => c.cuid === clientId);
    if (!clientConnection || !clientConnection.isConnected) {
      throw new NotFoundError({ message: t('client.errors.userNotFound') });
    }

    const client = await this.clientDAO.getClientByCuid(clientId);
    if (!client) {
      throw new NotFoundError({ message: t('client.errors.notFound') });
    }

    const userDetail = await this.buildUserDetailData(user, clientConnection, clientId, client);

    await this.userCache.cacheUserDetail(clientId, uid, userDetail);
    this.log.info('User detail cached', { clientId, uid });

    return userDetail;
  }

  async getClientUserInfo(
    cuid: string,
    uid: string,
    currentuser: ICurrentUser
  ): Promise<ISuccessReturnData<IUserDetailResponse>> {
    try {
      const user = await this.fetchAndValidateUser(uid, currentuser);

      const _cachedResult = await this.checkUserDetailCache(cuid, uid);
      if (_cachedResult) {
        return _cachedResult;
      }

      const userDetail = await this.buildAndCacheUserDetail(user, cuid, uid);

      return {
        success: true,
        data: userDetail,
        message: t('client.success.userRetrieved'),
      };
    } catch (error) {
      this.log.error('Error getting client user:', {
        cuid,
        uid,
        error: error.message || error,
      });
      throw error;
    }
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
    filterOptions: IUserFilterOptions,
    paginationOpts: IFindOptions
  ): Promise<ISuccessReturnData<{ items: FilteredUserTableData[]; pagination: IPaginateResult }>> {
    try {
      if (!cuid) {
        throw new BadRequestError({ message: t('client.errors.clientIdRequired') });
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      if (filterOptions.role && typeof filterOptions.role === 'string') {
        filterOptions.role = [filterOptions.role as IUserRoleType];
      }

      // const cachedResult = await this.userCache.getFilteredUsers(
      //   cuid,
      //   filterOptions,
      //   paginationOpts
      // );
      // if (cachedResult.success && cachedResult.data) {
      //   return {
      //     success: true,
      //     data: {
      //       items: cachedResult.data.items,
      //       pagination: cachedResult.data.pagination,
      //     },
      //     message: t('client.success.filteredUsersRetrieved'),
      //   };
      // }

      const result = await this.userDAO.getUsersByFilteredType(cuid, filterOptions, paginationOpts);
      const users: FilteredUserTableData[] = await Promise.all(
        result.items.map(async (user: any) => {
          const clientConnection = user.cuids?.find((c: any) => c.cuid === cuid);
          const firstName = user.profile?.personalInfo?.firstName || '';
          const lastName = user.profile?.personalInfo?.lastName || '';
          const fullName = `${firstName} ${lastName}`.trim();

          const tableUserData: FilteredUserTableData = {
            uid: user.uid,
            email: user.email,
            isActive: user.isActive,
            fullName: fullName || undefined,
            displayName: fullName || user.email,
            isConnected: clientConnection?.isConnected || false,
          };

          const roles = clientConnection?.roles || [];

          if (roles.some((r: string) => ROLE_GROUPS.EMPLOYEE_ROLES.includes(r as any))) {
            tableUserData.employeeInfo = {
              jobTitle: user.profile?.employeeInfo?.jobTitle || undefined,
              department: user.profile?.employeeInfo?.department || undefined,
              startDate:
                user.profile?.employeeInfo?.startDate || user.profile?.createdAt || undefined,
            };
          }

          if (roles.includes(ROLES.VENDOR as string) && user._id) {
            const vendorEntity = await this.vendorService.getVendorByUserId(user._id.toString());
            if (vendorEntity) {
              tableUserData.vendorInfo = {
                companyName: vendorEntity.companyName || 'Unknown Company',
                businessType: vendorEntity.businessType || 'General Contractor',
                serviceType: vendorEntity.businessType || 'General Contractor',
                contactPerson: vendorEntity.contactPerson?.name || fullName,
                rating: 4.5, // placeholder
                reviewCount: 15, // placeholder
                completedJobs: 25, // placeholder
                averageServiceCost: 250, // placeholder
                averageResponseTime: '2h', // placeholder
                isLinkedAccount: !!clientConnection.linkedVendorUid,
                isPrimaryVendor: !clientConnection.linkedVendorUid,
                linkedVendorUid: clientConnection.linkedVendorUid || null,
              };
            }
          }

          if (roles.includes(ROLES.TENANT as string)) {
            tableUserData.tenantInfo = {
              unitNumber: user.profile?.tenantInfo?.unitNumber || undefined,
              leaseStatus: user.profile?.tenantInfo?.leaseStatus || undefined,
              rentStatus: user.profile?.tenantInfo?.rentStatus || undefined,
            };
          }

          return tableUserData;
        })
      );

      await this.userCache.saveFilteredUsers(cuid, users, {
        filters: filterOptions,
        pagination: paginationOpts,
        totalCount: result.pagination?.total,
      });
      this.log.info('Filtered users cached', {
        cuid,
        count: users.length,
        total: result.pagination?.total,
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

  /**
   * Get user statistics for a client (for charts)
   * @param cuid - Client ID
   * @param currentUser - Current user context
   * @param filterOptions - Filter options
   * @returns User statistics for charts
   */
  async getUserStats(
    cuid: string,
    filterOptions: IUserFilterOptions
  ): Promise<ISuccessReturnData<IUserStats | any>> {
    try {
      if (!cuid) {
        throw new BadRequestError({ message: t('client.errors.clientIdRequired') });
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      if (filterOptions.role && typeof filterOptions.role === 'string') {
        filterOptions.role = [filterOptions.role as IUserRoleType];
      }

      // Note: Vendor stats have been moved to VendorService.getVendorStats()
      // This method now handles only user/employee statistics
      const stats = await this.clientDAO.getClientUsersStats(cuid, filterOptions);

      return {
        success: true,
        data: {
          departmentDistribution: stats.departmentDistribution,
          roleDistribution: stats.roleDistribution,
          totalFilteredUsers: stats.totalFilteredUsers,
        },
        message: t('client.success.userStatsRetrieved'),
      };
    } catch (error) {
      this.log.error('Error getting user stats:', {
        cuid,
        filterOptions,
        error: error.message || error,
      });
      throw error;
    }
  }

  async getUserProperties(userId: string, clientId: string): Promise<IUserProperty[]> {
    try {
      // Query properties managed by this user with minimal fields
      const result = await this.propertyDAO.getPropertiesByClientId(
        clientId,
        {
          managedBy: userId,
          deletedAt: null,
        },
        {
          limit: 50,
        }
      );

      const properties = result.items || [];

      return properties.map((property: any) => ({
        name: property.name || '',
        propertyId: property.id || '',
        location: this.formatPropertyLocation(property.location),
        units: property.totalUnits || 0,
        occupancy: `${property.occupancyRate || 0}%`,
        since: this.formatDate(property.createdAt),
      }));
    } catch (error) {
      this.log.error('Error getting user properties:', error);
      return [];
    }
  }

  /**
   * Build base profile structure
   */
  private buildBaseProfile(
    user: { profile: { contactInfo?: any } } & IUserPopulatedDocument,
    clientConnection: any,
    client: any
  ): any {
    const profile = user.profile || {};
    const personalInfo = profile.personalInfo || {};
    const contactInfo = profile.contactInfo || {};
    const roles = clientConnection.roles || [];
    const userType = this.determineUserType(roles, user.uid, client);

    return {
      profile: {
        firstName: personalInfo.firstName || '',
        lastName: personalInfo.lastName || '',
        fullName: `${personalInfo.firstName || ''} ${personalInfo.lastName || ''}`.trim(),
        avatar: personalInfo.avatar || '',
        phoneNumber: personalInfo.phoneNumber || contactInfo.phoneNumber || '',
        email: user.email,
        roles: roles,
        uid: user.uid,
        id: user.id,
        userType: userType,
        isActive: user.isActive,
      },
      status: user.isActive ? 'Active' : 'Inactive',
      userType,
      roles,
    };
  }

  private async buildUserDetailData(
    user: { profile: { contactInfo?: any } } & IUserPopulatedDocument,
    clientConnection: any,
    clientId: string,
    client: any
  ): Promise<IUserDetailResponse> {
    const response = this.buildBaseProfile(user, clientConnection, client);
    const profile = user.profile || {};

    switch (response.userType) {
      case 'primary_account_holder':
        // Primary account holders get all properties and enhanced employee info
        // response.properties = await this.getUserProperties(user._id.toString(), clientId);
        response.employeeInfo = await this.buildEmployeeInfo(
          user,
          profile,
          response.roles,
          response.properties
        );
        break;

      case 'employee':
        // Get properties for employees (excluding tenants)
        if (
          !response.roles.includes(IUserRole.TENANT as string) ||
          response.roles.includes(IUserRole.VENDOR as string)
        ) {
          response.properties = await this.getUserProperties(user._id.toString(), clientId);
        }
        response.employeeInfo = await this.buildEmployeeInfo(
          user,
          profile,
          response.roles,
          response.properties
        );
        break;

      case 'vendor':
        response.vendorInfo = await this.buildVendorInfo(
          user._id.toString(),
          profile,
          clientConnection,
          clientId
        );
        break;

      case 'tenant':
        response.tenantInfo = await this.buildTenantInfo(user, profile, clientId);
        break;
    }

    return response;
  }

  private async buildEmployeeInfo(
    user: any,
    profile: any,
    roles: any,
    userManagedProperties: IUserProperty[]
  ): Promise<IEmployeeDetailInfo> {
    const employeeInfo = profile.employeeInfo || {};
    const contactInfo = profile.contactInfo || {};

    const hireDate = employeeInfo.startDate || user.createdAt;
    const tenure = this.calculateTenure(hireDate);

    return {
      employeeId: employeeInfo.employeeId || '',
      hireDate: hireDate,
      tenure: tenure,
      employmentType: employeeInfo.employmentType || 'Full-Time',
      department: employeeInfo.department || 'operations',
      position: this.determinePrimaryRole(roles),
      directManager: employeeInfo.reportsTo || '',

      // Skills and expertise
      skills: employeeInfo.skills || [
        'Property Management',
        'Tenant Relations',
        'Maintenance Coordination',
        'Financial Reporting',
      ],

      // Office information
      officeInfo: {
        address: contactInfo.officeAddress || 'N/A',
        city: contactInfo.officeCity || 'N/A',
        workHours: contactInfo.workHours || 'N/A',
      },

      // Emergency contact
      emergencyContact: employeeInfo.emergencyContact || {
        name: 'N/A',
        relationship: 'N/A',
        phone: 'N/A',
      },

      // Performance statistics
      stats: {
        propertiesManaged: userManagedProperties.length,
        unitsManaged: userManagedProperties.reduce(
          (sum: number, p: any) => sum + (p.units || 0),
          0
        ),
        tasksCompleted: 47, // placeholder
        onTimeRate: '98%', // placeholder
        rating: '4.8', // placeholder
        activeTasks: 8, // placeholder
      },

      // Performance metrics
      performance: {
        taskCompletionRate: '98%',
        tenantSatisfaction: '4.8/5',
        avgOccupancyRate: '92%',
        avgResponseTime: '12h',
      },

      // Employment tags/badges
      tags: this.generateEmployeeTags(employeeInfo, roles),
    };
  }

  private async buildVendorInfo(
    userid: string,
    profile: any,
    clientConnection: any,
    cuid: string
  ): Promise<IVendorDetailInfo> {
    const _personalInfo = profile.personalInfo || {};

    const vendor = await this.vendorService.getVendorByUserId(userid);
    const vendorInfo = vendor;

    // get linked users if this is a primary vendor
    let linkedUsers: any[] = [];
    if (!clientConnection.linkedVendorUid) {
      try {
        const linkedUsersResult = await this.userDAO.getLinkedVendorUsers(userid, cuid);
        linkedUsers = linkedUsersResult.items.map((linkedUser: any) => {
          const personalInfo = linkedUser.profile?.personalInfo || {};
          return {
            uid: linkedUser.uid,
            displayName:
              personalInfo.displayName ||
              `${personalInfo.firstName || ''} ${personalInfo.lastName || ''}`.trim() ||
              linkedUser.email,
            email: linkedUser.email,
            isActive: linkedUser.isActive,
            phoneNumber: personalInfo.phoneNumber || undefined,
          };
        });
      } catch (error) {
        this.log.error('Error fetching linked vendor users:', error);
        linkedUsers = [];
      }
    }

    return {
      companyName: vendorInfo?.companyName || _personalInfo.displayName || '',
      businessType: vendorInfo?.businessType || 'General Contractor',
      yearsInBusiness: vendorInfo?.yearsInBusiness || 0,
      registrationNumber: vendorInfo?.registrationNumber || '',
      taxId: vendorInfo?.taxId || '',

      // Services
      servicesOffered: vendorInfo?.servicesOffered || {},

      // Service areas - baseLocation should be a string
      serviceAreas: {
        baseLocation:
          vendorInfo?.serviceAreas?.baseLocation?.address || vendorInfo?.address?.fullAddress || '',
        maxDistance: vendorInfo?.serviceAreas?.maxDistance || 25,
      },

      // Insurance - all fields must have values (not undefined)
      insuranceInfo: {
        provider: vendorInfo?.insuranceInfo?.provider || '',
        policyNumber: vendorInfo?.insuranceInfo?.policyNumber || '',
        expirationDate: vendorInfo?.insuranceInfo?.expirationDate || null,
        coverageAmount: vendorInfo?.insuranceInfo?.coverageAmount || 0,
      },

      // Contact person - all fields must have values (not undefined)
      contactPerson: {
        name: vendorInfo?.contactPerson?.name || _personalInfo.displayName || '',
        jobTitle: vendorInfo?.contactPerson?.jobTitle || 'Employee',
        email: vendorInfo?.contactPerson?.email || '',
        phone: vendorInfo?.contactPerson?.phone || _personalInfo.phoneNumber || '',
      },

      // Vendor statistics (placeholder)
      stats: {
        completedJobs: 0,
        activeJobs: 0,
        rating: '0',
        responseTime: '24h',
        onTimeRate: '0%',
      },

      // Vendor tags
      tags: this.generateVendorTags(vendorInfo, clientConnection),

      // Linked vendor info if applicable
      isLinkedAccount: !!clientConnection.linkedVendorUid,
      linkedVendorUid: clientConnection.linkedVendorUid || null,
      isPrimaryVendor: !clientConnection.linkedVendorUid,

      // Linked users (only for primary vendors)
      ...(linkedUsers.length > 0 ? { linkedUsers } : {}),
    };
  }

  private async buildTenantInfo(
    user: any,
    profile: any,
    clientId: string
  ): Promise<ITenantDetailInfo> {
    const tenantInfo = profile.tenantInfo || {};

    // Filter client-specific arrays by current client's cuid
    // This ensures we only return data relevant to the requesting client
    const filteredEmployerInfo = (tenantInfo.employerInfo || []).filter(
      (employer: any) => employer.cuid === clientId
    );

    const filteredActiveLeases = (tenantInfo.activeLeases || []).filter(
      (lease: any) => lease.cuid === clientId
    );

    const filteredBackgroundChecks = (tenantInfo.backgroundChecks || []).filter(
      (check: any) => check.cuid === clientId
    );

    // ITenantDetailInfo extends TenantInfo, so return TenantInfo fields directly
    return {
      // Client-specific data (filtered)
      employerInfo: filteredEmployerInfo,
      activeLeases: filteredActiveLeases,
      backgroundChecks: filteredBackgroundChecks,

      // Shared data (not filtered)
      rentalReferences: tenantInfo.rentalReferences || [],
      pets: tenantInfo.pets || [],
      emergencyContact: tenantInfo.emergencyContact || undefined,
    };
  }

  private generateVendorTags(vendorInfo: any, clientConnection: any): string[] {
    const tags = [];

    if (vendorInfo.businessType) {
      tags.push(vendorInfo.businessType);
    }

    if (vendorInfo.insuranceInfo?.expirationDate) {
      const expirationDate = new Date(vendorInfo.insuranceInfo.expirationDate);
      if (expirationDate > new Date()) {
        tags.push('Insured');
      }
    }

    if (vendorInfo.yearsInBusiness > 5) {
      tags.push('Established');
    }

    if (clientConnection.linkedVendorUid) {
      tags.push('Sub-contractor');
    } else {
      tags.push('Primary Vendor');
    }

    const services = vendorInfo.servicesOffered || {};
    const activeServices = Object.keys(services).filter((key) => services[key]);
    if (activeServices.length > 0) {
      tags.push(`${activeServices.length} Services`);
    }

    return tags;
  }

  private calculateTenure(hireDate: Date): string {
    const now = new Date();
    const hire = new Date(hireDate);
    const diffTime = Math.abs(now.getTime() - hire.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const years = Math.floor(diffDays / 365);
    const months = Math.floor((diffDays % 365) / 30);

    if (years > 0) {
      return years === 1 ? '1 Year' : `${years} Years`;
    } else if (months > 0) {
      return months === 1 ? '1 Month' : `${months} Months`;
    } else {
      return 'Less than 1 Month';
    }
  }

  private determinePrimaryRole(roles: string[]): string {
    const roleHierarchy = {
      super_admin: 'Super Administrator',
      admin: 'Administrator',
      manager: 'Property Manager',
      staff: 'Staff Member',
      vendor: 'Vendor',
      tenant: 'Tenant',
    };

    for (const [roleKey, roleLabel] of Object.entries(roleHierarchy)) {
      if (roles.includes(roleKey)) {
        return roleLabel;
      }
    }

    return 'Staff Member';
  }

  private determineUserType(
    roles: string[],
    userId: string,
    client: any
  ): 'employee' | 'vendor' | 'tenant' | 'primary_account_holder' {
    // Check if user is the primary account holder (accountAdmin) first
    if (client.accountAdmin?.toString() === userId) {
      return 'primary_account_holder';
    }

    // Employee roles include both enum values and additional string values
    const employeeRoles = [IUserRole.STAFF, IUserRole.ADMIN, IUserRole.MANAGER, 'super_admin'];

    if (roles.some((r: string) => employeeRoles.includes(r as any))) {
      return 'employee';
    } else if (roles.includes(IUserRole.VENDOR as string)) {
      return 'vendor';
    } else if (roles.includes(IUserRole.TENANT as string)) {
      return 'tenant';
    }
    return 'employee';
  }

  private formatPropertyLocation(location: any): string {
    if (!location) return 'Location not specified';

    const parts = [];
    if (location.address) parts.push(location.address);
    if (location.city) parts.push(location.city);
    if (location.state) parts.push(location.state);

    return parts.length > 0 ? parts.join(', ') : 'Location not specified';
  }

  private formatDate(date: Date): string {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
    });
  }

  private generateEmployeeTags(employeeInfo: any, roles: string[]): string[] {
    const tags = [];

    // Employment type
    if (employeeInfo.employmentType) {
      tags.push(employeeInfo.employmentType);
    } else {
      tags.push('Full-Time');
    }

    // Performance indicators (placeholder)
    if (roles.includes(ROLES.MANAGER as string) || roles.includes(ROLES.ADMIN as string)) {
      tags.push('Top Performer');
    }

    // Certifications (placeholder)
    if (employeeInfo.certifications && employeeInfo.certifications.length > 0) {
      tags.push('Certified');
    } else {
      tags.push('Certified'); // Default for demo
    }

    // Access levels (placeholder)
    if (roles.includes(ROLES.MANAGER as string)) {
      tags.push('Master Key Access');
    }

    return tags;
  }

  /**
   * Handle existing user by adding them to the client (moved from InvitationService)
   */
  async addExistingUserToClient(
    existingUser: any,
    role: IUserRoleType,
    client: { id: string; cuid: string; displayName: string },
    linkedVendorUid?: string,
    session?: any
  ): Promise<any> {
    return await this.userDAO.addUserToClient(
      existingUser._id.toString(),
      role as IUserRoleType,
      {
        id: client.id.toString(),
        cuid: client.cuid,
        clientDisplayName: client.displayName,
      },
      linkedVendorUid,
      session
    );
  }

  /**
   * Create new user from invitation data (moved from InvitationService)
   */
  async createUserFromInvitationData(
    invitationData: any,
    userData: any,
    client: { id: string; cuid: string; displayName: string },
    linkedVendorUid?: string,
    session?: any
  ): Promise<any> {
    const user = await this.userDAO.createUserFromInvitation(
      { cuid: client.cuid, displayName: client.displayName },
      invitationData,
      userData,
      linkedVendorUid,
      session
    );

    if (!user) {
      throw new BadRequestError({ message: 'Error creating user account.' });
    }

    const profileData = this.buildProfileFromInvitationData(user, invitationData, userData);
    await this.profileDAO.createUserProfile(user._id, profileData, session);

    return user;
  }

  /**
   * Build profile data from invitation and user data (moved from InvitationService)
   */
  buildProfileFromInvitationData(user: any, invitation: any, userData: any): any {
    return {
      user: user._id,
      puid: user.uid,
      personalInfo: {
        firstName: invitation.personalInfo.firstName,
        lastName: invitation.personalInfo.lastName,
        displayName: invitation.inviteeFullName,
        phoneNumber: invitation.personalInfo.phoneNumber || '',
        location: userData.location || 'Unknown',
      },
      settings: {
        lang: userData.lang || 'en',
        timeZone: userData.timeZone || 'UTC',
        theme: 'light',
        loginType: 'password',
        notifications: {
          emailNotifications: true,
          inAppNotifications: true,
          emailFrequency: 'daily',
          propertyUpdates: true,
          announcements: true,
          maintenance: true,
          comments: true,
          messages: true,
          payments: true,
          system: true,
        },
        gdprSettings: {
          dataRetentionPolicy: 'standard',
          dataProcessingConsent: true,
          processingConsentDate: new Date(),
          retentionExpiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      },
      policies: {
        tos: {
          accepted: userData.termsAccepted || false,
          acceptedOn: userData.termsAccepted ? new Date() : null,
        },
        marketing: {
          accepted: userData.newsletterOptIn || false,
          acceptedOn: userData.newsletterOptIn ? new Date() : null,
        },
      },
    };
  }

  /**
   * Handle user creation or linking based on existence (moved from InvitationService)
   */
  async processUserForClientInvitation(
    invitation: any,
    invitationData: any,
    client: { id: string; cuid: string; displayName: string },
    linkedVendorUid?: string,
    session?: any
  ): Promise<any> {
    const existingUser = await this.userDAO.getActiveUserByEmail(invitation.inviteeEmail);

    if (existingUser) {
      return await this.addExistingUserToClient(
        existingUser,
        invitation.role as IUserRoleType,
        client,
        linkedVendorUid,
        session
      );
    } else {
      return await this.createUserFromInvitationData(
        invitation,
        invitationData,
        client,
        linkedVendorUid,
        session
      );
    }
  }

  /**
   * Get user with client context validation - Base method for user operations
   */
  async getUserWithClientContext(
    userId: string,
    cuid: string,
    opts?: IFindOptions
  ): Promise<any | null> {
    try {
      if (!userId || !cuid) return null;

      const user = await this.userDAO.findFirst(
        {
          _id: new Types.ObjectId(userId),
          'cuids.cuid': cuid,
        },
        opts
      );

      return user;
    } catch (error) {
      this.log.error('Failed to get user with client context', { error, userId, cuid });
      return null;
    }
  }

  async getUserSupervisor(userId: string, cuid: string): Promise<string | null> {
    try {
      if (!userId) return null;

      const user = await this.getUserWithClientContext(userId, cuid, {
        populate: 'profile',
      });

      if (!user || !user.profile?.employeeInfo?.reportsTo) {
        return null;
      }

      const supervisorId = user.profile.employeeInfo.reportsTo;

      // Validate supervisor exists and belongs to same client
      const supervisor = await this.getUserWithClientContext(supervisorId, cuid);

      if (!supervisor) {
        this.log.warn('Supervisor not found or not in same client', {
          userId,
          supervisorId,
          cuid,
        });
        return null;
      }

      return supervisorId;
    } catch (error) {
      this.log.error('Failed to find user supervisor', { error, userId, cuid });
      return null;
    }
  }

  async getUserDisplayName(userId: string, cuid: string): Promise<string> {
    try {
      if (!userId || userId === 'system') return 'System';

      const user = await this.getUserWithClientContext(userId, cuid, {
        populate: 'profile',
      });

      if (!user || !user.profile) return 'Unknown User';

      const { firstName, lastName, displayName } = user.profile.personalInfo;
      return displayName || `${firstName} ${lastName}`.trim() || user.email || 'Unknown User';
    } catch (error) {
      this.log.error('Failed to get user display name', { error, userId, cuid });
      return 'Unknown User';
    }
  }

  async getUserAnnouncementFilters(
    userId: string,
    cuid: string
  ): Promise<{ roles: string[]; vendorId?: string }> {
    try {
      const user = await this.getUserWithClientContext(userId, cuid, {
        populate: 'profile',
      });

      if (!user) {
        this.log.warn('User not found for announcement filters', { userId, cuid });
        return { roles: [] };
      }

      const clientConnection = user.cuids?.find((c: any) => c.cuid === cuid);
      const roles = clientConnection?.roles || [];

      // Get vendor ID for users associated with vendors
      let vendorId: string | undefined;

      // Check if user is directly linked to a vendor (sub-contractor/employee)
      if (clientConnection?.linkedVendorUid) {
        vendorId = clientConnection.linkedVendorUid;
      }
      // Check if user has vendor role and is a primary vendor
      else if (roles.includes(ROLES.VENDOR as string)) {
        try {
          const vendorEntity = await this.vendorService.getVendorByUserId(user._id.toString());
          if (vendorEntity && vendorEntity.vuid) {
            vendorId = vendorEntity.vuid;
          }
        } catch (error) {
          this.log.warn('Failed to get vendor entity for primary vendor', {
            userId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
      // Check if staff user is associated with a vendor through profile
      else if (roles.includes(ROLES.STAFF as string) && user.profile?.vendorInfo?.linkedVendorUid) {
        vendorId = user.profile.vendorInfo.linkedVendorUid;
      }

      return { roles, vendorId };
    } catch (error) {
      this.log.error('Error getting user announcement filters', { userId, cuid, error });
      return { roles: [] };
    }
  }

  async updateUserInfo(
    userId: string,
    userInfo: { email?: string }
  ): Promise<ISuccessReturnData<any>> {
    try {
      if (!userId) {
        throw new BadRequestError({ message: 'User ID is required' });
      }

      // Check if user exists
      const existingUser = await this.userDAO.findFirst({ uid: userId });
      if (!existingUser) {
        throw new NotFoundError({ message: 'User not found' });
      }

      // If email is being updated, check for uniqueness
      if (userInfo.email && userInfo.email !== existingUser.email) {
        const emailExists = await this.userDAO.findFirst({ email: userInfo.email });
        if (emailExists) {
          throw new BadRequestError({ message: 'Email already exists' });
        }
      }

      // Update user information
      const updatedUser = await this.userDAO.updateById(existingUser._id.toString(), userInfo);

      if (!updatedUser) {
        throw new NotFoundError({ message: 'Failed to update user' });
      }

      this.log.info(`User info updated for user ${userId}`, { userInfo });

      return {
        success: true,
        data: {
          uid: updatedUser.uid,
          email: updatedUser.email,
          isActive: updatedUser.isActive,
        },
        message: 'User information updated successfully',
      };
    } catch (error) {
      this.log.error(`Error updating user info for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get tenants by client with filtering and pagination
   * @param cuid - Client unique identifier
   * @param filters - Optional tenant-specific filters
   * @param pagination - Optional pagination parameters
   * @param currentUser - Current user context for permissions
   * @returns Promise resolving to paginated tenant users with tenant-specific data
   */
  /**
   * Get available tenants for lease assignment
   * Returns tenants who don't have any active leases for this client
   */
  async getAvailableTenantsForLease(cuid: string): Promise<
    ISuccessReturnData<
      Array<{
        id: string;
        email: string;
        fullName: string;
        phoneNumber?: string;
        avatar?: { url: string; filename: string };
      }>
    >
  > {
    try {
      if (!cuid) {
        throw new BadRequestError({ message: t('client.errors.clientIdRequired') });
      }

      // Validate client exists
      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      // Get all tenants for this client
      const result = await this.userDAO.getTenantsByClient(
        cuid,
        undefined,
        { limit: 1000, skip: 0 } // Get all tenants
      );

      // Filter tenants without active leases
      const availableTenants = result.items
        .filter((tenant: any) => {
          const tenantInfo = tenant.profile?.tenantInfo;
          if (!tenantInfo) return true; // No tenant info means no leases

          // Get active leases for this specific client
          const activeLeases =
            tenantInfo.activeLeases?.filter(
              (lease: any) => lease.cuid === cuid && lease.confirmed
            ) || [];

          return activeLeases.length === 0;
        })
        .map((tenant: any) => {
          const personalInfo = tenant.profile?.personalInfo || {};

          return {
            id: tenant._id,
            email: tenant.email,
            fullName:
              `${personalInfo.firstName || ''} ${personalInfo.lastName || ''}`.trim() ||
              tenant.email,
            phoneNumber: personalInfo.phoneNumber,
            avatar: personalInfo.avatar,
          };
        });

      this.log.info('Available tenants retrieved', {
        cuid,
        total: result.items.length,
        available: availableTenants.length,
      });

      return {
        success: true,
        data: availableTenants,
        message: t('client.success.tenantsRetrieved'),
      };
    } catch (error: any) {
      this.log.error('Error getting available tenants:', {
        cuid,
        error: error.message || error,
      });
      throw error;
    }
  }

  async getTenantsByClient(
    cuid: string,
    filters?: ITenantFilterOptions,
    pagination?: IFindOptions,
    currentUser?: ICurrentUser
  ): Promise<ISuccessReturnData<IPaginatedResult<any[]>>> {
    try {
      if (!cuid) {
        throw new BadRequestError({ message: t('client.errors.clientIdRequired') });
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      if (currentUser && currentUser.client.cuid !== cuid) {
        throw new ForbiddenError({
          message: t('client.errors.insufficientPermissions', {
            action: 'view',
            resource: 'tenants',
          }),
        });
      }

      const result = await this.userDAO.getTenantsByClient(cuid, filters, pagination);
      const enrichedTenants = await Promise.all(
        result.items.map(async (tenant: any) => {
          const personalInfo = tenant.profile?.personalInfo || {};
          const tenantInfo = tenant.profile?.tenantInfo || {};

          return {
            id: tenant.user,
            email: tenant.email,
            isActive: tenant.isActive,
            fullName: `${personalInfo.firstName || ''} ${personalInfo.lastName || ''}`.trim(),
            displayName:
              personalInfo.displayName ||
              `${personalInfo.firstName || ''} ${personalInfo.lastName || ''}`.trim() ||
              tenant.email,
            phoneNumber: personalInfo.phoneNumber,
            avatar: personalInfo.avatar,
            tenantInfo: {
              activeLease: tenantInfo.activeLease,
              employerInfo: tenantInfo.employerInfo,
              rentalReferences: tenantInfo.rentalReferences,
              pets: tenantInfo.pets,
              emergencyContact: tenantInfo.emergencyContact,
              backgroundCheckStatus: tenantInfo.backgroundCheckStatus,
            },
            createdAt: tenant.createdAt,
            updatedAt: tenant.updatedAt,
          };
        })
      );

      const enrichedResult = {
        items: enrichedTenants,
        pagination: result.pagination,
      };

      this.log.info('Tenants retrieved', { cuid, count: enrichedTenants.length });

      return {
        success: true,
        data: enrichedResult,
        message: t('client.success.tenantsRetrieved'),
      };
    } catch (error) {
      this.log.error('Error getting tenants by client:', {
        cuid,
        filters,
        error: error.message || error,
      });
      throw error;
    }
  }

  /**
   * Get tenant statistics for a client
   * @param cuid - Client unique identifier
   * @param filters - Optional tenant filters
   * @param currentUser - Current user context for permissions
   * @returns Promise resolving to tenant statistics
   */
  async getTenantStats(
    cuid: string,
    filters?: import('@interfaces/user.interface').ITenantFilterOptions,
    currentUser?: ICurrentUser
  ): Promise<ISuccessReturnData<import('@interfaces/user.interface').ITenantStats>> {
    try {
      if (!cuid) {
        throw new BadRequestError({ message: t('client.errors.clientIdRequired') });
      }

      // Validate client exists
      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      // Optional permission check if currentUser is provided
      if (currentUser && currentUser.client.cuid !== cuid) {
        throw new ForbiddenError({
          message: t('client.errors.insufficientPermissions', {
            action: 'view',
            resource: 'tenant_stats',
          }),
        });
      }

      // Get stats from DAO
      const stats = await this.userDAO.getTenantStats(cuid, filters);

      // Enhance stats with property names if we have property IDs
      if (stats.distributionByProperty?.length > 0) {
        const enhancedDistribution = await Promise.all(
          stats.distributionByProperty.map(async (item) => {
            try {
              const property = await this.propertyDAO.findById(item.propertyId);
              return {
                ...item,
                propertyName: property?.name || item.propertyName || `Property ${item.propertyId}`,
              };
            } catch (error) {
              this.log.warn(`Failed to get property name for ${item.propertyId}:`, error);
              return item;
            }
          })
        );
        stats.distributionByProperty = enhancedDistribution;
      }

      this.log.info('Tenant stats retrieved', { cuid, total: stats.total });

      return {
        success: true,
        data: stats,
        message: t('client.success.tenantStatsRetrieved'),
      };
    } catch (error) {
      this.log.error('Error getting tenant stats:', {
        cuid,
        filters,
        error: error.message || error,
      });
      throw error;
    }
  }

  async getClientTenantDetails(
    cuid: string,
    tenantUid: string,
    currentUser?: ICurrentUser,
    include?: string[]
  ): Promise<ISuccessReturnData<import('@interfaces/user.interface').IClientTenantDetails>> {
    try {
      if (!cuid || !tenantUid) {
        throw new BadRequestError({
          message: t('client.errors.missingParameters'),
        });
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      if (currentUser && currentUser.client.cuid !== cuid) {
        throw new ForbiddenError({
          message: t('client.errors.insufficientPermissions', {
            action: 'view',
            resource: 'tenant_details',
          }),
        });
      }

      const rawTenantDetails = await this.userDAO.getClientTenantDetails(cuid, tenantUid, include);

      if (!rawTenantDetails) {
        throw new NotFoundError({
          message: t('tenant.errors.notFound'),
        });
      }

      const transformedResponse: import('@interfaces/user.interface').IClientTenantDetails = {
        profile: {
          firstName: (rawTenantDetails as any).firstName || '',
          lastName: (rawTenantDetails as any).lastName || '',
          fullName: (rawTenantDetails as any).fullName || '',
          avatar: (rawTenantDetails as any).avatar?.url || (rawTenantDetails as any).avatar || '',
          phoneNumber: (rawTenantDetails as any).phoneNumber || '',
          email: (rawTenantDetails as any).email || '',
          roles: ['tenant'],
          uid: (rawTenantDetails as any).uid || '',
          id: (rawTenantDetails as any)._id?.toString() || '',
          isActive: (rawTenantDetails as any).isActive ?? true,
          userType: 'tenant' as const,
        },
        status: (rawTenantDetails as any).isActive ? ('Active' as const) : ('Inactive' as const),
        userType: 'tenant' as const,
        roles: ['tenant'],
        tenantInfo: rawTenantDetails.tenantInfo,
        tenantMetrics: rawTenantDetails.tenantMetrics,
        joinedDate: (rawTenantDetails as any).joinedDate || (rawTenantDetails as any).createdAt,
      };

      this.log.info('Tenant details retrieved', {
        cuid,
        tenantUid,
        hasActiveLeases: !!transformedResponse.tenantInfo.activeLeases?.length,
      });

      return {
        success: true,
        data: transformedResponse,
        message: t('tenant.success.detailsRetrieved'),
      };
    } catch (error) {
      this.log.error('Error getting client tenant details:', {
        cuid,
        tenantUid,
        error: error.message || error,
      });
      throw error;
    }
  }

  /**
   * Get tenant user information (general user view)
   * Returns the same user detail structure as employees/vendors but validates tenant role
   * @param cuid - Client unique identifier
   * @param uid - Tenant user unique identifier
   * @param context - Request context
   * @returns Promise resolving to tenant user information
   */
  async getTenantUserInfo(
    cuid: string,
    uid: string,
    context: IRequestContext
  ): Promise<ISuccessReturnData<any>> {
    try {
      if (!cuid || !uid) {
        throw new BadRequestError({
          message: t('client.errors.missingParameters'),
        });
      }

      const currentUser = context.currentuser!;
      const result = await this.getClientUserInfo(cuid, uid, currentUser);

      // If the user is not a tenant, throw an error
      if (result.data.profile?.userType !== 'tenant') {
        throw new BadRequestError({
          message: t('tenant.errors.notTenant'),
        });
      }

      return result;
    } catch (error) {
      this.log.error('Error getting client tenant info:', {
        cuid,
        uid,
        error: error.message || error,
      });
      throw error;
    }
  }

  /**
   * Get tenant statistics wrapper method
   * @param cuid - Client unique identifier
   * @param currentUser - Current user context
   * @returns Promise resolving to tenant statistics
   */
  async getTenantsStats(
    cuid: string,
    currentUser?: ICurrentUser
  ): Promise<ISuccessReturnData<any>> {
    try {
      // Leverage the existing getTenantStats method
      return await this.getTenantStats(cuid, undefined, currentUser);
    } catch (error) {
      this.log.error('Error getting tenants stats:', {
        cuid,
        error: error.message || error,
      });
      throw error;
    }
  }

  /**
   * Update tenant profile information
   * @param cuid - Client unique identifier
   * @param uid - Tenant user unique identifier
   * @param updateData - Data to update
   * @param context - Request context
   * @returns Promise resolving to success response
   */
  async updateTenantProfile(
    cuid: string,
    uid: string,
    updateData: any,
    context: IRequestContext
  ): Promise<ISuccessReturnData<any>> {
    try {
      if (!cuid || !uid) {
        throw new BadRequestError({
          message: t('client.errors.missingParameters'),
        });
      }

      const currentUser = context.currentuser!;

      // Validate user exists and is a tenant
      const user = await this.userDAO.getUserByUId(uid, {
        populate: [{ path: 'profile' }],
      });

      if (!user) {
        throw new NotFoundError({ message: t('client.errors.userNotFound') });
      }

      // Check if user is connected to this client
      const clientConnection = user.cuids?.find((c: any) => c.cuid === cuid);
      if (!clientConnection || !clientConnection.isConnected) {
        throw new NotFoundError({ message: t('client.errors.userNotFound') });
      }

      // Verify user is a tenant
      if (!clientConnection.roles.includes('tenant')) {
        throw new BadRequestError({
          message: t('tenant.errors.notTenant'),
        });
      }

      // Check permissions
      if (!this.permissionService.canUserAccessUser(currentUser, user as any)) {
        throw new ForbiddenError({
          message: t('client.errors.insufficientPermissions', {
            action: 'update',
            resource: 'tenant',
          }),
        });
      }

      // Update profile data
      const profileUpdateFields: Record<string, any> = {};

      if (updateData.personalInfo) {
        for (const [key, value] of Object.entries(updateData.personalInfo)) {
          profileUpdateFields[`personalInfo.${key}`] = value;
        }
      }

      if (updateData.contactInfo) {
        for (const [key, value] of Object.entries(updateData.contactInfo)) {
          profileUpdateFields[`contactInfo.${key}`] = value;
        }
      }

      if (updateData.tenantInfo) {
        // Only update non-lease fields for now
        const { activeLease, ...allowedTenantInfo } = updateData.tenantInfo;
        for (const [key, value] of Object.entries(allowedTenantInfo)) {
          profileUpdateFields[`tenantInfo.${key}`] = value;
        }
      }

      if (Object.keys(profileUpdateFields).length > 0 && user.profile) {
        await this.profileDAO.updateById(user.profile._id.toString(), {
          $set: profileUpdateFields,
        });
      }

      // Update user email if provided
      if (updateData.email && updateData.email !== user.email) {
        // Check if email is already in use
        const emailExists = await this.userDAO.findFirst({ email: updateData.email });
        if (emailExists && emailExists.uid !== uid) {
          throw new BadRequestError({ message: t('client.errors.emailExists') });
        }
        await this.userDAO.updateById(user._id.toString(), { email: updateData.email });
      }

      // Invalidate caches
      await this.userCache.invalidateUserDetail(cuid, uid);
      await this.userCache.invalidateUserLists(cuid);

      this.log.info('Tenant profile updated', { cuid, uid });

      return {
        success: true,
        data: { uid },
        message: t('tenant.success.profileUpdated'),
      };
    } catch (error) {
      this.log.error('Error updating tenant profile:', {
        cuid,
        uid,
        error: error.message || error,
      });
      throw error;
    }
  }

  /**
   * Archive (soft delete) a user with comprehensive cleanup
   * Handles:
   * - Property management reassignment to supervisor
   * - Primary vendor account cleanup (archives linked vendor accounts)
   * - User disconnection from client
   * - Cache invalidation
   *
   * TODO: When lease/task/maintenance features are added:
   * - Reassign active leases
   * - Reassign or complete active tasks
   * - Reassign active maintenance requests
   *
   * @param cuid - Client unique identifier
   * @param uid - User unique identifier
   * @param currentUser - Current user context
   * @returns Promise resolving to success response with archival summary
   */
  async archiveUser(
    cuid: string,
    uid: string,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData<any>> {
    try {
      if (!cuid || !uid) {
        throw new BadRequestError({
          message: t('client.errors.missingParameters'),
        });
      }

      // Get user with full profile
      const user = await this.userDAO.getUserByUId(uid, {
        populate: [{ path: 'profile' }],
      });

      if (!user) {
        throw new NotFoundError({ message: t('client.errors.userNotFound') });
      }

      // Check permissions
      if (!this.permissionService.canUserAccessUser(currentUser, user as any)) {
        throw new ForbiddenError({
          message: t('client.errors.insufficientPermissions', {
            action: 'delete',
            resource: 'user',
          }),
        });
      }

      // Prevent archiving self
      if (uid === currentUser.uid) {
        throw new BadRequestError({
          message: t('client.errors.cannotArchiveSelf'),
        });
      }

      const clientConnection = user.cuids?.find((c: any) => c.cuid === cuid);
      if (!clientConnection) {
        throw new NotFoundError({ message: t('client.errors.userNotFoundInClient') });
      }

      const roles: string[] = clientConnection.roles || [];
      const archivalSummary: any = {
        uid,
        archivedAt: new Date(),
        archivedBy: currentUser.uid,
        actions: [],
      };

      // 1. Handle Property Management Reassignment
      const managedProperties = await this.propertyDAO.getPropertiesByClientId(
        cuid,
        { managedBy: user._id.toString(), deletedAt: null },
        { limit: 1000 }
      );

      if (managedProperties.items.length > 0) {
        this.log.info('User manages properties, attempting reassignment', {
          uid,
          propertyCount: managedProperties.items.length,
        });

        // Get user's supervisor
        const supervisorId = await this.getUserSupervisor(user._id.toString(), cuid);

        if (supervisorId) {
          // Reassign all properties to supervisor
          for (const property of managedProperties.items) {
            await this.propertyDAO.updateById(property._id.toString(), {
              managedBy: new Types.ObjectId(supervisorId),
            });
          }

          archivalSummary.actions.push({
            action: 'properties_reassigned',
            count: managedProperties.items.length,
            reassignedTo: supervisorId,
          });

          this.log.info('Properties reassigned to supervisor', {
            uid,
            supervisorId,
            propertyCount: managedProperties.items.length,
          });
        } else {
          // No supervisor found - properties need manual reassignment
          this.log.warn('No supervisor found for user with managed properties', {
            uid,
            propertyCount: managedProperties.items.length,
          });

          archivalSummary.actions.push({
            action: 'properties_require_manual_reassignment',
            count: managedProperties.items.length,
            warning: 'No supervisor found - properties need manual reassignment',
          });
        }
      }

      // 2. Handle Primary Vendor Account Cleanup
      if (roles.includes(IUserRole.VENDOR as string) && !clientConnection.linkedVendorUid) {
        // This is a primary vendor - need to archive linked accounts
        try {
          const vendor = await this.vendorService.getVendorByUserId(user._id.toString());

          if (vendor && vendor.vuid) {
            // Get all linked vendor users
            const linkedUsers = await this.userDAO.getLinkedVendorUsers(user._id.toString(), cuid);

            if (linkedUsers.items.length > 0) {
              this.log.info('Archiving linked vendor accounts', {
                uid,
                vendorId: vendor.vuid,
                linkedAccountCount: linkedUsers.items.length,
              });

              // Archive all linked vendor accounts
              for (const linkedUser of linkedUsers.items) {
                await this.userDAO.updateById(linkedUser._id.toString(), {
                  deletedAt: new Date(),
                  isActive: false,
                });

                // Disconnect from client
                await this.userDAO.updateById(
                  linkedUser._id.toString(),
                  {
                    $set: { 'cuids.$[elem].isConnected': false },
                  },
                  {
                    arrayFilters: [{ 'elem.cuid': cuid }],
                  } as any
                );

                // Invalidate cache for linked user
                await this.userCache.invalidateUserDetail(cuid, linkedUser.uid);
              }

              archivalSummary.actions.push({
                action: 'linked_vendor_accounts_archived',
                count: linkedUsers.items.length,
                vendorId: vendor.vuid,
              });
            }

            // Note: Vendor entity itself is not deleted, just marked inactive via user deletion
            archivalSummary.actions.push({
              action: 'primary_vendor_archived',
              vendorId: vendor.vuid,
            });
          }
        } catch (error) {
          this.log.error('Error handling vendor account cleanup:', {
            uid,
            error: error.message || error,
          });
          // Continue with user archival even if vendor cleanup fails
        }
      }

      // 3. Soft delete the user
      await this.userDAO.updateById(user._id.toString(), {
        deletedAt: new Date(),
        isActive: false,
      });

      // 4. Disconnect user from this client
      await this.userDAO.updateById(
        user._id.toString(),
        {
          $set: { 'cuids.$[elem].isConnected': false },
        },
        {
          arrayFilters: [{ 'elem.cuid': cuid }],
        } as any
      );

      // 5. Invalidate caches
      await this.userCache.invalidateUserDetail(cuid, uid);
      await this.userCache.invalidateUserLists(cuid);

      this.log.info('User archived successfully', {
        cuid,
        uid,
        archivedBy: currentUser.uid,
        summary: archivalSummary,
      });

      return {
        success: true,
        data: archivalSummary,
        message: t('client.success.userArchived'),
      };
    } catch (error) {
      this.log.error('Error archiving user:', {
        cuid,
        uid,
        error: error.message || error,
      });
      throw error;
    }
  }

  /**
   * Deactivate (soft delete) a tenant
   * Handles:
   * - Soft delete user with deletedAt timestamp
   * - Mark user as inactive
   * - Disconnect tenant from client
   * - Cache invalidation
   *
   * TODO: When lease/maintenance features are added:
   * - Check for active leases (prevent deactivation if active)
   * - Check for pending maintenance requests
   * - Check for pending service requests
   *
   * @param cuid - Client unique identifier
   * @param uid - User unique identifier (tenant)
   * @param context - Request context with current user
   * @returns Promise resolving to success response with deactivation summary
   */
  async deactivateTenant(
    cuid: string,
    uid: string,
    context: IRequestContext
  ): Promise<ISuccessReturnData<any>> {
    try {
      if (!cuid || !uid) {
        throw new BadRequestError({
          message: t('client.errors.missingParameters'),
        });
      }

      const user = await this.userDAO.getUserByUId(uid, {
        populate: [{ path: 'profile' }],
      });

      if (!user) {
        throw new NotFoundError({ message: t('client.errors.userNotFound') });
      }

      const clientConnection = user.cuids?.find((c: any) => c.cuid === cuid);
      if (!clientConnection) {
        throw new NotFoundError({ message: t('client.errors.userNotFoundInClient') });
      }

      const roles: string[] = clientConnection.roles || [];

      if (!roles.includes('tenant')) {
        throw new BadRequestError({
          message: 'User is not a tenant',
        });
      }

      if (!this.permissionService.canUserAccessUser(context.currentuser, user as any)) {
        throw new ForbiddenError({
          message: t('client.errors.insufficientPermissions', {
            action: 'deactivate',
            resource: 'tenant',
          }),
        });
      }

      if (uid === context.currentuser.uid) {
        throw new BadRequestError({
          message: 'Cannot deactivate yourself',
        });
      }

      const deactivationSummary: any = {
        uid,
        deactivatedAt: new Date(),
        deactivatedBy: context.currentuser.uid,
        actions: [],
      };

      // TODO: Check for active leases when lease feature is implemented
      // const activeLeases = await this.leaseDAO.getActiveLeasesByTenant(uid);
      // if (activeLeases.length > 0) {
      //   throw new BadRequestError({
      //     message: 'Cannot deactivate tenant with active leases',
      //   });
      // }

      // 1. Soft delete the user
      await this.userDAO.updateById(user._id.toString(), {
        deletedAt: new Date(),
        isActive: false,
      });

      deactivationSummary.actions.push({
        action: 'user_soft_deleted',
        timestamp: new Date(),
      });

      // 2. Disconnect tenant from this client
      await this.userDAO.updateById(
        user._id.toString(),
        {
          $set: { 'cuids.$[elem].isConnected': false },
        },
        {
          arrayFilters: [{ 'elem.cuid': cuid }],
        } as any
      );

      deactivationSummary.actions.push({
        action: 'tenant_disconnected_from_client',
        cuid,
        timestamp: new Date(),
      });

      // 3. Invalidate caches
      await this.userCache.invalidateUserDetail(cuid, uid);
      await this.userCache.invalidateUserLists(cuid);

      this.log.info('Tenant deactivated successfully', {
        cuid,
        uid,
        deactivatedBy: context.currentuser.uid,
        summary: deactivationSummary,
      });

      return {
        success: true,
        data: deactivationSummary,
        message: 'Tenant deactivated successfully',
      };
    } catch (error) {
      this.log.error('Error deactivating tenant:', {
        cuid,
        uid,
        error: error.message || error,
      });
      throw error;
    }
  }
}
