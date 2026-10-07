import { Types } from 'mongoose';
import { EventEmitterService } from '@services/eventEmitter';
import { IRequestContext } from '@interfaces/utils.interface';
import { InvitationDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { InvitationService } from '@services/invitation/invitation.service';
import { ProfileService as _ProfileService } from '@services/profile/profile.service';
import { InvitationQueue as _InvitationQueue, EmailQueue as _EmailQueue } from '@queues/index';

describe('Invitation CSV — queueing', () => {
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
      invitationCsvProcessor: {} as any,
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
      userCache: {
        invalidateUserDetail: jest.fn().mockResolvedValue({ success: true }),
        invalidateUserLists: jest.fn().mockResolvedValue({ success: true }),
      } as any,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockContext = (cuid: string): IRequestContext =>
    ({
      request: {
        params: { cuid },
        url: `/api/v1/invitations/${cuid}/csv/import`,
        method: 'POST',
        path: `/api/v1/invitations/${cuid}/csv/import`,
        query: {},
      },
      currentuser: { sub: testUserId },
      requestId: 'req-test-123',
      timestamp: new Date(),
    }) as any;

  describe('importInvitationsFromCsv — queueing', () => {
    it('queues even when no seats are left — tenant/vendor rows need none, the worker trims employees per row', async () => {
      mockSubscriptionService.getAvailableSeats.mockResolvedValue({
        availableSeats: 0,
        totalAllowed: 3,
        canPurchaseMore: false,
      });

      const result = await invitationService.importInvitationsFromCsv(
        createMockContext(testCuid),
        '/tmp/test.csv'
      );

      expect(result.success).toBe(true);
      expect(result.data.processId).toBe('mock-job-id');
      expect(mockInvitationQueue.addCsvImportJob).toHaveBeenCalled();
      expect(mockSubscriptionService.getAvailableSeats).not.toHaveBeenCalled();
    });

    it('passes only known import fields from the column mapping to the job', async () => {
      await invitationService.importInvitationsFromCsv(
        createMockContext(testCuid),
        '/tmp/test.csv',
        {
          'E-mail': 'inviteeEmail',
          'Given name': 'firstName',
          Hacked: 'password',
        }
      );

      expect(mockInvitationQueue.addCsvImportJob).toHaveBeenCalledWith(
        expect.objectContaining({
          columnMapping: { 'E-mail': 'inviteeEmail', 'Given name': 'firstName' },
        })
      );
    });

    it('drops the mapping entirely when nothing in it is a known field', async () => {
      await invitationService.importInvitationsFromCsv(
        createMockContext(testCuid),
        '/tmp/test.csv',
        {
          Hacked: 'password',
        }
      );

      expect(mockInvitationQueue.addCsvImportJob).toHaveBeenCalledWith(
        expect.objectContaining({ columnMapping: undefined })
      );
    });
  });

  describe('validateInvitationCsv', () => {
    it('forwards the sanitized column mapping to the validation job', async () => {
      await invitationService.validateInvitationCsv(
        testCuid,
        { path: '/tmp/test.csv', fileSize: 1024 } as any,
        { sub: testUserId } as any,
        { 'Work email': 'inviteeEmail', Notes: 'notAField' }
      );

      expect(mockInvitationQueue.addCsvValidationJob).toHaveBeenCalledWith(
        expect.objectContaining({ columnMapping: { 'Work email': 'inviteeEmail' } })
      );
    });

    it('rejects files over 10 MB and cleans up the upload', async () => {
      await expect(
        invitationService.validateInvitationCsv(
          testCuid,
          { path: '/tmp/big.csv', fileSize: 11 * 1024 * 1024 } as any,
          { sub: testUserId } as any
        )
      ).rejects.toThrow();

      expect(mockEmitterService.emit).toHaveBeenCalled();
      expect(mockInvitationQueue.addCsvValidationJob).not.toHaveBeenCalled();
    });
  });
});
