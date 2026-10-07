import { Types } from 'mongoose';
import { BadRequestError } from '@shared/customErrors';
import { ProfileService } from '@services/profile/profile.service';

describe('ProfileService — notification preference updates', () => {
  const userId = new Types.ObjectId().toString();
  const profileId = new Types.ObjectId().toString();
  const findFirst = jest.fn();
  const service = new ProfileService({
    profileDAO: { findFirst },
    emitterService: { on: jest.fn(), emit: jest.fn() },
  } as any);
  const clean = (update: Record<string, unknown>, editorId = userId, role = 'tenant') =>
    (service as any).cleanNotificationUpdate(update, profileId, userId, role, { sub: editorId });

  beforeEach(() => {
    findFirst.mockResolvedValue({
      settings: { notifications: { emailNotifications: true, inAppNotifications: false } },
      employeeInfo: {},
    });
  });

  it("ignores notification changes when someone edits another user's profile", async () => {
    await expect(
      clean({ payments: false }, new Types.ObjectId().toString())
    ).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("keeps only the categories the user's role can change", async () => {
    await expect(clean({ payments: false, approvals: false })).resolves.toEqual({
      payments: false,
    });
  });

  it('rejects switching off the last remaining channel', async () => {
    await expect(clean({ emailNotifications: false })).rejects.toBeInstanceOf(BadRequestError);
  });
});
