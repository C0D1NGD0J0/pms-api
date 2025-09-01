import Logger from 'bunyan';
import { t } from '@shared/languages';
import { UserDAO } from '@dao/userDAO';
import { VendorDAO } from '@dao/vendorDAO';
import { ClientDAO } from '@dao/clientDAO';
import { createLogger } from '@utils/index';
import { ClientSession, Types } from 'mongoose';
import { VendorCache } from '@caching/vendor.cache';
import { PermissionService } from '@services/permission';
import { IFindOptions } from '@dao/interfaces/baseDAO.interface';
import { IVendorFilterOptions } from '@dao/interfaces/vendorDAO.interface';
import { IVendorDocument, NewVendor, IVendor } from '@interfaces/vendor.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors/index';
import { ISuccessReturnData, IRequestContext, PaginateResult } from '@interfaces/utils.interface';
import {
  FilteredUserTableData,
  IUserDetailResponse,
  IVendorDetailInfo,
  IVendorTeamMember,
  IUserRole,
} from '@interfaces/user.interface';
interface IConstructor {
  permissionService: PermissionService;
  vendorCache: VendorCache;
  vendorDAO: VendorDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class VendorService {
  private logger: Logger;
  private userDAO: UserDAO;
  private vendorDAO: VendorDAO;
  private clientDAO: ClientDAO;
  private vendorCache: VendorCache;
  private permissionService: PermissionService;

  constructor({ vendorDAO, userDAO, clientDAO, vendorCache, permissionService }: IConstructor) {
    this.vendorDAO = vendorDAO;
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.vendorCache = vendorCache;
    this.permissionService = permissionService;
    this.logger = createLogger('VendorService');
  }

  async createVendor(
    vendorData: NewVendor,
    session?: ClientSession,
    linkedVendorUid?: string
  ): Promise<ISuccessReturnData<IVendorDocument>> {
    try {
      if (!vendorData.companyName) {
        throw new BadRequestError({
          message: 'Company name is required',
        });
      }

      if (!vendorData.connectedClients || vendorData.connectedClients.length === 0) {
        throw new BadRequestError({
          message: 'Connected clients information is required',
        });
      }

      // Validate unique client connections within the provided data
      const cuids = vendorData.connectedClients.map((client) => client.cuid);
      const uniqueCuids = [...new Set(cuids)];
      if (cuids.length !== uniqueCuids.length) {
        throw new BadRequestError({
          message: 'Duplicate client connections are not allowed',
        });
      }

      // Check for existing vendor with priority order:
      // 1. linkedVendorUid (if provided from CSV)
      // 2. Registration number (exact match)
      // 3. Company name (fallback)
      let existingVendor = null;

      if (linkedVendorUid && linkedVendorUid.trim()) {
        try {
          existingVendor = await this.vendorDAO.getVendorById(linkedVendorUid.trim());
        } catch (error) {
          this.logger.warn(
            `linkedVendorUid ${linkedVendorUid} not found, falling back to other methods`
          );
        }
      }

      if (
        !existingVendor &&
        vendorData.registrationNumber &&
        vendorData.registrationNumber.trim()
      ) {
        existingVendor = await this.vendorDAO.findByRegistrationNumber(
          vendorData.registrationNumber.trim()
        );
      }

      if (!existingVendor && vendorData.companyName && vendorData.companyName.trim()) {
        existingVendor = await this.vendorDAO.findByCompanyName(vendorData.companyName.trim());
      }

      if (existingVendor) {
        // Validate data consistency if linkedVendorUid was used to find the vendor
        if (linkedVendorUid && linkedVendorUid.trim() === existingVendor._id?.toString()) {
          const conflicts = [];

          // Check for company name mismatch
          if (
            vendorData.companyName &&
            vendorData.companyName.trim().toLowerCase() !==
              existingVendor.companyName?.toLowerCase()
          ) {
            conflicts.push(
              `Company name mismatch: expected "${existingVendor.companyName}", got "${vendorData.companyName}"`
            );
          }

          // Check for registration number mismatch (if both are provided)
          if (
            vendorData.registrationNumber &&
            existingVendor.registrationNumber &&
            vendorData.registrationNumber.trim() !== existingVendor.registrationNumber.trim()
          ) {
            conflicts.push(
              `Registration number mismatch: expected "${existingVendor.registrationNumber}", got "${vendorData.registrationNumber}"`
            );
          }

          if (conflicts.length > 0) {
            this.logger.warn(
              `Vendor data conflicts for linkedVendorUid ${linkedVendorUid}: ${conflicts.join(', ')}`
            );
            // For now, we'll log the warning but still proceed with linking
            // In the future, this could be configurable to either throw an error or update the data
          }
        }

        // Add new client connections, avoiding duplicates
        const newConnections = vendorData.connectedClients.filter(
          (newClient) =>
            !existingVendor.connectedClients.some((existing) => existing.cuid === newClient.cuid)
        );

        if (newConnections.length > 0) {
          existingVendor.connectedClients.push(...newConnections);
          await this.vendorDAO.updateVendor(existingVendor._id, existingVendor, session);
        }

        return {
          success: true,
          data: existingVendor,
          message: 'Vendor connection updated successfully',
        };
      }

      const vendor = await this.vendorDAO.createVendor(vendorData, session);

      this.logger.info(
        `Vendor created successfully: ${vendor.vuid} for user ${vendorData.companyName}`
      );

      return {
        success: true,
        data: vendor,
        message: 'Vendor created successfully',
      };
    } catch (error) {
      this.logger.error(`Error creating vendor: ${error}`);
      throw error;
    }
  }

  async getVendorByUserId(userId: string): Promise<IVendorDocument | null> {
    try {
      return await this.vendorDAO.getVendorByPrimaryAccountHolder(userId);
    } catch (error) {
      this.logger.error(`Error getting vendor for user ${userId}: ${error}`);
      throw error;
    }
  }

  async updateVendorInfo(
    vendorId: string,
    updateData: Partial<IVendor>,
    session?: ClientSession
  ): Promise<ISuccessReturnData<IVendorDocument>> {
    try {
      const vendor = await this.vendorDAO.updateVendor(vendorId, updateData, session);

      if (!vendor) {
        throw new NotFoundError({
          message: 'Vendor not found',
        });
      }

      this.logger.info(`Vendor updated successfully: ${vendor.vuid}`);

      return {
        success: true,
        data: vendor,
        message: 'Vendor information updated successfully',
      };
    } catch (error) {
      this.logger.error(`Error updating vendor ${vendorId}: ${error}`);
      throw error;
    }
  }

  async getClientVendors(cuid: string): Promise<IVendorDocument[]> {
    try {
      return await this.vendorDAO.getClientVendors(cuid);
    } catch (error) {
      this.logger.error(`Error getting client vendors for ${cuid}: ${error}`);
      throw error;
    }
  }

  async getVendorById(vendorId: string): Promise<IVendorDocument | null> {
    try {
      return await this.vendorDAO.getVendorById(vendorId);
    } catch (error) {
      this.logger.error(`Error getting vendor ${vendorId}: ${error}`);
      throw error;
    }
  }

  async createVendorFromCompanyProfile(
    cuid: string,
    primaryAccountHolder: string,
    companyProfile: any
  ): Promise<IVendorDocument> {
    try {
      const vendorData: NewVendor = {
        isPrimaryAccountHolder: true,
        connectedClients: [
          {
            cuid,
            isConnected: true,
            primaryAccountHolder: new Types.ObjectId(primaryAccountHolder),
          },
        ],
        companyName: companyProfile.legalEntityName || companyProfile.companyName,
        businessType: companyProfile.businessType || 'professional_services',
        registrationNumber: companyProfile.registrationNumber,
        taxId: companyProfile.taxId,
        address: companyProfile.address
          ? {
              fullAddress: companyProfile.address.fullAddress,
              street: companyProfile.address.street,
              city: companyProfile.address.city,
              state: companyProfile.address.state,
              country: companyProfile.address.country,
              postCode: companyProfile.address.postCode,
              computedLocation: {
                type: 'Point',
                coordinates: companyProfile.address.coordinates || [0, 0],
              },
            }
          : undefined,
        contactPerson: companyProfile.contactPerson
          ? {
              name: companyProfile.contactPerson.name,
              jobTitle: companyProfile.contactPerson.jobTitle || 'Owner',
              email: companyProfile.contactPerson.email,
              phone: companyProfile.contactPerson.phone,
            }
          : undefined,
      };

      const result = await this.createVendor(vendorData);
      return result.data!;
    } catch (error) {
      this.logger.error(`Error creating vendor from company profile: ${error}`);
      throw error;
    }
  }

  async getFilteredVendors(
    cuid: string,
    filterOptions: IVendorFilterOptions,
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

      const cachedResult = await this.vendorCache.getFilteredVendors(
        cuid,
        filterOptions,
        paginationOpts
      );
      if (cachedResult.success && cachedResult.data) {
        this.logger.info('Filtered vendors retrieved from cache', { cuid, filterOptions });
        return {
          success: true,
          data: {
            items: cachedResult.data.items,
            pagination: cachedResult.data.pagination,
          },
          message: t('client.success.filteredUsersRetrieved'),
        };
      }

      // Use the optimized DAO method for filtering and pagination
      const result = await this.vendorDAO.getFilteredVendors(cuid, filterOptions, paginationOpts);

      // Map vendor documents to FilteredUserTableData format for consistency
      const vendorTableData: FilteredUserTableData[] = await Promise.all(
        result.items.map(async (vendor: IVendorDocument) => {
          const clientVendorConnection = vendor.connectedClients.find((cc) => cc.cuid === cuid);

          // Get user data for the primary account holder
          const user = await this.userDAO.getUserById(
            clientVendorConnection!.primaryAccountHolder.toString(),
            { populate: 'profile' }
          );

          const firstName = user?.profile?.personalInfo?.firstName || '';
          const lastName = user?.profile?.personalInfo?.lastName || '';
          const fullName = `${firstName} ${lastName}`.trim();
          const userClientConnection = user?.cuids?.find((c: any) => c.cuid === cuid);

          return {
            uid: user?.uid || '',
            email: user?.email || '',
            isActive: user?.isActive || false,
            fullName: fullName || undefined,
            displayName: fullName || user?.email || vendor.companyName || 'Unknown User',
            isConnected: clientVendorConnection?.isConnected || false,
            phoneNumber: user?.profile?.personalInfo?.phoneNumber || undefined,
            vendorInfo: {
              vuid: vendor.vuid || '',
              companyName: vendor.companyName || 'Unknown Company',
              businessType: vendor.businessType || 'General Contractor',
              serviceType: vendor.businessType || 'General Contractor',
              contactPerson: vendor.contactPerson?.name || fullName || undefined,
              rating: 0, // TODO: Calculate from reviews when available
              reviewCount: 0, // TODO: Get from reviews when available
              completedJobs: 0, // TODO: Get from completed work orders when available
              averageResponseTime: '24h', // TODO: Calculate from historical data
              averageServiceCost: 0, // TODO: Calculate from completed jobs
              isLinkedAccount: !!userClientConnection?.linkedVendorUid,
              linkedVendorUid: userClientConnection?.linkedVendorUid || '',
              isPrimaryVendor: !userClientConnection?.linkedVendorUid,
            },
          };
        })
      );

      await this.vendorCache.saveFilteredVendors(cuid, vendorTableData, {
        filters: filterOptions,
        pagination: paginationOpts,
      });

      return {
        success: true,
        data: {
          items: vendorTableData,
          pagination: result.pagination!,
        },
        message: t('client.success.filteredUsersRetrieved'),
      };
    } catch (error) {
      this.logger.error('Error getting filtered vendors:', {
        cuid,
        filterOptions,
        error: error.message || error,
      });
      throw error;
    }
  }

