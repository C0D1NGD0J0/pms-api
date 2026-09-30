import { Types } from 'mongoose';
import ROLES from '@shared/constants/roles.constants';
import { PropertyService } from '@services/property/property.service';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';

const DAY = 24 * 60 * 60 * 1000;

const mockPropertyDAO = {
  list: jest.fn(),
  getPropertiesByClientId: jest.fn(),
};
const mockNotificationService = { createNotification: jest.fn() };
const mockS3Service = { signFileUrls: jest.fn(async (items: any[]) => items) };
const mockClientDAO = { getClientByCuid: jest.fn() };
const mockPropertyUnitDAO = { aggregate: jest.fn() };

const buildService = () =>
  new PropertyService({
    propertyDAO: mockPropertyDAO,
    notificationService: mockNotificationService,
    s3Service: mockS3Service,
    clientDAO: mockClientDAO,
    propertyUnitDAO: mockPropertyUnitDAO,
    emitterService: { on: jest.fn(), emit: jest.fn() },
    profileDAO: {},
    queueFactory: {},
    propertyCache: {},
    geoCoderService: {},
    propertyCsvProcessor: {},
    mediaUploadService: {},
    propertyApprovalService: {},
    propertyVerificationService: {},
    propertyStatsService: {},
    userDAO: {},
    leaseDAO: {},
    inspectionDAO: {},
    maintenanceRequestDAO: {},
    subscriptionDAO: {},
    paymentDAO: {},
  } as any);

