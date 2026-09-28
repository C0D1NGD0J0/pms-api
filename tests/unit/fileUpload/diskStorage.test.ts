import fs from 'fs';
import { fromFile as fileTypeFromFile } from 'file-type';

class FakeMulterError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'MulterError';
  }
}

const fieldsHandler = jest.fn();
const noneHandler = jest.fn();
const mockUpload = {
  fields: jest.fn(() => fieldsHandler),
  none: jest.fn(() => noneHandler),
};
const mockMulterFactory = jest.fn((..._args: any[]) => mockUpload);

jest.mock('multer', () => {
  const factory: any = function (this: unknown, ...args: unknown[]) {
    return mockMulterFactory(...args);
  };
  factory.diskStorage = jest.fn((opts: any) => opts);
  factory.MulterError = FakeMulterError;
  return { __esModule: true, default: factory };
});

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  const merged = {
    ...actual,
    existsSync: jest.fn(() => true),
    mkdirSync: jest.fn(),
    promises: {
      ...actual.promises,
      readFile: jest.fn(),
      unlink: jest.fn(() => Promise.resolve()),
    },
  };
  return { __esModule: true, ...merged, default: merged };
});

jest.mock('file-type', () => ({
  fromFile: jest.fn(),
}));

import { DiskStorage } from '@services/fileUpload/diskStorage';

const mockFromFile = fileTypeFromFile as jest.Mock;

describe('DiskStorage', () => {
  let storage: DiskStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    storage = new DiskStorage();
  });

  describe('uploadMiddleware — field config resolution', () => {
    // upload.fields()/none() are only invoked once the returned middleware
    // actually runs, so each case has to execute it, not just construct it.
    const invoke = (patterns: string[]) => {
      fieldsHandler.mockImplementation((_req: any, _res: any, cb: any) => cb(null));
      noneHandler.mockImplementation((_req: any, _res: any, cb: any) => cb(null));
      const middleware = storage.uploadMiddleware(patterns);
      middleware({} as any, {} as any, jest.fn());
    };

    it('resolves the new "propertyUnit.media" field to its configured maxCount/maxSize', () => {
      invoke(['propertyUnit.media']);

      expect(mockUpload.fields).toHaveBeenCalledWith([
        { name: 'propertyUnit.media', maxCount: 5 },
      ]);
      expect(mockMulterFactory).toHaveBeenCalledWith(
        expect.objectContaining({ limits: { fileSize: 5 * 1024 * 1024 } })
      );
    });

    it('resolves the new "receipt.file" field for manual payment entry', () => {
      invoke(['receipt.file']);

      expect(mockUpload.fields).toHaveBeenCalledWith([{ name: 'receipt.file', maxCount: 1 }]);
      expect(mockMulterFactory).toHaveBeenCalledWith(
        expect.objectContaining({ limits: { fileSize: 10 * 1024 * 1024 } })
      );
    });

    it('resolves the new "document" field for lease document upload with a 20MB limit', () => {
      invoke(['document']);

      expect(mockUpload.fields).toHaveBeenCalledWith([{ name: 'document', maxCount: 1 }]);
      expect(mockMulterFactory).toHaveBeenCalledWith(
        expect.objectContaining({ limits: { fileSize: 20 * 1024 * 1024 } })
      );
    });

    it('falls back to a single default field entry for an unrecognized pattern', () => {
      invoke(['totally_unknown_field']);

      expect(mockUpload.fields).toHaveBeenCalledWith([
        { name: 'totally_unknown_field', maxCount: 1 },
      ]);
    });

    it('uses upload.none() when no field patterns are passed', () => {
      invoke([]);

      expect(mockUpload.none).toHaveBeenCalled();
      expect(mockUpload.fields).not.toHaveBeenCalled();
    });
  });

  describe('uploadMiddleware — error translation', () => {
    const runHandler = async (patterns: string[], err: any) => {
      fieldsHandler.mockImplementation((_req: any, _res: any, cb: any) => cb(err));
      const middleware = storage.uploadMiddleware(patterns);
      const next = jest.fn();
      await middleware({} as any, {} as any, next);
      return next;
    };

    it('translates a LIMIT_FILE_SIZE multer error into a friendly 400 message', async () => {
      const next = await runHandler(['document'], new FakeMulterError('LIMIT_FILE_SIZE'));

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: expect.stringMatching(/maximum allowed size/),
        })
      );
    });

    it('translates a LIMIT_UNEXPECTED_FILE multer error into a friendly 400 message', async () => {
      const next = await runHandler(['document'], new FakeMulterError('LIMIT_UNEXPECTED_FILE'));

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, message: expect.stringMatching(/file type/) })
      );
    });

    it('calls next() with no error when the upload succeeds', async () => {
      const next = await runHandler(['document'], null);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('validateMagicBytes', () => {
    const runValidation = async (files: any) => {
      const middleware = storage.validateMagicBytes();
      const next = jest.fn();
      await middleware({ files } as any, {} as any, next);
      return next;
    };

    it('passes through immediately when the request has no files', async () => {
      const next = await runValidation(undefined);
      expect(next).toHaveBeenCalledWith();
    });

    it('allows a file whose detected magic bytes match its declared extension', async () => {
      mockFromFile.mockResolvedValue({ mime: 'application/pdf' });
      const next = await runValidation([
        { originalname: 'deed.pdf', path: '/tmp/deed.pdf', mimetype: 'application/pdf' },
      ]);

      expect(next).toHaveBeenCalledWith();
      expect(fs.promises.unlink).not.toHaveBeenCalled();
    });

    it('rejects and deletes a file whose magic bytes do not match its extension', async () => {
      mockFromFile.mockResolvedValue({ mime: 'application/zip' });
      const next = await runValidation([
        { originalname: 'fake.pdf', path: '/tmp/fake.pdf', mimetype: 'application/pdf' },
      ]);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringMatching(/fake.pdf/) })
      );
      expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/fake.pdf');
    });

    it('allows text-format files (csv) even when file-type detection returns nothing', async () => {
      mockFromFile.mockResolvedValue(undefined);
      const next = await runValidation([
        { originalname: 'import.csv', path: '/tmp/import.csv', mimetype: 'text/csv' },
      ]);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('deleteFiles', () => {
    it('returns true immediately for an empty list', async () => {
      await expect(storage.deleteFiles([])).resolves.toBe(true);
    });

    it('treats a missing file (ENOENT) as an already-successful deletion', async () => {
      (fs.promises.unlink as jest.Mock).mockReturnValue(
        Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }))
      );

      await expect(storage.deleteFiles(['gone.png'])).resolves.toBe(true);
    });

    it('returns false when a non-ENOENT deletion error occurs', async () => {
      (fs.promises.unlink as jest.Mock).mockReturnValue(
        Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
      );

      await expect(storage.deleteFiles(['locked.png'])).resolves.toBe(false);
    });
  });

  describe('getFile', () => {
    it('returns the file buffer on success', async () => {
      (fs.promises.readFile as jest.Mock).mockReturnValue(Promise.resolve(Buffer.from('data')));

      const result = await storage.getFile('report.pdf');

      expect(result).toEqual(Buffer.from('data'));
    });

    it('throws a NotFoundError when the file cannot be read', async () => {
      (fs.promises.readFile as jest.Mock).mockReturnValue(Promise.reject(new Error('ENOENT')));

      await expect(storage.getFile('missing.pdf')).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
