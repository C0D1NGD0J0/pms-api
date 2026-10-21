import { Types } from 'mongoose';
import { ICurrentUser } from '@interfaces/user.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { PermissionResource } from '@interfaces/utils.interface';
import { PermissionService } from '@services/permission/permission.service';

const permissionService = new PermissionService();

const CURRENT_SUB = new Types.ObjectId().toString();
const CURRENT_UID = 'ME00000000UI';
const OTHER_SUB = new Types.ObjectId().toString();
const OTHER_UID = 'OTHER0000UID';

// Tenants hold only user read:mine, so `granted` reflects whether ownership was recognised
const tenantUser = {
  sub: CURRENT_SUB,
  uid: CURRENT_UID,
  permissions: [],
  clients: [{ cuid: 'client-1', isConnected: true }],
  client: { cuid: 'client-1', role: ROLES.TENANT },
} as unknown as ICurrentUser;

const canRead = async (resourceData: unknown) =>
  (
    await permissionService.checkUserPermission(
      tenantUser,
      PermissionResource.USER,
      'read',
      resourceData
    )
  ).granted;

describe('PermissionService — USER ownership compares like-for-like ids', () => {
  it('recognises a user document carrying the caller _id', async () => {
    expect(await canRead({ _id: new Types.ObjectId(CURRENT_SUB), uid: CURRENT_UID })).toBe(true);
  });

  it('recognises a uid-only resource matching the caller uid', async () => {
    expect(await canRead({ uid: CURRENT_UID })).toBe(true);
  });

  it('never matches a uid against the caller _id (or vice versa)', async () => {
    expect(await canRead({ uid: CURRENT_SUB })).toBe(false);
    expect(await canRead({ uid: OTHER_UID })).toBe(false);
  });

  it("rejects another user's document", async () => {
    expect(await canRead({ _id: new Types.ObjectId(OTHER_SUB), uid: OTHER_UID })).toBe(false);
  });

  it('classifies bare ids by shape', async () => {
    expect(await canRead(CURRENT_SUB)).toBe(true);
    expect(await canRead(new Types.ObjectId(CURRENT_SUB))).toBe(true);
    expect(await canRead(CURRENT_UID)).toBe(true);
    expect(await canRead(OTHER_SUB)).toBe(false);
    expect(await canRead(OTHER_UID)).toBe(false);
  });
});
