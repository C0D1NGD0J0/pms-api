import { Types } from 'mongoose';
import { EventTypes } from '@interfaces/events.interface';
import { BadRequestError, ForbiddenError } from '@shared/customErrors';
import { InvitationService } from '@services/invitation/invitation.service';

describe('InvitationService.dispatchInvitation — shared single/CSV send path', () => {
  let service: InvitationService;
  let invitationDAO: any;
  let userDAO: any;
  let emailQueue: any;
  let emitterService: any;
  const cuid = 'test-client-cuid';
  const inviterId = new Types.ObjectId().toString();
  const clientId = new Types.ObjectId().toString();

  const inviterWithRole = (role: string) => ({
    _id: inviterId,
    email: 'inviter@test.com',
    cuids: [{ cuid, isConnected: true, roles: [role] }],
    profile: { fullname: 'Ivy Inviter' },
  });

  const invite = (overrides: Record<string, unknown> = {}) =>
    ({
      inviteeEmail: 'new.person@test.com',
      role: 'tenant',
      status: 'pending',
      personalInfo: { firstName: 'New', lastName: 'Person' },
      metadata: {},
      ...overrides,
    }) as any;

  beforeEach(() => {
    invitationDAO = {
      findPendingInvitation: jest.fn().mockResolvedValue(null),
      countDocuments: jest.fn().mockResolvedValue(0),
      createInvitation: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        invitationToken: 'tok',
        expiresAt: new Date(),
      }),
    };
    userDAO = {
      getUserById: jest.fn().mockResolvedValue(inviterWithRole('manager')),
      getUserWithClientAccess: jest.fn().mockResolvedValue(null),
    };
    emailQueue = { addToEmailQueue: jest.fn() };
    emitterService = { emit: jest.fn(), on: jest.fn() };

    service = new InvitationService({
      invitationCsvProcessor: {} as any,
      invitationDAO,
      userDAO,
      clientDAO: {
        getClientByCuid: jest.fn().mockResolvedValue({
          _id: clientId,
          id: clientId,
          cuid,
          isVerified: true,
          displayName: 'Co',
        }),
      },
      profileDAO: {},
      queueFactory: { getQueue: jest.fn().mockReturnValue(emailQueue) },
      emitterService,
      profileService: {},
      vendorService: {},
      userService: {},
      subscriptionService: {
        getAvailableSeats: jest.fn().mockResolvedValue({ availableSeats: 5 }),
      },
      leaseDAO: {},
      paymentProcessorDAO: {},
      paymentGatewayService: {},
      userCache: {},
    } as any);
  });

  it('never grants account-owner roles, even when schema validation was skipped', async () => {
    await expect(
      service.dispatchInvitation(inviterId, cuid, invite({ role: 'super-admin' }))
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.dispatchInvitation(inviterId, cuid, invite({ role: 'root-admin' }))
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(invitationDAO.createInvitation).not.toHaveBeenCalled();
  });

  it('rejects super-admin at the single-invite schema too', async () => {
    await expect(
      service.sendInvitation(inviterId, cuid, invite({ role: 'super-admin' }))
    ).rejects.toThrow();
    expect(invitationDAO.createInvitation).not.toHaveBeenCalled();
  });

  it('only lets admins invite admins', async () => {
    await expect(
      service.dispatchInvitation(inviterId, cuid, invite({ role: 'admin' }))
    ).rejects.toBeInstanceOf(ForbiddenError);

    userDAO.getUserById.mockResolvedValue(inviterWithRole('admin'));
    await expect(
      service.dispatchInvitation(inviterId, cuid, invite({ role: 'admin' }))
    ).resolves.toEqual(expect.objectContaining({ success: true }));
  });

  it('rejects inviting yourself', async () => {
    await expect(
      service.dispatchInvitation(inviterId, cuid, invite({ inviteeEmail: 'INVITER@test.com' }))
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('emails with the client (branding + sent status) and counts the seat', async () => {
    await service.dispatchInvitation(inviterId, cuid, invite({ role: 'staff' }));

    const [, payload] = emailQueue.addToEmailQueue.mock.calls[0];
    expect(payload.client).toEqual({ cuid, id: clientId });
    expect(payload.invitationId).toEqual(expect.any(String));
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.INVITATION_SENT,
      expect.objectContaining({ role: 'staff', cuid })
    );
  });

  it('saves drafts without emailing or counting a seat', async () => {
    await service.dispatchInvitation(inviterId, cuid, invite({ status: 'draft' }));

    expect(invitationDAO.createInvitation).toHaveBeenCalled();
    expect(emailQueue.addToEmailQueue).not.toHaveBeenCalled();
    expect(emitterService.emit).not.toHaveBeenCalledWith(
      EventTypes.INVITATION_SENT,
      expect.anything()
    );
  });
});
