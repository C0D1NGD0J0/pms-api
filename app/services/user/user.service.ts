import Logger from 'bunyan';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { UserCache } from '@caching/user.cache';
import { PropertyDAO, ClientDAO, UserDAO } from '@dao/index';
import { IFindOptions } from '@dao/interfaces/baseDAO.interface';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors/index';
import { ISuccessReturnData, IRequestContext, PaginateResult } from '@interfaces/utils.interface';
import { IUserRoleType, ICurrentUser, FilteredUser, IUserRole } from '@interfaces/user.interface';

interface IConstructor {
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

  constructor({ clientDAO, userDAO, propertyDAO, userCache }: IConstructor) {
    this.log = createLogger('UserService');
    this.clientDAO = clientDAO;
    this.userDAO = userDAO;
    this.propertyDAO = propertyDAO;
    this.userCache = userCache;
  }

  async getClientUser(cxt: IRequestContext, uid: string): Promise<ISuccessReturnData<any>> {
    const currentuser = cxt.currentuser!;
    const clientId = cxt.request.params.cuid || currentuser.client.cuid;

    try {
      // Check cache first
      const cachedData = await this.userCache.getUserDetail(clientId, uid);
      if (cachedData.success && cachedData.data) {
        this.log.info('User detail retrieved from cache', { clientId, uid });
        return {
          success: true,
          data: cachedData.data,
          message: t('client.success.userRetrieved'),
        };
      }

      // Fetch user with comprehensive population
      const user = await this.userDAO.getUserById(uid, {
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

      // Find client connection
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

  /**
   * Build comprehensive user detail data for the frontend
   */
  private async buildUserDetailData(
    user: any,
    clientConnection: any,
    clientId: string
  ): Promise<any> {
    const profile = user.profile || {};
    const personalInfo = profile.personalInfo || {};
    const employeeInfo = profile.employeeInfo || {};
    // const vendorInfo = profile.vendorInfo || {};
    const contactInfo = profile.contactInfo || {};

    // Calculate tenure
    const hireDate = employeeInfo.hireDate || user.createdAt;
    const tenure = this.calculateTenure(hireDate);

    // Determine user type and role info
    const roles = clientConnection.roles || [];
    const primaryRole = this.determinePrimaryRole(roles);
    const userType = this.determineUserType(roles);

    // Get minimal property data if user is property manager
    let properties = [];
    if (roles.includes('manager') || roles.includes('property_manager')) {
      properties = await this.getUserProperties(user._id, clientId);
    }

    // Build the comprehensive response
    return {
      // Basic user info
      user: {
        uid: user.uid,
        email: user.email,
        displayName: clientConnection.displayName || '',
        roles: roles,
        isActive: user.isActive,
        createdAt: user.createdAt,
        userType: userType,
      },

      // Profile information
      profile: {
        firstName: personalInfo.firstName || '',
        lastName: personalInfo.lastName || '',
        fullName: `${personalInfo.firstName || ''} ${personalInfo.lastName || ''}`.trim(),
        avatar: personalInfo.avatar || '',
        phoneNumber: personalInfo.phoneNumber || contactInfo.phoneNumber || '',
        email: user.email,

        // Employment details
        employeeId: employeeInfo.employeeId || '',
        hireDate: hireDate,
        tenure: tenure,
        employmentType: employeeInfo.employmentType || 'Full-Time',
        department: employeeInfo.department || 'Operations',
        position: primaryRole,

        // Manager info (placeholder)
        directManager: employeeInfo.directManager || 'Sarah Wilson',

        // Skills and expertise (placeholder)
        skills: employeeInfo.skills || [
          'Property Management',
          'Tenant Relations',
          'Maintenance Coordination',
          'Financial Reporting',
        ],

        // About section (placeholder)
        about:
          employeeInfo.about ||
          `${personalInfo.firstName || 'Employee'} is a dedicated team member with expertise in property management and customer service.`,

        // Contact information
        contact: {
          phone: personalInfo.phoneNumber || contactInfo.phoneNumber || '',
          email: user.email,
          officeAddress: contactInfo.officeAddress || '123 Main Street, Suite 100',
          officeCity: contactInfo.officeCity || 'New York, NY 10001',
          workHours: contactInfo.workHours || 'Mon-Fri: 8AM-5PM',
        },

        // Emergency contact (placeholder)
        emergencyContact: employeeInfo.emergencyContact || {
          name: 'Emergency Contact',
          relationship: 'Spouse',
          phone: '+1 (555) 123-4568',
        },
      },

      // Performance statistics (placeholders)
      stats: {
        propertiesManaged: properties.length,
        unitsManaged: properties.reduce((sum: number, p: any) => sum + (p.units || 0), 0),
        tasksCompleted: 47,
        onTimeRate: '98%',
        rating: '4.8',
        activeTasks: 8,
      },

      // Minimal property data for table display
      properties: properties,

      // Placeholders for unimplemented features
      tasks: [], // Active tasks/tickets
      documents: [], // Certifications and documents
      performance: {
        // Performance metrics
        taskCompletionRate: '98%',
        tenantSatisfaction: '4.8/5',
        avgOccupancyRate: '92%',
        avgResponseTime: '12h',
      },

      // Employment tags/badges
      tags: this.generateEmployeeTags(employeeInfo, roles),

      // Status
      status: user.isActive ? 'Active' : 'Inactive',
    };
  }

  /**
   * Calculate tenure from hire date
   */
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

  /**
   * Determine primary role for display
   */
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

  /**
   * Determine user type (employee, vendor, tenant)
   */
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

  /**
   * Get minimal property data for properties managed by user
   */
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

  /**
   * Format property location for display
   */
  private formatPropertyLocation(location: any): string {
    if (!location) return 'Location not specified';

    const parts = [];
    if (location.address) parts.push(location.address);
    if (location.city) parts.push(location.city);
    if (location.state) parts.push(location.state);

    return parts.length > 0 ? parts.join(', ') : 'Location not specified';
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date): string {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
    });
  }

  /**
   * Generate employee tags/badges
   */
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
