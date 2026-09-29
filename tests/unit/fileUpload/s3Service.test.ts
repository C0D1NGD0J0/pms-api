import { Upload } from '@aws-sdk/lib-storage';
import { S3Service } from '@services/fileUpload/awsS3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(({ params }: any) => ({
    on: jest.fn(),
    done: jest.fn().mockResolvedValue({
      Location: `https://bucket.s3.amazonaws.com/${params.Key}`,
      Key: params.Key,
    }),
  })),
}));

// A real S3Client throws "Region is missing" when AWS_REGION is unset (as in CI);
// uploads and signing are mocked below, so the client itself is never used.
jest.mock('@aws-sdk/client-s3', () => ({
  ...jest.requireActual('@aws-sdk/client-s3'),
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  createReadStream: jest.fn(() => 'stream'),
}));

const mockUpload = Upload as unknown as jest.Mock;
const mockGetSignedUrl = getSignedUrl as jest.Mock;

describe('S3Service', () => {
  let service: S3Service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new S3Service();
  });

  describe('server-side encryption', () => {
    it('encrypts streamed uploads with AES256', async () => {
      await service.uploadFiles(
        [
          {
            path: '/tmp/deed.pdf',
            fileName: 'deed.pdf',
            originalFileName: 'deed.pdf',
            mimeType: 'application/pdf',
            fieldName: 'documents[0].file',
            fileSize: 100,
          } as any,
        ],
        { resourceName: 'property', resourceId: 'PID123', actorId: 'u1' } as any
      );

      expect(mockUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ ServerSideEncryption: 'AES256' }),
        })
      );
    });

    it('encrypts buffer uploads with AES256', async () => {
      await service.uploadBuffer(Buffer.from('pdf'), 'reports/r.pdf', 'application/pdf');

      expect(mockUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ ServerSideEncryption: 'AES256' }),
        })
      );
    });
  });

  describe('signFileUrls', () => {
    it('replaces each url with a presigned url generated from its key', async () => {
      mockGetSignedUrl.mockImplementation(async (_client: any, command: any) => {
        return `https://signed/${command.input.Key}?X-Amz-Signature=abc`;
      });
      const items = [
        { url: 'https://public/a.png', key: 'property/a.png' },
        { url: 'https://public/b.pdf', key: 'property/b.pdf' },
      ];

      const result = await service.signFileUrls(items);

      expect(result).toBe(items);
      expect(items[0].url).toBe('https://signed/property/a.png?X-Amz-Signature=abc');
      expect(items[1].url).toBe('https://signed/property/b.pdf?X-Amz-Signature=abc');
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: expect.objectContaining({ ResponseContentDisposition: 'inline' }),
        }),
        { expiresIn: 3600 }
      );
    });

    it('passes attachment disposition through', async () => {
      mockGetSignedUrl.mockResolvedValue('https://signed/x');
      await service.signFileUrls([{ url: 'u', key: 'k' }], 'attachment');

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          input: expect.objectContaining({ ResponseContentDisposition: 'attachment' }),
        }),
        expect.anything()
      );
    });

    it('leaves items without a key untouched', async () => {
      const items = [{ url: 'https://external/doc.pdf' }];
      await service.signFileUrls(items);

      expect(items[0].url).toBe('https://external/doc.pdf');
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
    });

    it('keeps the original url when signing fails for one item', async () => {
      mockGetSignedUrl
        .mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied' }))
        .mockResolvedValueOnce('https://signed/ok');
      const items = [
        { url: 'https://public/bad', key: 'bad' },
        { url: 'https://public/ok', key: 'ok' },
      ];

      await service.signFileUrls(items);

      expect(items[0].url).toBe('https://public/bad');
      expect(items[1].url).toBe('https://signed/ok');
    });

    it('returns empty/undefined input as-is', async () => {
      await expect(service.signFileUrls([])).resolves.toEqual([]);
      await expect(service.signFileUrls(undefined as any)).resolves.toBeUndefined();
    });
  });
});