  async getVendorTeamMembers(
    cxt: IRequestContext,
    cuid: string,
    vuid: string,
    status?: 'active' | 'inactive',
    paginationOpts?: any
  ): Promise<
    ISuccessReturnData<{
      items: IVendorTeamMember[];
      pagination: PaginateResult | undefined;
    }>
  > {
    const currentuser = cxt.currentuser!;

    try {
      if (!cuid) {
        throw new BadRequestError({ message: t('client.errors.clientIdRequired') });
      }

      const vendor = await this.vendorDAO.findFirst({ vuid });
      if (!vendor) {
        throw new NotFoundError({ message: t('vendor.errors.notFound') });
      }

      // Check if the vendor is associated with this client
      const vendorConnection = vendor.connectedClients?.find((c: any) => c.cuid === cuid);
      if (!vendorConnection || !vendorConnection.isConnected) {
        throw new NotFoundError({ message: t('vendor.errors.notAssociatedWithClient') });
      }

      const allowedRoles = [IUserRole.MANAGER, IUserRole.ADMIN].includes(
        currentuser.client.role as IUserRole
      );
      const isPrimaryVendor =
        vendorConnection.primaryAccountHolder.toString() === currentuser.sub.toString();

      if (!allowedRoles && !isPrimaryVendor) {
        throw new ForbiddenError({
          message: t('client.errors.insufficientPermissions', {
            action: 'view',
            resource: 'vendor team members',
          }),
        });
      }

      // Check permissions
      if (!this.permissionService.canUserAccessVendors(currentuser, vendor)) {
        throw new ForbiddenError({
          message: t('client.errors.insufficientPermissions', {
            action: 'view',
            resource: 'vendor team',
          }),
        });
      }

      // Fetch linked vendor users
      const linkedUsersResult = await this.userDAO.getLinkedVendorUsers(vendor.vuid, cuid, {
        ...paginationOpts,
        populate: [{ path: 'profile', select: 'personalInfo contactInfo' }],
      });

      // Filter by status if provided
      let teamMembers = linkedUsersResult.items;
      if (status !== undefined) {
        teamMembers = teamMembers.filter((user: any) =>
          status === 'active' ? user.isActive : !user.isActive
        );
      }

      // Format the response
      const formattedMembers: IVendorTeamMember[] = teamMembers.map((member: any) => {
        const personalInfo = member.profile?.personalInfo || {};
        const contactInfo = member.profile?.contactInfo || {};
        const memberConnection = member.cuids?.find((c: any) => c.cuid === cuid);

        return {
          uid: member.uid,
          email: member.email,
          displayName:
            memberConnection?.clientDisplayName ||
            `${personalInfo.firstName || ''} ${personalInfo.lastName || ''}`.trim() ||
            member.email,
          firstName: personalInfo.firstName || '',
          lastName: personalInfo.lastName || '',
          phoneNumber: personalInfo.phoneNumber || contactInfo.phoneNumber || '',
          isActive: member.isActive,
          role: memberConnection?.role || 'Team Member',
          joinedDate: member.createdAt,
          isTeamMember: true,
          lastLogin: member.lastLogin || null,
        };
      });

      // Get vendor entity and profile info for context
      const vendorEntity = await this.getVendorByUserId(
        vendorConnection.primaryAccountHolder.toString()
      );

      // Get the primary account holder user for additional profile data
      const primaryUser = await this.userDAO.getUserById(
        vendorConnection.primaryAccountHolder.toString(),
        { populate: 'profile' }
      );

      const vendorProfile = (primaryUser?.profile as any) || {};
      const _vendorInfo = {
        vendorId: vendor.vuid,
        companyName:
          vendorEntity?.companyName ||
          vendorProfile.personalInfo?.displayName ||
          primaryUser?.email ||
          'Unknown Company',
        primaryContact:
          vendorEntity?.contactPerson?.name ||
          vendorProfile.personalInfo?.displayName ||
          `${vendorProfile.personalInfo?.firstName || ''} ${vendorProfile.personalInfo?.lastName || ''}`.trim() ||
          primaryUser?.email ||
          'Unknown Contact',
      };

      return {
        success: true,
        data: {
          items: formattedMembers,
          pagination: linkedUsersResult.pagination,
        },
        message: t('vendor.success.teamMembersRetrieved'),
      };
    } catch (error) {
      this.logger.error('Error getting vendor team members:', {
        cuid,
        vendorId: vuid,
        error: error.message || error,
      });
      throw error;
    }
  }

