import { Types } from 'mongoose';
import { ROLES } from '@shared/constants/roles.constants';
import { InvitationWorker } from '@workers/invitation.worker';

describe('InvitationWorker — CSV Import Seat Enforcement', () => {
  let worker: InvitationWorker;
  let mockSubscriptionService: any;
  let mockInvitationCsvProcessor: any;
  let mockEmitterService: any;
  let mockInvitationDAO: any;
  let mockSSEService: any;
  let mockEmailQueue: any;
  let mockUserDAO: any;
  let mockClientDAO: any;
  let mockProfileDAO: any;
  let mockVendorDAO: any;

  const testCuid = 'test-client-cuid';
  const testUserId = new Types.ObjectId().toString();
  const testClientId = new Types.ObjectId().toString();

  const makeJob = (overrides = {}) =>
    ({
      id: 'job-123',
      data: {
        csvFilePath: '/tmp/test-invitations.csv',
        clientInfo: {
          cuid: testCuid,
          clientDisplayName: 'Test Co',
          id: testClientId,
        },
        userId: testUserId,
        ...overrides,
      },
      progress: jest.fn(),
    }) as any;

  const makeInvitationRow = (email: string, role: string) => ({
    inviteeEmail: email,
    role,
    status: 'pending',
    personalInfo: { firstName: 'Test', lastName: 'User' },
    metadata: {},
  });

  beforeEach(() => {
    mockSubscriptionService = {
      getAvailableSeats: jest.fn(),
    };

    mockInvitationCsvProcessor = {
      validateCsv: jest.fn(),
    };

    mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    } as any;

    mockSSEService = {
      sendToUser: jest.fn().mockReturnValue(Promise.resolve()),
    };

    mockEmailQueue = {
      addToEmailQueue: jest.fn(),
    };

    mockInvitationDAO = {
      createInvitation: jest.fn().mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          iuid: 'inv-123',
          invitationToken: 'token-abc',
          expiresAt: new Date(Date.now() + 86400000),
        })
      ),
      findPendingInvitation: jest.fn().mockReturnValue(Promise.resolve(null)),
    };

    mockUserDAO = {
      getUserById: jest.fn().mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          email: 'inviter@test.com',
          profile: { fullname: 'Inviter' },
        })
      ),
      getUserWithClientAccess: jest.fn().mockReturnValue(Promise.resolve(null)),
    };

    mockClientDAO = {};
    mockProfileDAO = {};
    mockVendorDAO = {};

    worker = new InvitationWorker({
      subscriptionService: mockSubscriptionService,
      invitationCsvProcessor: mockInvitationCsvProcessor,
      emitterService: mockEmitterService,
      invitationDAO: mockInvitationDAO,
      sseService: mockSSEService,
      emailQueue: mockEmailQueue,
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      profileService: {} as any,
      vendorService: {} as any,
      vendorDAO: mockVendorDAO,
    } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processCsvImport — seat trimming', () => {
    it('should trim employee invitations to available seat count', async () => {
      const csvResult = {
        validInvitations: [
          makeInvitationRow('admin1@test.com', ROLES.ADMIN),
          makeInvitationRow('admin2@test.com', ROLES.ADMIN),
          makeInvitationRow('admin3@test.com', ROLES.ADMIN),
          makeInvitationRow('tenant1@test.com', ROLES.TENANT),
          makeInvitationRow('tenant2@test.com', ROLES.TENANT),
        ],
        errors: [],
        totalRows: 5,
      };

      mockInvitationCsvProcessor.validateCsv.mockReturnValue(Promise.resolve(csvResult));

      // Only 1 seat available — should keep 1 admin + all tenants
      mockSubscriptionService.getAvailableSeats.mockReturnValue(
        Promise.resolve({
          availableSeats: 1,
          currentSeats: 9,
          totalAllowed: 10,
          includedSeats: 10,
          additionalSeats: 0,
          canPurchaseMore: false,
          maxAdditionalSeats: 0,
        })
      );

      const job = makeJob();
      const result = await worker.processCsvImport(job);

      // 1 admin + 2 tenants should be processed; 2 admins should be trimmed
      expect(result.success).toBe(true);
      expect(result.data!.successCount).toBe(3); // 1 admin + 2 tenants
      expect(result.data!.failedCount).toBe(2); // 2 trimmed admins
    });

    it('should allow all invitations when seats are sufficient', async () => {
      const csvResult = {
        validInvitations: [
          makeInvitationRow('admin1@test.com', ROLES.ADMIN),
          makeInvitationRow('staff1@test.com', ROLES.STAFF),
          makeInvitationRow('tenant1@test.com', ROLES.TENANT),
        ],
        errors: [],
        totalRows: 3,
      };

      mockInvitationCsvProcessor.validateCsv.mockReturnValue(Promise.resolve(csvResult));

      mockSubscriptionService.getAvailableSeats.mockReturnValue(
        Promise.resolve({
          availableSeats: 10,
          currentSeats: 0,
          totalAllowed: 10,
          includedSeats: 10,
          additionalSeats: 0,
          canPurchaseMore: true,
          maxAdditionalSeats: 25,
        })
      );

      const job = makeJob();
      const result = await worker.processCsvImport(job);

      expect(result.success).toBe(true);
      expect(result.data!.successCount).toBe(3);
      expect(result.data!.failedCount).toBe(0);
    });

    it('should pass through tenant/vendor invitations even when no seats available', async () => {
      const csvResult = {
        validInvitations: [
          makeInvitationRow('tenant1@test.com', ROLES.TENANT),
          makeInvitationRow('tenant2@test.com', ROLES.TENANT),
          makeInvitationRow('vendor1@test.com', ROLES.VENDOR),
        ],
        errors: [],
        totalRows: 3,
      };

      mockInvitationCsvProcessor.validateCsv.mockReturnValue(Promise.resolve(csvResult));

      // No seats — but these are non-employee roles, so they should all pass
      mockSubscriptionService.getAvailableSeats.mockReturnValue(
        Promise.resolve({
          availableSeats: 0,
          currentSeats: 10,
          totalAllowed: 10,
          includedSeats: 10,
          additionalSeats: 0,
          canPurchaseMore: false,
          maxAdditionalSeats: 0,
        })
      );

      const job = makeJob();
      const result = await worker.processCsvImport(job);

      // getAvailableSeats should NOT be called since there are 0 employee rows
      expect(mockSubscriptionService.getAvailableSeats).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data!.successCount).toBe(3);
    });

    it('should abort if seat availability check fails', async () => {
      const csvResult = {
        validInvitations: [makeInvitationRow('admin1@test.com', ROLES.ADMIN)],
        errors: [],
        totalRows: 1,
      };

      mockInvitationCsvProcessor.validateCsv.mockReturnValue(Promise.resolve(csvResult));
      mockSubscriptionService.getAvailableSeats.mockReturnValue(
        Promise.reject(new Error('DB connection error'))
      );

      const job = makeJob();
      const result = await worker.processCsvImport(job);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Unable to verify seat availability/);
      // Should clean up CSV file
      expect(mockEmitterService.emit).toHaveBeenCalled();
    });

    it('should trim all employee roles (admin, staff, manager, super-admin)', async () => {
      const csvResult = {
        validInvitations: [
          makeInvitationRow('admin@test.com', ROLES.ADMIN),
          makeInvitationRow('staff@test.com', ROLES.STAFF),
          makeInvitationRow('manager@test.com', ROLES.MANAGER),
          makeInvitationRow('superadmin@test.com', ROLES.SUPER_ADMIN),
        ],
        errors: [],
        totalRows: 4,
      };

      mockInvitationCsvProcessor.validateCsv.mockReturnValue(Promise.resolve(csvResult));

      // 0 seats available — all 4 employee rows should be trimmed
      mockSubscriptionService.getAvailableSeats.mockReturnValue(
        Promise.resolve({
          availableSeats: 0,
          currentSeats: 3,
          totalAllowed: 3,
          includedSeats: 3,
          additionalSeats: 0,
          canPurchaseMore: false,
          maxAdditionalSeats: 0,
        })
      );

      const job = makeJob();
      const result = await worker.processCsvImport(job);

      expect(result.success).toBe(true);
      expect(result.data!.successCount).toBe(0);
      expect(result.data!.failedCount).toBe(4);
    });
  });
});
