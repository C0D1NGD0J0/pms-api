import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { VendorService } from '@services/vendor/vendor.service';
import { InvitationService } from '@services/invitation/invitation.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';

describe('Vendor team-member links use the vendor vuid', () => {
  const cuid = 'CLIENT000001';
  const vuid = 'GNTM8EMXMA2Z';

  describe('InvitationService.assertLinkedVendorConnected', () => {
    const vendorService = { getVendorByVuid: jest.fn() };
    const service = new InvitationService({ vendorService } as any) as any;

    beforeEach(() => jest.clearAllMocks());

    it('skips non-vendor invitations and primary-vendor invitations', async () => {
      await service.assertLinkedVendorConnected(cuid, { role: 'manager', linkedVendorUid: vuid });
      await service.assertLinkedVendorConnected(cuid, { role: 'vendor' });
      expect(vendorService.getVendorByVuid).not.toHaveBeenCalled();
    });

    it('accepts a vendor connected to the client', async () => {
      vendorService.getVendorByVuid.mockResolvedValue({
        vuid,
        connectedClients: [{ cuid, isConnected: true }],
      });
      await expect(
        service.assertLinkedVendorConnected(cuid, { role: 'vendor', linkedVendorUid: vuid })
      ).resolves.toBeUndefined();
      expect(vendorService.getVendorByVuid).toHaveBeenCalledWith(vuid);
    });

    it('rejects an unknown vuid', async () => {
      vendorService.getVendorByVuid.mockResolvedValue(null);
      await expect(
        service.assertLinkedVendorConnected(cuid, { role: 'vendor', linkedVendorUid: vuid })
      ).rejects.toThrow(BadRequestError);
    });

    it('rejects a vendor that is not connected to this client', async () => {
      vendorService.getVendorByVuid.mockResolvedValue({
        vuid,
        connectedClients: [{ cuid: 'OTHERCLIENT1', isConnected: true }],
      });
      await expect(
        service.assertLinkedVendorConnected(cuid, { role: 'vendor', linkedVendorUid: vuid })
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('VendorService.updateVendorInfo ownership', () => {
    const primaryUserId = new Types.ObjectId().toString();
    const vendorDAO = { getVendorById: jest.fn(), updateVendor: jest.fn() };
    const service = new VendorService({ vendorDAO, geoCoderService: {} } as any);

    beforeEach(() => jest.clearAllMocks());

    it('resolves the vendor by vuid or _id so the ownership check always runs', async () => {
      vendorDAO.getVendorById.mockResolvedValue({
        connectedClients: [{ cuid, primaryAccountHolderUserId: new Types.ObjectId() }],
      });

      await expect(
        service.updateVendorInfo(new Types.ObjectId().toString(), {}, undefined, primaryUserId)
      ).rejects.toThrow(ForbiddenError);
      expect(vendorDAO.updateVendor).not.toHaveBeenCalled();
    });

    it('rejects an unknown vendor instead of skipping the check', async () => {
      vendorDAO.getVendorById.mockResolvedValue(null);
      await expect(service.updateVendorInfo(vuid, {}, undefined, primaryUserId)).rejects.toThrow(
        NotFoundError
      );
      expect(vendorDAO.updateVendor).not.toHaveBeenCalled();
    });

    it('lets the primary account holder update', async () => {
      vendorDAO.getVendorById.mockResolvedValue({
        connectedClients: [{ cuid, primaryAccountHolderUserId: new Types.ObjectId(primaryUserId) }],
      });
      vendorDAO.updateVendor.mockResolvedValue({ vuid });

      await service.updateVendorInfo(
        vuid,
        { companyName: 'Acme' } as any,
        undefined,
        primaryUserId
      );
      expect(vendorDAO.updateVendor).toHaveBeenCalledWith(vuid, { companyName: 'Acme' }, undefined);
    });
  });

  describe('UserDAO.getLinkedVendorUsers', () => {
    const dao = Object.create(UserDAO.prototype) as { list: jest.Mock; logger: any } & UserDAO;

    beforeEach(() => {
      dao.list = jest.fn().mockResolvedValue({ items: [] });
      dao.logger = { error: jest.fn() };
    });

    it('matches only team members of this vendor on the same cuids entry', async () => {
      await dao.getLinkedVendorUsers(vuid, cuid);
      expect(dao.list).toHaveBeenCalledWith(
        {
          deletedAt: null,
          cuids: { $elemMatch: { cuid, isConnected: true, linkedVendorUid: vuid } },
        },
        undefined
      );
    });

    it('adds the primary account holder by _id when asked — never other primary vendors', async () => {
      const primaryUserId = new Types.ObjectId();
      await dao.getLinkedVendorUsers(vuid, cuid, undefined, primaryUserId.toString());

      const [query] = dao.list.mock.calls[0];
      expect(query.$or).toEqual([
        { cuids: { $elemMatch: { cuid, isConnected: true, linkedVendorUid: vuid } } },
        { _id: primaryUserId, cuids: { $elemMatch: { cuid, isConnected: true } } },
      ]);
      expect(JSON.stringify(query)).not.toContain('primaryRole');
    });
  });
});
