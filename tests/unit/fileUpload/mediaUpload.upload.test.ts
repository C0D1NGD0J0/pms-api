import os from 'os';
import fs from 'fs';
import path from 'path';
import { EventTypes } from '@interfaces/events.interface';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import { ExtractedMediaFile, ResourceContext } from '@interfaces/utils.interface';

/** A real temp file, so the tests can check it is removed after the upload. */
const makeTempFile = (name: string, fieldName = 'images[0].file'): ExtractedMediaFile => {
  const filePath = path.join(os.tmpdir(), `${Date.now()}_${Math.random()}_${name}`);
  fs.writeFileSync(filePath, 'file-contents');
  return {
    fieldName,
    originalFileName: name,
    filename: path.basename(filePath),
    path: filePath,
    mimeType: 'image/jpeg',
    fileSize: 13,
    status: 'pending',
    uploadedAt: new Date(),
    uploadedBy: 'user-1',
  };
};

const uploadResultFor = (file: ExtractedMediaFile) => ({
  key: `property/${file.originalFileName}`,
  url: `https://s3.example.com/${file.originalFileName}`,
  filename: file.originalFileName,
  fieldName: 'images',
  resourceId: 'PID1',
  publicuid: 'PID1',
});

const makeService = () => {
  const uploadQueue = { addToUploadQueue: jest.fn() };
  const s3Service = { uploadFiles: jest.fn(), deleteFiles: jest.fn().mockResolvedValue(true) };
  const emitterService = { emit: jest.fn() };
  const service = new MediaUploadService({
    assetService: {} as any,
    queueFactory: { getQueue: jest.fn().mockReturnValue(uploadQueue) } as any,
    s3Service: s3Service as any,
    emitterService: emitterService as any,
  });
  return { service, s3Service, uploadQueue, emitterService };
};

const resource = {
  resourceName: 'property' as const,
  resourceType: 'image' as const,
  resourceId: 'PID1',
  fieldName: 'images',
  actorId: 'user-1',
};

describe('MediaUploadService.uploadFilesToS3', () => {
  it('uploads the files and removes the temp files', async () => {
    const { service, s3Service } = makeService();
    const files = [makeTempFile('a.jpg'), makeTempFile('b.jpg')];
    s3Service.uploadFiles.mockResolvedValue(files.map(uploadResultFor));

    const results = await service.uploadFilesToS3(files, resource);

    expect(results).toHaveLength(2);
    expect(s3Service.uploadFiles).toHaveBeenCalledWith(
      [
        expect.objectContaining({ path: files[0].path, fileName: files[0].filename }),
        expect.objectContaining({ path: files[1].path, fileName: files[1].filename }),
      ],
      resource
    );
    for (const file of files) expect(fs.existsSync(file.path)).toBe(false);
  });

  it('throws when any file fails to upload, and still removes the temp files', async () => {
    const { service, s3Service } = makeService();
    const files = [makeTempFile('a.jpg'), makeTempFile('b.jpg')];
    // S3Service.uploadFiles skips failed files instead of throwing
    s3Service.uploadFiles.mockResolvedValue([uploadResultFor(files[0])]);

    await expect(service.uploadFilesToS3(files, resource)).rejects.toThrow('Uploaded 1 of 2');
    for (const file of files) expect(fs.existsSync(file.path)).toBe(false);
  });
});

describe('MediaUploadService.handleFiles', () => {
  const context = {
    primaryResourceId: 'PID1',
    uploadedBy: 'user-1',
    resourceContext: ResourceContext.PROPERTY,
  };

  it('uploads in this process and queues only the S3 results', async () => {
    const { service, s3Service, uploadQueue } = makeService();
    const file = makeTempFile('a.jpg');
    const results = [uploadResultFor(file)];
    s3Service.uploadFiles.mockResolvedValue(results);

    const outcome = await service.handleFiles({ scannedFiles: [file], body: {} } as any, context);

    expect(outcome.totalQueued).toBe(1);
    expect(uploadQueue.addToUploadQueue).toHaveBeenCalledWith(expect.any(String), {
      resource: expect.objectContaining({ resourceName: 'property', resourceId: 'PID1' }),
      results,
    });
    // No local path ever crosses into the job
    expect(JSON.stringify(uploadQueue.addToUploadQueue.mock.calls[0][1])).not.toContain(file.path);
  });

  it('emits UPLOAD_FAILED and queues nothing when a group fails to upload', async () => {
    const { service, s3Service, uploadQueue, emitterService } = makeService();
    s3Service.uploadFiles.mockRejectedValue(new Error('S3 unavailable'));

    const outcome = await service.handleFiles(
      { scannedFiles: [makeTempFile('a.jpg')], body: {} } as any,
      context
    );

    expect(outcome.totalQueued).toBe(0);
    expect(uploadQueue.addToUploadQueue).not.toHaveBeenCalled();
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.UPLOAD_FAILED,
      expect.objectContaining({
        resourceName: 'property',
        resourceId: 'PID1',
        error: { message: 'S3 unavailable' },
      })
    );
  });
});

