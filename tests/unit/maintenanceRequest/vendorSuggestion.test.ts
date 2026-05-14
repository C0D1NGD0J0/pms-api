import { Types } from 'mongoose';
import { jest } from '@jest/globals';
import { MaintenanceCategory } from '@interfaces/maintenanceRequest.interface';
import { MaintenanceRequestService } from '@services/maintenanceRequest/serviceRequest.service';

// ── Minimal mock factories ───────────────────────────────────────────────────

const makeVendor = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  vuid: `VN-${Math.random().toString(36).slice(2, 8)}`,
  companyName: 'Test Vendor',
  servicesOffered: {},
  ...overrides,
});

const makeStats = (overrides: Record<string, any> = {}) => ({
  total: 0,
  completed: 0,
  inProgress: 0,
  assigned: 0,
  cancelled: 0,
  avgCompletionDays: undefined,
  ...overrides,
});

// ── Service factory with injectable mocks ────────────────────────────────────

const createService = (mocks: {
  vendorDAO?: any;
  maintenanceRequestDAO?: any;
}) => {
  const defaultDAO = {
    getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [] })),
    getVendorStats: jest.fn().mockReturnValue(Promise.resolve(makeStats())),
    getVendorAvgRating: jest.fn().mockReturnValue(Promise.resolve(0)),
    getByMruid: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateById: jest.fn(),
    startSession: jest.fn(),
    withTransaction: jest.fn(),
    list: jest.fn(),
    listWithDetails: jest.fn(),
    getStats: jest.fn(),
    aggregate: jest.fn(),
    countDocuments: jest.fn(),
  };

  return new MaintenanceRequestService({
    maintenanceRequestDAO: { ...defaultDAO, ...mocks.maintenanceRequestDAO } as any,
    vendorDAO: { getClientVendors: jest.fn(), ...mocks.vendorDAO } as any,
    emitterService: { emit: jest.fn(), on: jest.fn() } as any,
    propertyUnitDAO: {} as any,
    propertyDAO: {} as any,
    emailQueue: { addToEmailQueue: jest.fn() } as any,
    invoiceDAO: {} as any,
    aiService: { categorizeMaintenanceRequest: jest.fn() } as any,
    leaseDAO: {} as any,
    userDAO: {} as any,
  });
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MaintenanceRequestService.suggestVendor', () => {
  it('returns null when client has no vendors', async () => {
    const service = createService({
      vendorDAO: {
        getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [] })),
      },
    });

    const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING);
    expect(result).toBeNull();
  });

  it('returns null when no vendors match the category', async () => {
    const electrician = makeVendor({
      companyName: 'Sparky Electric',
      servicesOffered: { electrical: true },
    });

    const service = createService({
      vendorDAO: {
        getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [electrician] })),
      },
    });

    const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING);
    expect(result).toBeNull();
  });

  it('gives new vendor with no history a baseline score (not excluded)', async () => {
    const newPlumber = makeVendor({
      companyName: 'New Plumber Co',
      servicesOffered: { plumbing: true },
    });

    const service = createService({
      vendorDAO: {
        getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [newPlumber] })),
      },
      maintenanceRequestDAO: {
        getVendorStats: jest.fn().mockReturnValue(Promise.resolve(makeStats({ total: 0 }))),
        getVendorAvgRating: jest.fn().mockReturnValue(Promise.resolve(0)),
      },
    });

    const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(50);
    expect(result!.reasons).toContain('New vendor — no job history yet');
  });

  it('ranks higher-rated vendor above lower-rated', async () => {
    const highRated = makeVendor({
      companyName: 'Top Plumber',
      servicesOffered: { plumbing: true },
    });
    const lowRated = makeVendor({
      companyName: 'Budget Plumber',
      servicesOffered: { plumbing: true },
    });

    const statsMap = new Map([
      [highRated._id.toString(), makeStats({ total: 20, completed: 19, inProgress: 1, avgCompletionDays: 3 })],
      [lowRated._id.toString(), makeStats({ total: 20, completed: 10, inProgress: 1, avgCompletionDays: 3 })],
    ]);
    const ratingMap = new Map([
      [highRated._id.toString(), 4.8],
      [lowRated._id.toString(), 2.5],
    ]);

    const service = createService({
      vendorDAO: {
        getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [highRated, lowRated] })),
      },
      maintenanceRequestDAO: {
        getVendorStats: jest.fn().mockImplementation((id: any) =>
          Promise.resolve(statsMap.get(id) ?? makeStats())
        ),
        getVendorAvgRating: jest.fn().mockImplementation((id: any) =>
          Promise.resolve(ratingMap.get(id) ?? 0)
        ),
      },
    });

    const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING);
    expect(result).not.toBeNull();
    expect(result!.companyName).toBe('Top Plumber');
  });

  it('penalizes vendor with high active workload', async () => {
    const busy = makeVendor({
      companyName: 'Busy Plumber',
      servicesOffered: { plumbing: true },
    });
    const idle = makeVendor({
      companyName: 'Idle Plumber',
      servicesOffered: { plumbing: true },
    });

    const statsMap = new Map([
      [busy._id.toString(), makeStats({ total: 20, completed: 15, inProgress: 8, assigned: 2, avgCompletionDays: 3 })],
      [idle._id.toString(), makeStats({ total: 20, completed: 15, inProgress: 0, assigned: 0, avgCompletionDays: 3 })],
    ]);

    const service = createService({
      vendorDAO: {
        getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [busy, idle] })),
      },
      maintenanceRequestDAO: {
        getVendorStats: jest.fn().mockImplementation((id: any) =>
          Promise.resolve(statsMap.get(id) ?? makeStats())
        ),
        getVendorAvgRating: jest.fn().mockReturnValue(Promise.resolve(4.0)),
      },
    });

    const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING);
    expect(result).not.toBeNull();
    expect(result!.companyName).toBe('Idle Plumber');
  });

  it('faster vendor scores higher than slower', async () => {
    const fast = makeVendor({
      companyName: 'Fast Plumber',
      servicesOffered: { plumbing: true },
    });
    const slow = makeVendor({
      companyName: 'Slow Plumber',
      servicesOffered: { plumbing: true },
    });

    const statsMap = new Map([
      [slow._id.toString(), makeStats({ total: 20, completed: 18, inProgress: 1, avgCompletionDays: 20 })],
      [fast._id.toString(), makeStats({ total: 20, completed: 18, inProgress: 1, avgCompletionDays: 2 })],
    ]);

    const service = createService({
      vendorDAO: {
        getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [fast, slow] })),
      },
      maintenanceRequestDAO: {
        getVendorStats: jest.fn().mockImplementation((id: any) =>
          Promise.resolve(statsMap.get(id) ?? makeStats())
        ),
        getVendorAvgRating: jest.fn().mockReturnValue(Promise.resolve(4.0)),
      },
    });

    const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING);
    expect(result).not.toBeNull();
    expect(result!.companyName).toBe('Fast Plumber');
  });

  it('returns vendor with highest composite score across all signals', async () => {
    const best = makeVendor({
      companyName: 'Best Overall',
      servicesOffered: { plumbing: true },
    });
    const decent = makeVendor({
      companyName: 'Decent Vendor',
      servicesOffered: { plumbing: true },
    });

    const statsMap = new Map([
      [decent._id.toString(), makeStats({ total: 10, completed: 7, inProgress: 3, avgCompletionDays: 10 })],
      [best._id.toString(), makeStats({ total: 50, completed: 48, inProgress: 1, avgCompletionDays: 2 })],
    ]);
    const ratingMap = new Map([
      [decent._id.toString(), 3.5],
      [best._id.toString(), 4.9],
    ]);

    const service = createService({
      vendorDAO: {
        getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [best, decent] })),
      },
      maintenanceRequestDAO: {
        getVendorStats: jest.fn().mockImplementation((id: any) =>
          Promise.resolve(statsMap.get(id) ?? makeStats())
        ),
        getVendorAvgRating: jest.fn().mockImplementation((id: any) =>
          Promise.resolve(ratingMap.get(id) ?? 0)
        ),
      },
    });

    const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING);
    expect(result).not.toBeNull();
    expect(result!.companyName).toBe('Best Overall');
    expect(result!.score).toBeGreaterThan(70);
  });

  it('reasons array includes human-readable explanation', async () => {
    const vendor = makeVendor({
      companyName: 'Pro Plumber',
      servicesOffered: { plumbing: true },
    });

    const service = createService({
      vendorDAO: {
        getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [vendor] })),
      },
      maintenanceRequestDAO: {
        getVendorStats: jest.fn().mockReturnValue(
          Promise.resolve(makeStats({ total: 10, completed: 9, inProgress: 1, avgCompletionDays: 5 }))
        ),
        getVendorAvgRating: jest.fn().mockReturnValue(Promise.resolve(4.5)),
      },
    });

    const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING);
    expect(result).not.toBeNull();
    expect(result!.reasons.length).toBeGreaterThan(0);
    expect(result!.reasons.some((r) => r.includes('completion rate'))).toBe(true);
    expect(result!.reasons.some((r) => r.includes('avg rating'))).toBe(true);
    expect(result!.reasons.some((r) => r.includes('active job'))).toBe(true);
  });

  it('only considers vendors connected to the given cuid', async () => {
    const mockGetClientVendors = jest.fn().mockReturnValue(Promise.resolve({ items: [] }));

    const service = createService({
      vendorDAO: { getClientVendors: mockGetClientVendors },
    });

    await service.suggestVendor('SPECIFIC_CUID', MaintenanceCategory.ELECTRICAL);

    expect(mockGetClientVendors).toHaveBeenCalledWith('SPECIFIC_CUID');
  });
});
