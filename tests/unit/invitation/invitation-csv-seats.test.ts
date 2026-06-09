import { Types } from 'mongoose';
import { InvitationQueue, EmailQueue } from '@queues/index';
import { EventEmitterService } from '@services/eventEmitter';
import { IRequestContext } from '@interfaces/utils.interface';
import { ProfileService } from '@services/profile/profile.service';
import { InvitationDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { InvitationService } from '@services/invitation/invitation.service';

describe('Invitation CSV Import — Seat Enforcement', () => {
  let invitationService: InvitationService;
  let mockDAOs: {
    invitationDAO: InvitationDAO;
    profileDAO: ProfileDAO;
    clientDAO: ClientDAO;
    userDAO: UserDAO;
  };
  let mockSubscriptionService: any;
  let mockEmitterService: EventEmitterService;
  let mockQueueFactory: any;
  let mockInvitationQueue: any;

  const testCuid = 'test-client-cuid';
  const testUserId = new Types.ObjectId().toString();
  const testClientId = new Types.ObjectId();

  const createMockDAOs = () => ({
    invitationDAO: {
      findByToken: jest.fn(),
      acceptInvitation: jest.fn(),
      startSession: jest.fn(),
      withTransaction: jest.fn(),
      createInvitation: jest.fn(),
      findPendingInvitation: jest.fn(),
      countDocuments: jest.fn(),
    } as any,
    profileDAO: {
      createUserProfile: jest.fn(),
      findFirst: jest.fn(),
    } as any,
    clientDAO: {
      getClientByCuid: jest.fn().mockReturnValue(
        Promise.resolve({
          _id: testClientId,
          cuid: testCuid,
          displayName: 'Test Company',
          id: testClientId.toString(),
          isVerified: true,
        })
      ),
    } as any,
    userDAO: {
      getActiveUserByEmail: jest.fn(),
      getUserById: jest.fn(),
      getUserWithClientAccess: jest.fn(),
    } as any,
  });

  beforeEach(() => {
    mockDAOs = createMockDAOs();

    mockInvitationQueue = {
      addCsvImportJob: jest.fn().mockReturnValue(Promise.resolve({ id: 'mock-job-id' })),
      addCsvValidationJob: jest.fn().mockReturnValue(Promise.resolve({ id: 'mock-job-id' })),
    };

    mockQueueFactory = {
      getQueue: jest.fn().mockReturnValue(mockInvitationQueue),
    };

    mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    } as any;

    mockSubscriptionService = {
      getAvailableSeats: jest.fn(),
      getSubscriptionEntitlements: jest.fn(),
      getPlanUsage: jest.fn(),
    };

    invitationService = new InvitationService({
      ...mockDAOs,
      queueFactory: mockQueueFactory,
      emitterService: mockEmitterService,
      profileService: {} as any,
      vendorService: {} as any,
      userService: {} as any,
      subscriptionService: mockSubscriptionService,
      leaseDAO: {} as any,
      paymentProcessorDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve(null)) } as any,
      paymentGatewayService: { createCustomer: jest.fn() } as any,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockContext = (cuid: string): IRequestContext =>
    ({
      request: {
        params: { cuid },
        url: `/api/v1/invitations/${cuid}/import_invitations_csv`,
        method: 'POST',
        path: `/api/v1/invitations/${cuid}/import_invitations_csv`,
        query: {},
      },
      currentuser: { sub: testUserId },
      requestId: 'req-test-123',
      timestamp: new Date(),
    }) as any;

  describe('importInvitationsFromCsv — pre-queue seat check', () => {
    it('should reject immediately when no seats available and cannot purchase more', async () => {
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

      const cxt = createMockContext(testCuid);

      await expect(
        invitationService.importInvitationsFromCsv(cxt, '/tmp/test.csv')
      ).rejects.toThrow(/Seat limit reached/);

      // Should clean up the CSV file
      expect(mockEmitterService.emit).toHaveBeenCalled();
      // Should NOT queue the job
      expect(mockInvitationQueue.addCsvImportJob).not.toHaveBeenCalled();
    });

    it('should allow queueing when seats available', async () => {
      mockSubscriptionService.getAvailableSeats.mockReturnValue(
        Promise.resolve({
          availableSeats: 5,
          currentSeats: 3,
          totalAllowed: 8,
          includedSeats: 3,
          additionalSeats: 5,
          canPurchaseMore: true,
          maxAdditionalSeats: 25,
        })
      );

      const cxt = createMockContext(testCuid);
      const result = await invitationService.importInvitationsFromCsv(cxt, '/tmp/test.csv');

      expect(result.success).toBe(true);
      expect(result.data.processId).toBe('mock-job-id');
      expect(mockInvitationQueue.addCsvImportJob).toHaveBeenCalled();
    });

    it('should allow queueing when no seats but can purchase more', async () => {
      mockSubscriptionService.getAvailableSeats.mockReturnValue(
        Promise.resolve({
          availableSeats: 0,
          currentSeats: 10,
          totalAllowed: 10,
          includedSeats: 10,
          additionalSeats: 0,
          canPurchaseMore: true,
          maxAdditionalSeats: 25,
        })
      );

      const cxt = createMockContext(testCuid);
      const result = await invitationService.importInvitationsFromCsv(cxt, '/tmp/test.csv');

      expect(result.success).toBe(true);
      expect(mockInvitationQueue.addCsvImportJob).toHaveBeenCalled();
    });
  });
});
