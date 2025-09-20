import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';

describe('MediaUploadService', () => {
  let mediaUploadService: MediaUploadService;
  let mockAssetService: any;
  let mockUploadQueue: any;

  const createMockService = () => {
    mockAssetService = {
      deleteAsset: jest.fn(),
      createAssets: jest.fn(),
    };

    mockUploadQueue = {
      addToUploadQueue: jest.fn(),
      addToRemovalQueue: jest.fn(),
    };

    return new MediaUploadService({
      assetService: mockAssetService,
      uploadQueue: mockUploadQueue,
    });
  };

  beforeEach(() => {
    mediaUploadService = createMockService();
    jest.clearAllMocks();
  });

  describe('handleFiles', () => {
    const createMockRequest = (scannedFiles: any[] = []) =>
      ({
        body: { scannedFiles },
      }) as any;

    const createContext = (resourceId = 'property123', userId = 'user123') => ({
      primaryResourceId: resourceId,
      uploadedBy: userId,
    });

    it('should handle files successfully and queue them for processing', async () => {
      const mockRequest = createMockRequest([
        {
          fieldName: 'images.0',
          filename: 'test-image.jpg',
          mimeType: 'image/jpeg',
          buffer: Buffer.from('test'),
          size: 1024,
        },
      ]);

      const result = await mediaUploadService.handleFiles(mockRequest, createContext());

      expect(result.hasFiles).toBe(true);
      expect(result.totalQueued).toBe(1);
      expect(mockUploadQueue.addToUploadQueue).toHaveBeenCalledWith(
        'mediaUploadJob',
        expect.objectContaining({
          resource: expect.objectContaining({
            resourceName: 'property',
            resourceId: 'property123',
            fieldName: 'images',
            actorId: 'user123',
          }),
          files: [
            expect.objectContaining({
              fieldName: 'images.0',
              filename: 'test-image.jpg',
              mimeType: 'image/jpeg',
            }),
          ],
        })
      );
    });

    it('should return no files result when no scanned files present', async () => {
      const mockRequest = createMockRequest();
      const result = await mediaUploadService.handleFiles(mockRequest, createContext());

      expect(result).toMatchObject({
        hasFiles: false,
        totalQueued: 0,
        message: 'No files to process',
      });
      expect(mockUploadQueue.addToUploadQueue).not.toHaveBeenCalled();
    });

    it('should handle avatar files for profile context', async () => {
      const mockRequest = createMockRequest([
        {
          fieldName: 'personalInfo.avatar',
          filename: 'avatar.png',
          mimeType: 'image/png',
          buffer: Buffer.from('avatar'),
          size: 512,
        },
      ]);

      const result = await mediaUploadService.handleFiles(mockRequest, createContext('user123'));

      expect(result.hasFiles).toBe(true);
      expect(mockUploadQueue.addToUploadQueue).toHaveBeenCalledWith(
        'mediaUploadJob',
        expect.objectContaining({
          resource: expect.objectContaining({
            resourceName: 'profile',
            resourceId: 'user123',
            fieldName: 'avatar',
          }),
        })
      );
    });

    it('should throw error when processing fails', async () => {
      const mockRequest = createMockRequest([
        {
          fieldName: 'images.0',
          filename: 'test.jpg',
          mimeType: 'image/jpeg',
        },
      ]);

      mockUploadQueue.addToUploadQueue.mockImplementation(() => {
        throw new Error('Queue error');
      });

      await expect(mediaUploadService.handleFiles(mockRequest, createContext())).rejects.toThrow(
        'Queue error'
      );
    });
  });

  describe('handleMediaDeletion', () => {
    const createMediaArray = (assets: any[]) =>
      assets.map((asset: any, index: number) => ({
        _id: `asset${index + 1}`,
        key: `file${index + 1}.jpg`,
        status: asset.status,
        ...asset,
      }));

    beforeEach(() => {
      mockAssetService.deleteAsset.mockResolvedValue({ success: true });
    });

    it('should perform soft delete by default', async () => {
      const currentMedia = createMediaArray([{ status: 'active' }, { status: 'active' }]);
      const newMedia = createMediaArray([{ status: 'active' }, { status: 'deleted' }]);

      await mediaUploadService.handleMediaDeletion(currentMedia, newMedia, 'user123', false);

      expect(mockAssetService.deleteAsset).toHaveBeenCalledWith('asset2', 'user123');
      expect(mockUploadQueue.addToRemovalQueue).not.toHaveBeenCalled();
    });

    it('should perform hard delete when hardDelete is true', async () => {
      const currentMedia = createMediaArray([{ status: 'active' }, { status: 'active' }]);
      const newMedia = createMediaArray([{ status: 'active' }, { status: 'deleted' }]);

      await mediaUploadService.handleMediaDeletion(currentMedia, newMedia, 'user123', true);

      expect(mockAssetService.deleteAsset).toHaveBeenCalledWith('asset2', 'user123');
      expect(mockUploadQueue.addToRemovalQueue).toHaveBeenCalledWith('mediaRemovalJob', {
        data: ['file2.jpg'],
      });
    });

    it('should handle multiple deletions', async () => {
      const currentMedia = createMediaArray([
        { status: 'active' },
        { status: 'active' },
        { status: 'active' },
      ]);
      const newMedia = createMediaArray([
        { status: 'active' },
        { status: 'deleted' },
        { status: 'deleted' },
      ]);

      await mediaUploadService.handleMediaDeletion(currentMedia, newMedia, 'user123', true);

      expect(mockAssetService.deleteAsset).toHaveBeenCalledTimes(2);
      expect(mockUploadQueue.addToRemovalQueue).toHaveBeenCalledWith('mediaRemovalJob', {
        data: ['file2.jpg', 'file3.jpg'],
      });
    });

    it('should continue processing even if asset service delete fails', async () => {
      const currentMedia = createMediaArray([{ status: 'active' }, { status: 'active' }]);
      const newMedia = createMediaArray([{ status: 'deleted' }, { status: 'deleted' }]);

      mockAssetService.deleteAsset
        .mockRejectedValueOnce(new Error('Asset delete failed'))
        .mockResolvedValueOnce({ success: true });

      await mediaUploadService.handleMediaDeletion(currentMedia, newMedia, 'user123', true);

      expect(mockAssetService.deleteAsset).toHaveBeenCalledTimes(2);
      expect(mockUploadQueue.addToRemovalQueue).toHaveBeenCalledWith('mediaRemovalJob', {
        data: ['file1.jpg', 'file2.jpg'],
      });
    });
  });

  describe('handleAvatarDeletion', () => {
    const createAvatar = (key: string) => ({ key });

    const testCases = [
      {
        name: 'should queue old avatar for deletion when avatar changes',
        current: createAvatar('old-avatar.jpg'),
        new: createAvatar('new-avatar.jpg'),
        shouldQueue: true,
        expectedData: ['old-avatar.jpg'],
      },
      {
        name: 'should queue avatar for deletion when avatar is removed',
        current: createAvatar('current-avatar.jpg'),
        new: undefined,
        shouldQueue: true,
        expectedData: ['current-avatar.jpg'],
      },
      {
        name: 'should not queue deletion when avatar remains the same',
        current: createAvatar('same-avatar.jpg'),
        new: createAvatar('same-avatar.jpg'),
        shouldQueue: false,
      },
      {
        name: 'should not queue deletion when no current avatar exists',
        current: undefined,
        new: createAvatar('new-avatar.jpg'),
        shouldQueue: false,
      },
    ];

    testCases.forEach(({ name, current, new: newAvatar, shouldQueue, expectedData }) => {
      it(name, async () => {
        await mediaUploadService.handleAvatarDeletion(current, newAvatar);

        if (shouldQueue) {
          expect(mockUploadQueue.addToRemovalQueue).toHaveBeenCalledWith('mediaRemovalJob', {
            data: expectedData,
          });
        } else {
          expect(mockUploadQueue.addToRemovalQueue).not.toHaveBeenCalled();
        }
      });
    });
  });

  describe('determineMediaType', () => {
    const testCases = [
      { mimeTypes: ['image/jpeg', 'image/png', 'image/gif'], expected: 'image' },
      { mimeTypes: ['application/pdf', 'application/msword', 'text/plain'], expected: 'document' },
      { mimeTypes: ['video/mp4', 'video/avi'], expected: 'video' },
      { mimeTypes: [undefined, 'unknown/type'], expected: 'unknown' },
    ];

    testCases.forEach(({ mimeTypes, expected }) => {
      it(`should identify ${expected} types correctly`, () => {
        mimeTypes.forEach((mimeType) => {
          expect(mediaUploadService['determineMediaType'](mimeType)).toBe(expected);
        });
      });
    });
  });

  describe('findMediaToDelete', () => {
    it('should identify items marked for deletion', () => {
      const currentMedia = [
        { _id: 'asset1', key: 'file1.jpg', status: 'active' },
        { _id: 'asset2', key: 'file2.jpg', status: 'active' },
      ];

      const newMedia = [
        { _id: 'asset1', key: 'file1.jpg', status: 'active' },
        { _id: 'asset2', key: 'file2.jpg', status: 'deleted' },
      ];

      const toDelete = mediaUploadService['findMediaToDelete'](currentMedia, newMedia);

      expect(toDelete).toMatchObject([{ _id: 'asset2', status: 'deleted' }]);
    });

    it('should only return items with keys or IDs', () => {
      const newMedia = [
        { status: 'deleted' },
        { _id: 'asset1', status: 'deleted' },
        { key: 'file1.jpg', status: 'deleted' },
      ];

      const toDelete = mediaUploadService['findMediaToDelete']([], newMedia);

      expect(toDelete).toHaveLength(2);
      expect(toDelete.every((item) => item._id || item.key)).toBe(true);
    });
  });
});
