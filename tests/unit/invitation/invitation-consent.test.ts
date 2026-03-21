import { Types } from 'mongoose';
import { InvitationQueue, EmailQueue } from '@queues/index';
import { EventEmitterService } from '@services/eventEmitter';
import { ProfileService } from '@services/profile/profile.service';
import { IInvitationAcceptance } from '@interfaces/invitation.interface';
import { InvitationDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { InvitationService } from '@services/invitation/invitation.service';

describe('Invitation Acceptance — Consent Recording', () => {
  let invitationService: InvitationService;
  let profileService: ProfileService;
  let mockDAOs: {
    invitationDAO: InvitationDAO;
    profileDAO: ProfileDAO;
    clientDAO: ClientDAO;
    userDAO: UserDAO;
  };
  let mockQueues: { emailQueue: EmailQueue; invitationQueue: InvitationQueue };
  let emitterService: EventEmitterService;

  const mockIds = {
    client: new Types.ObjectId(),
    user: new Types.ObjectId(),
    invitation: new Types.ObjectId(),
    profile: new Types.ObjectId(),
  };

  const mockUser = {
    _id: mockIds.user,
    email: 'tenant@example.com',
    uid: 'user-uid-123',
    cuids: [],
  };

  const mockClient = {
    id: mockIds.client,
    cuid: 'client-abc',
    displayName: 'Test Property Co',
  };

  const mockProfile = { id: mockIds.profile, user: mockIds.user };

  const mockInvitation = {
    _id: mockIds.invitation,
    inviteeEmail: 'tenant@example.com',
    role: 'tenant',
    metadata: {},
    personalInfo: { firstName: 'Jane', lastName: 'Doe' },
    inviteeFullName: 'Jane Doe',
    isValid: () => true,
    clientId: mockIds.client,
  };

  const createMockDAOs = () => ({
    invitationDAO: {
      findByToken: jest.fn(),
      acceptInvitation: jest.fn(),
      startSession: jest.fn(),
      withTransaction: jest.fn(),
    } as any,
    profileDAO: {
      createUserProfile: jest.fn(),
      findFirst: jest.fn(),
      updateCommonEmployeeInfo: jest.fn(),
      updateCommonVendorInfo: jest.fn(),
    } as any,
    clientDAO: {
      getClientByCuid: jest.fn(),
      findFirst: jest.fn(),
    } as any,
    userDAO: {
      getActiveUserByEmail: jest.fn(),
      createUserFromInvitation: jest.fn(),
      getUserById: jest.fn(),
      updateById: jest.fn(),
      update: jest.fn(),
    } as any,
  });

  beforeEach(() => {
    mockDAOs = createMockDAOs();
    mockQueues = { emailQueue: { addToEmailQueue: jest.fn() } as any, invitationQueue: {} as any };
    emitterService = { emit: jest.fn(), off: jest.fn(), on: jest.fn() } as any;

    const mockVendorService = {
      getVendorByUserId: jest.fn(),
      updateVendorInfo: jest.fn(),
      createVendor: jest.fn(),
      linkVendorToClient: jest.fn(),
    } as any;

    const mockUserService = {
      processUserForClientInvitation: jest.fn().mockReturnValue(Promise.resolve(mockUser)),
      createUserFromInvitationData: jest.fn().mockReturnValue(Promise.resolve(mockUser)),
      buildProfileFromInvitationData: jest.fn().mockReturnValue({}),
    } as any;

    profileService = new ProfileService({
      ...mockDAOs,
      vendorService: mockVendorService,
      userService: mockUserService,
      emitterService,
      mediaUploadService: { handleMediaDeletion: jest.fn() } as any,
    });

    invitationService = new InvitationService({
      ...mockDAOs,
      queueFactory: {
        getQueue: jest.fn((queueName: string) => {
          if (queueName.includes('email')) return mockQueues.emailQueue;
          if (queueName.includes('invitation')) return mockQueues.invitationQueue;
          return {} as any;
        }),
      } as any,
      emitterService,
      profileService,
      vendorService: mockVendorService,
      userService: mockUserService,
      subscriptionService: {} as any,
      leaseDAO: {} as any,
      paymentProcessorDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve(null)) } as any,
      paymentGatewayService: { createCustomer: jest.fn() } as any,
      propertyDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve(null)) } as any,
      propertyUnitDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve(null)) } as any,
    });

    // Common mock setup
    (mockDAOs.invitationDAO.startSession as jest.Mock).mockReturnValue(Promise.resolve({}));
    (mockDAOs.invitationDAO.withTransaction as jest.Mock).mockImplementation(
      async (_session: any, callback: any) => callback(_session)
    );
    (mockDAOs.invitationDAO.findByToken as jest.Mock).mockReturnValue(Promise.resolve(mockInvitation));
    (mockDAOs.clientDAO.getClientByCuid as jest.Mock).mockReturnValue(Promise.resolve(mockClient));
    (mockDAOs.clientDAO.findFirst as jest.Mock).mockReturnValue(Promise.resolve(mockClient));
    (mockDAOs.userDAO.createUserFromInvitation as jest.Mock).mockReturnValue(Promise.resolve(mockUser));
    (mockDAOs.profileDAO.createUserProfile as jest.Mock).mockReturnValue(Promise.resolve(mockProfile));
    (mockDAOs.invitationDAO.acceptInvitation as jest.Mock).mockReturnValue(Promise.resolve(true));
    (mockDAOs.profileDAO.findFirst as jest.Mock).mockReturnValue(Promise.resolve(mockProfile));
    (mockDAOs.userDAO.getUserById as jest.Mock).mockReturnValue(Promise.resolve(mockUser));
    (mockDAOs.userDAO.update as jest.Mock).mockReturnValue(Promise.resolve(mockUser));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const baseAcceptanceData: IInvitationAcceptance = {
    token: 'test-token',
    email: 'tenant@example.com',
    password: 'SecurePass1',
    confirmPassword: 'SecurePass1',
    termsAccepted: true,
    newsletterOptIn: false,
    timeZone: 'UTC',
    lang: 'en',
    cuid: 'client-abc',
  };

  it('writes user.consent when firstName and lastName are provided', async () => {
    const acceptanceData: IInvitationAcceptance = {
      ...baseAcceptanceData,
      firstName: 'Jane',
      lastName: 'Doe',
      consentDate: '2026-03-19',
    };

    await invitationService.acceptInvitation('client-abc', acceptanceData);

    expect(mockDAOs.userDAO.update).toHaveBeenCalledWith(
      { _id: mockIds.user },
      {
        $set: {
          consent: {
            acceptedOn: expect.any(Date),
            acceptedBy: 'Jane Doe',
          },
        },
      }
    );
  });

  it('does not write consent when firstName and lastName are omitted', async () => {
    await invitationService.acceptInvitation('client-abc', baseAcceptanceData);

    expect(mockDAOs.userDAO.update).not.toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ $set: expect.objectContaining({ consent: expect.anything() }) })
    );
  });

  it('writes consent with only firstName when lastName is absent', async () => {
    const acceptanceData: IInvitationAcceptance = {
      ...baseAcceptanceData,
      firstName: 'Jane',
    };

    await invitationService.acceptInvitation('client-abc', acceptanceData);

    expect(mockDAOs.userDAO.update).toHaveBeenCalledWith(
      { _id: mockIds.user },
      expect.objectContaining({
        $set: expect.objectContaining({
          consent: expect.objectContaining({ acceptedBy: 'Jane' }),
        }),
      })
    );
  });

  it('trims whitespace in acceptedBy when only one name part is provided', async () => {
    const acceptanceData: IInvitationAcceptance = {
      ...baseAcceptanceData,
      lastName: 'Doe',
    };

    await invitationService.acceptInvitation('client-abc', acceptanceData);

    const updateCall = (mockDAOs.userDAO.update as jest.Mock).mock.calls.find((args) =>
      args[1]?.$set?.consent
    );
    expect(updateCall?.[1].$set.consent.acceptedBy).toBe('Doe');
  });
});