describe('PropertyService — management authorization', () => {
  let service: PropertyService;
  let computeAuthorizationStatus: (p: any) => {
    isAuthorized: boolean;
    reason?: string;
    daysUntilExpiry?: number;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
    computeAuthorizationStatus = (service as any).computeAuthorizationStatus.bind(service);
  });

  describe('computeAuthorizationStatus', () => {
    it('always authorizes company_owned properties, ignoring authorization fields', () => {
      expect(
        computeAuthorizationStatus({
          owner: { type: 'company_owned' },
          authorization: { isActive: false },
        })
      ).toEqual({ isAuthorized: true });
    });

    it('is not authorized when there is no authorization record', () => {
      const result = computeAuthorizationStatus({ owner: { type: 'external_owner' } });
      expect(result.isAuthorized).toBe(false);
      expect(result.reason).toMatch(/No management authorization/);
    });

    it('is not authorized when authorization is inactive', () => {
      expect(
        computeAuthorizationStatus({
          owner: { type: 'external_owner' },
          authorization: { isActive: false },
        })
      ).toEqual({ isAuthorized: false, reason: 'Management authorization is inactive.' });
    });

    it('is authorized without daysUntilExpiry when there is no expiry date', () => {
      expect(
        computeAuthorizationStatus({
          owner: { type: 'external_owner' },
          authorization: { isActive: true, expiresAt: null },
        })
      ).toEqual({ isAuthorized: true });
    });

    it('returns daysUntilExpiry for a future expiry', () => {
      const result = computeAuthorizationStatus({
        owner: { type: 'self_owned' },
        authorization: { isActive: true, expiresAt: new Date(Date.now() + 15 * DAY) },
      });
      expect(result).toEqual({ isAuthorized: true, daysUntilExpiry: 15 });
    });

    it('is not authorized once expired', () => {
      const result = computeAuthorizationStatus({
        owner: { type: 'external_owner' },
        authorization: { isActive: true, expiresAt: new Date(Date.now() - 2 * DAY) },
      });
      expect(result.isAuthorized).toBe(false);
      expect(result.reason).toMatch(/expired on/);
    });
  });

  describe('getCronJobs', () => {
    it('registers a daily authorization expiry check', () => {
      const job = service
        .getCronJobs()
        .find((j) => j.name === 'property:authorization-expiry-check');

      expect(job).toBeDefined();
      expect(job!.enabled).toBe(true);
      expect(job!.schedule).toBe('0 7 * * *');
      expect(typeof job!.handler).toBe('function');
    });
  });

  describe('processExpiringAuthorizations', () => {
    const run = () => (service as any).processExpiringAuthorizations();

    it('only queries active external/self-owned authorizations expiring within 30 days', async () => {
      mockPropertyDAO.list.mockResolvedValue({ items: [] });
      await run();

      const [filter] = mockPropertyDAO.list.mock.calls[0];
      expect(filter).toEqual(
        expect.objectContaining({
          deletedAt: null,
          'owner.type': { $in: ['external_owner', 'self_owned'] },
          'authorization.isActive': true,
        })
      );
      const lte: Date = filter['authorization.expiresAt'].$lte;
      const daysAhead = Math.round((lte.getTime() - Date.now()) / DAY);
      expect(daysAhead).toBe(30);
      expect(mockNotificationService.createNotification).not.toHaveBeenCalled();
    });

    it('sends a HIGH priority announcement to the super-admin when expired', async () => {
      mockPropertyDAO.list.mockResolvedValue({
        items: [
          {
            pid: 'P1',
            cuid: 'C1',
            name: 'Mission Beach Bungalow',
            authorization: { expiresAt: new Date(Date.now() - DAY) },
          },
        ],
      });
      await run();

      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        'C1',
        NotificationTypeEnum.PROPERTY,
        expect.objectContaining({
          cuid: 'C1',
          type: NotificationTypeEnum.PROPERTY,
          recipientType: RecipientTypeEnum.ANNOUNCEMENT,
          targetRoles: [ROLES.SUPER_ADMIN],
          priority: NotificationPriorityEnum.HIGH,
          title: 'Authorization Expired — Mission Beach Bungalow',
          actionUrl: '/properties/C1/P1/edit',
          metadata: expect.objectContaining({ type: 'authorization_expired' }),
        })
      );
    });

    it('sends a MEDIUM priority announcement to the super-admin when expiring soon', async () => {
      mockPropertyDAO.list.mockResolvedValue({
        items: [
          {
            pid: 'P2',
            cuid: 'C2',
            name: 'Notting Hill Victorian',
            authorization: { expiresAt: new Date(Date.now() + 10 * DAY) },
          },
        ],
      });
      await run();

      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        'C2',
        NotificationTypeEnum.PROPERTY,
        expect.objectContaining({
          targetRoles: [ROLES.SUPER_ADMIN],
          priority: NotificationPriorityEnum.MEDIUM,
          message: expect.stringContaining('expires in 10 days'),
          metadata: expect.objectContaining({
            type: 'authorization_expiring',
            daysUntilExpiry: 10,
          }),
        })
      );
    });

    it('never targets admin or manager roles', async () => {
      mockPropertyDAO.list.mockResolvedValue({
        items: [
          {
            pid: 'P',
            cuid: 'C',
            name: 'X',
            authorization: { expiresAt: new Date(Date.now() + DAY) },
          },
        ],
      });
      await run();

      const payload = mockNotificationService.createNotification.mock.calls[0][2];
      expect(payload.targetRoles).not.toContain(ROLES.ADMIN);
      expect(payload.targetRoles).not.toContain(ROLES.MANAGER);
    });
  });

  describe('getClientProperties — presigned URLs', () => {
    it('signs image URLs for every listed property', async () => {
      const images = [{ url: 'https://public/a.png', key: 'property/a.png' }];
      mockClientDAO.getClientByCuid.mockResolvedValue({ cuid: 'C1' });
      mockPropertyDAO.getPropertiesByClientId.mockResolvedValue({
        items: [{ _id: new Types.ObjectId(), pid: 'P1', images, fees: {} }],
        pagination: {},
      });
      mockPropertyUnitDAO.aggregate.mockResolvedValue([]);

      await service.getClientProperties(
        'C1',
        { client: { role: 'super-admin' }, sub: new Types.ObjectId().toString() } as any,
        { pagination: { page: 1, limit: 10 } } as any
      );

      expect(mockS3Service.signFileUrls).toHaveBeenCalledWith(images);
    });
  });
});
