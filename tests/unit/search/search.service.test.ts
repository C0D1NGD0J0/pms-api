import { ROLES } from '@shared/constants/roles.constants';
import { SearchService } from '@services/search/search.service';
import { PermissionService } from '@services/permission/permission.service';
import { PermissionResource, IRequestContext } from '@interfaces/utils.interface';

const cuid = 'CLIENT_SEARCH_CUID';

const makeContext = (role: string, department?: string): IRequestContext =>
  ({
    currentuser: {
      sub: '507f1f77bcf86cd799439011',
      client: { cuid, role },
      employeeInfo: department ? { department } : undefined,
    },
    request: { params: { cuid }, query: {} },
  }) as unknown as IRequestContext;

const createMocks = () => ({
  permissionService: {
    checkPermission: jest.fn().mockResolvedValue({ granted: true }),
  },
  propertyService: {
    getClientProperties: jest.fn().mockResolvedValue({
      success: true,
      data: {
        items: [{ pid: 'PID1', name: 'Maple Court', address: { fullAddress: '1 Maple St' } }],
      },
    }),
  },
  userService: {
    getFilteredUsers: jest.fn().mockResolvedValue({
      success: true,
      data: {
        items: [
          { uid: 'UID1', email: 'jane@example.com', fullName: 'Jane Doe' },
          { uid: 'UID2', email: 'noname@example.com' },
        ],
      },
    }),
  },
  leaseService: {
    getFilteredLeases: jest.fn().mockResolvedValue({
      items: [
        { luid: 'LUID1', leaseNumber: 'LS-001', propertyAddress: '1 Maple St', status: 'active' },
      ],
    }),
  },
  maintenanceRequestService: {
    listRequests: jest.fn().mockResolvedValue({
      success: true,
      data: { items: [{ mruid: 'MR-001', title: 'Leaky sink', status: 'open' }] },
    }),
  },
});

const buildService = (mocks: ReturnType<typeof createMocks>) =>
  new SearchService(mocks as unknown as ConstructorParameters<typeof SearchService>[0]);

describe('SearchService.globalSearch', () => {
  let mocks: ReturnType<typeof createMocks>;
  let service: SearchService;

  beforeEach(() => {
    mocks = createMocks();
    service = buildService(mocks);
  });

  it('maps every record type to the flat result shape', async () => {
    const result = await service.globalSearch(cuid, makeContext(ROLES.MANAGER), 'maple');

    expect(result.data.results).toEqual([
      { type: 'property', id: 'PID1', title: 'Maple Court', subtitle: '1 Maple St' },
      { type: 'tenant', id: 'UID1', title: 'Jane Doe', subtitle: 'jane@example.com' },
      { type: 'tenant', id: 'UID2', title: 'noname@example.com', subtitle: 'noname@example.com' },
      {
        type: 'lease',
        id: 'LUID1',
        title: 'LS-001',
        subtitle: '1 Maple St',
        status: 'active',
      },
      {
        type: 'serviceRequest',
        id: 'MR-001',
        title: 'Leaky sink',
        subtitle: 'MR-001',
        status: 'open',
      },
    ]);
  });

  it('passes the trimmed term and a limit of 5 to every existing lookup', async () => {
    const context = makeContext(ROLES.MANAGER);
    await service.globalSearch(cuid, context, '  maple  ');

    expect(mocks.propertyService.getClientProperties).toHaveBeenCalledWith(
      cuid,
      context.currentuser,
      { filters: { searchTerm: 'maple' }, pagination: { page: 1, limit: 5 } }
    );
    expect(mocks.userService.getFilteredUsers).toHaveBeenCalledWith(
      cuid,
      { role: ['tenant'], search: 'maple' },
      { limit: 5, skip: 0 }
    );
    expect(mocks.leaseService.getFilteredLeases).toHaveBeenCalledWith(
      cuid,
      { search: 'maple' },
      { page: 1, limit: 5 },
      context
    );
    expect(mocks.maintenanceRequestService.listRequests).toHaveBeenCalledWith(
      context,
      { search: 'maple' },
      { page: 1, limit: 5 }
    );
  });

  it('skips record types the caller cannot list', async () => {
    mocks.permissionService.checkPermission.mockImplementation(async ({ resource }) => ({
      granted: resource !== PermissionResource.USER && resource !== PermissionResource.LEASE,
    }));

    const result = await service.globalSearch(cuid, makeContext(ROLES.STAFF), 'maple');

    expect(mocks.userService.getFilteredUsers).not.toHaveBeenCalled();
    expect(mocks.leaseService.getFilteredLeases).not.toHaveBeenCalled();
    expect(result.data.results.map((r) => r.type)).toEqual(['property', 'serviceRequest']);
  });

  it('checks LIST permission with the caller role, department and client context', async () => {
    await service.globalSearch(cuid, makeContext(ROLES.STAFF, 'operations'), 'maple');

    expect(mocks.permissionService.checkPermission).toHaveBeenCalledTimes(4);
    expect(mocks.permissionService.checkPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        role: ROLES.STAFF,
        department: 'operations',
        resource: PermissionResource.PROPERTY,
        action: 'list',
        context: expect.objectContaining({ clientId: cuid }),
      })
    );
  });

  it('drops only the failed record type and returns the rest', async () => {
    mocks.leaseService.getFilteredLeases.mockRejectedValue(new Error('lease lookup failed'));

    const result = await service.globalSearch(cuid, makeContext(ROLES.MANAGER), 'maple');

    const types = result.data.results.map((r) => r.type);
    expect(types).not.toContain('lease');
    expect(types).toEqual(['property', 'tenant', 'tenant', 'serviceRequest']);
  });

  it('returns no results and makes no lookups for a term under 2 characters', async () => {
    const result = await service.globalSearch(cuid, makeContext(ROLES.MANAGER), ' a ');

    expect(result).toEqual(expect.objectContaining({ success: true, data: { results: [] } }));
    expect(mocks.permissionService.checkPermission).not.toHaveBeenCalled();
    expect(mocks.propertyService.getClientProperties).not.toHaveBeenCalled();
  });

  it('with real permissions, base staff do not search tenants and tenants search nothing', async () => {
    const realPermissionMocks = { ...mocks, permissionService: new PermissionService() };
    const realService = buildService(realPermissionMocks as any);

    const staffResult = await realService.globalSearch(cuid, makeContext(ROLES.STAFF), 'maple');
    expect(mocks.userService.getFilteredUsers).not.toHaveBeenCalled();
    expect(staffResult.data.results.map((r) => r.type)).toEqual([
      'property',
      'lease',
      'serviceRequest',
    ]);

    jest.clearAllMocks();
    const tenantResult = await realService.globalSearch(cuid, makeContext(ROLES.TENANT), 'maple');
    expect(tenantResult.data.results).toEqual([]);
    expect(mocks.propertyService.getClientProperties).not.toHaveBeenCalled();
  });
});
