import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import { LeaseDAO } from '@dao/leaseDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { GuestPassDAO } from '@dao/guestpassDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { ROLES } from '@shared/constants/roles.constants';
import { EventTypes } from '@interfaces/events.interface';
import { PropertyUnit, Property, Lease } from '@models/index';
import GuestPassModel from '@models/guestPass/guestpass.model';
import { GuestPassStatus } from '@interfaces/guestPass.interface';
import { GuestPassService } from '@services/guestpass/guestpass.service';
import { EventEmitterService } from '@services/eventEmitter/eventsEmitter.service';

import { mockRequestContext } from '../../helpers/mockRequestContext';
import { disconnectTestDatabase, setupTestDatabase } from '../../setup/testDatabase';
import {
  createTestPropertyUnit,
  setupAllExternalMocks,
  createTestProperty,
  clearTestDatabase,
  createTestClient,
  createTestUser,
} from '../../helpers';

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------
const setupService = () => {
  const propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
  const propertyDAO = new PropertyDAO({ propertyModel: Property, propertyUnitDAO });
  const leaseDAO = new LeaseDAO({ leaseModel: Lease });
  const guestPassDAO = new GuestPassDAO({ GuestPassModel });
  const eventsRegistry = {
    trackEvent: jest.fn().mockResolvedValue(undefined),
    getEventLog: jest.fn().mockResolvedValue([]),
    registerEvent: jest.fn().mockResolvedValue(undefined),
  } as any;
  const emitterService = new EventEmitterService({ eventsRegistry });
  jest.spyOn(emitterService, 'emit');

  const service = new GuestPassService({
    leaseDAO,
    propertyDAO,
    guestPassDAO,
    propertyUnitDAO,
    emitterService,
  });

  return { service, emitterService };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const createActiveLease = async (
  cuid: string,
  tenantId: Types.ObjectId,
  propertyId: Types.ObjectId,
  propertyUnitId?: Types.ObjectId
) => {
  const lease = new Lease({
    luid: `lease-${faker.string.alphanumeric(12)}`,
    cuid,
    tenantId,
    property: {
      id: propertyId,
      ...(propertyUnitId ? { unitId: propertyUnitId } : {}),
      address: faker.location.streetAddress(),
    },
    status: 'active',
    approvalStatus: 'approved',
    type: 'fixed_term',
    duration: {
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 335 * 24 * 60 * 60 * 1000),
    },
    fees: {
      rentAmount: 150000,
      securityDeposit: 150000,
      rentDueDay: 1,
      currency: 'USD',
      acceptedPaymentMethod: 'bank_transfer',
    },
  });
  return lease.save({ validateBeforeSave: false });
};

const baseGuestPassInput = (pid: string, puid?: string) => ({
  propertyInfo: { pid, ...(puid ? { puid } : {}) },
  visitorName: faker.person.fullName(),
  visitorPhone: faker.phone.number(),
  visitorEmail: faker.internet.email(),
  hostName: faker.person.fullName(),
  sendViaEmail: true,
  sendViaSms: false,
  expiryMinutes: 30,
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await disconnectTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  setupAllExternalMocks();
});

