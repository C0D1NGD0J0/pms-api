/**
 * PaymentController — scanReceipt tests
 *
 * Covers happy path, missing file, AI failure, and temp file cleanup.
 */
import fs from 'fs';

jest.mock('@di/index', () => ({ container: {} }));
jest.mock('@shared/config', () => ({
  envVariables: {
    APP_NAME: 'test',
    SERVER: { ENV: 'test' },
    EMAIL: { APP_EMAIL_ADDRESS: 'test@test.com' },
    FRONTEND: { URL: 'http://localhost:3000' },
  },
}));
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    unlink: jest.fn().mockReturnValue(Promise.resolve()),
  },
}));

import { BadRequestError } from '@shared/customErrors';
import { PaymentController } from '@controllers/PaymentController';

const makeController = (overrides: Record<string, any> = {}) => {
  return new PaymentController({
    paymentService: {} as any,
    invoiceService: {} as any,
    mediaUploadService: {} as any,
    cronService: {} as any,
    invoiceAIService: overrides.invoiceAIService ?? {
      extractInvoiceData: jest.fn(),
    },
  } as any);
};

const makeReq = (overrides: Record<string, any> = {}) => ({
  params: { cuid: 'TEST_CUID' },
  scannedFiles: overrides.scannedFiles ?? [{ path: '/tmp/receipt.jpg', mimeType: 'image/jpeg' }],
  context: { currentuser: { sub: 'user123' } },
  ...overrides,
});

const makeRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('PaymentController — scanReceipt', () => {
  afterEach(() => jest.clearAllMocks());

  it('should throw BadRequestError when no file is uploaded', async () => {
    const controller = makeController();
    const req = makeReq({ scannedFiles: [] });

    await expect(controller.scanReceipt(req as any, makeRes())).rejects.toThrow(BadRequestError);
  });

  it('should return extracted data on successful scan', async () => {
    const extracted = {
      amountInCents: 15000,
      description: 'Plumbing repair',
      vendorName: 'ABC Plumbing',
      currency: 'USD',
      confidence: 0.92,
    };
    const invoiceAIService = {
      extractInvoiceData: jest.fn().mockReturnValue(
        Promise.resolve({
          success: true,
          data: extracted,
        })
      ),
    };
    const controller = makeController({ invoiceAIService });
    const res = makeRes();

    (fs.promises.readFile as jest.Mock).mockReturnValue(Promise.resolve(Buffer.from('fake')));

    await controller.scanReceipt(makeReq() as any, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { extracted },
    });
    expect(invoiceAIService.extractInvoiceData).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/jpeg',
      'TEST_CUID'
    );
  });

  it('should always clean up temp file even if readFile fails', async () => {
    const controller = makeController();
    (fs.promises.readFile as jest.Mock).mockReturnValue(Promise.reject(new Error('disk error')));

    await expect(controller.scanReceipt(makeReq() as any, makeRes())).rejects.toThrow('disk error');

    expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/receipt.jpg');
  });

  it('should throw BadRequestError when AI extraction fails', async () => {
    const invoiceAIService = {
      extractInvoiceData: jest.fn().mockReturnValue(
        Promise.resolve({
          success: false,
          data: null,
          message: 'Not an invoice',
        })
      ),
    };
    const controller = makeController({ invoiceAIService });

    (fs.promises.readFile as jest.Mock).mockReturnValue(Promise.resolve(Buffer.from('fake')));

    await expect(controller.scanReceipt(makeReq() as any, makeRes())).rejects.toThrow(
      BadRequestError
    );
  });

  it('should clean up temp file on successful scan', async () => {
    const invoiceAIService = {
      extractInvoiceData: jest.fn().mockReturnValue(
        Promise.resolve({
          success: true,
          data: { amountInCents: 100, confidence: 0.9 },
        })
      ),
    };
    const controller = makeController({ invoiceAIService });

    (fs.promises.readFile as jest.Mock).mockReturnValue(Promise.resolve(Buffer.from('fake')));

    await controller.scanReceipt(makeReq() as any, makeRes());

    expect(fs.promises.unlink).toHaveBeenCalledWith('/tmp/receipt.jpg');
  });
});
