import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { LeaseStatus } from '@interfaces/lease.interface';

jest.mock('@di/index', () => ({ container: {} }));

import { LeaseRenewalService } from '@services/lease/leaseRenewal.service';

describe('LeaseRenewalService - renewal crons read every eligible lease', () => {
  // Far outside the generation window, so each lease is checked and skipped
  const makeLeaseOutsideWindow = () => ({
    _id: new Types.ObjectId(),
    luid: `L-${Math.random()}`,
    cuid: 'TESTCLIENT123',
    status: LeaseStatus.ACTIVE,
    duration: { endDate: dayjs().add(300, 'days').toDate() },
    renewalOptions: { autoRenew: true, daysBeforeExpiryToGenerateRenewal: 30 },
  });

  it('processAutoRenewals checks every lease the DAO yields, not only the first page', async () => {
    const firstPage = Array.from({ length: 200 }, makeLeaseOutsideWindow);
    const secondPage = Array.from({ length: 50 }, makeLeaseOutsideWindow);
    const mockLeaseDAO = {
      list: jest
        .fn()
        .mockResolvedValueOnce({ items: firstPage })
        .mockResolvedValueOnce({ items: secondPage }),
    };
    const service = new LeaseRenewalService({ leaseDAO: mockLeaseDAO } as any);
    const infoSpy = jest.spyOn((service as any).log, 'info');

    await service.processAutoRenewals();

    expect(mockLeaseDAO.list).toHaveBeenCalledTimes(2);
    expect(mockLeaseDAO.list.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        status: LeaseStatus.ACTIVE,
        'renewalOptions.autoRenew': true,
        deletedAt: null,
      })
    );
    expect(mockLeaseDAO.list.mock.calls[1][0].$and[1]).toEqual({
      _id: { $gt: firstPage[199]._id },
    });
    expect(infoSpy).toHaveBeenCalledWith(
      'Auto-renewal draft creation completed',
      expect.objectContaining({ total: 250, skipped: 250 })
    );
  });

  it('autoSendRenewalsForSignature checks every ready renewal the DAO yields', async () => {
    const renewals = Array.from({ length: 30 }, () => ({
      luid: `R-${Math.random()}`,
      previousLeaseId: null,
    }));
    const mockLeaseDAO = { list: jest.fn().mockResolvedValue({ items: renewals }) };
    const service = new LeaseRenewalService({ leaseDAO: mockLeaseDAO } as any);
    const infoSpy = jest.spyOn((service as any).log, 'info');

    await service.autoSendRenewalsForSignature(jest.fn());

    expect(mockLeaseDAO.list).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      'Auto-send renewals completed',
      expect.objectContaining({ total: 30, errors: 30 })
    );
  });
});
