import { User } from '@models/index';
import { hashToken } from '@utils/index';
import { Profile, Client } from '@models/index';
import { MailType } from '@interfaces/utils.interface';
import { UserService } from '@services/user/user.service';
import { AuthService } from '@services/auth/auth.service';
import { ROLES } from '@shared/constants/roles.constants';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { PermissionService } from '@services/permission/permission.service';
import { beforeEach, beforeAll, describe, expect, it } from '@jest/globals';
import {
  clearTestDatabase,
  createTestProfile,
  createTestClient,
  createTestUser,
} from '@tests/helpers';

const addToEmailQueue = jest.fn();
const queueFactory = { getQueue: jest.fn(() => ({ addToEmailQueue })) };
const authCache = {
  invalidateUserSession: jest.fn().mockResolvedValue({ success: true }),
  invalidateCurrentUser: jest.fn().mockResolvedValue({ success: true }),
};
const userCache = {
  invalidateUserDetail: jest.fn().mockResolvedValue({ success: true }),
  invalidateUserLists: jest.fn().mockResolvedValue({ success: true }),
};
const subscriptionDAO = { findFirst: jest.fn() };

const queuedEmails = (type: MailType) =>
  addToEmailQueue.mock.calls.map((call) => call[1] as any).filter((job) => job.emailType === type);

const tokenFromLastVerification = (): string => {
  const verifications = queuedEmails(MailType.EMAIL_CHANGE_VERIFICATION);
  const url = new URL(verifications[verifications.length - 1].data.confirmUrl);
  return url.searchParams.get('t') as string;
};

const actorFor = (user: any, cuid: string, role: string) =>
  ({
    sub: user._id.toString(),
    uid: user.uid,
    email: user.email,
    fullname: 'Acting User',
    displayName: 'Acting User',
    client: { cuid, role },
    clients: [{ cuid, isConnected: true, roles: [role] }],
  }) as any;

