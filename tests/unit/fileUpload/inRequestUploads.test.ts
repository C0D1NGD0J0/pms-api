import { Types } from 'mongoose';
import { UserController } from '@controllers/UserController';
import { LeaseService } from '@services/lease/lease.service';
import { ProfileService } from '@services/profile/profile.service';
import { InspectionStatus } from '@interfaces/inspection.interface';
import { InspectionService } from '@services/inspection/inspection.service';
import { MaintenanceRequestStatus } from '@interfaces/maintenanceRequest.interface';
import { MaintenanceRequestService } from '@services/maintenanceRequest/serviceRequest.service';

// User uploads are saved during the request that sends them: the files go to S3, then onto
// the record in the same write, and are removed from S3 again if that write fails.

const USER_ID = new Types.ObjectId().toString();
const CUID = 'C1';

const s3Result = (name: string, fieldName = 'media') => ({
  key: `x/${name}`,
  url: `https://s3.example.com/${name}`,
  filename: name,
  fieldName,
  resourceId: 'R1',
  publicuid: 'R1',
});
const scannedFile = (fieldName: string) => ({ fieldName, path: `/tmp/${fieldName}` }) as any;

const makeMediaUploadService = (uploads: any[]) => ({
  uploadRequestFiles: jest.fn().mockResolvedValue(uploads),
  removeUploadedFiles: jest.fn().mockResolvedValue(undefined),
  handleAvatarDeletion: jest.fn().mockResolvedValue(undefined),
});
const makeSseService = () => ({ broadcastToClient: jest.fn().mockResolvedValue(undefined) });
// Signing replaces the URL the way S3Service.signFileUrls does
const makeS3Service = () => ({
  signFileUrls: jest.fn(async (items: any[]) => {
    items.forEach((item) => (item.url = `signed:${item.key}`));
    return items;
  }),
});

/** Builds a service from its prototype with only the dependencies a test needs. */
const serviceWith = <T>(ServiceClass: { prototype: T }, deps: Record<string, unknown>): T =>
  Object.assign(Object.create(ServiceClass.prototype as object), {
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ...deps,
  }) as T;

