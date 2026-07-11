import { Types } from 'mongoose';
import { BadRequestError } from '@shared/customErrors';
/**
 * Currency guard integration test.
 * Verifies that updating a property's country (which auto-changes currency)
 * is blocked when the property has active leases.
 */
import { ROLES } from '@shared/constants/roles.constants';
import { PropertyService } from '@services/property/property.service';
import { PropertyStatsService } from '@services/property/propertyStats.service';
import { mockQueueFactory, mockEventEmitter } from '@tests/setup/externalMocks';
import { SigningMethod, LeaseStatus, LeaseType } from '@interfaces/lease.interface';
import { PropertyUnit, Property, Profile, Client, Lease, User } from '@models/index';
import { PropertyApprovalService } from '@services/property/propertyApproval.service';
import { createTestProperty, clearTestDatabase, createTestClient } from '@tests/helpers';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';

const mockMediaUploadService = {
  handleMediaDeletion: jest.fn().mockResolvedValue(undefined),
  uploadFile: jest.fn().mockResolvedValue({ success: true }),
} as any;

const mockGeoCoderService = {
  geocode: jest.fn().mockResolvedValue({
    success: true,
    data: { latitude: 6.5244, longitude: 3.3792, formattedAddress: 'Lagos, Nigeria' },
  }),
} as any;

const mockNotificationService = {
  handlePropertyUpdateNotifications: jest.fn().mockResolvedValue({ success: true }),
  notifyPendingChangesOverridden: jest.fn().mockResolvedValue({ success: true }),
  notifyApprovalDecision: jest.fn().mockResolvedValue({ success: true }),
} as any;

const mockPropertyCache = {
  cacheProperty: jest.fn().mockResolvedValue({ success: true }),
  getClientProperties: jest.fn().mockResolvedValue({ success: false }),
  saveClientProperties: jest.fn().mockResolvedValue({ success: true }),
  invalidateProperty: jest.fn().mockResolvedValue({ success: true }),
  invalidatePropertyLists: jest.fn().mockResolvedValue({ success: true }),
  getLeaseableProperties: jest.fn().mockResolvedValue({ success: false }),
  cacheLeaseableProperties: jest.fn().mockResolvedValue({ success: true }),
  invalidateLeaseableProperties: jest.fn().mockResolvedValue({ success: true }),
} as any;

const mockPropertyCsvProcessor = {
  validateCsv: jest.fn().mockResolvedValue({ success: true }),
  processCsv: jest.fn().mockResolvedValue({ success: true }),
} as any;

