import { Types } from 'mongoose';
import { BadRequestError } from '@shared/customErrors';
import { UserService } from '@services/user/user.service';
import { ProfileService } from '@services/profile/profile.service';
import { ProfileValidations } from '@shared/validations/ProfileValidation';
import { InvitationService } from '@services/invitation/invitation.service';
import { InvitationValidations } from '@shared/validations/InvitationValidation';

const CUID = 'CLIENT000001';
const SUPERVISOR_UID = 'SUPVR0000001';
const supervisorId = new Types.ObjectId();
const employeeId = new Types.ObjectId();

const buildUserService = (userDAO: Record<string, jest.Mock>, extra: Record<string, any> = {}) =>
  new UserService({
    userDAO,
    leaseDAO: {},
    clientDAO: {},
    propertyDAO: {},
    profileDAO: {},
    propertyUnitDAO: {},
    paymentDAO: {},
    maintenanceRequestDAO: {},
    inspectionDAO: {},
    userCache: {},
    vendorService: {},
    emitterService: { on: jest.fn(), emit: jest.fn() },
    permissionService: {},
    queueFactory: {},
    paymentProcessorDAO: {},
    subscriptionDAO: {},
    ...extra,
  } as any);

describe('employeeInfo.reportsTo — supervisor uid contract', () => {
  describe('request schemas', () => {
    const baseInvitation = {
      inviteeEmail: 'invitee@example.com',
      role: 'staff',
      personalInfo: { firstName: 'Jane', lastName: 'Doe' },
      status: 'draft',
    };

    it.each([
      ['sendInvitation', InvitationValidations.sendInvitation],
      ['updateInvitation', InvitationValidations.updateInvitation],
    ])('%s accepts a supervisor uid and rejects an ObjectId or a name', async (_name, schema) => {
      const withReportsTo = (reportsTo: string) => ({
        ...baseInvitation,
        employeeInfo: { jobTitle: 'Agent', reportsTo },
      });

      const parsed = await schema.parseAsync(withReportsTo(SUPERVISOR_UID));
      expect(parsed.employeeInfo?.reportsTo).toBe(SUPERVISOR_UID);

      expect((await schema.safeParseAsync(withReportsTo(supervisorId.toString()))).success).toBe(
        false
      );
      expect((await schema.safeParseAsync(withReportsTo('John Doe'))).success).toBe(false);
    });

    it('profile employeeInfo accepts a supervisor uid and rejects an ObjectId', () => {
      const schema = ProfileValidations.updateEmployeeInfo;

      expect(schema.parse({ reportsTo: SUPERVISOR_UID }).reportsTo).toBe(SUPERVISOR_UID);
      expect(schema.safeParse({ reportsTo: supervisorId.toString() }).success).toBe(false);
    });

    it('CSV rows accept a supervisor uid, treat a blank as unset and reject a name', async () => {
      const csvRow = (employeeInfo_reportsTo: string) => ({
        inviteeEmail: 'staff@example.com',
        role: 'staff',
        firstName: 'Test',
        lastName: 'User',
        status: 'pending',
        employeeInfo_jobTitle: 'Agent',
        employeeInfo_reportsTo,
        cuid: CUID,
      });
      const schema = InvitationValidations.invitationCsv;

      const parsed: any = await schema.parseAsync(csvRow(SUPERVISOR_UID));
      expect(parsed.metadata.employeeInfo.reportsTo).toBe(SUPERVISOR_UID);

      const blank: any = await schema.parseAsync(csvRow('  '));
      expect(blank.metadata.employeeInfo.reportsTo).toBeUndefined();

      expect((await schema.safeParseAsync(csvRow('John Doe'))).success).toBe(false);
      expect((await schema.safeParseAsync(csvRow(supervisorId.toString()))).success).toBe(false);
    });
  });

  describe('UserService.resolveSupervisorId', () => {
    it('resolves the uid to the ObjectId of an active employee of this client', async () => {
      const list = jest
        .fn()
        .mockResolvedValue({ items: [{ uid: SUPERVISOR_UID, _id: supervisorId }] });
      const service = buildUserService({ list });

      await expect(service.resolveSupervisorId(CUID, SUPERVISOR_UID)).resolves.toBe(supervisorId);

      const [filter] = list.mock.calls[0];
      expect(filter.uid).toEqual({ $in: [SUPERVISOR_UID] });
      expect(filter.cuids.$elemMatch).toEqual(
        expect.objectContaining({ cuid: CUID, isConnected: true })
      );
      expect(filter.cuids.$elemMatch.roles.$in).toEqual(
        expect.arrayContaining(['admin', 'manager', 'staff'])
      );
    });

    it("rejects a uid that is not an employee of this client (e.g. another client's user)", async () => {
      const service = buildUserService({ list: jest.fn().mockResolvedValue({ items: [] }) });

      await expect(service.resolveSupervisorId(CUID, SUPERVISOR_UID)).rejects.toBeInstanceOf(
        BadRequestError
      );
    });

    it('rejects an employee reporting to themselves', async () => {
      const list = jest
        .fn()
        .mockResolvedValue({ items: [{ uid: SUPERVISOR_UID, _id: employeeId }] });
      const service = buildUserService({ list });

      await expect(
        service.resolveSupervisorId(CUID, SUPERVISOR_UID, employeeId.toString())
      ).rejects.toBeInstanceOf(BadRequestError);
    });
  });

  describe('UserService.findSupervisor (stored values)', () => {
    it('looks a stored ObjectId up by _id, scoped to the client', async () => {
      const findFirst = jest.fn().mockResolvedValue({ _id: supervisorId, uid: SUPERVISOR_UID });
      const service = buildUserService({ findFirst });

      await service.findSupervisor(supervisorId, CUID);

      expect(findFirst).toHaveBeenCalledWith({
        _id: supervisorId,
        deletedAt: null,
        'cuids.cuid': CUID,
      });
    });

    it('looks a uid up by uid, scoped to the client', async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const service = buildUserService({ findFirst });

      await service.findSupervisor(SUPERVISOR_UID, CUID);

      expect(findFirst).toHaveBeenCalledWith({
        uid: SUPERVISOR_UID,
        deletedAt: null,
        'cuids.cuid': CUID,
      });
    });

    it('ignores values that are neither an ObjectId nor a uid', async () => {
      const findFirst = jest.fn();
      const service = buildUserService({ findFirst });

      await expect(service.findSupervisor('John Doe', CUID)).resolves.toBeNull();
      expect(findFirst).not.toHaveBeenCalled();
    });

    it("getUserSupervisor returns the supervisor's _id for notifications", async () => {
      const findFirst = jest
        .fn()
        .mockResolvedValueOnce({
          _id: employeeId,
          profile: { employeeInfo: { reportsTo: supervisorId } },
        })
        .mockResolvedValueOnce({ _id: supervisorId, uid: SUPERVISOR_UID });
      const service = buildUserService({ findFirst });

      await expect(service.getUserSupervisor(employeeId.toString(), CUID)).resolves.toBe(
        supervisorId.toString()
      );
    });

    it('exposes the supervisor uid and name on the employee detail response', async () => {
      const service = buildUserService(
        { findFirst: jest.fn().mockResolvedValue({ _id: supervisorId, uid: SUPERVISOR_UID }) },
        {
          profileDAO: {
            findFirst: jest.fn().mockResolvedValue({
              personalInfo: { firstName: 'Sam', lastName: 'Boss' },
            }),
          },
          maintenanceRequestDAO: { getStats: jest.fn().mockResolvedValue({}) },
          inspectionDAO: { countDocuments: jest.fn().mockResolvedValue(0) },
          propertyUnitDAO: { countDocuments: jest.fn().mockResolvedValue(0) },
        }
      );

      const info = await (service as any).buildEmployeeInfo(
        { _id: employeeId, uid: 'EMPLOYEE0001', createdAt: new Date() },
        { employeeInfo: { reportsTo: supervisorId } },
        [],
        [],
        CUID
      );

      expect(info.supervisorUid).toBe(SUPERVISOR_UID);
      expect(info.directManager).toBe('Sam Boss');
    });
  });

  describe('ProfileService.updateEmployeeInfo', () => {
    const profileId = new Types.ObjectId().toString();

    const buildProfileService = (resolveSupervisorId: jest.Mock) => {
      const profileDAO = {
        findFirst: jest.fn().mockResolvedValue({ _id: profileId, user: employeeId }),
        updateEmployeeInfo: jest.fn().mockResolvedValue({ _id: profileId }),
      };
      const service = new ProfileService({
        profileDAO,
        userService: { resolveSupervisorId },
        emitterService: { on: jest.fn(), emit: jest.fn() },
      } as any);
      jest.spyOn(service as any, 'ensureClientRoleInfo').mockResolvedValue(undefined);
      return { service, profileDAO };
    };

    it("stores the supervisor's ObjectId resolved from the uid", async () => {
      const resolveSupervisorId = jest.fn().mockResolvedValue(supervisorId);
      const { service, profileDAO } = buildProfileService(resolveSupervisorId);

      await service.updateEmployeeInfo(
        profileId,
        CUID,
        { jobTitle: 'Agent', reportsTo: SUPERVISOR_UID },
        'staff'
      );

      expect(resolveSupervisorId).toHaveBeenCalledWith(CUID, SUPERVISOR_UID, employeeId.toString());
      expect(profileDAO.updateEmployeeInfo).toHaveBeenCalledWith(profileId, CUID, {
        jobTitle: 'Agent',
        reportsTo: supervisorId,
      });
    });

    it('rejects a supervisor from another client without writing', async () => {
      const resolveSupervisorId = jest
        .fn()
        .mockRejectedValue(new BadRequestError({ message: 'Supervisor must be an employee' }));
      const { service, profileDAO } = buildProfileService(resolveSupervisorId);

      await expect(
        service.updateEmployeeInfo(profileId, CUID, { reportsTo: SUPERVISOR_UID }, 'staff')
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(profileDAO.updateEmployeeInfo).not.toHaveBeenCalled();
    });

    it('rejects an ObjectId before resolving anything', async () => {
      const resolveSupervisorId = jest.fn();
      const { service } = buildProfileService(resolveSupervisorId);

      await expect(
        service.updateEmployeeInfo(profileId, CUID, { reportsTo: supervisorId.toString() }, 'staff')
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(resolveSupervisorId).not.toHaveBeenCalled();
    });
  });

  describe('InvitationService', () => {
    const buildInvitationService = (userService: Record<string, jest.Mock>, userDAO = {}) =>
      new InvitationService({
        invitationCsvProcessor: {},
        invitationDAO: {},
        profileDAO: {},
        clientDAO: {},
        userDAO,
        queueFactory: { getQueue: jest.fn() },
        emitterService: { on: jest.fn(), emit: jest.fn() },
        profileService: {},
        vendorService: {},
        userService,
        subscriptionService: {},
        leaseDAO: {},
        paymentProcessorDAO: {},
        paymentGatewayService: {},
        userCache: {},
      } as any);

    it("checks the invitation's supervisor is an employee of this client", async () => {
      const resolveSupervisorId = jest
        .fn()
        .mockRejectedValue(new BadRequestError({ message: 'Supervisor must be an employee' }));
      const service = buildInvitationService({ resolveSupervisorId });

      await expect(
        (service as any).assertSupervisorIsEmployee(CUID, {
          metadata: { employeeInfo: { reportsTo: SUPERVISOR_UID } },
        })
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(resolveSupervisorId).toHaveBeenCalledWith(CUID, SUPERVISOR_UID);
    });

    it('exposes a legacy stored ObjectId as the supervisor uid in responses', async () => {
      const list = jest
        .fn()
        .mockResolvedValue({ items: [{ _id: supervisorId, uid: SUPERVISOR_UID }] });
      const service = buildInvitationService({}, { list });
      const legacy: any = {
        metadata: { employeeInfo: { jobTitle: 'Agent', reportsTo: supervisorId.toString() } },
      };
      const current: any = {
        metadata: { employeeInfo: { jobTitle: 'Agent', reportsTo: 'OTHERSUP0001' } },
      };

      await (service as any).exposeSupervisorUids([legacy, current]);

      expect(legacy.metadata.employeeInfo).toEqual({
        jobTitle: 'Agent',
        reportsTo: SUPERVISOR_UID,
      });
      expect(current.metadata.employeeInfo.reportsTo).toBe('OTHERSUP0001');
    });
  });
});
