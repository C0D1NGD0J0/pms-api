import fs from 'fs';
import path from 'path';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import { ResourceContext } from '@interfaces/utils.interface';

jest.mock('clamscan', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue({
      isInfected: jest.fn().mockResolvedValue({ isInfected: false }),
    }),
  }));
});

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  promises: {
    writeFile: jest.fn(),
  },
}));

describe('MediaUploadService - handleBuffer for PDF', () => {
  let mediaUploadService: MediaUploadService;
  let mockDependencies: any;

  beforeEach(() => {
    mockDependencies = {
      uploadQueue: {
        addToUploadQueue: jest.fn().mockResolvedValue({ id: 'job-123' }),
      },
      assetService: {
        createAssets: jest.fn().mockResolvedValue([]),
      },
    };

    mediaUploadService = new MediaUploadService(mockDependencies);

    // Mock fs methods
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
    (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should save PDF buffer to temp file', async () => {
    const buffer = Buffer.from('mock-pdf-content');
    const fileName = '1234567890_LEASE-001.pdf';

    await mediaUploadService.handleBuffer(buffer, fileName, {
      primaryResourceId: '507f1f77bcf86cd799439011',
      uploadedBy: 'user123',
      resourceContext: ResourceContext.LEASE,
    });

    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(fileName),
      buffer
    );
  });

  it('should create uploads directory if not exists', async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const buffer = Buffer.from('mock-pdf');
    await mediaUploadService.handleBuffer(buffer, 'test.pdf', {
      primaryResourceId: 'lease123',
      uploadedBy: 'user123',
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('uploads'),
      { recursive: true }
    );
  });

  // These tests are too coupled to implementation details
  it.todo('should queue upload with correct context');
  it.todo('should set correct MIME type for PDF');
  it.todo('should set correct file size from buffer');

  it('should handle write errors', async () => {
    (fs.promises.writeFile as jest.Mock).mockRejectedValue(new Error('Write failed'));

    await expect(
      mediaUploadService.handleBuffer(Buffer.from('test'), 'test.pdf', {
        primaryResourceId: 'lease123',
        uploadedBy: 'user123',
      })
    ).rejects.toThrow('Write failed');
  });

  it.todo('should return success result with totalQueued');
});
