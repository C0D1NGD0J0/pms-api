import Logger from 'bunyan';
import { t } from '@shared/languages';
import { UserService } from '@services/user/user.service';
import { LeaseService } from '@services/lease/lease.service';
import { SEARCH_CONSTANTS, createLogger } from '@utils/index';
import { PropertyService } from '@services/property/property.service';
import { PermissionService } from '@services/permission/permission.service';
import { IMaintenanceRequestDocument } from '@interfaces/maintenanceRequest.interface';
import { MaintenanceRequestService } from '@services/maintenanceRequest/serviceRequest.service';
import {
  GlobalSearchResultType,
  IGlobalSearchResponse,
  IGlobalSearchResult,
} from '@interfaces/search.interface';
import {
  IPromiseReturnedData,
  ISuccessReturnData,
  PermissionResource,
  PermissionAction,
  IRequestContext,
} from '@interfaces/utils.interface';

interface IConstructor {
  maintenanceRequestService: MaintenanceRequestService;
  permissionService: PermissionService;
  propertyService: PropertyService;
  leaseService: LeaseService;
  userService: UserService;
}

interface ISearchGroup {
  run: () => Promise<IGlobalSearchResult[]>;
  resource: PermissionResource;
  type: GlobalSearchResultType;
}

export class SearchService {
  private readonly maintenanceRequestService: MaintenanceRequestService;
  private readonly permissionService: PermissionService;
  private readonly propertyService: PropertyService;
  private readonly leaseService: LeaseService;
  private readonly userService: UserService;
  private readonly log: Logger;

  constructor({
    maintenanceRequestService,
    permissionService,
    propertyService,
    leaseService,
    userService,
  }: IConstructor) {
    this.maintenanceRequestService = maintenanceRequestService;
    this.permissionService = permissionService;
    this.propertyService = propertyService;
    this.leaseService = leaseService;
    this.userService = userService;
    this.log = createLogger('SearchService');
  }

  async globalSearch(
    cuid: string,
    context: IRequestContext,
    query: string
  ): IPromiseReturnedData<IGlobalSearchResponse> {
    try {
      const searchTerm = query.trim();
      if (searchTerm.length < SEARCH_CONSTANTS.MIN_TERM_LENGTH) {
        return this.buildSearchResponse([]);
      }

      const groups: ISearchGroup[] = [
        {
          type: 'property',
          resource: PermissionResource.PROPERTY,
          run: () => this.searchProperties(cuid, context, searchTerm),
        },
        {
          type: 'tenant',
          resource: PermissionResource.USER,
          run: () => this.searchTenants(cuid, searchTerm),
        },
        {
          type: 'lease',
          resource: PermissionResource.LEASE,
          run: () => this.searchLeases(cuid, context, searchTerm),
        },
        {
          type: 'serviceRequest',
          resource: PermissionResource.MAINTENANCE,
          run: () => this.searchServiceRequests(context, searchTerm),
        },
      ];

      const allowedGroups = await this.filterAllowedGroups(cuid, context, groups);
      const settled = await Promise.allSettled(allowedGroups.map((group) => group.run()));

      // One failing lookup must not hide the other record types
      const results: IGlobalSearchResult[] = [];
      settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
          results.push(...outcome.value);
          return;
        }
        this.log.error(
          { error: outcome.reason, cuid, type: allowedGroups[index].type },
          'Global search lookup failed'
        );
      });

      return this.buildSearchResponse(results);
    } catch (error) {
      this.log.error({ error, cuid }, 'Error running global search');
      throw error;
    }
  }

  private buildSearchResponse(
    results: IGlobalSearchResult[]
  ): ISuccessReturnData<IGlobalSearchResponse> {
    return {
      success: true,
      data: { results },
      message: t('common.success.retrieved', { resource: 'Search results' }),
    };
  }

  private async filterAllowedGroups(
    cuid: string,
    context: IRequestContext,
    groups: ISearchGroup[]
  ): Promise<ISearchGroup[]> {
    const { currentuser } = context;
    const checks = await Promise.all(
      groups.map((group) =>
        this.permissionService.checkPermission({
          role: currentuser.client.role,
          department: currentuser.employeeInfo?.department,
          resource: group.resource,
          action: PermissionAction.LIST,
          context: { clientId: cuid, userId: currentuser.sub },
        })
      )
    );
    return groups.filter((_group, index) => checks[index].granted);
  }

  private async searchProperties(
    cuid: string,
    context: IRequestContext,
    searchTerm: string
  ): Promise<IGlobalSearchResult[]> {
    const result = await this.propertyService.getClientProperties(cuid, context.currentuser, {
      filters: { searchTerm },
      pagination: { page: 1, limit: SEARCH_CONSTANTS.GLOBAL_LIMIT_PER_TYPE },
    });

    return (result.data?.items ?? []).map((property) => ({
      type: 'property',
      id: property.pid,
      title: property.name,
      subtitle: property.address?.fullAddress || undefined,
    }));
  }

  private async searchTenants(cuid: string, searchTerm: string): Promise<IGlobalSearchResult[]> {
    const result = await this.userService.getFilteredUsers(
      cuid,
      { role: ['tenant'], search: searchTerm },
      { limit: SEARCH_CONSTANTS.GLOBAL_LIMIT_PER_TYPE, skip: 0 }
    );

    return (result.data?.items ?? []).map((tenant) => ({
      type: 'tenant',
      id: tenant.uid,
      title: tenant.fullName || tenant.email,
      subtitle: tenant.email,
    }));
  }

  private async searchLeases(
    cuid: string,
    context: IRequestContext,
    searchTerm: string
  ): Promise<IGlobalSearchResult[]> {
    const result = await this.leaseService.getFilteredLeases(
      cuid,
      { search: searchTerm },
      { page: 1, limit: SEARCH_CONSTANTS.GLOBAL_LIMIT_PER_TYPE },
      context
    );

    return (result.items ?? []).map((lease) => ({
      type: 'lease',
      id: lease.luid,
      title: lease.leaseNumber,
      subtitle: lease.propertyAddress,
      status: lease.status,
    }));
  }

  private async searchServiceRequests(
    context: IRequestContext,
    searchTerm: string
  ): Promise<IGlobalSearchResult[]> {
    const result = await this.maintenanceRequestService.listRequests(
      context,
      { search: searchTerm },
      { page: 1, limit: SEARCH_CONSTANTS.GLOBAL_LIMIT_PER_TYPE }
    );

    return (result.data?.items ?? []).map((request: IMaintenanceRequestDocument) => ({
      type: 'serviceRequest',
      id: request.mruid,
      title: request.title,
      subtitle: request.mruid,
      status: request.status,
    }));
  }
}
