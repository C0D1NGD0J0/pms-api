import { httpStatusCodes } from '@utils/index';
import { PropertyController } from '@controllers/PropertyController';

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('PropertyController.updateClientProperty — file uploads', () => {
  const currentuser = { sub: 'USER-1', client: { cuid: 'CUID', role: 'admin' } };
  const scannedFiles = [{ fieldName: 'images[0].file', path: '/tmp/a.png' }];
  const propertyService = { updateClientProperty: jest.fn() };
  const mediaUploadService = { handleFiles: jest.fn() };
  const controller = new PropertyController({
    propertyService: propertyService as any,
    mediaUploadService: mediaUploadService as any,
  });

  const makeReq = () =>
    ({
      params: { cuid: 'CUID', pid: 'PID-1' },
      query: {},
      body: { name: 'New name' },
      scannedFiles,
      context: { currentuser },
    }) as any;

  beforeEach(() => jest.clearAllMocks());

  it('uploads nothing when the service rejects the update', async () => {
    propertyService.updateClientProperty.mockRejectedValueOnce(new Error('pending changes lock'));

    await expect(controller.updateClientProperty(makeReq(), makeRes())).rejects.toThrow(
      'pending changes lock'
    );

    expect(mediaUploadService.handleFiles).not.toHaveBeenCalled();
  });

  it('passes the new files to the service, then uploads them after a direct update', async () => {
    const serviceResult = { success: true, data: { pid: 'PID-1' }, message: 'updated' };
    propertyService.updateClientProperty.mockResolvedValueOnce(serviceResult);
    mediaUploadService.handleFiles.mockResolvedValueOnce({
      hasFiles: true,
      message: '1 file(s) queued',
      processedFiles: { property_images: { queuedCount: 1 } },
    });
    const res = makeRes();

    await controller.updateClientProperty(makeReq(), res);

    expect(propertyService.updateClientProperty).toHaveBeenCalledWith(
      expect.objectContaining({ cuid: 'CUID', pid: 'PID-1', newFiles: scannedFiles }),
      { name: 'New name' }
    );
    expect(propertyService.updateClientProperty.mock.invocationCallOrder[0]).toBeLessThan(
      mediaUploadService.handleFiles.mock.invocationCallOrder[0]
    );
    expect(res.status).toHaveBeenCalledWith(httpStatusCodes.OK);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ...serviceResult, fileUpload: '1 file(s) queued' })
    );
  });

  it('does not queue files of a staff edit held for approval (the service stored them)', async () => {
    const serviceResult = {
      success: true,
      data: { pid: 'PID-1', pendingChanges: { pendingMedia: { images: [], documents: [] } } },
      message: 'Property changes submitted for approval',
    };
    propertyService.updateClientProperty.mockResolvedValueOnce(serviceResult);
    const res = makeRes();

    await controller.updateClientProperty(makeReq(), res);

    expect(mediaUploadService.handleFiles).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(httpStatusCodes.OK);
    expect(res.json).toHaveBeenCalledWith(serviceResult);
  });
});
