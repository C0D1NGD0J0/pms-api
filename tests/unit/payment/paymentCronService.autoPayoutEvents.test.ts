/**
 * PaymentCronService — auto vendor payout event emission tests
 *
 * Verifies that autoPayoutVendors emits MAINTENANCE_AUTO_VENDOR_PAID
 * for each successful payout so that finance staff receive notifications.
 */
import { Types } from 'mongoose';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { EventTypes } from '@interfaces/events.interface';
import { PaymentCronService } from '@services/payments/paymentCron.service';

const CUID = 'CLIENT_AUTO_PAY';
const MRUID = 'MR-001';
const VENDOR_ID = new Types.ObjectId();

const makeInvoice = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  invuid: 'INV-001',
  cuid: CUID,
  mruid: MRUID,
  maintenanceRequestUid: MRUID,
  amountInCents: 50000,
  submittedBy: VENDOR_ID,
  ...overrides,
});

const makeMocks = () => {
  const invoiceDAO = {
    findReadyForAutoPayout: jest.fn().mockReturnValue(Promise.resolve([])),
  } as any;

  const maintenancePaymentService = {
    payVendor: jest.fn().mockReturnValue(Promise.resolve()),
  } as any;

  const profileDAO = {
    getProfileByUserId: jest.fn().mockReturnValue(Promise.resolve({ fullname: 'Jane Vendor' })),
  } as any;

  const emitterService = {
    emit: jest.fn(),
    on: jest.fn(),
  } as any;

  const noop = {} as any;

  const service = new PaymentCronService({
    maintenancePaymentService,
    paymentGatewayService: noop,
    paymentProcessorDAO: noop,
    subscriptionPlanConfig: noop,
    emitterService,
    subscriptionDAO: noop,
    stripeService: noop,
    smsService: { sendToUser: jest.fn() } as any,
    invoiceDAO,
    queueFactory: { getQueue: jest.fn() } as any,
    profileDAO,
    paymentDAO: noop,
    clientDAO: noop,
    leaseDAO: noop,
  });

  return { service, invoiceDAO, maintenancePaymentService, profileDAO, emitterService };
};

const getAutoPayoutHandler = async (service: PaymentCronService) => {
  const jobs = await service.getCronJobs();
  const job = jobs.find((j: any) => j.name === 'payment.auto-payout-vendors');
  if (!job) throw new Error('auto-payout-vendors cron job not found');
  return job.handler;
};

describe('PaymentCronService — autoPayoutVendors event emission', () => {
  afterEach(() => jest.clearAllMocks());

  it('should emit MAINTENANCE_AUTO_VENDOR_PAID after successful payout', async () => {
    const { service, invoiceDAO, emitterService } = makeMocks();
    invoiceDAO.findReadyForAutoPayout.mockReturnValue(Promise.resolve([makeInvoice()]));

    const handler = await getAutoPayoutHandler(service);
    await handler();

    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_AUTO_VENDOR_PAID,
      expect.objectContaining({
        amountInCents: 50000,
        vendorName: 'Jane Vendor',
        mruid: MRUID,
        cuid: CUID,
      })
    );
  });

  it('should use fallback vendor name when profile not found', async () => {
    const { service, invoiceDAO, profileDAO, emitterService } = makeMocks();
    invoiceDAO.findReadyForAutoPayout.mockReturnValue(Promise.resolve([makeInvoice()]));
    profileDAO.getProfileByUserId.mockReturnValue(Promise.resolve(null));

    const handler = await getAutoPayoutHandler(service);
    await handler();

    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_AUTO_VENDOR_PAID,
      expect.objectContaining({
        vendorName: 'Unknown Vendor',
      })
    );
  });

  it('should NOT emit event when payout fails', async () => {
    const { service, invoiceDAO, maintenancePaymentService, emitterService } = makeMocks();
    invoiceDAO.findReadyForAutoPayout.mockReturnValue(Promise.resolve([makeInvoice()]));
    maintenancePaymentService.payVendor.mockReturnValue(
      Promise.reject(new Error('Transfer failed'))
    );

    const handler = await getAutoPayoutHandler(service);
    await handler();

    expect(emitterService.emit).not.toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_AUTO_VENDOR_PAID,
      expect.anything()
    );
  });

  it('should emit one event per successful payout in batch', async () => {
    const { service, invoiceDAO, emitterService } = makeMocks();
    invoiceDAO.findReadyForAutoPayout.mockReturnValue(
      Promise.resolve([
        makeInvoice({ mruid: 'MR-001', maintenanceRequestUid: 'MR-001' }),
        makeInvoice({ mruid: 'MR-002', maintenanceRequestUid: 'MR-002' }),
      ])
    );

    const handler = await getAutoPayoutHandler(service);
    await handler();

    const autoPayCalls = emitterService.emit.mock.calls.filter(
      ([type]: [string]) => type === EventTypes.MAINTENANCE_AUTO_VENDOR_PAID
    );
    expect(autoPayCalls).toHaveLength(2);
  });

  it('should NOT emit when no invoices are ready', async () => {
    const { service, invoiceDAO, emitterService } = makeMocks();
    invoiceDAO.findReadyForAutoPayout.mockReturnValue(Promise.resolve([]));

    const handler = await getAutoPayoutHandler(service);
    await handler();

    expect(emitterService.emit).not.toHaveBeenCalled();
  });
});