describe('MaintenanceRequestService — media saved with the request', () => {
  const ctx = {
    currentuser: { sub: USER_ID, client: { role: 'manager', cuid: CUID } },
    request: { params: { cuid: CUID } },
  } as any;
  const storedRequest = () => ({
    _id: new Types.ObjectId(),
    mruid: 'MR1',
    cuid: CUID,
    status: MaintenanceRequestStatus.OPEN,
    title: 'Leak',
    description: { text: 'Leak' },
    media: [{ key: 'x/old.jpg', url: 'https://s3.example.com/old.jpg', status: 'active' }],
  });

  const makeService = (uploads: any[], updateById: jest.Mock) => {
    const request = storedRequest();
    const maintenanceRequestDAO = {
      getByMruid: jest.fn().mockResolvedValue(request),
      startSession: jest.fn().mockResolvedValue({}),
      withTransaction: jest.fn((_session, fn) => fn({})),
      updateById,
    };
    const mediaUploadService = makeMediaUploadService(uploads);
    const sseService = makeSseService();
    const service = serviceWith(MaintenanceRequestService, {
      maintenanceRequestDAO,
      mediaUploadService,
      sseService,
      s3Service: makeS3Service(),
      emitterService: { emit: jest.fn() },
      vendorSuggestionService: { runAITriage: jest.fn().mockResolvedValue(undefined) },
    });
    return { service, request, maintenanceRequestDAO, mediaUploadService, sseService };
  };

  it('pushes the uploaded media in the same write as the edit and returns it signed', async () => {
    const updateById = jest.fn(async (_id, ops) => ({
      ...storedRequest(),
      title: 'Leak under sink',
      media: [...storedRequest().media, ...ops.$push.media.$each],
    }));
    const { service, mediaUploadService, sseService } = makeService(
      [s3Result('new.jpg')],
      updateById
    );

    const result = await service.updateRequest(ctx, 'MR1', { title: 'Leak under sink' } as any, [
      scannedFile('media[0][file]'),
    ]);

    expect(mediaUploadService.uploadRequestFiles).toHaveBeenCalledWith(
      { scannedFiles: [expect.objectContaining({ fieldName: 'media[0][file]' })] },
      { resourceName: 'maintenance', resourceId: 'MR1', fieldName: 'media', actorId: USER_ID }
    );
    expect(updateById).toHaveBeenCalledTimes(1);
    expect(updateById.mock.calls[0][1]).toEqual({
      $set: expect.objectContaining({ title: 'Leak under sink' }),
      $push: {
        media: {
          $each: [
            expect.objectContaining({ key: 'x/new.jpg', filename: 'new.jpg', status: 'active' }),
          ],
        },
      },
    });
    expect(result.data.media.map((item: any) => item.url)).toEqual([
      'signed:x/old.jpg',
      'signed:x/new.jpg',
    ]);
    expect(sseService.broadcastToClient).toHaveBeenCalledWith(
      CUID,
      { resource: 'maintenance', action: 'media-updated', resourceUId: 'MR1', count: 1 },
      'resource-event'
    );
    expect(mediaUploadService.removeUploadedFiles).not.toHaveBeenCalled();
  });

  it('soft-deletes removed media and pushes new media in two writes of one transaction', async () => {
    const updateById = jest.fn().mockResolvedValue(storedRequest());
    const { service, maintenanceRequestDAO } = makeService([s3Result('new.jpg')], updateById);

    await service.updateRequest(ctx, 'MR1', { mediaToRemove: ['x/old.jpg'] } as any, [
      scannedFile('media[0][file]'),
    ]);

    expect(maintenanceRequestDAO.withTransaction).toHaveBeenCalledTimes(1);
    expect(updateById.mock.calls[0][1].$set).toEqual(
      expect.objectContaining({ 'media.$[elem].status': 'deleted' })
    );
    expect(updateById.mock.calls[0][1].$push).toBeUndefined();
    expect(updateById.mock.calls[1][1]).toEqual({
      $push: { media: { $each: [expect.objectContaining({ key: 'x/new.jpg' })] } },
    });
  });

  it('removes the uploaded files from S3 when the write fails', async () => {
    const uploads = [s3Result('new.jpg')];
    const updateById = jest.fn().mockRejectedValue(new Error('write conflict'));
    const { service, mediaUploadService, sseService } = makeService(uploads, updateById);

    await expect(
      service.updateRequest(ctx, 'MR1', { title: 'x' } as any, [scannedFile('media[0][file]')])
    ).rejects.toThrow('write conflict');

    expect(mediaUploadService.removeUploadedFiles).toHaveBeenCalledWith(uploads);
    expect(sseService.broadcastToClient).not.toHaveBeenCalled();
  });

  it('uploads nothing when the edit is not allowed', async () => {
    const { service, request, mediaUploadService } = makeService([s3Result('new.jpg')], jest.fn());
    request.status = MaintenanceRequestStatus.COMPLETED;

    await expect(
      service.updateRequest(ctx, 'MR1', { title: 'x' } as any, [scannedFile('media[0][file]')])
    ).rejects.toThrow();
    expect(mediaUploadService.uploadRequestFiles).not.toHaveBeenCalled();
  });
});

