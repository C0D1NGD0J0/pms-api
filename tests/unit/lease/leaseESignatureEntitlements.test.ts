import { Types } from 'mongoose';
import { ForbiddenError } from '@shared/customErrors';
import { ROLES } from '@shared/constants/roles.constants';
import { LeasePdfService } from '@services/lease/leasePdf.service';
import { SigningMethod, LeaseStatus } from '@interfaces/lease.interface';
import {
  assertESignatureEntitlement,
  hasESignatureEntitlement,
} from '@services/lease/leaseEntitlements';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));
jest.mock('@utils/systemBot', () => ({
  getSystemBotUserId: jest.fn().mockResolvedValue(new Types.ObjectId()),
}));

import { LeaseService } from '@services/lease/lease.service';

const subscriptionWith = (data: unknown) => ({
  getSubscriptionEntitlements: (jest.fn() as any).mockResolvedValue({ success: true, data }),
});
const entitled = () => subscriptionWith({ entitlements: { eSignature: true } });
const notEntitled = () => subscriptionWith({ entitlements: { eSignature: false } });

describe('e-signature entitlement helpers', () => {
  it('is entitled only when the plan includes eSignature', async () => {
    expect(await hasESignatureEntitlement(entitled() as any, 'c1')).toBe(true);
    expect(await hasESignatureEntitlement(notEntitled() as any, 'c1')).toBe(false);
  });

  it('fails closed when there is no subscription record', async () => {
    expect(await hasESignatureEntitlement(subscriptionWith(null) as any, 'c1')).toBe(false);
  });

  it('assert throws a ForbiddenError when not entitled', async () => {
    await expect(assertESignatureEntitlement(notEntitled() as any, 'c1')).rejects.toBeInstanceOf(
      ForbiddenError
    );
    await expect(assertESignatureEntitlement(entitled() as any, 'c1')).resolves.toBeUndefined();
  });
});

