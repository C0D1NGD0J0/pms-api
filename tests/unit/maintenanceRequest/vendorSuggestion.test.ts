import { Types } from 'mongoose';
import { MaintenanceCategory } from '@interfaces/maintenanceRequest.interface';
import { ServiceAreaService } from '@services/serviceArea/serviceArea.service';
import { VendorSuggestionService } from '@services/maintenanceRequest/vendorSuggestion.service';

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
  propertyDAO?: any;
  serviceAreaService?: Partial<jest.Mocked<ServiceAreaService>>;
}) => {
  const defaultDAO = {
    getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [] })),
    getByMruid: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateById: jest.fn(),
    // batch methods return empty Maps by default → vendors appear as "new"
    getVendorStatsBatch: jest
      .fn()
      .mockReturnValue(Promise.resolve(new Map<string, any>())),
    getVendorAvgRatingBatch: jest
      .fn()
      .mockReturnValue(Promise.resolve(new Map<string, number>())),
  };

  return new VendorSuggestionService({
    maintenanceRequestDAO: { ...defaultDAO, ...mocks.maintenanceRequestDAO } as any,
    vendorDAO: { getClientVendors: jest.fn(), ...mocks.vendorDAO } as any,
    emitterService: { emit: jest.fn(), on: jest.fn() } as any,
    propertyDAO: { findFirst: jest.fn(), ...mocks.propertyDAO } as any,
    aiService: { categorizeMaintenanceRequest: jest.fn(), selectBestVendor: jest.fn() } as any,
    serviceAreaService: {
      isLocationInVendorServiceArea: jest.fn(),
      ...mocks.serviceAreaService,
    } as jest.Mocked<ServiceAreaService>,
    subscriptionDAO: {} as any,
  });
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('VendorSuggestionService.suggestVendor', () => {
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
      // empty Map → isNewVendor = true → baseline score 50
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
        getVendorStatsBatch: jest.fn().mockReturnValue(Promise.resolve(statsMap)),
        getVendorAvgRatingBatch: jest.fn().mockReturnValue(Promise.resolve(ratingMap)),
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
    const ratingMap = new Map([
      [busy._id.toString(), 4.0],
      [idle._id.toString(), 4.0],
    ]);

    const service = createService({
      vendorDAO: {
        getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [busy, idle] })),
      },
      maintenanceRequestDAO: {
        getVendorStatsBatch: jest.fn().mockReturnValue(Promise.resolve(statsMap)),
        getVendorAvgRatingBatch: jest.fn().mockReturnValue(Promise.resolve(ratingMap)),
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
    const ratingMap = new Map([
      [slow._id.toString(), 4.0],
      [fast._id.toString(), 4.0],
    ]);

    const service = createService({
      vendorDAO: {
        getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [fast, slow] })),
      },
      maintenanceRequestDAO: {
        getVendorStatsBatch: jest.fn().mockReturnValue(Promise.resolve(statsMap)),
        getVendorAvgRatingBatch: jest.fn().mockReturnValue(Promise.resolve(ratingMap)),
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
        getVendorStatsBatch: jest.fn().mockReturnValue(Promise.resolve(statsMap)),
        getVendorAvgRatingBatch: jest.fn().mockReturnValue(Promise.resolve(ratingMap)),
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

    const statsMap = new Map([
      [vendor._id.toString(), makeStats({ total: 10, completed: 9, inProgress: 1, avgCompletionDays: 5 })],
    ]);
    const ratingMap = new Map([[vendor._id.toString(), 4.5]]);

    const service = createService({
      vendorDAO: {
        getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [vendor] })),
      },
      maintenanceRequestDAO: {
        getVendorStatsBatch: jest.fn().mockReturnValue(Promise.resolve(statsMap)),
        getVendorAvgRatingBatch: jest.fn().mockReturnValue(Promise.resolve(ratingMap)),
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

  describe('proximity filtering and scoring', () => {
    it('does not filter vendors when no propertyId is provided', async () => {
      const mockIsInRange = jest.fn();
      const vendor = makeVendor({
        servicesOffered: { plumbing: true },
        address: { computedLocation: { coordinates: [-123.1, 49.2] } },
        serviceAreas: { maxDistance: 25 },
      });

      const service = createService({
        vendorDAO: {
          getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [vendor] })),
        },
        serviceAreaService: { isLocationInVendorServiceArea: mockIsInRange },
      });

      await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING);

      expect(mockIsInRange).not.toHaveBeenCalled();
    });

    it('includes vendor with no computedLocation regardless of property coords', async () => {
      const mockIsInRange = jest.fn();
      const vendor = makeVendor({
        servicesOffered: { plumbing: true },
        // no address.computedLocation
      });

      const service = createService({
        vendorDAO: {
          getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [vendor] })),
        },
        propertyDAO: {
          findFirst: jest.fn().mockReturnValue(
            Promise.resolve({ computedLocation: { coordinates: [-123.1, 49.25] } })
          ),
        },
        serviceAreaService: { isLocationInVendorServiceArea: mockIsInRange },
      });

      const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING, 'prop-id-1');

      expect(result).not.toBeNull();
      expect(mockIsInRange).not.toHaveBeenCalled();
    });

    it('falls back to qualified list when vendor is outside service area (best-effort suggestion)', async () => {
      // When ALL vendors are outside their declared service area, the service returns the best-effort
      // candidate from the qualified list (with proximity score 0) rather than null.
      // This ensures the PM always receives a suggestion even when location data is imprecise.
      const vendor = makeVendor({
        servicesOffered: { plumbing: true },
        address: { computedLocation: { coordinates: [-123.1, 49.2] } },
        serviceAreas: { maxDistance: 25 },
      });

      const service = createService({
        vendorDAO: {
          getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [vendor] })),
        },
        propertyDAO: {
          findFirst: jest.fn().mockReturnValue(
            Promise.resolve({ computedLocation: { coordinates: [-123.1, 49.25] } })
          ),
        },
        serviceAreaService: {
          isLocationInVendorServiceArea: jest.fn().mockReturnValue(
            Promise.resolve({ isInRange: false })
          ),
        },
      });

      const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING, 'prop-id-1');

      // Falls back to the qualified list — returns a result, not null
      expect(result).not.toBeNull();
      expect(result?.vendorId).toBe(vendor._id.toString());
    });

    it('includes vendor inside service area', async () => {
      const vendor = makeVendor({
        servicesOffered: { plumbing: true },
        address: { computedLocation: { coordinates: [-123.1, 49.2] } },
        serviceAreas: { maxDistance: 25 },
      });

      const service = createService({
        vendorDAO: {
          getClientVendors: jest.fn().mockReturnValue(Promise.resolve({ items: [vendor] })),
        },
        propertyDAO: {
          findFirst: jest.fn().mockReturnValue(
            Promise.resolve({ computedLocation: { coordinates: [-123.1, 49.25] } })
          ),
        },
        serviceAreaService: {
          isLocationInVendorServiceArea: jest.fn().mockReturnValue(
            Promise.resolve({ isInRange: true, distance: 5 })
          ),
        },
      });

      const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING, 'prop-id-1');

      expect(result).not.toBeNull();
    });

    it('returns best-effort suggestion when all vendors are outside service area', async () => {
      // When ALL candidates fail the geo check, the service falls back to the full qualified list
      // rather than returning null — the PM always gets a suggestion (proximity score will be 0).
      const vendor1 = makeVendor({
        servicesOffered: { plumbing: true },
        address: { computedLocation: { coordinates: [-123.1, 49.2] } },
        serviceAreas: { maxDistance: 25 },
      });
      const vendor2 = makeVendor({
        servicesOffered: { plumbing: true },
        address: { computedLocation: { coordinates: [-123.5, 49.5] } },
        serviceAreas: { maxDistance: 10 },
      });

      const service = createService({
        vendorDAO: {
          getClientVendors: jest.fn().mockReturnValue(
            Promise.resolve({ items: [vendor1, vendor2] })
          ),
        },
        propertyDAO: {
          findFirst: jest.fn().mockReturnValue(
            Promise.resolve({ computedLocation: { coordinates: [-123.1, 49.25] } })
          ),
        },
        serviceAreaService: {
          isLocationInVendorServiceArea: jest.fn().mockReturnValue(
            Promise.resolve({ isInRange: false })
          ),
        },
      });

      const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING, 'prop-id-1');

      // Falls back to qualified list — returns one of the two vendors
      expect(result).not.toBeNull();
    });

    it('closer vendor scores higher due to proximity', async () => {
      const closerVendor = makeVendor({
        companyName: 'Closer Plumber',
        servicesOffered: { plumbing: true },
        address: { computedLocation: { coordinates: [-123.1, 49.21] } },
        serviceAreas: { maxDistance: 25 },
      });
      const fartherVendor = makeVendor({
        companyName: 'Farther Plumber',
        servicesOffered: { plumbing: true },
        address: { computedLocation: { coordinates: [-123.1, 49.4] } },
        serviceAreas: { maxDistance: 25 },
      });

      const identicalStats = makeStats({ total: 20, completed: 18, inProgress: 1, avgCompletionDays: 5 });
      const statsMap = new Map([
        [fartherVendor._id.toString(), identicalStats],
        [closerVendor._id.toString(), identicalStats],
      ]);
      const ratingMap = new Map([
        [fartherVendor._id.toString(), 4.0],
        [closerVendor._id.toString(), 4.0],
      ]);

      const isLocationInVendorServiceArea = jest.fn().mockImplementation((vendorId: any) => {
        const isCloser = vendorId === closerVendor._id.toString();
        return Promise.resolve({ isInRange: true, distance: isCloser ? 2 : 20 });
      });

      const service = createService({
        vendorDAO: {
          getClientVendors: jest.fn().mockReturnValue(
            Promise.resolve({ items: [closerVendor, fartherVendor] })
          ),
        },
        maintenanceRequestDAO: {
          getVendorStatsBatch: jest.fn().mockReturnValue(Promise.resolve(statsMap)),
          getVendorAvgRatingBatch: jest.fn().mockReturnValue(Promise.resolve(ratingMap)),
        },
        propertyDAO: {
          findFirst: jest.fn().mockReturnValue(
            Promise.resolve({ computedLocation: { coordinates: [-123.1, 49.2] } })
          ),
        },
        serviceAreaService: { isLocationInVendorServiceArea },
      });

      const result = await service.suggestVendor('CUID1', MaintenanceCategory.PLUMBING, 'prop-id-1');

      expect(result).not.toBeNull();
      expect(result!.companyName).toBe('Closer Plumber');
    });
  });
});
