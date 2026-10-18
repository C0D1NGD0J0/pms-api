import { httpStatusCodes } from '@utils/index';
import { PropertyController } from '@controllers/PropertyController';

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('PropertyController — file uploads are saved by the service in the same write', () => {
  const currentuser = { sub: 'USER-1', client: { cuid: 'CUID', role: 'admin' } };
  const scannedFiles = [{ fieldName: 'images[0].file', path: '/tmp/a.png' }];
  const propertyService = { updateClientProperty: jest.fn(), addProperty: jest.fn() };
  const mediaUploadService = { uploadRequestFiles: jest.fn() };
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

  it('passes the new files to the update and returns its result as-is', async () => {
    const serviceResult = {
      success: true,
      data: { pid: 'PID-1', images: [{ key: 'property/a.png', url: 'https://signed/a.png' }] },
      message: 'updated',
    };
    propertyService.updateClientProperty.mockResolvedValueOnce(serviceResult);
    const res = makeRes();

    await controller.updateClientProperty(makeReq(), res);

    expect(propertyService.updateClientProperty).toHaveBeenCalledWith(
      expect.objectContaining({ cuid: 'CUID', pid: 'PID-1', newFiles: scannedFiles }),
      { name: 'New name' }
    );
    expect(mediaUploadService.uploadRequestFiles).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(httpStatusCodes.OK);
    expect(res.json).toHaveBeenCalledWith(serviceResult);
  });

  it('surfaces a rejected update without uploading anything itself', async () => {
    propertyService.updateClientProperty.mockRejectedValueOnce(new Error('pending changes lock'));

    await expect(controller.updateClientProperty(makeReq(), makeRes())).rejects.toThrow(
      'pending changes lock'
    );

    expect(mediaUploadService.uploadRequestFiles).not.toHaveBeenCalled();
  });

  it('passes the new files to the create and returns the created property', async () => {
    const serviceResult = { success: true, data: { pid: 'PID-NEW', images: [] }, message: 'ok' };
    propertyService.addProperty.mockResolvedValueOnce(serviceResult);
    const res = makeRes();
    const req = makeReq();

    await controller.create(req, res);

    expect(propertyService.addProperty).toHaveBeenCalledWith(req.context, req.body, scannedFiles);
    expect(res.json).toHaveBeenCalledWith(serviceResult);
  });
});
