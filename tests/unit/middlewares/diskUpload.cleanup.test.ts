import { EventEmitter } from 'events';
import { diskUpload } from '@shared/middlewares/middleware';

const makeDiskStorage = (files: any) => ({
  uploadMiddleware: jest.fn(() => (req: any, _res: any, cb: (err?: any) => void) => {
    req.files = files;
    cb();
  }),
  validateMagicBytes: jest.fn(() => (_req: any, _res: any, next: () => void) => next()),
  deleteFiles: jest.fn().mockResolvedValue(true),
});

describe('diskUpload — removing uploaded files once the response is done', () => {
  const files = {
    images: [
      {
        path: 'uploads/1_photo.png',
        filename: '1_photo.png',
        originalname: 'photo.png',
        mimetype: 'image/png',
        size: 10,
        fieldname: 'images',
      },
    ],
  };

  const run = async (diskStorage: any) => {
    const req: any = { container: { cradle: { diskStorage } }, context: {} };
    const res: any = new EventEmitter();
    const next = jest.fn();
    await diskUpload(['images'])(req, res, next);
    return { req, res, next };
  };

  it('deletes files nobody consumed after the response closes', async () => {
    const diskStorage = makeDiskStorage(files);
    const { res, next } = await run(diskStorage);

    expect(next).toHaveBeenCalled();
    expect(diskStorage.deleteFiles).not.toHaveBeenCalled();

    res.emit('close');

    expect(diskStorage.deleteFiles).toHaveBeenCalledWith(['uploads/1_photo.png']);
  });

  it('does nothing when the request had no files', async () => {
    const diskStorage = makeDiskStorage(undefined);
    const { res } = await run(diskStorage);

    res.emit('close');

    expect(diskStorage.deleteFiles).not.toHaveBeenCalled();
  });
});
