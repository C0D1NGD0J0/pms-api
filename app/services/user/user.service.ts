import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { UserCache } from '@caching/user.cache';
import { VendorService } from '@services/index';
import { PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { IFindOptions } from '@dao/interfaces/baseDAO.interface';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';
import { PermissionService } from '@services/permission/permission.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors/index';
import { IUserRoleType, ROLE_GROUPS, IUserRole, ROLES } from '@shared/constants/roles.constants';
import { ISuccessReturnData, IRequestContext, PaginateResult } from '@interfaces/utils.interface';
import {
  IUserPopulatedDocument,
  FilteredUserTableData,
  IUserDetailResponse,
  IEmployeeDetailInfo,
  IVendorDetailInfo,
  ITenantDetailInfo,
  IUserProperty,
  ICurrentUser,
  IUserStats,
} from '@interfaces/user.interface';

interface IConstructor {
  permissionService: PermissionService;
  vendorService: VendorService;
  propertyDAO: PropertyDAO;
  clientDAO: ClientDAO;
  userCache: UserCache;
  userDAO: UserDAO;
}

export class UserService {
  private readonly log: Logger;
  private readonly clientDAO: ClientDAO;
  private readonly userDAO: UserDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly userCache: UserCache;
  private readonly permissionService: PermissionService;
  private readonly vendorService: VendorService;

  constructor({
    clientDAO,
    userDAO,
    propertyDAO,
    userCache,
    permissionService,
    vendorService,
  }: IConstructor) {
    this.log = createLogger('UserService');
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.propertyDAO = propertyDAO;
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
  ): Promise<ISuccessReturnData<{ items: FilteredUserTableData[]; pagination: PaginateResult }>> {
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

      const cachedResult = await this.userCache.getFilteredUsers(
        cuid,
        filterOptions,
        paginationOpts
      );
      if (cachedResult.success && cachedResult.data) {
        return {
          success: true,
          data: {
            items: cachedResult.data.items,
            pagination: cachedResult.data.pagination,
          },
          message: t('client.success.filteredUsersRetrieved'),
        };
      }

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
            phoneNumber: user.profile?.personalInfo?.phoneNumber || undefined,
          };

          const roles = clientConnection?.roles || [];

          if (roles.some((r: string) => ROLE_GROUPS.EMPLOYEE_ROLES.includes(r as any))) {
            tableUserData.employeeInfo = {
              jobTitle: user.profile?.employeeInfo?.jobTitle || undefined,
              department: user.profile?.employeeInfo?.department || undefined,
              startDate: user.profile?.employeeInfo?.startDate || undefined,
            };
          }

          // Add vendor info if user has vendor role
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

      // Cache the result for future requests
      await this.userCache.saveFilteredUsers(cuid, users, {
        filters: filterOptions,
        pagination: paginationOpts,
      });
      this.log.info('Filtered users cached', { cuid, count: users.length });

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
        about:
          personalInfo.bio ||
          `${personalInfo.firstName || 'User'} is a valued member of our community.`,
        contact: {
          phone: personalInfo.phoneNumber || contactInfo.phoneNumber || '',
          email: user.email,
        },
        roles: roles,
        uid: user.uid,
        id: user.id,
        userType: userType,
        isActive: user.isActive,
      },
      status: user.isActive ? 'Active' : 'Inactive',
      properties: [],
      tasks: [],
      documents: [],
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
        response.tenantInfo = await this.buildTenantInfo();
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

  private async buildTenantInfo(): Promise<ITenantDetailInfo> {
    // Placeholder implementation for tenant info
    // This should be expanded when tenant model is fully implemented
    return {
      leaseInfo: {
        status: 'Active',
        startDate: new Date(),
        endDate: null,
        monthlyRent: 0,
      },
      unit: {
        propertyName: '',
        unitNumber: '',
        address: '',
      },
      rentStatus: 'Current',
      paymentHistory: [],
      maintenanceRequests: [],
      documents: [],
    };
  }

  private generateVendorTags(vendorInfo: any, clientConnection: any): string[] {
    const tags = [];

    // Business type
    if (vendorInfo.businessType) {
      tags.push(vendorInfo.businessType);
    }

    // Insurance status
    if (vendorInfo.insuranceInfo?.expirationDate) {
      const expirationDate = new Date(vendorInfo.insuranceInfo.expirationDate);
      if (expirationDate > new Date()) {
        tags.push('Insured');
      }
    }

    // Years in business
    if (vendorInfo.yearsInBusiness > 5) {
      tags.push('Established');
    }

    // Linked account
    if (clientConnection.linkedVendorUid) {
      tags.push('Sub-contractor');
    } else {
      tags.push('Primary Vendor');
    }

    // Service specialties
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

  /**
   * Find user's supervisor based on employeeInfo.reportsTo
   */
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

  /**
   * Get user's display name for notifications/UI
   */
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

  /**
   * Get user's announcement targeting filters (roles and vendor association)
   * Used by notification system to determine which announcements a user should see
   */
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

      this.log.debug('Retrieved user announcement filters', {
        userId,
        cuid,
        roles,
        vendorId,
        hasLinkedVendor: !!clientConnection?.linkedVendorUid,
        isPrimaryVendor:
          roles.includes(ROLES.VENDOR as string) && !clientConnection?.linkedVendorUid,
        isStaffWithVendor: roles.includes(ROLES.STAFF as string) && !!vendorId,
      });

      return { roles, vendorId };
    } catch (error) {
      this.log.error('Error getting user announcement filters', { userId, cuid, error });
      return { roles: [] };
    }
  }

  /**
   * Update user information in the User model
   */
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
}
