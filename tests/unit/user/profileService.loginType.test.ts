import { Types } from 'mongoose';
import { BadRequestError } from '@shared/customErrors';
import { ProfileService } from '@services/profile/profile.service';

describe('ProfileService — login type updates', () => {
  const userId = new Types.ObjectId().toString();
  const profileId = new Types.ObjectId().toString();
  const getUserPasskeys = jest.fn();
  const service = new ProfileService({
    profileDAO: { findFirst: jest.fn() },
    userDAO: { getUserPasskeys },
    emitterService: { on: jest.fn(), emit: jest.fn() },
  } as any);

  it('rejects choosing passkey when the user has no passkeys registered', async () => {
    getUserPasskeys.mockResolvedValue([]);

    await expect(
      (service as any).processProfileUpdates(
        { settings: { loginType: 'passkey' } },
        profileId,
        userId,
        'CUID1',
        'tenant',
        { sub: userId }
      )
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(getUserPasskeys).toHaveBeenCalledWith(userId);
  });

  it("ignores login type and GDPR changes when someone edits another user's profile", async () => {
    const updateById = jest.fn().mockResolvedValue({});
    const adminService = new ProfileService({
      profileDAO: { findFirst: jest.fn(), updateById },
      userDAO: { getUserPasskeys },
      emitterService: { on: jest.fn(), emit: jest.fn() },
    } as any);
    getUserPasskeys.mockClear();

    await (adminService as any).processProfileUpdates(
      {
        settings: {
          loginType: 'otp',
          theme: 'dark',
          gdprSettings: { dataProcessingConsent: true, dataRetentionPolicy: 'minimal' },
        },
      },
      profileId,
      userId,
      'CUID1',
      'admin',
      { sub: new Types.ObjectId().toString() }
    );

    const written = JSON.stringify(updateById.mock.calls);
    expect(written).toContain('settings.theme');
    expect(written).not.toContain('loginType');
    expect(written).not.toContain('gdprSettings');
    expect(getUserPasskeys).not.toHaveBeenCalled();
  });
});
