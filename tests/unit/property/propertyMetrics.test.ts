import { Types } from 'mongoose';
import { LeaseStatus } from '@interfaces/lease.interface';
import { PropertyService } from '@services/property/property.service';

const mockLeaseDAO = { list: jest.fn() };

const buildService = () =>
  new PropertyService({
    propertyDAO: {},
    notificationService: {},
    s3Service: {},
    clientDAO: {},
    propertyUnitDAO: {},
    emitterService: { on: jest.fn(), emit: jest.fn() },
    profileDAO: {},
    queueFactory: {},
    propertyCache: {},
    geoCoderService: {},
    propertyCsvProcessor: {},
    mediaUploadService: {},
    propertyApprovalService: {},
    propertyVerificationService: {},
    propertyStatsService: {},
    userDAO: {},
    leaseDAO: mockLeaseDAO,
    inspectionDAO: {},
    maintenanceRequestDAO: {},
    subscriptionDAO: {},
    paymentDAO: {},
  } as any);

describe('PropertyService — calculatePropertyMetrics', () => {
  const propertyId = new Types.ObjectId().toString();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('only counts active leases toward income', async () => {
    mockLeaseDAO.list.mockResolvedValue({ items: [] });

    await buildService().calculatePropertyMetrics('cuid-1', propertyId, { totalUnits: 1 }, {});

    expect(mockLeaseDAO.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: LeaseStatus.ACTIVE, cuid: 'cuid-1', deletedAt: null }),
      {},
      true
    );
  });

  it('sums rent and pet fees and subtracts management fees', async () => {
    mockLeaseDAO.list.mockResolvedValue({
      items: [
        { fees: { rentAmount: 150000 }, petPolicy: { monthlyFee: 5000 } },
        { fees: { rentAmount: 120000 } },
      ],
    });

    const metrics = await buildService().calculatePropertyMetrics(
      'cuid-1',
      propertyId,
      { totalUnits: 2, unitStats: { occupied: 2 } },
      { fees: { managementFees: 10000 } }
    );

    expect(metrics.rentAmount).toBe(275000);
    expect(metrics.monthlyNetIncome).toBe(265000);
    expect(metrics.annualRevenue).toBe(275000 * 12);
  });
});