describe('InspectionService — room media saved with the update', () => {
  const storedInspection = () => ({
    _id: new Types.ObjectId(),
    iuid: 'INS1',
    cuid: CUID,
    status: InspectionStatus.IN_PROGRESS,
    type: 'move_in',
    rooms: [
      { name: 'Kitchen', items: [], media: [] },
      { name: 'Bath', items: [], media: [] },
    ],
  });

  const makeService = (uploads: any[], updateById: jest.Mock) => {
    const inspectionDAO = {
      getByIuid: jest.fn().mockResolvedValue(storedInspection()),
      updateById,
    };
    const mediaUploadService = makeMediaUploadService(uploads);
    const sseService = makeSseService();
    const service = serviceWith(InspectionService, {
      inspectionDAO,
      mediaUploadService,
      sseService,
      s3Service: makeS3Service(),
      emitterService: { emit: jest.fn() },
    });
    return { service, mediaUploadService, sseService };
  };

  it('pushes a room file into that room when the update does not replace the rooms', async () => {
    const updateById = jest.fn().mockResolvedValue(storedInspection());
    const { service, sseService } = makeService(
      [s3Result('sink.jpg', 'rooms[1][media][0][file]')],
      updateById
    );

    await service.updateInspection(CUID, USER_ID, 'manager', 'INS1', {} as any, [
      scannedFile('rooms[1][media][0][file]'),
    ]);

    expect(updateById).toHaveBeenCalledTimes(1);
    expect(updateById.mock.calls[0][1].$push).toEqual({
      'rooms.1.media': {
        $each: [expect.objectContaining({ key: 'x/sink.jpg', status: 'active' })],
      },
    });
    expect(sseService.broadcastToClient).toHaveBeenCalledWith(
      CUID,
      { resource: 'inspection', action: 'media-updated', resourceUId: 'INS1', count: 1 },
      'resource-event'
    );
  });

  it('adds a room file to the replacement rooms in the same $set when rooms are edited', async () => {
    const updateById = jest.fn(async (_id, ops) => ({
      ...storedInspection(),
      rooms: ops.$set.rooms,
    }));
    const { service } = makeService([s3Result('sink.jpg', 'rooms[0][media][0][file]')], updateById);

    const result = await service.updateInspection(
      CUID,
      USER_ID,
      'manager',
      'INS1',
      { rooms: [{ name: 'Kitchen', items: [], media: [] }] } as any,
      [scannedFile('rooms[0][media][0][file]')]
    );

    const ops = updateById.mock.calls[0][1];
    expect(ops.$push).toBeUndefined();
    expect(ops.$set.rooms[0].media).toEqual([expect.objectContaining({ key: 'x/sink.jpg' })]);
    expect((result.data as any).rooms[0].media[0].url).toBe('signed:x/sink.jpg');
  });

  it('removes the uploaded files from S3 when the write fails', async () => {
    const uploads = [s3Result('sink.jpg', 'rooms[0][media][0][file]')];
    const { service, mediaUploadService } = makeService(uploads, jest.fn().mockResolvedValue(null));

    await service.updateInspection(CUID, USER_ID, 'manager', 'INS1', {} as any, [
      scannedFile('rooms[0][media][0][file]'),
    ]);

    expect(mediaUploadService.removeUploadedFiles).toHaveBeenCalledWith(uploads);
  });
});

