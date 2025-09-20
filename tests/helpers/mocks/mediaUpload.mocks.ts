// Asset Service Mock
export const createMockAssetService = () => ({
  createAssets: jest.fn().mockResolvedValue([]),
  getAssetsByResource: jest.fn().mockResolvedValue({
    success: true,
    data: [],
    message: 'Assets retrieved successfully',
  }),
  getAssetById: jest.fn().mockResolvedValue({
    success: true,
    data: { _id: 'asset123', originalName: 'test.jpg' },
    message: 'Asset retrieved successfully',
  }),
  deleteAsset: jest.fn().mockResolvedValue({
    success: true,
    data: { deletedAssetId: 'asset123' },
    message: 'Asset deleted successfully',
  }),
  getAssetStats: jest.fn().mockResolvedValue({
    success: true,
    data: {
      totalAssets: 0,
      totalSize: 0,
      assetsByType: {},
    },
    message: 'Asset statistics retrieved successfully',
  }),
  replaceAssetsByField: jest.fn().mockResolvedValue({
    success: true,
    data: [],
    message: 'Assets replaced successfully',
  }),
  destroy: jest.fn(),
});

// Media Upload Service Mock
export const createMockMediaUploadService = () => ({
  handleFiles: jest.fn().mockResolvedValue({
    hasFiles: true,
    processedFiles: {},
    totalQueued: 0,
    message: 'Files processed successfully',
  }),
  handleMediaDeletion: jest.fn().mockResolvedValue(true),
  handleAvatarDeletion: jest.fn().mockResolvedValue(true),
});

// Mock extracted media file
export const createMockExtractedMediaFile = (overrides = {}) => ({
  fieldName: 'images.0',
  filename: 'test-image.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from('test image data'),
  size: 1024,
  ...overrides,
});

// Mock upload result
export const createMockUploadResult = (overrides = {}) => ({
  resourceId: 'property123',
  url: 'https://mock-s3-url.com/file.jpg',
  filename: 'test-image.jpg',
  publicuid: 'mock-key-123',
  size: 1024,
  mediatype: 'image',
  resourceName: 'property',
  fieldName: 'images',
  actorId: 'user123',
  ...overrides,
});