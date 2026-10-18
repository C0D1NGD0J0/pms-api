import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { faker } from '@faker-js/faker';
import { LeaseDAO } from '@dao/leaseDAO';
import { ClientDAO } from '@dao/clientDAO';
import { VendorDAO } from '@dao/vendorDAO';
import { MailType } from '@interfaces/utils.interface';
import { LeaseStatus } from '@interfaces/lease.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { Client, Vendor, Lease, User } from '@models/index';
import { IUserRoleType } from '@shared/constants/roles.constants';
import { mockRequestContext, clearTestDatabase, createTestClient } from '@tests/helpers';

jest.mock('@di/index', () => ({ container: {} }));
jest.mock('@utils/systemBot', () => ({
  getSystemBotUserId: jest.fn().mockResolvedValue(new Types.ObjectId()),
  buildSystemRequestContext: jest.fn().mockResolvedValue({ requestId: 'system' }),
}));

import { OffboardingService } from '@services/offboarding/offboarding.service';

// BaseDAO.list() returns 20 documents when no limit is given; every count here is above that
const RECORD_COUNT = 25;

const buildUsers = (cuid: string, role: IUserRoleType, prefix: string) =>
  Array.from({ length: RECORD_COUNT }, (_, i) => ({
    uid: `uid-${faker.string.alphanumeric(12)}`,
    email: `${prefix}-${i}-${faker.string.alphanumeric(6)}@test.com`,
    password: '$2b$10$hashedPasswordForTesting',
    isActive: true,
    cuids: [{ cuid, roles: [role], isConnected: true, clientDisplayName: 'Test Co' }],
    activecuid: cuid,
  }));

const buildActiveLease = (cuid: string, tenantId: Types.ObjectId) => ({
  luid: `lease-${faker.string.alphanumeric(12)}`,
  leaseNumber: `LN-${faker.string.alphanumeric(10)}`,
  cuid,
  tenantId,
  property: { id: new Types.ObjectId(), address: faker.location.streetAddress() },
  status: LeaseStatus.ACTIVE,
  approvalStatus: 'approved',
  type: 'fixed_term',
  duration: {
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 335 * 24 * 60 * 60 * 1000),
  },
  fees: {
    rentAmount: 150000,
    securityDeposit: 150000,
    rentDueDay: 1,
    currency: 'USD',
    acceptedPaymentMethod: 'bank_transfer',
  },
});

describe('OffboardingService.initiateAccountClosure — more than one list page of records', () => {
  let cuid: string;
  let owner: any;
  let service: OffboardingService;
  let terminateLease: jest.Mock;
  let addToEmailQueue: jest.Mock;

  beforeEach(async () => {
    await clearTestDatabase();

    const client = await createTestClient();
    cuid = client.cuid;
    owner = await User.create({
      ...buildUsers(cuid, ROLES.SUPER_ADMIN, 'owner')[0],
    });

    const [staff, tenants, vendorUsers] = await Promise.all([
      User.insertMany(buildUsers(cuid, ROLES.STAFF, 'staff')),
      User.insertMany(buildUsers(cuid, ROLES.TENANT, 'tenant')),
      User.insertMany(buildUsers(cuid, ROLES.VENDOR, 'vendor')),
    ]);
    expect(staff).toHaveLength(RECORD_COUNT);

    await Lease.collection.insertMany(tenants.map((t) => buildActiveLease(cuid, t._id)));
    await Vendor.insertMany(
      vendorUsers.map((vendorUser) => ({
        companyName: faker.company.name(),
        businessType: 'General Contractor',
        registrationNumber: `REG-${faker.string.alphanumeric(10)}`,
        connectedClients: [{ cuid, isConnected: true, primaryAccountHolderUserId: vendorUser._id }],
      }))
    );

    // The real terminateLease runs the whole offboarding chain; here it only flips the status,
    // which is what drops the lease out of the "active" filter mid-iteration
    terminateLease = jest.fn(async (_cuid: string, luid: string) => {
      await Lease.updateOne({ luid }, { $set: { status: LeaseStatus.TERMINATED } });
      return { success: true };
    });
    addToEmailQueue = jest.fn();

    service = new OffboardingService({
      userDAO: new UserDAO({ userModel: User }),
      leaseDAO: new LeaseDAO({ leaseModel: Lease }),
      vendorDAO: new VendorDAO({ vendorModel: Vendor }),
      clientDAO: new ClientDAO({ clientModel: Client, userModel: User }),
      leaseService: { terminateLease } as any,
      emailQueue: { addToEmailQueue } as any,
      emitterService: { emit: jest.fn(), on: jest.fn() } as any,
      userCache: { invalidateUserDetail: jest.fn() } as any,
      authCache: { invalidateCurrentUser: jest.fn() } as any,
      propertyDAO: {} as any,
      propertyUnitDAO: {} as any,
      paymentDAO: {} as any,
      invoiceDAO: {} as any,
      inspectionDAO: {} as any,
      inspectionService: {} as any,
      leaseRenewalService: {} as any,
      maintenanceRequestDAO: {} as any,
      maintenancePaymentService: {} as any,
      sseService: {} as any,
    });
  });

  const emailsOfType = (emailType: MailType) =>
    addToEmailQueue.mock.calls.filter(([, payload]) => payload.emailType === emailType);

  it('terminates every active lease, disconnects every staff member and vendor, and emails every tenant', async () => {
    const ctx = mockRequestContext(owner, cuid) as any;

    const result = await service.initiateAccountClosure(cuid, ctx, 'Retiring');

    expect(result.success).toBe(true);
    expect(terminateLease).toHaveBeenCalledTimes(RECORD_COUNT);
    expect(await Lease.countDocuments({ cuid, status: LeaseStatus.ACTIVE })).toBe(0);

    const stillConnectedStaff = await User.countDocuments({
      cuids: { $elemMatch: { cuid, roles: ROLES.STAFF, isConnected: true } },
    });
    expect(stillConnectedStaff).toBe(0);

    const stillConnectedVendors = await Vendor.countDocuments({
      connectedClients: { $elemMatch: { cuid, isConnected: true } },
    });
    expect(stillConnectedVendors).toBe(0);

    expect(emailsOfType(MailType.COMPANY_CLOSURE_TENANT)).toHaveLength(RECORD_COUNT);
    expect(emailsOfType(MailType.COMPANY_CLOSURE_VENDOR)).toHaveLength(RECORD_COUNT);
    // The test client's own admin is also an employee, so staff emails cover it too
    expect(emailsOfType(MailType.COMPANY_CLOSURE_STAFF).length).toBeGreaterThanOrEqual(
      RECORD_COUNT
    );
    expect(result.data.message).toContain(`${RECORD_COUNT} leases terminated`);
    expect(result.data.message).toContain(`${RECORD_COUNT} vendors disconnected`);
    expect(result.data.message).toContain(`${RECORD_COUNT} tenants notified`);
  });
});