describe('Email change flow (integration)', () => {
  let userService: UserService;
  let authService: AuthService;
  let userDAO: UserDAO;

  beforeAll(() => {
    userDAO = new UserDAO({ userModel: User });
    const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    const profileDAO = new ProfileDAO({ profileModel: Profile });

    userService = new UserService({
      userDAO,
      clientDAO,
      profileDAO,
      userCache,
      subscriptionDAO,
      queueFactory,
      permissionService: new PermissionService(),
      emitterService: { on: jest.fn(), emit: jest.fn(), off: jest.fn() },
      vendorService: {},
      propertyDAO: {},
      propertyUnitDAO: {},
      inspectionDAO: {},
      leaseDAO: {},
      paymentDAO: {},
      paymentProcessorDAO: {},
      maintenanceRequestDAO: {},
    } as any);

    authService = new AuthService({
      userDAO,
      clientDAO,
      profileDAO,
      authCache,
      userCache,
      queueFactory,
      emitterService: { on: jest.fn(), emit: jest.fn() },
      featureFlagService: { isEnabled: jest.fn().mockReturnValue(false) },
      webAuthnService: {},
      tokenService: {},
      vendorService: {},
      subscriptionService: {},
      leaseDAO: {},
      paymentProcessorDAO: {},
      paymentGatewayService: {},
      paymentService: {},
      twilioService: {},
    } as any);
  });

  let client: any;
  let manager: any;
  let tenant: any;

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
    subscriptionDAO.findFirst.mockResolvedValue(null);

    client = await createTestClient();
    manager = await createTestUser(client.cuid, {
      email: 'manager@test.com',
      roles: [ROLES.MANAGER],
    });
    tenant = await createTestUser(client.cuid, { email: 'tenant@test.com', roles: [ROLES.TENANT] });
    await createTestProfile(tenant._id, client._id);
  });

  describe('requestEmailChange', () => {
    it('stores a hashed token and pending email without touching the login email', async () => {
      const result = await userService.requestEmailChange(
        client.cuid,
        actorFor(tenant, client.cuid, ROLES.TENANT),
        tenant.uid,
        'New.Tenant@Test.com'
      );

      expect(result.success).toBe(true);
      expect(result.data.pendingEmail).toBe('new.tenant@test.com');

      const stored = await User.findById(tenant._id).select(
        '+emailChangeToken +emailChangeTokenExpiresAt'
      );
      expect(stored!.email).toBe('tenant@test.com');
      expect(stored!.pendingEmail).toBe('new.tenant@test.com');

      const plainToken = tokenFromLastVerification();
      expect(stored!.emailChangeToken).not.toBe(plainToken);
      expect(stored!.emailChangeToken).toBe(hashToken(plainToken));

      const hoursLeft = (stored!.emailChangeTokenExpiresAt!.getTime() - Date.now()) / 3_600_000;
      expect(hoursLeft).toBeGreaterThan(23.9);
      expect(hoursLeft).toBeLessThanOrEqual(24);
    });

    it('emails the link to the new address and a notice to the old address', async () => {
      await userService.requestEmailChange(
        client.cuid,
        actorFor(tenant, client.cuid, ROLES.TENANT),
        tenant.uid,
        'fresh@test.com'
      );

      const [verification] = queuedEmails(MailType.EMAIL_CHANGE_VERIFICATION);
      const [notice] = queuedEmails(MailType.EMAIL_CHANGE_NOTICE);
      expect(verification.to).toBe('fresh@test.com');
      expect(verification.data.confirmUrl).toContain('/email_change/confirm?t=');
      expect(notice.to).toBe('tenant@test.com');
      expect(notice.data.stage).toBe('requested');
    });

    it('never exposes the token in the response or JSON output', async () => {
      const result = await userService.requestEmailChange(
        client.cuid,
        actorFor(tenant, client.cuid, ROLES.TENANT),
        tenant.uid,
        'fresh@test.com'
      );
      expect(JSON.stringify(result)).not.toContain(tokenFromLastVerification());

      const stored = await User.findById(tenant._id).select('+emailChangeToken');
      const json = stored!.toJSON() as any;
      expect(json.emailChangeToken).toBeUndefined();
      expect(json.emailChangeTokenExpiresAt).toBeUndefined();
    });

    it('rejects the current email (case-insensitive)', async () => {
      await expect(
        userService.requestEmailChange(
          client.cuid,
          actorFor(tenant, client.cuid, ROLES.TENANT),
          tenant.uid,
          'TENANT@test.com'
        )
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it("rejects an address that is another user's login email", async () => {
      await expect(
        userService.requestEmailChange(
          client.cuid,
          actorFor(tenant, client.cuid, ROLES.TENANT),
          tenant.uid,
          'manager@test.com'
        )
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("rejects an address reserved by another user's pending change", async () => {
      await userService.requestEmailChange(
        client.cuid,
        actorFor(manager, client.cuid, ROLES.MANAGER),
        manager.uid,
        'reserved@test.com'
      );

      await expect(
        userService.requestEmailChange(
          client.cuid,
          actorFor(tenant, client.cuid, ROLES.TENANT),
          tenant.uid,
          'reserved@test.com'
        )
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it('lets a manager start the change for a tenant of the client', async () => {
      const result = await userService.requestEmailChange(
        client.cuid,
        actorFor(manager, client.cuid, ROLES.MANAGER),
        tenant.uid,
        'staff-set@test.com'
      );

      expect(result.data.pendingEmail).toBe('staff-set@test.com');
      const stored = await User.findById(tenant._id);
      expect(stored!.emailChangeRequestedBy).toBe(manager.uid);
      expect(stored!.email).toBe('tenant@test.com');
    });

    it('rejects a tenant who belongs to a different client', async () => {
      const otherClient = await createTestClient();
      const foreignTenant = await createTestUser(otherClient.cuid, {
        email: 'foreign@test.com',
        roles: [ROLES.TENANT],
      });

      await expect(
        userService.requestEmailChange(
          client.cuid,
          actorFor(manager, client.cuid, ROLES.MANAGER),
          foreignTenant.uid,
          'hijack@test.com'
        )
      ).rejects.toMatchObject({ statusCode: 404 });
      expect((await User.findById(foreignTenant._id))!.pendingEmail).toBeUndefined();
    });

    it('rejects changing the email of a non-tenant member', async () => {
      const staff = await createTestUser(client.cuid, {
        email: 'staff@test.com',
        roles: [ROLES.STAFF],
      });

      await expect(
        userService.requestEmailChange(
          client.cuid,
          actorFor(manager, client.cuid, ROLES.MANAGER),
          staff.uid,
          'staff-new@test.com'
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it("rejects a tenant changing another tenant's email", async () => {
      const otherTenant = await createTestUser(client.cuid, {
        email: 'other-tenant@test.com',
        roles: [ROLES.TENANT],
      });

      await expect(
        userService.requestEmailChange(
          client.cuid,
          actorFor(tenant, client.cuid, ROLES.TENANT),
          otherTenant.uid,
          'takeover@test.com'
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('applies the billing lock only to the account owner', async () => {
      subscriptionDAO.findFirst.mockResolvedValue({ billing: { customerId: 'cus_123' } });
      const accountOwner = await User.findById(client.accountAdmin);

      await expect(
        userService.requestEmailChange(
          client.cuid,
          actorFor(accountOwner, client.cuid, ROLES.ADMIN),
          accountOwner!.uid,
          'owner-new@test.com'
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      const result = await userService.requestEmailChange(
        client.cuid,
        actorFor(tenant, client.cuid, ROLES.TENANT),
        tenant.uid,
        'billing-irrelevant@test.com'
      );
      expect(result.success).toBe(true);
    });
  });

  describe('re-sending / cancelEmailChange', () => {
    it('re-sends when the pending address is requested again, rotating the token', async () => {
      const actor = actorFor(tenant, client.cuid, ROLES.TENANT);
      await userService.requestEmailChange(client.cuid, actor, tenant.uid, 'rotate@test.com');
      const firstToken = tokenFromLastVerification();

      const resent = await userService.requestEmailChange(
        client.cuid,
        actor,
        tenant.uid,
        'Rotate@test.com'
      );
      const secondToken = tokenFromLastVerification();

      expect(resent.data.pendingEmail).toBe('rotate@test.com');
      expect(secondToken).not.toBe(firstToken);
      expect(queuedEmails(MailType.EMAIL_CHANGE_VERIFICATION)[1].to).toBe('rotate@test.com');
      expect(queuedEmails(MailType.EMAIL_CHANGE_NOTICE)).toHaveLength(1);
      await expect(authService.confirmEmailChange(firstToken)).rejects.toMatchObject({
        statusCode: 400,
      });
      await authService.confirmEmailChange(secondToken);
      expect((await User.findById(tenant._id))!.email).toBe('rotate@test.com');
    });

    it('cancel clears the pending change and kills the link', async () => {
      const actor = actorFor(manager, client.cuid, ROLES.MANAGER);
      await userService.requestEmailChange(client.cuid, actor, tenant.uid, 'cancel-me@test.com');
      const token = tokenFromLastVerification();

      await userService.cancelEmailChange(client.cuid, actor, tenant.uid);

      const stored = await User.findById(tenant._id).select('+emailChangeToken');
      expect(stored!.pendingEmail).toBeUndefined();
      expect(stored!.emailChangeToken).toBeUndefined();
      await expect(authService.confirmEmailChange(token)).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });

  describe('confirmEmailChange', () => {
    const requestChange = async (newEmail: string) => {
      await userService.requestEmailChange(
        client.cuid,
        actorFor(tenant, client.cuid, ROLES.TENANT),
        tenant.uid,
        newEmail
      );
      return tokenFromLastVerification();
    };

    it('swaps the login email, clears pending fields and invalidates every session', async () => {
      const secondClient = await createTestClient();
      await User.updateOne(
        { _id: tenant._id },
        {
          $push: {
            cuids: {
              cuid: secondClient.cuid,
              roles: [ROLES.TENANT],
              isConnected: true,
              clientDisplayName: 'Second',
            },
          },
        }
      );
      const token = await requestChange('confirmed@test.com');
      addToEmailQueue.mockClear();

      const result = await authService.confirmEmailChange(token);

      expect(result.success).toBe(true);
      const stored = await User.findById(tenant._id).select(
        '+emailChangeToken +emailChangeTokenExpiresAt'
      );
      expect(stored!.email).toBe('confirmed@test.com');
      expect(stored!.pendingEmail).toBeUndefined();
      expect(stored!.emailChangeToken).toBeUndefined();
      expect(stored!.emailChangeTokenExpiresAt).toBeUndefined();

      const userId = tenant._id.toString();
      expect(authCache.invalidateUserSession).toHaveBeenCalledWith(userId, client.cuid);
      expect(authCache.invalidateUserSession).toHaveBeenCalledWith(userId, secondClient.cuid);
      expect(userCache.invalidateUserDetail).toHaveBeenCalledWith(client.cuid, tenant.uid);
      expect(userCache.invalidateUserDetail).toHaveBeenCalledWith(secondClient.cuid, tenant.uid);

      const [notice] = queuedEmails(MailType.EMAIL_CHANGE_NOTICE);
      expect(notice.to).toBe('tenant@test.com');
      expect(notice.data.stage).toBe('completed');
      expect(notice.data.newEmail).toBe('confirmed@test.com');
    });

    it('rejects an expired token', async () => {
      const token = await requestChange('late@test.com');
      await User.updateOne(
        { _id: tenant._id },
        { $set: { emailChangeTokenExpiresAt: new Date(Date.now() - 1000) } }
      );

      await expect(authService.confirmEmailChange(token)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect((await User.findById(tenant._id))!.email).toBe('tenant@test.com');
    });

    it('rejects a token that was already used', async () => {
      const token = await requestChange('once@test.com');
      await authService.confirmEmailChange(token);

      await expect(authService.confirmEmailChange(token)).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('returns 409 when the address was claimed by someone else before confirmation', async () => {
      const token = await requestChange('race@test.com');
      // Bypass the request-time check to simulate a concurrent signup winning the race
      await createTestUser(client.cuid, { email: 'race@test.com' });

      await expect(authService.confirmEmailChange(token)).rejects.toMatchObject({
        statusCode: 409,
      });
      expect((await User.findById(tenant._id))!.email).toBe('tenant@test.com');
      expect(authCache.invalidateUserSession).not.toHaveBeenCalled();
    });
  });

  describe('updateTenantProfile', () => {
    it('no longer changes the login email', async () => {
      await userService.updateTenantProfile(
        client.cuid,
        tenant.uid,
        {
          email: 'sneaky@test.com',
          personalInfo: { firstName: 'Renamed', email: 'sneaky@test.com' },
        },
        { currentuser: actorFor(manager, client.cuid, ROLES.MANAGER) } as any
      );

      const stored = await User.findById(tenant._id);
      expect(stored!.email).toBe('tenant@test.com');
      expect(stored!.pendingEmail).toBeUndefined();
      const profile = await Profile.findOne({ user: tenant._id }).lean();
      expect(profile!.personalInfo.firstName).toBe('Renamed');
      expect((profile!.personalInfo as any).email).toBeUndefined();
    });

    it('requires UPDATE permission, not just READ', async () => {
      const accountingStaff = await createTestUser(client.cuid, {
        email: 'accounting@test.com',
        roles: [ROLES.STAFF],
      });
      const actor = {
        ...actorFor(accountingStaff, client.cuid, ROLES.STAFF),
        employeeInfo: { department: 'accounting' },
      };

      await expect(
        userService.updateTenantProfile(
          client.cuid,
          tenant.uid,
          { personalInfo: { firstName: 'Nope' } },
          { currentuser: actor } as any
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  });
});
