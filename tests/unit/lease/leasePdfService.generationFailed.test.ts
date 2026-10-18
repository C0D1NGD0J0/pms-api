import { Types } from 'mongoose';
import { EventTypes } from '@interfaces/events.interface';
import { NotificationTypeEnum } from '@interfaces/notification.interface';

// Break the circular import chain that runs through @di/index → registerResources
jest.mock('@di/index', () => ({ container: {} }));

import { LeasePdfService } from '@services/lease/leasePdf.service';

const testCuid = 'TESTCLIENT123';
const leaseId = new Types.ObjectId();
const creatorId = new Types.ObjectId();

const buildService = () => {
  const lease = {
    _id: leaseId,
    luid: 'LEASE-PDF-001',
    cuid: testCuid,
    leaseNumber: 'LN-001',
    createdBy: creatorId,
  };
  const mocks = {
    leaseDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve(lease)) },
    emitterService: { on: jest.fn(), emit: jest.fn() },
    notificationService: {
      createNotificationFromTemplate: jest.fn().mockReturnValue(Promise.resolve()),
    },
  } as any;
  const service = new LeasePdfService(mocks);
  return { service, mocks };
};

describe('LeasePdfService - PDF generation failure', () => {
  it('notifies the lease creator when generation fails', async () => {
    const { service, mocks } = buildService();
    jest
      .spyOn(service, 'generateLeasePDF')
      .mockReturnValue(Promise.resolve({ success: false, error: "Template type 'x' not found" }));

    await (service as any).handlePdfGenerationRequest({
      jobId: 'job-1',
      cuid: testCuid,
      resource: { resourceId: leaseId.toString(), resourceName: 'lease' },
    });

    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PDF_GENERATION_FAILED,
      expect.objectContaining({ resourceId: leaseId.toString() })
    );
    expect(mocks.notificationService.createNotificationFromTemplate).toHaveBeenCalledWith(
      'lease.pdfGenerationFailed',
      expect.objectContaining({ leaseNumber: 'LN-001' }),
      creatorId.toString(),
      NotificationTypeEnum.ERROR,
      expect.anything(),
      testCuid,
      creatorId.toString(),
      expect.objectContaining({ resourceUid: 'LEASE-PDF-001' })
    );
  });
});
