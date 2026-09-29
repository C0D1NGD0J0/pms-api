import { Types } from 'mongoose';
import { InvalidRequestError } from '@shared/customErrors';
import { VerificationStatusEnum } from '@interfaces/property.interface';
import { PropertyVerificationService } from '@services/property/propertyVerification.service';

const CUID = 'CLIENT1';
const PID = 'PROP1';
const DAY = 24 * 60 * 60 * 1000;

const mockPropertyDAO = {
  findFirst: jest.fn(),
  update: jest.fn(),
  getPropertiesByClientId: jest.fn(),
};
const mockPropertyCache = {
  invalidateProperty: jest.fn(),
  invalidatePropertyLists: jest.fn(),
  invalidateLeaseableProperties: jest.fn(),
};

const adminUser = {
  sub: new Types.ObjectId().toString(),
  client: { cuid: CUID, role: 'admin' },
} as any;

const buildService = () =>
  new PropertyVerificationService({
    propertyDAO: mockPropertyDAO,
    propertyCache: mockPropertyCache,
  } as any);

describe('PropertyVerificationService', () => {
  let service: PropertyVerificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
  });

  describe('getPendingVerifications', () => {
    it('includes both unverified and rejected properties in the review queue', async () => {
      mockPropertyDAO.getPropertiesByClientId.mockResolvedValue({ items: [], pagination: {} });

      await service.getPendingVerifications(CUID, adminUser, { page: 1, limit: 10 });

      expect(mockPropertyDAO.getPropertiesByClientId).toHaveBeenCalledWith(
        CUID,
        expect.objectContaining({
          verificationStatus: {
            $in: [VerificationStatusEnum.UNVERIFIED, VerificationStatusEnum.REJECTED],
          },
        }),
        expect.any(Object)
      );
    });
  });

  describe('grantGracePeriod', () => {
    const futureDate = new Date(Date.now() + 7 * DAY);

    it('refuses a grace period on a rejected property', async () => {
      mockPropertyDAO.findFirst.mockResolvedValue({
        id: 'p1',
        verificationStatus: VerificationStatusEnum.REJECTED,
      });

      await expect(service.grantGracePeriod(CUID, PID, adminUser, futureDate)).rejects.toThrow(
        InvalidRequestError
      );
      expect(mockPropertyDAO.update).not.toHaveBeenCalled();
    });

    it('refuses a grace period on an already verified property', async () => {
      mockPropertyDAO.findFirst.mockResolvedValue({
        id: 'p1',
        verificationStatus: VerificationStatusEnum.VERIFIED,
      });

      await expect(service.grantGracePeriod(CUID, PID, adminUser, futureDate)).rejects.toThrow(
        InvalidRequestError
      );
      expect(mockPropertyDAO.update).not.toHaveBeenCalled();
    });

    it('grants a grace period on an unverified property', async () => {
      mockPropertyDAO.findFirst.mockResolvedValue({
        id: 'p1',
        verificationStatus: VerificationStatusEnum.UNVERIFIED,
      });
      mockPropertyDAO.update.mockResolvedValue({ pid: PID });

      const result = await service.grantGracePeriod(CUID, PID, adminUser, futureDate);

      expect(result.success).toBe(true);
      expect(mockPropertyDAO.update).toHaveBeenCalledWith(
        { pid: PID, cuid: CUID, deletedAt: null },
        expect.objectContaining({
          $set: expect.objectContaining({
            verificationGracePeriod: expect.objectContaining({ expiresAt: futureDate }),
          }),
        })
      );
    });
  });

  describe('verifyProperty', () => {
    it('allows re-verifying a previously rejected property', async () => {
      mockPropertyDAO.findFirst.mockResolvedValue({
        id: 'p1',
        verificationStatus: VerificationStatusEnum.REJECTED,
      });
      mockPropertyDAO.update.mockResolvedValue({ pid: PID });

      const result = await service.verifyProperty(CUID, PID, adminUser);

      expect(result.success).toBe(true);
      expect(mockPropertyDAO.update).toHaveBeenCalledWith(
        { pid: PID, cuid: CUID, deletedAt: null },
        expect.objectContaining({
          $set: expect.objectContaining({ verificationStatus: VerificationStatusEnum.VERIFIED }),
        })
      );
    });
  });
});