describe('LeaseService.addUploadedDocuments — documents sent with a lease edit', () => {
  const lease = { _id: new Types.ObjectId(), luid: 'L1', cuid: CUID };

  const makeService = (updateLeaseDocuments: jest.Mock) => {
    const mediaUploadService = makeMediaUploadService([s3Result('addendum.pdf', 'leaseDocument')]);
    const leaseCache = {
      invalidateLease: jest.fn().mockResolvedValue({ success: true }),
      invalidateLeaseLists: jest.fn().mockResolvedValue({ success: true }),
    };
    const service = serviceWith(LeaseService, {
      leaseDAO: { findFirst: jest.fn().mockResolvedValue(lease) },
      leaseDocumentService: { updateLeaseDocuments },
      mediaUploadService,
      leaseCache,
      s3Service: makeS3Service(),
    });
    return { service, mediaUploadService, leaseCache };
  };

  it('attaches the uploads, refreshes the lease caches and returns the documents signed', async () => {
    const updateLeaseDocuments = jest.fn().mockResolvedValue({
      data: { ...lease, leaseDocuments: [{ key: 'x/addendum.pdf', url: 'raw' }] },
    });
    const { service, mediaUploadService, leaseCache } = makeService(updateLeaseDocuments);

    const updated = await service.addUploadedDocuments(
      CUID,
      'L1',
      [scannedFile('leaseDocument[0].file')],
      USER_ID
    );

    expect(mediaUploadService.uploadRequestFiles).toHaveBeenCalledWith(expect.anything(), {
      resourceName: 'lease',
      resourceId: lease._id.toString(),
      fieldName: 'leaseDocument',
      actorId: USER_ID,
    });
    expect(updateLeaseDocuments).toHaveBeenCalledWith(
      lease._id.toString(),
      [expect.objectContaining({ key: 'x/addendum.pdf' })],
      USER_ID
    );
    expect(updated!.leaseDocuments![0].url).toBe('signed:x/addendum.pdf');
    expect(leaseCache.invalidateLease).toHaveBeenCalledWith(CUID, 'L1');
    expect(leaseCache.invalidateLeaseLists).toHaveBeenCalledWith(CUID);
  });

  it('removes the uploads from S3 when attaching fails', async () => {
    const { service, mediaUploadService, leaseCache } = makeService(
      jest.fn().mockRejectedValue(new Error('lease not found'))
    );

    await expect(
      service.addUploadedDocuments(CUID, 'L1', [scannedFile('leaseDocument[0].file')], USER_ID)
    ).rejects.toThrow('lease not found');

    expect(mediaUploadService.removeUploadedFiles).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'x/addendum.pdf' }),
    ]);
    expect(leaseCache.invalidateLease).not.toHaveBeenCalled();
  });

  it('does nothing when no files were sent', async () => {
    const { service, mediaUploadService } = makeService(jest.fn());

    await expect(service.addUploadedDocuments(CUID, 'L1', undefined, USER_ID)).resolves.toBeNull();
    expect(mediaUploadService.uploadRequestFiles).not.toHaveBeenCalled();
  });
});

describe('ProfileService.saveUploadedAvatar — avatar saved in the profile request', () => {
  const profileId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  const makeService = (updateById: jest.Mock) => {
    const mediaUploadService = makeMediaUploadService([s3Result('me.png', 'avatar')]);
    const authCache = { invalidateCurrentUser: jest.fn().mockResolvedValue(undefined) };
    const userCache = {
      invalidateUserDetail: jest.fn().mockResolvedValue(undefined),
      invalidateUserLists: jest.fn().mockResolvedValue(undefined),
    };
    const service = serviceWith(ProfileService, {
      userDAO: { findFirst: jest.fn().mockResolvedValue({ profile: { _id: profileId } }) },
      profileDAO: {
        findFirst: jest.fn().mockResolvedValue({
          personalInfo: { avatar: { key: 'profile/old.png', url: 'old' } },
        }),
        updateById,
      },
      mediaUploadService,
      authCache,
      userCache,
    });
    return { service, mediaUploadService, authCache, userCache };
  };

  it('saves the S3 key and URL, then queues the old avatar for deletion', async () => {
    const updatedProfile = { user: userId, personalInfo: { avatar: { key: 'x/me.png' } } };
    const updateById = jest.fn().mockResolvedValue(updatedProfile);
    const { service, mediaUploadService, authCache, userCache } = makeService(updateById);

    const profile = await service.saveUploadedAvatar(
      CUID,
      'UID1',
      [scannedFile('receipt.file'), scannedFile('personalInfo.avatar.file')],
      USER_ID
    );

    expect(mediaUploadService.uploadRequestFiles).toHaveBeenCalledWith(
      { scannedFiles: [expect.objectContaining({ fieldName: 'personalInfo.avatar.file' })] },
      { resourceName: 'profile', resourceId: 'UID1', fieldName: 'avatar', actorId: USER_ID }
    );
    expect(updateById).toHaveBeenCalledWith(profileId.toString(), {
      $set: {
        'personalInfo.avatar.url': 'https://s3.example.com/me.png',
        'personalInfo.avatar.filename': 'me.png',
        'personalInfo.avatar.key': 'x/me.png',
      },
    });
    expect(mediaUploadService.handleAvatarDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'profile/old.png' }),
      { key: 'x/me.png' }
    );
    expect(profile).toBe(updatedProfile);
    expect(authCache.invalidateCurrentUser).toHaveBeenCalledWith(userId.toString(), CUID);
    expect(userCache.invalidateUserDetail).toHaveBeenCalledWith(CUID, 'UID1');
  });

  it('removes the new avatar from S3 and keeps the old one when the save fails', async () => {
    const { service, mediaUploadService } = makeService(jest.fn().mockResolvedValue(null));

    await expect(
      service.saveUploadedAvatar(CUID, 'UID1', [scannedFile('personalInfo.avatar.file')], USER_ID)
    ).rejects.toThrow();

    expect(mediaUploadService.removeUploadedFiles).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'x/me.png' }),
    ]);
    expect(mediaUploadService.handleAvatarDeletion).not.toHaveBeenCalled();
  });

  it('returns null without uploading when no avatar file was sent', async () => {
    const { service, mediaUploadService } = makeService(jest.fn());

    await expect(service.saveUploadedAvatar(CUID, 'UID1', [], USER_ID)).resolves.toBeNull();
    expect(mediaUploadService.uploadRequestFiles).not.toHaveBeenCalled();
  });
});