// ===========================================================================
// Tests
// ===========================================================================
describe('GuestPassService', () => {
  // -------------------------------------------------------------------------
  // createGuestPass
  // -------------------------------------------------------------------------
  describe('createGuestPass', () => {
    it('should create a guest pass successfully as a manager', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.createGuestPass(ctx, baseGuestPassInput(property.pid));

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.vpuid).toBeDefined();
      expect(result.data.cuid).toBe(client.cuid);
      expect(result.data.propertyId.toString()).toBe(property._id.toString());
      expect(result.data.status).toBe(GuestPassStatus.ACTIVE);
    });

    it('should create a guest pass successfully as a tenant with active lease', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
      await createActiveLease(client.cuid, tenant._id, property._id);

      const { service } = setupService();
      const ctx = mockRequestContext(tenant, client.cuid) as any;

      const result = await service.createGuestPass(ctx, baseGuestPassInput(property.pid));

      expect(result.success).toBe(true);
      expect(result.data.createdBy.toString()).toBe(tenant._id.toString());
    });

    it('should reject tenant without an active lease', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });

      const { service } = setupService();
      const ctx = mockRequestContext(tenant, client.cuid) as any;

      await expect(
        service.createGuestPass(ctx, baseGuestPassInput(property.pid))
      ).rejects.toThrow();
    });

    it('should reject when property does not exist', async () => {
      const client = await createTestClient();
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await expect(
        service.createGuestPass(ctx, baseGuestPassInput('nonexistent-pid'))
      ).rejects.toThrow();
    });

    it('should reject when property unit does not exist', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await expect(
        service.createGuestPass(ctx, baseGuestPassInput(property.pid, 'nonexistent-puid'))
      ).rejects.toThrow();
    });

    it('should create guest pass with valid property unit', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const unit = await createTestPropertyUnit(client.cuid, property._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.createGuestPass(
        ctx,
        baseGuestPassInput(property.pid, unit.puid)
      );

      expect(result.success).toBe(true);
      expect(result.data.propertyUnitId?.toString()).toBe(unit._id.toString());
    });

    it('should generate a 6-digit code', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.createGuestPass(ctx, baseGuestPassInput(property.pid));

      expect(result.data.code).toMatch(/^\d{6}$/);
    });

    it('should emit GUEST_PASS_CREATED event', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service, emitterService } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await service.createGuestPass(ctx, baseGuestPassInput(property.pid));

      expect(emitterService.emit).toHaveBeenCalledWith(
        EventTypes.GUEST_PASS_CREATED,
        expect.objectContaining({
          cuid: client.cuid,
          createdBy: manager._id.toString(),
          propertyId: property._id.toString(),
        })
      );
    });

    it('should set validUntil based on expiryMinutes', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const before = dayjs();
      const result = await service.createGuestPass(ctx, {
        ...baseGuestPassInput(property.pid),
        expiryMinutes: 45,
      });
      const after = dayjs();

      const validUntil = dayjs(result.data.validUntil);
      // validUntil should be roughly 45 minutes from now (within 5 second tolerance)
      expect(validUntil.diff(before, 'minute')).toBeGreaterThanOrEqual(44);
      expect(validUntil.diff(after, 'minute')).toBeLessThanOrEqual(45);
      expect(result.data.expiryMinutes).toBe(45);
    });
  });

  // -------------------------------------------------------------------------
  // getMyPasses
  // -------------------------------------------------------------------------
  describe('getMyPasses', () => {
    it('should return all passes in cuid for manager', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });

      // Create passes from different users
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '111111',
        propertyId: property._id,
        visitorInfo: { name: 'Visitor A' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '222222',
        propertyId: property._id,
        visitorInfo: { name: 'Visitor B' },
        createdBy: tenant._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.getMyPasses(ctx, {});

      expect(result.success).toBe(true);
      expect(result.data.passes).toHaveLength(2);
    });

    it('should return only own passes for tenant', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
      const otherUser = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });

      await GuestPassModel.create({
        cuid: client.cuid,
        code: '111111',
        propertyId: property._id,
        visitorInfo: { name: 'Tenant Visitor' },
        createdBy: tenant._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '222222',
        propertyId: property._id,
        visitorInfo: { name: 'Other Visitor' },
        createdBy: otherUser._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(tenant, client.cuid) as any;

      const result = await service.getMyPasses(ctx, {});

      expect(result.success).toBe(true);
      expect(result.data.passes).toHaveLength(1);
      expect(result.data.passes[0].visitorInfo.name).toBe('Tenant Visitor');
    });

    it('should filter by status', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      await GuestPassModel.create({
        cuid: client.cuid,
        code: '111111',
        propertyId: property._id,
        visitorInfo: { name: 'Active Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '222222',
        propertyId: property._id,
        visitorInfo: { name: 'Revoked Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.REVOKED,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.getMyPasses(ctx, { status: GuestPassStatus.ACTIVE });

      expect(result.data.passes).toHaveLength(1);
      expect(result.data.passes[0].status).toBe(GuestPassStatus.ACTIVE);
    });

    it('should filter by propertyId', async () => {
      const client = await createTestClient();
      const property1 = await createTestProperty(client.cuid, client._id);
      const property2 = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      await GuestPassModel.create({
        cuid: client.cuid,
        code: '111111',
        propertyId: property1._id,
        visitorInfo: { name: 'Prop1 Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '222222',
        propertyId: property2._id,
        visitorInfo: { name: 'Prop2 Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.getMyPasses(ctx, {
        propertyId: property1._id.toString(),
      });

      expect(result.data.passes).toHaveLength(1);
      // propertyId is populated, so compare the nested _id
      const passPropertyId =
        typeof result.data.passes[0].propertyId === 'object' &&
        '_id' in (result.data.passes[0].propertyId as any)
          ? (result.data.passes[0].propertyId as any)._id.toString()
          : result.data.passes[0].propertyId.toString();
      expect(passPropertyId).toBe(property1._id.toString());
    });

    it('should return pagination data', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      // Create 3 passes
      for (let i = 0; i < 3; i++) {
        await GuestPassModel.create({
          cuid: client.cuid,
          code: `${100000 + i}`,
          propertyId: property._id,
          visitorInfo: { name: `Visitor ${i}` },
          createdBy: manager._id,
          validUntil: dayjs().add(30, 'minute').toDate(),
          expiryMinutes: 30,
          status: GuestPassStatus.ACTIVE,
          isAcknowledged: false,
        });
      }

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.getMyPasses(ctx, { page: 1, limit: 2 });

      expect(result.data.passes).toHaveLength(2);
      expect(result.data.pagination).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // revokePass
  // -------------------------------------------------------------------------
  describe('revokePass', () => {
    it('should revoke an active pass successfully', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '123456',
        propertyId: property._id,
        visitorInfo: { name: 'Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.revokePass(ctx, pass.vpuid);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(GuestPassStatus.REVOKED);

      // Verify DB state
      const dbPass = await GuestPassModel.findById(pass._id);
      expect(dbPass!.status).toBe(GuestPassStatus.REVOKED);
      expect(dbPass!.revokedAt).toBeDefined();
    });

    it('should allow tenant to revoke their own pass', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });

      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '123456',
        propertyId: property._id,
        visitorInfo: { name: 'Visitor' },
        createdBy: tenant._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(tenant, client.cuid) as any;

      const result = await service.revokePass(ctx, pass.vpuid);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(GuestPassStatus.REVOKED);
    });

    it('should reject tenant revoking another user pass', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
      const otherUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '123456',
        propertyId: property._id,
        visitorInfo: { name: 'Visitor' },
        createdBy: otherUser._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(tenant, client.cuid) as any;

      await expect(service.revokePass(ctx, pass.vpuid)).rejects.toThrow();
    });

    it('should reject revoking a used pass', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '123456',
        propertyId: property._id,
        visitorInfo: { name: 'Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.USED,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await expect(service.revokePass(ctx, pass.vpuid)).rejects.toThrow(
        /Cannot revoke a pass that is used/
      );
    });

    it('should reject revoking an already revoked pass', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '123456',
        propertyId: property._id,
        visitorInfo: { name: 'Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.REVOKED,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await expect(service.revokePass(ctx, pass.vpuid)).rejects.toThrow(
        /Cannot revoke a pass that is revoked/
      );
    });

    it('should reject revoking a time-expired pass', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      // Create a pass with validUntil in the past but status still ACTIVE
      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '123456',
        propertyId: property._id,
        visitorInfo: { name: 'Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().subtract(10, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await expect(service.revokePass(ctx, pass.vpuid)).rejects.toThrow(
        /Cannot revoke a pass that is expired/
      );
    });

    it('should reject when pass does not exist', async () => {
      const client = await createTestClient();
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await expect(service.revokePass(ctx, 'nonexistent-vpuid')).rejects.toThrow();
    });

    it('should emit GUEST_PASS_REVOKED event', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '123456',
        propertyId: property._id,
        visitorInfo: { name: 'Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service, emitterService } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await service.revokePass(ctx, pass.vpuid);

      expect(emitterService.emit).toHaveBeenCalledWith(
        EventTypes.GUEST_PASS_REVOKED,
        expect.objectContaining({
          cuid: client.cuid,
          vpuid: pass.vpuid,
          revokedBy: manager._id.toString(),
        })
      );
    });

    it('should revoke a pending pass', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '123456',
        propertyId: property._id,
        visitorInfo: { name: 'Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.PENDING,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.revokePass(ctx, pass.vpuid);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(GuestPassStatus.REVOKED);
    });
  });

  // -------------------------------------------------------------------------
  // getStats
  // -------------------------------------------------------------------------
  describe('getStats', () => {
    it('should return stats for all passes as manager', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      // Create passes with various statuses
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '111111',
        propertyId: property._id,
        visitorInfo: { name: 'Active Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '222222',
        propertyId: property._id,
        visitorInfo: { name: 'Used Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.USED,
        isAcknowledged: false,
      });
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '333333',
        propertyId: property._id,
        visitorInfo: { name: 'Revoked Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.REVOKED,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.getStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(3);
      expect(result.data.active).toBe(1);
      expect(result.data.used).toBe(1);
      expect(result.data.revoked).toBe(1);
    });

    it('should scope stats to tenant own passes', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
      const otherUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      await GuestPassModel.create({
        cuid: client.cuid,
        code: '111111',
        propertyId: property._id,
        visitorInfo: { name: 'Tenant Visitor' },
        createdBy: tenant._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '222222',
        propertyId: property._id,
        visitorInfo: { name: 'Other Visitor' },
        createdBy: otherUser._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(tenant, client.cuid) as any;

      const result = await service.getStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(1);
      expect(result.data.active).toBe(1);
    });

    it('should scope stats to assigned properties for staff', async () => {
      const client = await createTestClient();
      const property1 = await createTestProperty(client.cuid, client._id);
      const property2 = await createTestProperty(client.cuid, client._id);
      const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      // Assign staff to property1 only
      await Property.updateOne({ _id: property1._id }, { $set: { assignedStaff: [staff._id] } });

      await GuestPassModel.create({
        cuid: client.cuid,
        code: '111111',
        propertyId: property1._id,
        visitorInfo: { name: 'Prop1 Visitor' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '222222',
        propertyId: property2._id,
        visitorInfo: { name: 'Prop2 Visitor' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(staff, client.cuid) as any;

      const result = await service.getStats(ctx);

      expect(result.success).toBe(true);
      // Staff should only see stats for property1 (their assigned property)
      expect(result.data.total).toBe(1);
      expect(result.data.active).toBe(1);
    });

    it('should filter by pid when provided', async () => {
      const client = await createTestClient();
      const property1 = await createTestProperty(client.cuid, client._id);
      const property2 = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      await GuestPassModel.create({
        cuid: client.cuid,
        code: '111111',
        propertyId: property1._id,
        visitorInfo: { name: 'Prop1 Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '222222',
        propertyId: property2._id,
        visitorInfo: { name: 'Prop2 Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.getStats(ctx, property1.pid);

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(1);
    });

    it('should reject when pid does not exist', async () => {
      const client = await createTestClient();
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await expect(service.getStats(ctx, 'nonexistent-pid')).rejects.toThrow();
    });
  });
});
