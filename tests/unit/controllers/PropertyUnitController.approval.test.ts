import { httpStatusCodes } from '@utils/index';
import { PropertyUnitController } from '@controllers/PropertyUnitController';

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('PropertyUnitController — pending change approval', () => {
  const serviceResult = { success: true, data: { puid: 'PUID-1' }, message: 'done' };
  const propertyUnitService = {
    approveUnitChanges: jest.fn(() => Promise.resolve(serviceResult)),
    rejectUnitChanges: jest.fn(() => Promise.resolve(serviceResult)),
  };
  const controller = new PropertyUnitController({
    propertyUnitService: propertyUnitService as any,
    mediaUploadService: {} as any,
  });
  const context = { request: { params: { cuid: 'CUID', pid: 'PID', puid: 'PUID-1' } } };

  beforeEach(() => jest.clearAllMocks());

  it('passes the request context and approval notes to the service', async () => {
    const res = makeRes();

    await controller.approveUnitChanges({ context, body: { notes: 'Looks good' } } as any, res);

    expect(propertyUnitService.approveUnitChanges).toHaveBeenCalledWith(context, 'Looks good');
    expect(res.status).toHaveBeenCalledWith(httpStatusCodes.OK);
    expect(res.json).toHaveBeenCalledWith(serviceResult);
  });

  it('passes the request context and rejection reason to the service', async () => {
    const res = makeRes();

    await controller.rejectUnitChanges(
      { context, body: { reason: 'Rent change not agreed' } } as any,
      res
    );

    expect(propertyUnitService.rejectUnitChanges).toHaveBeenCalledWith(
      context,
      'Rent change not agreed'
    );
    expect(res.status).toHaveBeenCalledWith(httpStatusCodes.OK);
    expect(res.json).toHaveBeenCalledWith(serviceResult);
  });

  it('lets service errors propagate to the error handler', async () => {
    propertyUnitService.rejectUnitChanges.mockImplementationOnce(() =>
      Promise.reject(new Error('not pending'))
    );

    await expect(
      controller.rejectUnitChanges({ context, body: { reason: 'x' } } as any, makeRes())
    ).rejects.toThrow('not pending');
  });
});
