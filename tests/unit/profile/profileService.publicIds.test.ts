import { Types } from 'mongoose';
import { ProfileService } from '@services/profile/profile.service';

/**
 * Profiles store ObjectId refs, but invitations and vendor links name people and vendor
 * organisations by public id (user uid, vendor vuid). These cover the profile-side resolution.
 */
const CUID = 'CLIENT000001';
const VUID = 'VENDOR000001';
const userId = new Types.ObjectId();
const supervisorId = new Types.ObjectId();
const vendorObjectId = new Types.ObjectId();

const buildService = (deps: Record<string, any>) => {
  const profile = { id: 'P1', _id: new Types.ObjectId(), user: userId };
  const profileDAO = {
    findFirst: jest.fn().mockResolvedValue(profile),
    updateEmployeeInfo: jest.fn().mockResolvedValue(profile),
    updateVendorReference: jest.fn().mockResolvedValue(profile),
    ...deps.profileDAO,
  };
  const service = new ProfileService({
    emitterService: { on: jest.fn(), emit: jest.fn() },
    userService: {},
    vendorService: {},
    ...deps,
    profileDAO,
  } as any);
  return { service, profileDAO, profile };
};

const stubRoleContext = (service: ProfileService, profile: unknown, role: string) => {
  jest
    .spyOn(service as any, 'validateAndPrepareContext')
    .mockImplementation(async (...args: unknown[]) => ({
      userId: args[0],
      cuid: args[1],
      role,
      linkedVendorUid: args[3],
    }));
  jest.spyOn(service as any, 'fetchUserProfile').mockResolvedValue(profile);
};

describe('ProfileService.initializeRoleInfo — invited supervisor', () => {
  it("stores the supervisor's ObjectId resolved from the invitation's uid", async () => {
    const findSupervisor = jest.fn().mockResolvedValue({ _id: supervisorId, uid: 'SUPVR0000001' });
    const { service, profileDAO, profile } = buildService({ userService: { findSupervisor } });
    stubRoleContext(service, profile, 'staff');

    await service.initializeRoleInfo(userId.toString(), CUID, 'staff', undefined, {
      employeeInfo: { jobTitle: 'Leasing Agent', reportsTo: 'SUPVR0000001' },
    });

    expect(findSupervisor).toHaveBeenCalledWith('SUPVR0000001', CUID);
    expect(profileDAO.updateEmployeeInfo).toHaveBeenCalledWith('P1', CUID, {
      jobTitle: 'Leasing Agent',
      reportsTo: supervisorId,
    });
  });

  it('drops a supervisor who is no longer in the client instead of failing the acceptance', async () => {
    const findSupervisor = jest.fn().mockResolvedValue(null);
    const { service, profileDAO, profile } = buildService({ userService: { findSupervisor } });
    stubRoleContext(service, profile, 'staff');

    const result = await service.initializeRoleInfo(userId.toString(), CUID, 'staff', undefined, {
      employeeInfo: { jobTitle: 'Leasing Agent', reportsTo: 'SUPVR0000001' },
    });

    expect(result.success).toBe(true);
    expect(profileDAO.updateEmployeeInfo).toHaveBeenCalledWith('P1', CUID, {
      jobTitle: 'Leasing Agent',
    });
  });
});

describe('ProfileService.initializeRoleInfo — vendor team member', () => {
  it('links the profile by vuid and records the vendor entity id', async () => {
    const getVendorByVuid = jest.fn().mockResolvedValue({ _id: vendorObjectId, vuid: VUID });
    const { service, profileDAO, profile } = buildService({ vendorService: { getVendorByVuid } });
    stubRoleContext(service, profile, 'vendor');

    await service.initializeRoleInfo(userId.toString(), CUID, 'vendor', VUID, {
      isVendorTeamMember: true,
    });

    expect(getVendorByVuid).toHaveBeenCalledWith(VUID);
    expect(profileDAO.updateVendorReference).toHaveBeenCalledWith('P1', {
      linkedVendorUid: VUID,
      isLinkedAccount: true,
      vendorId: vendorObjectId.toString(),
    });
  });
});

describe('ProfileService.updateVendorInfo', () => {
  it('updates the vendor by vuid and ignores client-sent link fields', async () => {
    const updateVendorInfo = jest.fn().mockResolvedValue({});
    const vendorService = {
      getVendorByUserId: jest.fn().mockResolvedValue({ _id: vendorObjectId, vuid: VUID }),
      updateVendorInfo,
    };
    const { service } = buildService({ vendorService });
    jest.spyOn(service as any, 'ensureClientRoleInfo').mockResolvedValue(undefined);

    await service
      .updateVendorInfo(
        new Types.ObjectId().toString(),
        CUID,
        {
          companyName: 'Fix-It Co',
          vendorId: 'forged',
          linkedVendorUid: 'OTHERVENDOR1',
          isLinkedAccount: true,
        },
        'vendor',
        userId.toString()
      )
      .catch(() => undefined); // only the vendor update call matters here

    expect(updateVendorInfo).toHaveBeenCalledWith(
      VUID,
      { companyName: 'Fix-It Co' },
      undefined,
      userId.toString()
    );
  });
});
