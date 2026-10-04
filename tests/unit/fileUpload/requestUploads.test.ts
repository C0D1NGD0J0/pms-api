import { Types } from 'mongoose';
import { ExpenseController } from '@controllers/ExpenseController';
import { PaymentController } from '@controllers/PaymentController';
import { LeaseDocumentService } from '@services/lease/leaseDocument.service';
import { PropertyUnitService } from '@services/property/propertyUnit.service';

// Flows that upload during the request (no worker step): the file goes to S3 in the API
// process and the record is saved with the real S3 URL.

const USER_ID = new Types.ObjectId().toString();
const s3Result = (name: string) => ({
  key: `x/${name}`,
  url: `https://s3.example.com/${name}`,
  filename: name,
  fieldName: 'receipt',
  resourceId: 'R1',
  publicuid: 'R1',
});

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (params: Record<string, string>, body: Record<string, any> = {}) =>
  ({
    params,
    body,
    context: { currentuser: { sub: USER_ID, client: { role: 'manager' } } },
  }) as any;

describe('ExpenseController.attachReceipt', () => {
  const makeController = (uploaded: any[]) => {
    const expenseService = { updateExpense: jest.fn().mockResolvedValue({}) };
    const mediaUploadService = { uploadRequestFiles: jest.fn().mockResolvedValue(uploaded) };
    const controller = new ExpenseController({
      expenseService: expenseService as any,
      mediaUploadService: mediaUploadService as any,
    } as any);
    return { controller, expenseService, mediaUploadService };
  };

  it('saves the receipt with its real S3 URL and key', async () => {
    const { controller, expenseService, mediaUploadService } = makeController([
      s3Result('receipt.pdf'),
    ]);
    const res = makeRes();

    await controller.attachReceipt(makeReq({ cuid: 'C1', expuid: 'EXP1' }), res);

    expect(mediaUploadService.uploadRequestFiles).toHaveBeenCalledWith(expect.anything(), {
      resourceName: 'expense',
      resourceId: 'EXP1',
      fieldName: 'receipt',
      actorId: USER_ID,
    });
    expect(expenseService.updateExpense).toHaveBeenCalledWith('EXP1', 'C1', {
      receipt: expect.objectContaining({
        url: 'https://s3.example.com/receipt.pdf',
        key: 'x/receipt.pdf',
        filename: 'receipt.pdf',
      }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 400 and saves nothing when no file was sent', async () => {
    const { controller, expenseService } = makeController([]);
    const res = makeRes();

    await controller.attachReceipt(makeReq({ cuid: 'C1', expuid: 'EXP1' }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(expenseService.updateExpense).not.toHaveBeenCalled();
  });
});

describe('PaymentController.recordManualPayment', () => {
  const makeController = (uploaded: any[], recordResult: Promise<any>) => {
    const paymentService = { recordManualPayment: jest.fn().mockReturnValue(recordResult) };
    const mediaUploadService = {
      uploadRequestFiles: jest.fn().mockResolvedValue(uploaded),
      removeUploadedFiles: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new PaymentController({
      paymentService: paymentService as any,
      invoiceService: { requestInvoice: jest.fn().mockResolvedValue(undefined) } as any,
      mediaUploadService: mediaUploadService as any,
      invoiceAIService: {} as any,
      cronService: {} as any,
    } as any);
    return { controller, paymentService, mediaUploadService };
  };

  it('records the payment with the uploaded receipt in one write', async () => {
    const { controller, paymentService } = makeController(
      [s3Result('receipt.jpg')],
      Promise.resolve({ success: true, data: { pytuid: 'PYT1' } })
    );
    const res = makeRes();

    await controller.recordManualPayment(makeReq({ cuid: 'C1' }, { amount: 1000 }), res);

    expect(paymentService.recordManualPayment).toHaveBeenCalledWith(
      'C1',
      USER_ID,
      USER_ID,
      {
        amount: 1000,
        receipt: {
          url: 'https://s3.example.com/receipt.jpg',
          filename: 'receipt.jpg',
          key: 'x/receipt.jpg',
        },
      },
      'pm_initiated'
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('removes the uploaded receipt when the payment fails to record', async () => {
    const receipt = s3Result('receipt.jpg');
    const { controller, mediaUploadService } = makeController(
      [receipt],
      Promise.reject(new Error('validation failed'))
    );

    await expect(
      controller.recordManualPayment(makeReq({ cuid: 'C1' }, { amount: 1000 }), makeRes())
    ).rejects.toThrow('validation failed');
    expect(mediaUploadService.removeUploadedFiles).toHaveBeenCalledWith([receipt]);
  });
});

describe('LeaseDocumentService.uploadLeaseDocument', () => {
  const makeService = () => {
    const lease = { _id: new Types.ObjectId(), luid: 'L1' };
    const leaseDAO = {
      findFirst: jest.fn().mockResolvedValue(lease),
      updateLeaseDocuments: jest.fn().mockResolvedValue({ ...lease, leaseDocuments: [{}] }),
    };
    const service = new LeaseDocumentService({ leaseDAO: leaseDAO as any, s3Service: {} as any });
    return { service, leaseDAO, lease };
  };

  it('attaches the S3-uploaded document to the lease', async () => {
    const { service, leaseDAO, lease } = makeService();

    const result = await service.uploadLeaseDocument(
      'C1',
      'L1',
      s3Result('lease.pdf') as any,
      USER_ID
    );

    expect(result.success).toBe(true);
    expect(leaseDAO.updateLeaseDocuments).toHaveBeenCalledWith(
      lease._id.toString(),
      [
        expect.objectContaining({
          url: 'https://s3.example.com/lease.pdf',
          key: 'x/lease.pdf',
          resourceId: lease._id.toString(),
        }),
      ],
      USER_ID
    );
  });

  it('rejects when no document was uploaded', async () => {
    const { service } = makeService();

    await expect(service.uploadLeaseDocument('C1', 'L1', undefined, USER_ID)).rejects.toThrow(
      'No file provided'
    );
  });
});

describe('PropertyUnitService.addDocumentToUnit', () => {
  it("pushes the uploaded photos onto the unit's media.photos", async () => {
    const property = { _id: new Types.ObjectId(), id: 'P-ID' };
    const propertyUnitDAO = { update: jest.fn().mockResolvedValue({ puid: 'U1' }) };
    const emitterService = { emit: jest.fn() };
    const propertyCache = {
      invalidateProperty: jest.fn().mockResolvedValue(true),
      invalidatePropertyLists: jest.fn().mockResolvedValue(true),
    };
    // The unit service has many dependencies; only these are used by addDocumentToUnit
    const service = Object.assign(Object.create(PropertyUnitService.prototype), {
      propertyDAO: { findFirst: jest.fn().mockResolvedValue(property) },
      propertyUnitDAO,
      emitterService,
      propertyCache,
    }) as PropertyUnitService;

    const result = await service.addDocumentToUnit(
      {
        currentuser: { sub: USER_ID },
        request: { params: { cuid: 'C1', pid: 'P1', puid: 'U1' } },
      } as any,
      [s3Result('kitchen.jpg') as any]
    );

    expect(result.success).toBe(true);
    expect(propertyUnitDAO.update).toHaveBeenCalledWith(
      { puid: 'U1', propertyId: property._id, deletedAt: null },
      expect.objectContaining({
        $push: {
          'media.photos': {
            $each: [
              expect.objectContaining({
                url: 'https://s3.example.com/kitchen.jpg',
                key: 'x/kitchen.jpg',
                filename: 'kitchen.jpg',
              }),
            ],
          },
        },
      })
    );
    expect(propertyCache.invalidateProperty).toHaveBeenCalledWith('C1', 'P1');
  });
});