describe('PropertyService — currency guard on country update', () => {
  let propertyService: PropertyService;
  let leaseDAO: LeaseDAO;

  const makeMockCtx = (cuid: string, userId: string) => ({
    request: {
      params: { cuid },
      url: '/properties',
      method: 'PATCH',
      path: '/properties',
      query: {},
    },
    userAgent: {
      browser: 'Test',
      version: '1',
      os: 'Test',
      raw: 'test',
      isMobile: false,
      isBot: false,
    },
    langSetting: { lang: 'en', t: jest.fn((key: string) => key) },
    timing: { startTime: Date.now() },
    currentuser: {
      sub: userId,
      displayName: 'Admin',
      fullname: 'Admin User',
      client: { cuid, role: ROLES.ADMIN },
    },
    service: { env: 'test' },
    source: 'WEB' as any,
    requestId: 'req-guard',
    timestamp: new Date(),
  });

  beforeAll(async () => {
    const propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
    const propertyDAO = new PropertyDAO({ propertyModel: Property, propertyUnitDAO });
    const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    const profileDAO = new ProfileDAO({ profileModel: Profile });
    const userDAO = new UserDAO({ userModel: User });
    leaseDAO = new LeaseDAO({ leaseModel: Lease });

    const propertyApprovalService = new PropertyApprovalService({
      propertyDAO,
      propertyCache: mockPropertyCache,
      notificationService: mockNotificationService,
    });

    const propertyStatsService = new PropertyStatsService({ propertyUnitDAO, propertyDAO });

    propertyService = new PropertyService({
      propertyDAO,
      propertyUnitDAO,
      clientDAO,
      profileDAO,
      userDAO,
      leaseDAO,
      queueFactory: mockQueueFactory as any,
      propertyCache: mockPropertyCache,
      emitterService: mockEventEmitter as any,
      mediaUploadService: mockMediaUploadService,
      geoCoderService: mockGeoCoderService,
      notificationService: mockNotificationService,
      propertyCsvProcessor: mockPropertyCsvProcessor,
      propertyApprovalService,
      propertyStatsService,
      subscriptionDAO: {} as any,
      paymentDAO: {} as any,
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
  });

  it('blocks country update when an active lease exists on the property', async () => {
    const client = await createTestClient();
    const property = await createTestProperty(client.cuid, client._id);
    await Property.findByIdAndUpdate(property._id, {
      'address.country': 'US',
      'fees.currency': 'USD',
    });

    // Create an active lease on this property
    const leaseTenantId = new Types.ObjectId();
    await Lease.create({
      cuid: client.cuid,
      luid: 'TEST-LUID-GUARD',
      leaseNumber: 'LN-GUARD',
      type: LeaseType.FIXED_TERM,
      status: LeaseStatus.ACTIVE,
      approvalStatus: 'approved' as const,
      templateType: 'residential-apartment' as const,
      signingMethod: SigningMethod.MANUAL,
      property: { id: property._id, address: property.address },
      tenantId: leaseTenantId,
      createdBy: leaseTenantId,
      fees: { rentAmount: 150000, currency: 'USD', securityDeposit: 0, rentDueDay: 1, acceptedPaymentMethod: 'e-transfer' as const },
      signedDate: new Date(),
      signatures: [{ userId: leaseTenantId, signedAt: new Date(), role: 'tenant' as const, signatureMethod: 'manual' as const }],
      leaseDocuments: [{ documentType: 'lease_agreement' as const, url: 'https://example.com/doc.pdf', uploadedAt: new Date(), uploadedBy: leaseTenantId, filename: 'lease.pdf', key: 'leases/lease.pdf' }],
      duration: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });

    // Attempt to change country from US → NG (USD → NGN)
    await expect(
      propertyService.updateClientProperty(
        {
          cuid: client.cuid,
          pid: property.pid,
          currentuser: makeMockCtx(client.cuid, client.accountAdmin.toString()).currentuser as any,
        },
        {
          address: { country: 'NG', street: '1 Victoria Island', city: 'Lagos', state: 'Lagos' },
        } as any
      )
    ).rejects.toThrow(BadRequestError);

    await expect(
      propertyService.updateClientProperty(
        {
          cuid: client.cuid,
          pid: property.pid,
          currentuser: makeMockCtx(client.cuid, client.accountAdmin.toString()).currentuser as any,
        },
        {
          address: { country: 'NG', street: '1 Victoria Island', city: 'Lagos', state: 'Lagos' },
        } as any
      )
    ).rejects.toThrow('Cannot change property currency while active leases exist.');
  });

  it('allows country update when no active leases exist', async () => {
    const client = await createTestClient();
    const property = await createTestProperty(client.cuid, client._id);
    await Property.findByIdAndUpdate(property._id, {
      'address.country': 'US',
      'fees.currency': 'USD',
    });

    // No leases — update should succeed
    await expect(
      propertyService.updateClientProperty(
        {
          cuid: client.cuid,
          pid: property.pid,
          currentuser: makeMockCtx(client.cuid, client.accountAdmin.toString()).currentuser as any,
        },
        {
          address: { country: 'NG', street: '1 Victoria Island', city: 'Lagos', state: 'Lagos' },
        } as any
      )
    ).resolves.toMatchObject({ success: true });
  });
});
