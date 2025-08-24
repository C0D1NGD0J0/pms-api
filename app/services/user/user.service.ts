import Logger from 'bunyan';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { UserCache } from '@caching/user.cache';
import { PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { IFindOptions } from '@dao/interfaces/baseDAO.interface';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';
import { PermissionService } from '@services/permission/permission.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors/index';
import { ISuccessReturnData, IRequestContext, PaginateResult } from '@interfaces/utils.interface';
import {
  FilteredUserTableData,
  IUserRoleType,
  IUserStats,
  IUserRole,
} from '@interfaces/user.interface';

interface IConstructor {
  permissionService: PermissionService;
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

  constructor({ clientDAO, userDAO, propertyDAO, userCache, permissionService }: IConstructor) {
    this.log = createLogger('UserService');
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.propertyDAO = propertyDAO;
    this.userCache = userCache;
    this.permissionService = permissionService;
  }

  async getClientUserInfo(cxt: IRequestContext, uid: string): Promise<ISuccessReturnData<any>> {
    const currentuser = cxt.currentuser!;
    const clientId = cxt.request.params.cuid || currentuser.client.cuid;

    try {
      const user = await this.userDAO.getUserByUId(uid, {
        populate: [
          {
            path: 'profile',
            select: 'personalInfo employeeInfo vendorInfo contactInfo preferences',
          },
        ],
      });

      if (!user) {
        throw new NotFoundError({ message: t('client.errors.userNotFound') });
      }

      // user data for permission check
      const targetUser = {
        _id: user._id,
        uid: user.uid,
        activecuid: user.activecuid,
        cuids: user.cuids,
        profile: user.profile,
      };

      // if current user has permission to access this user's data
      if (!this.permissionService.canUserAccessUser(currentuser, targetUser)) {
        throw new ForbiddenError({
          message: t('client.errors.insufficientPermissions', {
            action: 'view',
            resource: 'user',
          }),
        });
      }

      // Check cache after permission check
      const cachedData = await this.userCache.getUserDetail(clientId, uid);
      if (cachedData.success && cachedData.data) {
        this.log.info('User detail retrieved from cache', { clientId, uid });
        return {
          success: true,
          data: cachedData.data,
          message: t('client.success.userRetrieved'),
        };
      }

      const clientConnection = user.cuids?.find((c: any) => c.cuid === clientId);
      if (!clientConnection || !clientConnection.isConnected) {
        throw new NotFoundError({ message: t('client.errors.userNotFound') });
      }

      // Build comprehensive user detail data
      const userDetail = await this.buildUserDetailData(user, clientConnection, clientId);

      // Cache the result for 2 hours
      await this.userCache.cacheUserDetail(clientId, uid, userDetail);
      this.log.info('User detail cached', { clientId, uid });

      return {
        success: true,
        data: userDetail,
        message: t('client.success.userRetrieved'),
      };
    } catch (error) {
      this.log.error('Error getting client user:', {
        clientId,
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

      const result = await this.userDAO.getUsersByFilteredType(cuid, filterOptions, paginationOpts);
      const users: FilteredUserTableData[] = result.items.map((user: any) => {
        const clientConnection = user.cuids?.find((c: any) => c.cuid === cuid);
        const firstName = user.profile?.personalInfo?.firstName || '';
        const lastName = user.profile?.personalInfo?.lastName || '';
        const fullName = `${firstName} ${lastName}`.trim();

        const tableUserData: FilteredUserTableData = {
          uid: user.uid,
          email: user.email,
          displayName: clientConnection?.clientDisplayName || fullName || user.email,
          fullName: fullName || undefined,
          phoneNumber: user.profile?.personalInfo?.phoneNumber || undefined,
          isActive: user.isActive,
          isConnected: clientConnection?.isConnected || false,
        };

        const roles = clientConnection?.roles || [];

        // Add minimal employee info if user is an employee
        if (roles.some((r: string) => ['manager', 'admin', 'staff'].includes(r))) {
          tableUserData.employeeInfo = {
            jobTitle: user.profile?.employeeInfo?.jobTitle || undefined,
            department: user.profile?.employeeInfo?.department || undefined,
            startDate: user.profile?.employeeInfo?.startDate || undefined,
          };
        }

        // Add minimal vendor info if user is a vendor
        if (roles.includes('vendor')) {
          const vendorProfile = user.profile?.vendorInfo || {};
          const personalInfo = user.profile?.personalInfo || {};

          tableUserData.vendorInfo = {
            companyName: vendorProfile.companyName || personalInfo.displayName || undefined,
            businessType: vendorProfile.businessType || 'General Contractor',
            serviceType: vendorProfile.businessType || 'General Contractor',
            contactPerson:
              vendorProfile.contactPerson?.name ||
              personalInfo.displayName ||
              fullName ||
              undefined,
            rating: vendorProfile?.stats?.rating ? parseFloat(vendorProfile.stats.rating) : 0,
            reviewCount: vendorProfile?.reviewCount || 0,
            completedJobs: vendorProfile?.stats?.completedJobs || 0,
            averageResponseTime: vendorProfile?.stats?.responseTime || '24h',
            averageServiceCost: vendorProfile?.averageServiceCost || 0,
            isLinkedAccount: !!clientConnection?.linkedVendorId,
            linkedVendorId: clientConnection?.linkedVendorId || undefined,
            isPrimaryVendor: !clientConnection?.linkedVendorId,
          };
        }

        // Add minimal tenant info if user is a tenant
        if (roles.includes('tenant')) {
          tableUserData.tenantInfo = {
            unitNumber: user.profile?.tenantInfo?.unitNumber || undefined,
            leaseStatus: user.profile?.tenantInfo?.leaseStatus || undefined,
            rentStatus: user.profile?.tenantInfo?.rentStatus || undefined,
          };
        }

        return tableUserData;
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
  ): Promise<ISuccessReturnData<IUserStats>> {
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

  private async buildUserDetailData(
    user: any,
    clientConnection: any,
    clientId: string
  ): Promise<any> {
    const profile = user.profile || {};
    const personalInfo = profile.personalInfo || {};
    const contactInfo = profile.contactInfo || {};

    // Determine user type and role info
    const roles = clientConnection.roles || [];
    const userType = this.determineUserType(roles);

    // Build base response structure
    const response: any = {
      // Basic user info (common for all user types)
      user: {
        uid: user.uid,
        email: user.email,
        displayName: clientConnection.clientDisplayName || '',
        roles: roles,
        isActive: user.isActive,
        createdAt: user.createdAt,
        userType: userType,
      },

      // Common profile information
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
      },

      // Common fields
      status: user.isActive ? 'Active' : 'Inactive',
      properties: [],
      tasks: [],
      documents: [],
    };

    // Add type-specific information based on userType
    switch (userType) {
      case 'employee':
        response.employeeInfo = await this.buildEmployeeInfo(
          user,
          profile,
          clientConnection,
          clientId
        );
        // Get properties for managers
        if (roles.includes('manager') || roles.includes('property_manager')) {
          response.properties = await this.getUserProperties(user._id, clientId);
        }
        break;

      case 'vendor':
        response.vendorInfo = await this.buildVendorInfo(user, profile, clientConnection, clientId);
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
    clientConnection: any,
    clientId: string
  ): Promise<any> {
    const employeeInfo = profile.employeeInfo || {};
    const contactInfo = profile.contactInfo || {};
    const roles = clientConnection.roles || [];

    // Calculate tenure
    const hireDate = employeeInfo.startDate || user.createdAt;
    const tenure = this.calculateTenure(hireDate);

    // Get minimal property data if user is property manager
    let properties = [];
    if (roles.includes('manager') || roles.includes('property_manager')) {
      properties = await this.getUserProperties(user._id, clientId);
    }

    return {
      // Employment details
      employeeId: employeeInfo.employeeId || '',
      hireDate: hireDate,
      tenure: tenure,
      employmentType: employeeInfo.employmentType || 'Full-Time',
      department: employeeInfo.department || 'operations',
      position: this.determinePrimaryRole(roles),
      directManager: employeeInfo.reportsTo || 'Sarah Wilson',

      // Skills and expertise
      skills: employeeInfo.skills || [
        'Property Management',
        'Tenant Relations',
        'Maintenance Coordination',
        'Financial Reporting',
      ],

      // Office information
      officeInfo: {
        address: contactInfo.officeAddress || '123 Main Street, Suite 100',
        city: contactInfo.officeCity || 'New York, NY 10001',
        workHours: contactInfo.workHours || 'Mon-Fri: 8AM-5PM',
      },

      // Emergency contact
      emergencyContact: employeeInfo.emergencyContact || {
        name: 'Emergency Contact',
        relationship: 'Spouse',
        phone: '+1 (555) 123-4568',
      },

      // Performance statistics
      stats: {
        propertiesManaged: properties.length,
        unitsManaged: properties.reduce((sum: number, p: any) => sum + (p.units || 0), 0),
        tasksCompleted: 47,
        onTimeRate: '98%',
        rating: '4.8',
        activeTasks: 8,
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
    user: any,
    profile: any,
    clientConnection: any,
    cuid: string
  ): Promise<any> {
    const vendorInfo = profile.vendorInfo || {};
    const _personalInfo = profile.personalInfo || {};

    // Get linked users if this is a primary vendor
    let linkedUsers: any[] = [];
    if (!clientConnection.linkedVendorId) {
      try {
        const linkedUsersResult = await this.userDAO.getLinkedVendorUsers(user.uid, cuid);
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
      // Company information
      companyName: vendorInfo.companyName || _personalInfo.displayName || '',
      businessType: vendorInfo.businessType || 'General Contractor',
      yearsInBusiness: vendorInfo.yearsInBusiness || 0,
      registrationNumber: vendorInfo.registrationNumber || '',
      taxId: vendorInfo.taxId || '',

      // Services
      servicesOffered: vendorInfo.servicesOffered || {},

      // Service areas
      serviceAreas: vendorInfo.serviceAreas || {
        baseLocation: vendorInfo.address?.fullAddress || '',
        maxDistance: 25,
      },

      // Insurance
      insuranceInfo: vendorInfo.insuranceInfo || {
        provider: '',
        policyNumber: '',
        expirationDate: null,
        coverageAmount: 0,
      },

      // Contact person
      contactPerson: vendorInfo.contactPerson || {
        name: _personalInfo.displayName || '',
        jobTitle: 'Owner',
        email: user.email,
        phone: _personalInfo.phoneNumber || '',
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
      isLinkedAccount: !!clientConnection.linkedVendorId,
      linkedVendorId: clientConnection.linkedVendorId || null,
      isPrimaryVendor: !clientConnection.linkedVendorId,

      // Linked users (only for primary vendors)
      linkedUsers: linkedUsers.length > 0 ? linkedUsers : undefined,
    };
  }

  private async buildTenantInfo(): Promise<any> {
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
    if (clientConnection.linkedVendorId) {
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
      property_manager: 'Property Manager',
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

  private determineUserType(roles: string[]): string {
    if (
      roles.some((r: string) =>
        ['property_manager', 'super_admin', 'manager', 'admin', 'staff'].includes(r)
      )
    ) {
      return 'employee';
    } else if (roles.includes('vendor')) {
      return 'vendor';
    } else if (roles.includes('tenant')) {
      return 'tenant';
    }
    return 'employee';
  }

  private async getUserProperties(userId: string, clientId: string): Promise<any[]> {
    try {
      // Query properties managed by this user with minimal fields
      const result = await this.propertyDAO.getPropertiesByClientId(
        clientId,
        {
          managedBy: userId,
          deletedAt: null,
        },
        {
          limit: 20, // Limit to reasonable number
        }
      );

      const properties = result.items || [];

      return properties.map((property: any) => ({
        name: property.name || '',
        location: this.formatPropertyLocation(property.location),
        units: property.totalUnits || 0,
        occupancy: `${property.occupancyRate || 0}%`,
        since: this.formatDate(property.createdAt),
      }));
    } catch (error) {
      this.log.error('Error getting user properties:', error);
      // Return empty array on error - don't fail the whole request
      return [];
    }
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
    if (roles.includes('manager') || roles.includes('admin')) {
      tags.push('Top Performer');
    }

    // Certifications (placeholder)
    if (employeeInfo.certifications && employeeInfo.certifications.length > 0) {
      tags.push('Certified');
    } else {
      tags.push('Certified'); // Default for demo
    }

    // Access levels (placeholder)
    if (roles.includes('manager')) {
      tags.push('Master Key Access');
      tags.push('Company Vehicle');
    }

    return tags;
  }
}
