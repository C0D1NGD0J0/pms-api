import { Types } from 'mongoose';
import { envVariables } from '@shared/config';
import { IRequestContext } from '@interfaces/utils.interface';
import { mockSubscriptionService } from '@tests/setup/externalMocks';

// Break the circular import chain: lease.service → @shared/middlewares → @di/index → registerResources → lease.service (undefined)
jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));
jest.mock('@services/lease/leaseHelpers', () => ({
  ...jest.requireActual('@services/lease/leaseHelpers'),
  handleActiveUpdate: jest.fn(),
}));

import { LeaseService } from '@services/lease/lease.service';
import { handleActiveUpdate } from '@services/lease/leaseHelpers';

/**
 * An admin editing an active lease notifies the tenant by email and in-app; both link to the
 * tenant portal, which is routed by the tenant's uid.
 */
describe('LeaseService.updateLease — admin update of an active lease', () => {
  const cuid = 'CLIENT000001';
  const actorId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const lease = {
    _id: new Types.ObjectId(),
    luid: 'LEASE0000001',
    leaseNumber: 'L-2026-001',
    status: 'active',
    tenantId,
    property: { address: '1 Maple Court, Toronto' },
  };

  const context = {
    currentuser: {
      sub: actorId.toString(),
      email: 'admin@example.com',
      fullname: 'Admin User',
      client: { cuid, role: 'admin' },
    },
    request: { params: { cuid } },
  } as unknown as IRequestContext;

  let addJobToQueue: jest.Mock;
  let createNotificationFromTemplate: jest.Mock;
  let profileFindFirst: jest.Mock;
  let leaseService: LeaseService;

  beforeEach(() => {
    (handleActiveUpdate as jest.Mock).mockResolvedValue({ success: true, data: { lease } });
    addJobToQueue = jest.fn();
    createNotificationFromTemplate = jest.fn().mockResolvedValue({});
    profileFindFirst = jest.fn();

    leaseService = new LeaseService({
      subscriptionService: mockSubscriptionService as any,
      leaseDAO: { findFirst: jest.fn().mockResolvedValue(lease) } as any,
      userDAO: {} as any,
      clientDAO: {} as any,
      propertyDAO: {} as any,
      invitationDAO: {} as any,
      profileDAO: { findFirst: profileFindFirst } as any,
      mailerService: {} as any,
      invitationService: {} as any,
      leaseCache: { invalidateLease: jest.fn(), invalidateLeaseLists: jest.fn() } as any,
      emitterService: { on: jest.fn(), off: jest.fn(), emit: jest.fn() } as any,
      notificationService: { createNotificationFromTemplate } as any,
      leaseSignatureService: {} as any,
      leaseDocumentService: {} as any,
      leaseTemplateService: {} as any,
      leaseRenewalService: {} as any,
      mediaUploadService: {} as any,
      leasePdfService: {} as any,
      boldSignService: {} as any,
      propertyUnitDAO: {} as any,
      queueFactory: { getQueue: jest.fn().mockReturnValue({ addJobToQueue }) } as any,
      userService: {} as any,
      smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
      paymentDAO: {} as any,
      userCache: { invalidateUserDetail: jest.fn().mockResolvedValue({ success: true }) } as any,
      s3Service: { getSignedUrl: jest.fn(), uploadFiles: jest.fn() } as any,
    });
  });

  const inAppLeaseUrl = () => createNotificationFromTemplate.mock.calls[0][7].metadata.leaseUrl;
  const emailLeaseUrl = () => addJobToQueue.mock.calls[0][1].data.leaseUrl;

  it('links the email and in-app notification to the tenant portal by the tenant uid', async () => {
    profileFindFirst.mockResolvedValue({
      personalInfo: { firstName: 'Tina', lastName: 'Tenant' },
      user: { email: 'tenant@example.com', uid: 'TENANT000001' },
    });

    await leaseService.updateLease(context, lease.luid, {});

    const expectedUrl = `${envVariables.FRONTEND.URL}/tenants/${cuid}/TENANT000001/lease/${lease.luid}`;
    expect(emailLeaseUrl()).toBe(expectedUrl);
    expect(inAppLeaseUrl()).toBe(expectedUrl);
    expect(createNotificationFromTemplate.mock.calls[0][2]).toBe(tenantId.toString());
  });

  it('falls back to the login page when the tenant profile cannot be loaded', async () => {
    profileFindFirst.mockRejectedValue(new Error('db down'));

    await leaseService.updateLease(context, lease.luid, {});

    expect(addJobToQueue).not.toHaveBeenCalled();
    expect(inAppLeaseUrl()).toBe(`${envVariables.FRONTEND.URL}/login`);
  });

  it('does not notify the tenant when the edit is staged for approval', async () => {
    (handleActiveUpdate as jest.Mock).mockResolvedValue({
      success: true,
      data: { requiresApproval: true },
    });

    await leaseService.updateLease(context, lease.luid, {});

    expect(addJobToQueue).not.toHaveBeenCalled();
    expect(createNotificationFromTemplate).not.toHaveBeenCalled();
  });
});