describe('UserController — profile edits', () => {
  const makeController = () => {
    const profileService = {
      updateUserProfile: jest.fn().mockResolvedValue({ success: true, data: { id: 'P1' } }),
      saveUploadedAvatar: jest.fn().mockResolvedValue({ id: 'P1', personalInfo: { avatar: {} } }),
    };
    const controller = new UserController({
      profileService: profileService as any,
      userService: {} as any,
      smsService: {} as any,
      queueFactory: {} as any,
      mediaUploadService: {} as any,
    });
    return { controller, profileService };
  };
  const makeRes = () => {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  it('saves the avatar after the profile edit and returns the profile carrying it', async () => {
    const { controller, profileService } = makeController();
    const res = makeRes();
    const files = [scannedFile('personalInfo.avatar.file')];

    await controller.updateUserProfile(
      {
        params: { cuid: CUID },
        query: {},
        body: {},
        scannedFiles: files,
        context: { currentuser: { sub: USER_ID, uid: 'UID1' } },
      } as any,
      res
    );

    expect(profileService.saveUploadedAvatar).toHaveBeenCalledWith(CUID, 'UID1', files, USER_ID);
    expect(profileService.updateUserProfile.mock.invocationCallOrder[0]).toBeLessThan(
      profileService.saveUploadedAvatar.mock.invocationCallOrder[0]
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { id: 'P1', personalInfo: { avatar: {} } },
    });
  });

  it('returns the saved avatar under personalInfo after a tenant profile edit', async () => {
    const avatar = { url: 'https://s3.example.com/me.png', key: 'x/me.png', filename: 'me.png' };
    const userService = {
      updateTenantProfile: jest.fn().mockResolvedValue({ success: true, data: { uid: 'UID1' } }),
    };
    const profileService = {
      saveUploadedAvatar: jest.fn().mockResolvedValue({ personalInfo: { avatar } }),
    };
    const controller = new UserController({
      profileService: profileService as any,
      userService: userService as any,
      smsService: {} as any,
      queueFactory: {} as any,
      mediaUploadService: {} as any,
    });
    const res = makeRes();
    const files = [scannedFile('personalInfo.avatar.file')];

    await controller.updateTenantProfile(
      {
        params: { cuid: CUID, uid: 'UID1' },
        body: {},
        scannedFiles: files,
        context: { currentuser: { sub: USER_ID, uid: 'UID1' } },
      } as any,
      res
    );

    expect(profileService.saveUploadedAvatar).toHaveBeenCalledWith(CUID, 'UID1', files, USER_ID);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { uid: 'UID1', personalInfo: { avatar } },
    });
  });
});
