import { Types } from 'mongoose';
import { Lease } from '@models/index';
import { LeaseStatus, LeaseType } from '@interfaces/lease.interface';

const buildLease = (fees: Record<string, unknown>) =>
  new Lease({
    luid: 'lease-annual-test',
    cuid: 'CLIENT_1',
    tenantId: new Types.ObjectId(),
    property: { id: new Types.ObjectId(), address: '12 Admiralty Way, Lekki, Lagos' },
    status: LeaseStatus.DRAFT,
    type: LeaseType.FIXED_TERM,
    duration: { startDate: new Date('2026-03-15'), endDate: new Date('2028-03-14') },
    fees: {
      rentAmount: 10000000,
      securityDeposit: 0,
      currency: 'NGN',
      acceptedPaymentMethod: 'bank-transfer',
      ...fees,
    },
    signingMethod: 'manual',
    templateType: 'generic',
    createdBy: new Types.ObjectId(),
  });

const errorPaths = (fees: Record<string, unknown>) =>
  Object.keys(buildLease(fees).validateSync()?.errors ?? {});

describe('Lease model — rent frequency and bank transfer', () => {
  it('defaults to monthly and accepts bank-transfer with payment instructions', () => {
    const lease = buildLease({ paymentInstructions: 'GTBank USD domiciliary 0123456789' });
    expect(lease.validateSync()).toBeUndefined();
    expect(lease.fees.paymentFrequency).toBe('monthly');
  });

  it('requires the annual rent on an annual lease', () => {
    expect(errorPaths({ paymentFrequency: 'annual' })).toContain('fees.annualRentAmount');
    expect(errorPaths({ paymentFrequency: 'annual', annualRentAmount: 120000000 })).toEqual([]);
  });

  it('rejects an unknown frequency and over-long payment instructions', () => {
    expect(errorPaths({ paymentFrequency: 'weekly' })).toContain('fees.paymentFrequency');
    expect(errorPaths({ paymentInstructions: 'x'.repeat(1001) })).toContain(
      'fees.paymentInstructions'
    );
  });
});