  async getVendorInfo(
    cuid: string,
    vuid: string
  ): Promise<ISuccessReturnData<IUserDetailResponse | null>> {
    try {
      if (!cuid || !vuid) {
        throw new BadRequestError({ message: 'Client ID and Vendor UID are required' });
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      const vendor = await this.vendorDAO.getVendorByVuid(vuid);
      if (!vendor) {
        throw new NotFoundError({ message: 'Vendor not found' });
      }

      // Check if vendor is connected to this client
      const clientConnection = vendor.connectedClients.find((cc) => cc.cuid === cuid);
      if (!clientConnection) {
        throw new NotFoundError({ message: 'Vendor not connected to this client' });
      }

      // Get user data for the primary account holder with profile populated
      const user = await this.userDAO.getUserById(
        clientConnection.primaryAccountHolder.toString(),
        { populate: 'profile' }
      );
      if (!user) {
        throw new NotFoundError({ message: 'Vendor user account not found' });
      }

      const profile = user.profile;
      const firstName = profile?.personalInfo?.firstName || '';
      const lastName = profile?.personalInfo?.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim();
      const userClientConnection = user.cuids?.find((c: any) => c.cuid === cuid);
      const _personalInfo = profile?.personalInfo || {};

      // Extract roles from client connection
      const roles = userClientConnection?.roles || [];

      // Get linked users if this is a primary vendor
      let linkedUsers: any[] = [];
      if (!userClientConnection?.linkedVendorUid) {
        try {
          const linkedUsersResult = await this.userDAO.getLinkedVendorUsers(
            user._id.toString(),
            cuid
          );
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
          this.logger.error('Error fetching linked vendor users:', error);
          linkedUsers = [];
        }
      }

      // Build the vendor detail info (nested in vendorInfo property)
      const vendorDetailInfo: IVendorDetailInfo = {
        companyName: vendor?.companyName || (_personalInfo as any).displayName || fullName || '',
        businessType: vendor?.businessType || 'General Contractor',
        yearsInBusiness: vendor?.yearsInBusiness || 0,
        registrationNumber: vendor?.registrationNumber || '',
        taxId: vendor?.taxId || '',

        // Services
        servicesOffered: vendor?.servicesOffered || {},

        // Service areas - baseLocation should be a string
        serviceAreas: {
          baseLocation:
            vendor?.serviceAreas?.baseLocation?.address || vendor?.address?.fullAddress || '',
          maxDistance: vendor?.serviceAreas?.maxDistance || 25,
        },

        // Insurance - all fields must have values (not undefined)
        insuranceInfo: {
          provider: vendor?.insuranceInfo?.provider || '',
          policyNumber: vendor?.insuranceInfo?.policyNumber || '',
          expirationDate: vendor?.insuranceInfo?.expirationDate || null,
          coverageAmount: vendor?.insuranceInfo?.coverageAmount || 0,
        },

        // Contact person - all fields must have values (not undefined)
        contactPerson: {
          name: vendor?.contactPerson?.name || (_personalInfo as any).displayName || fullName || '',
          jobTitle: vendor?.contactPerson?.jobTitle || 'Employee',
          email: vendor?.contactPerson?.email || '',
          phone: vendor?.contactPerson?.phone || (_personalInfo as any).phoneNumber || '',
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
        tags: this.generateVendorTags(vendor, userClientConnection),

        // Linked vendor info if applicable
        isLinkedAccount: !!userClientConnection?.linkedVendorUid,
        linkedVendorUid: userClientConnection?.linkedVendorUid || null,
        isPrimaryVendor: !userClientConnection?.linkedVendorUid,

        // Linked users (only for primary vendors)
        ...(linkedUsers.length > 0 ? { linkedUsers } : {}),
      };

      const userData: IUserDetailResponse = {
        profile: {
          firstName: firstName || '',
          lastName: lastName || '',
          fullName: fullName || '',
          avatar: (_personalInfo as any).avatar?.url || '',
          phoneNumber: (_personalInfo as any).phoneNumber || '',
          email: user.email || '',
          about: (_personalInfo as any).bio || '',
          contact: {
            phone: (_personalInfo as any).phoneNumber || '',
            email: user.email || '',
          },
          roles: roles,
          userType: 'vendor' as const,
        },
        vendorInfo: vendorDetailInfo,
        status: user.isActive ? 'Active' : 'Inactive',
      };

      return {
        success: true,
        data: userData,
        message: 'Vendor retrieved successfully',
      };
    } catch (error) {
      this.logger.error('Error getting single vendor:', {
        cuid,
        vuid,
        error: error.message || error,
      });
      throw error;
    }
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

  async getVendorStats(
    cuid: string,
    filterOptions: { status?: 'active' | 'inactive' } = {}
  ): Promise<ISuccessReturnData<any>> {
    try {
      if (!cuid) {
        throw new BadRequestError({
          message: t('client.errors.clientIdRequired'),
        });
      }

      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        throw new NotFoundError({ message: t('client.errors.notFound') });
      }

      const vendorStats = await this.vendorDAO.getClientVendorStats(cuid, {
        status: filterOptions.status,
      });

      return {
        success: true,
        data: {
          businessTypeDistribution: vendorStats.businessTypeDistribution,
          servicesDistribution: vendorStats.servicesDistribution,
          totalVendors: vendorStats.totalVendors,
        },
        message: t('vendor.success.statsRetrieved'),
      };
    } catch (error) {
      this.logger.error(`Error getting vendor stats for client ${cuid}: ${error}`);
      throw error;
    }
  }
}