describe('LeaseService — electronic signing requires the plan', () => {
  const buildService = (subscriptionService: any, overrides: Record<string, any> = {}) =>
    new LeaseService({
      subscriptionService,
      leaseDAO: { findFirst: jest.fn() } as any,
      userDAO: {} as any,
      clientDAO: { getClientByCuid: jest.fn().mockResolvedValue({ _id: 'client-1' }) } as any,
      propertyDAO: { findFirst: jest.fn().mockRejectedValue(new Error('stop-after-check')) } as any,
      invitationDAO: {} as any,
      profileDAO: {} as any,
      mailerService: {} as any,
      invitationService: {} as any,
      leaseCache: {} as any,
      emitterService: { on: jest.fn(), emit: jest.fn() } as any,
      notificationService: {} as any,
      leaseSignatureService: {} as any,
      leaseDocumentService: {} as any,
      leaseTemplateService: {} as any,
      leaseRenewalService: {} as any,
      mediaUploadService: {} as any,
      leasePdfService: {} as any,
      boldSignService: {} as any,
      propertyUnitDAO: {} as any,
      queueFactory: {} as any,
      userService: {} as any,
      smsService: {} as any,
      paymentDAO: {} as any,
      userCache: {} as any,
      s3Service: {} as any,
      ...overrides,
    } as any);

  const createCtx = { currentuser: { sub: new Types.ObjectId().toString() } } as any;
  const leaseData = (signingMethod: SigningMethod) =>
    ({ signingMethod, property: { id: new Types.ObjectId().toString() } }) as any;

  describe('createLease', () => {
    it('rejects an electronic lease when the plan lacks e-signature', async () => {
      const service = buildService(notEntitled());

      await expect(
        service.createLease('c1', leaseData(SigningMethod.ELECTRONIC), createCtx)
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('does not check the plan for a manual lease', async () => {
      const subscription = notEntitled();
      const service = buildService(subscription);

      // Proceeds past the check (stops at the stubbed property lookup)
      await expect(
        service.createLease('c1', leaseData(SigningMethod.MANUAL), createCtx)
      ).rejects.toThrow('stop-after-check');
      expect(subscription.getSubscriptionEntitlements).not.toHaveBeenCalled();
    });

    it('allows an electronic lease when the plan includes e-signature', async () => {
      const service = buildService(entitled());

      await expect(
        service.createLease('c1', leaseData(SigningMethod.ELECTRONIC), createCtx)
      ).rejects.toThrow('stop-after-check');
    });
  });

  describe('sendLeaseForSignature (signature route + renewal auto-send)', () => {
    const sendCtx = { request: { params: { cuid: 'c1', luid: 'l1' } } } as any;

    it('refuses to send when the plan lacks e-signature', async () => {
      const leaseSignatureService = { sendLeaseForSignature: jest.fn() };
      const service = buildService(notEntitled(), { leaseSignatureService });

      await expect(service.sendLeaseForSignature(sendCtx)).rejects.toBeInstanceOf(ForbiddenError);
      expect(leaseSignatureService.sendLeaseForSignature).not.toHaveBeenCalled();
    });

    it('sends when the plan includes e-signature', async () => {
      const leaseSignatureService = {
        sendLeaseForSignature: (jest.fn() as any).mockResolvedValue({ success: true }),
      };
      const service = buildService(entitled(), { leaseSignatureService });

      await expect(service.sendLeaseForSignature(sendCtx)).resolves.toEqual({ success: true });
    });
  });

  describe('updateLease', () => {
    const tenantId = new Types.ObjectId();
    const updateCtx = {
      request: { params: { cuid: 'c1' } },
      currentuser: { sub: new Types.ObjectId().toString(), client: { role: ROLES.ADMIN } },
    } as any;

    const serviceWithLease = (subscriptionService: any, signingMethod: SigningMethod) =>
      buildService(subscriptionService, {
        leaseDAO: {
          findFirst: jest.fn().mockResolvedValue({
            luid: 'l1',
            cuid: 'c1',
            tenantId,
            signingMethod,
            status: LeaseStatus.DRAFT,
          }),
        },
      });

    it('rejects switching a lease to electronic when the plan lacks e-signature', async () => {
      const service = serviceWithLease(notEntitled(), SigningMethod.MANUAL);

      await expect(
        service.updateLease(updateCtx, 'l1', { signingMethod: SigningMethod.ELECTRONIC } as any)
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('keeps an already-electronic lease editable after a downgrade', async () => {
      const subscription = notEntitled();
      const service = serviceWithLease(subscription, SigningMethod.ELECTRONIC);

      // Whatever happens further down the (stubbed) update, it isn't the plan check
      await service
        .updateLease(updateCtx, 'l1', { signingMethod: SigningMethod.ELECTRONIC } as any)
        .catch((error) => {
          expect(error).not.toBeInstanceOf(ForbiddenError);
        });
      expect(subscription.getSubscriptionEntitlements).not.toHaveBeenCalled();
    });
  });
});

describe('LeasePdfService — PDF-generated e-signature hand-off', () => {
  const lease = {
    cuid: 'c1',
    signingMethod: SigningMethod.ELECTRONIC,
    status: LeaseStatus.READY_FOR_SIGNATURE,
    createdBy: new Types.ObjectId(),
  };

  const run = async (subscriptionService: any) => {
    const addToESignatureRequestQueue = jest.fn().mockResolvedValue(undefined);
    const service = new LeasePdfService({
      subscriptionService,
      leaseDAO: { findById: jest.fn().mockResolvedValue(lease) } as any,
      queueFactory: { getQueue: jest.fn(() => ({ addToESignatureRequestQueue })) } as any,
      clientDAO: {} as any,
      emitterService: { on: jest.fn(), emit: jest.fn() } as any,
      leaseTemplateService: {} as any,
      sseService: {} as any,
      leaseCache: {} as any,
      mediaUploadService: {} as any,
      notificationService: {} as any,
      pdfGeneratorService: {} as any,
      profileDAO: {} as any,
      propertyDAO: {} as any,
    } as any);

    await (service as any).handlePdfGeneratedForESignature({
      leaseId: 'lease-1',
      s3Key: 'key',
      senderInfo: {},
    });
    return addToESignatureRequestQueue;
  };

  it('does not send for e-signature when the plan lacks it', async () => {
    expect(await run(notEntitled())).not.toHaveBeenCalled();
  });

  it('sends for e-signature when the plan includes it', async () => {
    expect(await run(entitled())).toHaveBeenCalled();
  });
});
