/**
 * DSARService — exportUserData tests
 *
 * The export speaks public ids: the supervisor stored as a User ObjectId in
 * employeeInfo.reportsTo leaves the API as the supervisor's uid.
 */
import { Types } from 'mongoose';

jest.mock('@di/index', () => ({ container: {} }));

import { DSARService } from '@services/dsar/dsar.service';

const CUID = 'TEST_CUID';
const UID = 'TEST_UID';

const makeUser = () => ({
  _id: new Types.ObjectId(),
  uid: UID,
  email: 'staff@test.com',
  isActive: true,
  cuids: [{ cuid: CUID, roles: ['staff'], isConnected: true, clientDisplayName: 'Test Co' }],
});

const makeService = (employeeInfo: Record<string, any>, supervisor: { uid: string } | null) => {
  const userService = { findSupervisor: jest.fn().mockResolvedValue(supervisor) };
  const service = new DSARService({
    userDAO: { getUserByUId: jest.fn().mockResolvedValue(makeUser()) },
    clientDAO: {},
    leaseDAO: { list: jest.fn().mockResolvedValue({ items: [] }) },
    propertyDAO: {},
    profileDAO: {
      getProfileByUserId: jest.fn().mockResolvedValue({ personalInfo: {}, employeeInfo }),
    },
    userCache: {},
    authCache: {},
    s3Service: {},
    userService,
    emitterService: { emit: jest.fn(), on: jest.fn() },
    vendorService: {},
    queueFactory: { getQueue: jest.fn() },
  } as any);
  return { service, userService };
};

describe('DSARService — exportUserData employeeInfo', () => {
  const supervisorId = new Types.ObjectId();

  it("exports the supervisor's uid in place of the stored ObjectId", async () => {
    const { service, userService } = makeService(
      { jobTitle: 'Leasing Agent', reportsTo: supervisorId, permissions: ['x'] },
      { uid: 'SUPERVISOR01' }
    );

    const exported = await service.exportUserData(UID, CUID);

    expect(userService.findSupervisor).toHaveBeenCalledWith(supervisorId, CUID);
    expect(exported.employeeInfo).toEqual({ jobTitle: 'Leasing Agent', reportsTo: 'SUPERVISOR01' });
  });

  it('leaves reportsTo out when the supervisor is not found in the client', async () => {
    const { service } = makeService({ jobTitle: 'Leasing Agent', reportsTo: supervisorId }, null);

    const exported = await service.exportUserData(UID, CUID);

    expect(exported.employeeInfo).toEqual({ jobTitle: 'Leasing Agent' });
    expect(JSON.stringify(exported)).not.toContain(supervisorId.toString());
  });
});
