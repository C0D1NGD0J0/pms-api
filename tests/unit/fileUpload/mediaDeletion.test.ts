import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';

describe('MediaUploadService.handleMediaDeletion', () => {
  const assetService = { deleteAsset: jest.fn().mockResolvedValue(undefined) };
  const removalQueue = { addToRemovalQueue: jest.fn() };
  const queueFactory = { getQueue: jest.fn().mockReturnValue(removalQueue) };

  const service = new MediaUploadService({
    assetService: assetService as any,
    queueFactory: queueFactory as any,
    s3Service: {} as any,
    emitterService: {} as any,
  });

  const a = { _id: 'id-a', key: 'property/a.png' };
  const b = { _id: 'id-b', key: 'property/b.png' };

  beforeEach(() => jest.clearAllMocks());

  it('deletes items the new list no longer contains', async () => {
    await service.handleMediaDeletion([a, b], [b], 'actor-1');

    expect(assetService.deleteAsset).toHaveBeenCalledTimes(1);
    expect(assetService.deleteAsset).toHaveBeenCalledWith('id-a', 'actor-1');
  });

  it('deletes everything when the new list is empty', async () => {
    await service.handleMediaDeletion([a, b], [], 'actor-1');

    expect(assetService.deleteAsset).toHaveBeenCalledWith('id-a', 'actor-1');
    expect(assetService.deleteAsset).toHaveBeenCalledWith('id-b', 'actor-1');
  });

  it('still honours items flagged status "deleted", without deleting them twice', async () => {
    await service.handleMediaDeletion([a, b], [{ ...a, status: 'deleted' }, b], 'actor-1');

    expect(assetService.deleteAsset).toHaveBeenCalledTimes(1);
    expect(assetService.deleteAsset).toHaveBeenCalledWith('id-a', 'actor-1');
  });

  it('deletes nothing when every current item is kept', async () => {
    await service.handleMediaDeletion([a, b], [a, b], 'actor-1');

    expect(assetService.deleteAsset).not.toHaveBeenCalled();
    expect(removalQueue.addToRemovalQueue).not.toHaveBeenCalled();
  });

  it('only queues S3 removal for a hard delete', async () => {
    await service.handleMediaDeletion([a, b], [b], 'actor-1');
    expect(removalQueue.addToRemovalQueue).not.toHaveBeenCalled();

    await service.handleMediaDeletion([a, b], [b], 'actor-1', true);
    expect(removalQueue.addToRemovalQueue).toHaveBeenCalledWith(expect.any(String), {
      data: ['property/a.png'],
    });
  });
});