describe('MediaUploadService.uploadRequestFiles', () => {
  it('returns [] when the request has no files', async () => {
    const { service, s3Service } = makeService();

    await expect(
      service.uploadRequestFiles({ scannedFiles: undefined } as any, {
        resourceName: 'expense',
        resourceId: 'EXP1',
        fieldName: 'receipt',
        actorId: 'user-1',
      })
    ).resolves.toEqual([]);
    expect(s3Service.uploadFiles).not.toHaveBeenCalled();
  });

  it('uploads the scanned files for the given resource', async () => {
    const { service, s3Service } = makeService();
    const file = makeTempFile('receipt.jpg', 'receipt.file');
    s3Service.uploadFiles.mockResolvedValue([uploadResultFor(file)]);

    const [receipt] = await service.uploadRequestFiles({ scannedFiles: [file] } as any, {
      resourceName: 'expense',
      resourceId: 'EXP1',
      fieldName: 'receipt',
      actorId: 'user-1',
    });

    expect(receipt.url).toContain('receipt.jpg');
    expect(s3Service.uploadFiles).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ resourceName: 'expense', resourceType: 'image' })
    );
  });
});

describe('MediaUploadService.removeUploadedFiles', () => {
  it('deletes the uploaded keys from S3', async () => {
    const { service, s3Service } = makeService();

    await service.removeUploadedFiles([
      { key: 'payment/r.jpg', url: 'u', filename: 'r.jpg' } as any,
    ]);

    expect(s3Service.deleteFiles).toHaveBeenCalledWith(['payment/r.jpg']);
  });
});

describe('MediaUploadService.handleBuffer', () => {
  const leaseContext = {
    primaryResourceId: '507f1f77bcf86cd799439011',
    uploadedBy: 'user-1',
    resourceContext: ResourceContext.LEASE,
  };
  const uniquePdfName = () => `lease-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;

  it('carries the documentType onto the file sent to S3, so a generated lease PDF stays the agreement', async () => {
    const { service, s3Service } = makeService();
    s3Service.uploadFiles.mockImplementation(async (files: any[]) =>
      files.map((file) => ({ key: file.fileName, url: 'https://s3/x.pdf', fieldName: 'document' }))
    );

    const outcome = await service.handleBuffer(Buffer.from('%PDF-1.4'), uniquePdfName(), {
      ...leaseContext,
      documentType: 'lease_agreement',
    });

    expect(outcome.totalQueued).toBe(1);
    expect(s3Service.uploadFiles).toHaveBeenCalledWith(
      [expect.objectContaining({ documentType: 'lease_agreement' })],
      expect.anything()
    );
  });

  it('sends no documentType when the caller does not set one', async () => {
    const { service, s3Service } = makeService();
    s3Service.uploadFiles.mockImplementation(async (files: any[]) =>
      files.map((file) => ({ key: file.fileName, url: 'https://s3/x.pdf', fieldName: 'document' }))
    );

    await service.handleBuffer(Buffer.from('%PDF-1.4'), uniquePdfName(), leaseContext);

    const [[sentFiles]] = s3Service.uploadFiles.mock.calls;
    expect(sentFiles[0].documentType).toBeUndefined();
  });

  it('removes the temporary file after uploading', async () => {
    const { service, s3Service } = makeService();
    s3Service.uploadFiles.mockImplementation(async (files: any[]) =>
      files.map((file) => ({ key: file.fileName, url: 'https://s3/x.pdf', fieldName: 'document' }))
    );
    const fileName = uniquePdfName();

    await service.handleBuffer(Buffer.from('%PDF-1.4'), fileName, leaseContext);

    expect(fs.existsSync(path.join(process.cwd(), 'uploads', fileName))).toBe(false);
  });
});
