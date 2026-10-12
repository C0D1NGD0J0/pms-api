import { Types } from 'mongoose';
import { ProfileService } from '@services/profile/profile.service';

describe('ProfileService — login email changes', () => {
  const userObjectId = new Types.ObjectId().toString();
  const profileId = new Types.ObjectId().toString();
  const targetUid = 'TARGETUID01';

  const buildService = () => {
    const requestEmailChange = jest.fn().mockResolvedValue({ success: true });
    const findUser = jest.fn().mockResolvedValue({ uid: targetUid, email: 'current@test.com' });
    const service = new ProfileService({
      profileDAO: { findFirst: jest.fn().mockResolvedValue({ _id: profileId }) },
      userDAO: { findFirst: findUser },
      userService: { requestEmailChange },
      emitterService: { on: jest.fn(), emit: jest.fn() },
    } as any);
    return { service, requestEmailChange, findUser };
  };

  it('starts a verified email change for the already-loaded target user', async () => {
    const { service, requestEmailChange, findUser } = buildService();
    const currentuser = { sub: userObjectId, uid: targetUid };

    await (service as any).processProfileUpdates(
      { userInfo: { email: 'New@Test.com' } },
      profileId,
      userObjectId,
      'CUID1',
      'tenant',
      currentuser,
      targetUid
    );

    expect(findUser).toHaveBeenCalledWith({ uid: targetUid }, { populate: 'profile' });
    expect(requestEmailChange).toHaveBeenCalledWith(
      'CUID1',
      currentuser,
      expect.objectContaining({ uid: targetUid }),
      'new@test.com'
    );
  });

  it('does nothing when the submitted email equals the current one', async () => {
    const { service, requestEmailChange } = buildService();

    await (service as any).processProfileUpdates(
      { userInfo: { email: 'CURRENT@test.com' } },
      profileId,
      userObjectId,
      'CUID1',
      'tenant',
      { sub: userObjectId, uid: targetUid },
      targetUid
    );

    expect(requestEmailChange).not.toHaveBeenCalled();
  });
});
