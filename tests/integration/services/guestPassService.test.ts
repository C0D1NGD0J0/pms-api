import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import { LeaseDAO } from '@dao/leaseDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { GuestPassDAO } from '@dao/guestpassDAO';
import { ForbiddenError } from '@shared/customErrors';
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
  createTestProfile,
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
  const guestPassDAO = new GuestPassDAO({ guestPassModel: GuestPassModel });
  const eventsRegistry = {
    trackEvent: jest.fn().mockResolvedValue(undefined),
    getEventLog: jest.fn().mockResolvedValue([]),
    registerEvent: jest.fn().mockResolvedValue(undefined),
    registerEvents: jest.fn().mockResolvedValue(undefined),
  } as any;
  const emitterService = new EventEmitterService({ eventsRegistry });
  jest.spyOn(emitterService, 'emit');

  const smsQueue = { addToSmsQueue: jest.fn() } as any;
  const emailQueue = { addToEmailQueue: jest.fn() } as any;

  const service = new GuestPassService({
    leaseDAO,
    propertyDAO,
    guestPassDAO,
    propertyUnitDAO,
    emitterService,
    smsQueue,
    emailQueue,
  });

  return { service, emitterService, smsQueue, emailQueue };
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
  propertyId: pid,
  ...(puid ? { unitId: puid } : {}),
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

    it('should resolve property and unit when the UI falls back to Mongo _ids', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const unit = await createTestPropertyUnit(client.cuid, property._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.createGuestPass(
        ctx,
        baseGuestPassInput(property._id.toString(), unit._id.toString())
      );

      expect(result.data.propertyId.toString()).toBe(property._id.toString());
      expect(result.data.propertyUnitId?.toString()).toBe(unit._id.toString());
    });

    it('should not resolve a property from another client by _id', async () => {
      const client = await createTestClient();
      const otherClient = await createTestClient();
      const otherProperty = await createTestProperty(otherClient.cuid, otherClient._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await expect(
        service.createGuestPass(ctx, baseGuestPassInput(otherProperty._id.toString()))
      ).rejects.toThrow();
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

    it('should persist purpose and hostNotes and return them on create', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.createGuestPass(ctx, {
        ...baseGuestPassInput(property.pid),
        purpose: 'Delivery',
        hostNotes: 'Large furniture — use the loading dock',
      });

      expect(result.data.purpose).toBe('Delivery');
      expect(result.data.hostNotes).toBe('Large furniture — use the loading dock');

      const dbPass = await GuestPassModel.findById(result.data._id).lean();
      expect(dbPass?.purpose).toBe('Delivery');
      expect(dbPass?.hostNotes).toBe('Large furniture — use the loading dock');
      expect(dbPass?.entryNotes).toBeUndefined();
    });

    it('should let a tenant create a pass for their own leased unit', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const unit = await createTestPropertyUnit(client.cuid, property._id);
      const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
      await createActiveLease(client.cuid, tenant._id, property._id, unit._id);

      const { service } = setupService();
      const ctx = mockRequestContext(tenant, client.cuid) as any;

      const result = await service.createGuestPass(
        ctx,
        baseGuestPassInput(property.pid, unit.puid)
      );

      expect(result.data.propertyUnitId?.toString()).toBe(unit._id.toString());
    });

    it("should forbid a tenant from creating a pass for another tenant's unit", async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const ownUnit = await createTestPropertyUnit(client.cuid, property._id, {
        unitNumber: '101',
      });
      const otherUnit = await createTestPropertyUnit(client.cuid, property._id, {
        unitNumber: '102',
      });
      const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
      await createActiveLease(client.cuid, tenant._id, property._id, ownUnit._id);

      const { service } = setupService();
      const ctx = mockRequestContext(tenant, client.cuid) as any;

      await expect(
        service.createGuestPass(ctx, baseGuestPassInput(property.pid, otherUnit.puid))
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await GuestPassModel.countDocuments({ cuid: client.cuid })).toBe(0);
    });

    it('should forbid a tenant from creating a pass for a property they do not lease', async () => {
      const client = await createTestClient();
      const leasedProperty = await createTestProperty(client.cuid, client._id);
      const otherProperty = await createTestProperty(client.cuid, client._id);
      const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
      await createActiveLease(client.cuid, tenant._id, leasedProperty._id);

      const { service } = setupService();
      const ctx = mockRequestContext(tenant, client.cuid) as any;

      await expect(
        service.createGuestPass(ctx, baseGuestPassInput(otherProperty.pid))
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('should show hostNotes to the host and to security, and keep them when the guard adds entry notes', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
      const securityStaff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      await createActiveLease(client.cuid, tenant._id, property._id);
      await Property.updateOne(
        { _id: property._id },
        { $set: { assignedStaff: [securityStaff._id] } }
      );

      const { service } = setupService();
      const tenantCtx = mockRequestContext(tenant, client.cuid) as any;
      const created = await service.createGuestPass(tenantCtx, {
        ...baseGuestPassInput(property.pid),
        purpose: 'Personal visit',
        hostNotes: 'Buzz unit 4B',
      });

      const own = await service.getMyPasses(tenantCtx, {});
      expect(own.data.passes[0]).toMatchObject({
        purpose: 'Personal visit',
        hostNotes: 'Buzz unit 4B',
      });

      const securityCtx = mockRequestContext(securityStaff, client.cuid) as any;
      const expected = await service.getExpectedVisitors(securityCtx, { timeWindow: 'all' });
      expect(expected.data.passes[0]).toMatchObject({
        purpose: 'Personal visit',
        hostNotes: 'Buzz unit 4B',
      });

      const validated = await service.validateCode(securityCtx, {
        code: created.data.code,
        propertyId: property.pid,
        entryNotes: 'Arrived with a delivery cart',
      });
      expect(validated.data.pass).toMatchObject({
        purpose: 'Personal visit',
        hostNotes: 'Buzz unit 4B',
        entryNotes: 'Arrived with a delivery cart',
      });
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

  // -------------------------------------------------------------------------
  // validateCode
  // -------------------------------------------------------------------------
  describe('validateCode', () => {
    it('should validate a code successfully and mark pass as USED', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '999888',
        propertyId: property._id,
        visitorInfo: { name: 'Valid Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.validateCode(ctx, {
        code: '999888',
        propertyId: property.pid,
      });

      expect(result.success).toBe(true);
      expect(result.data.valid).toBe(true);
      expect(result.data.pass).toBeDefined();

      // Verify DB state — pass should be USED
      const dbPass = await GuestPassModel.findById(pass._id);
      expect(dbPass!.status).toBe(GuestPassStatus.USED);
    });

    it('should return valid: false for non-existent code', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.validateCode(ctx, {
        code: '000000',
        propertyId: property.pid,
      });

      expect(result.success).toBe(true);
      expect(result.data.valid).toBe(false);
      expect(result.data.reason).toMatch(/not found/i);
    });

    it('should return valid: false for wrong property', async () => {
      const client = await createTestClient();
      const property1 = await createTestProperty(client.cuid, client._id);
      const property2 = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      await GuestPassModel.create({
        cuid: client.cuid,
        code: '555444',
        propertyId: property1._id,
        visitorInfo: { name: 'Wrong Prop Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.validateCode(ctx, {
        code: '555444',
        propertyId: property2.pid, // wrong property
      });

      expect(result.success).toBe(true);
      expect(result.data.valid).toBe(false);
      expect(result.data.reason).toMatch(/not valid for this property/i);
    });

    it('should return valid: false for expired pass', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      await GuestPassModel.create({
        cuid: client.cuid,
        code: '112233',
        propertyId: property._id,
        visitorInfo: { name: 'Expired Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().subtract(10, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.validateCode(ctx, {
        code: '112233',
        propertyId: property.pid,
      });

      // findByCode filters by validUntil > now, so expired pass won't be found
      expect(result.data.valid).toBe(false);
      expect(result.data.reason).toMatch(/not found|expired/i);
    });

    it('should emit GUEST_PASS_VALIDATED event on success', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      await GuestPassModel.create({
        cuid: client.cuid,
        code: '776655',
        propertyId: property._id,
        visitorInfo: { name: 'Event Visitor' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service, emitterService } = setupService();
      const ctx = mockRequestContext(staff, client.cuid) as any;

      await service.validateCode(ctx, {
        code: '776655',
        propertyId: property.pid,
      });

      expect(emitterService.emit).toHaveBeenCalledWith(
        EventTypes.GUEST_PASS_VALIDATED,
        expect.objectContaining({
          cuid: client.cuid,
          validatedBy: staff._id.toString(),
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // getExpectedVisitors
  // -------------------------------------------------------------------------
  describe('getExpectedVisitors', () => {
    it('should return active passes for manager', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      await GuestPassModel.create({
        cuid: client.cuid,
        code: '111222',
        propertyId: property._id,
        visitorInfo: { name: 'Expected Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(60, 'minute').toDate(),
        expiryMinutes: 60,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      // Expired pass — should not appear
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '333444',
        propertyId: property._id,
        visitorInfo: { name: 'Expired Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().subtract(5, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.getExpectedVisitors(ctx, {});

      expect(result.success).toBe(true);
      expect(result.data.passes).toHaveLength(1);
      expect(result.data.passes[0].visitorInfo.name).toBe('Expected Visitor');
    });

    it('should scope staff to assigned properties only', async () => {
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
        validUntil: dayjs().add(60, 'minute').toDate(),
        expiryMinutes: 60,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '222222',
        propertyId: property2._id,
        visitorInfo: { name: 'Prop2 Visitor' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(60, 'minute').toDate(),
        expiryMinutes: 60,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(staff, client.cuid) as any;

      const result = await service.getExpectedVisitors(ctx, {});

      expect(result.success).toBe(true);
      expect(result.data.passes).toHaveLength(1);
      expect(result.data.passes[0].visitorInfo.name).toBe('Prop1 Visitor');
    });

    it('should filter by timeWindow today', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      // Pass valid within today — halfway to midnight, so the test holds late in the day too
      const now = dayjs();
      const laterToday = now.add(now.endOf('day').diff(now) / 2, 'millisecond');
      await GuestPassModel.create({
        cuid: client.cuid,
        code: '444555',
        propertyId: property._id,
        visitorInfo: { name: 'Today Visitor' },
        createdBy: manager._id,
        validUntil: laterToday.toDate(),
        expiryMinutes: 60,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      // Pass valid until tomorrow — should be excluded by 'today' filter
      // Use save with validateBeforeSave: false to bypass expiryMinutes max
      const tomorrowPass = new GuestPassModel({
        cuid: client.cuid,
        code: '666777',
        propertyId: property._id,
        visitorInfo: { name: 'Tomorrow Visitor' },
        createdBy: manager._id,
        validUntil: dayjs().add(2, 'day').toDate(),
        expiryMinutes: 60,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      await tomorrowPass.save({ validateBeforeSave: true });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.getExpectedVisitors(ctx, { timeWindow: 'today' });

      expect(result.success).toBe(true);
      // Only the pass expiring within today should be returned
      expect(result.data.passes).toHaveLength(1);
      expect(result.data.passes[0].visitorInfo.name).toBe('Today Visitor');
    });

    it('should return empty when no expected visitors', async () => {
      const client = await createTestClient();
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const result = await service.getExpectedVisitors(ctx, {});

      expect(result.success).toBe(true);
      expect(result.data.passes).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // acknowledgePass
  // -------------------------------------------------------------------------
  describe('acknowledgePass', () => {
    it('should acknowledge a pass successfully', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '887766',
        propertyId: property._id,
        visitorInfo: { name: 'Acknowledge Visitor' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(staff, client.cuid) as any;

      const result = await service.acknowledgePass(ctx, pass.vpuid);

      expect(result.success).toBe(true);
      expect(result.data.isAcknowledged).toBe(true);

      // Verify DB state
      const dbPass = await GuestPassModel.findById(pass._id);
      expect(dbPass!.isAcknowledged).toBe(true);
      expect(dbPass!.acknowledgedAt).toBeDefined();
    });

    it('should emit GUEST_PASS_ACKNOWLEDGED event', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '998877',
        propertyId: property._id,
        visitorInfo: { name: 'Event Ack Visitor' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service, emitterService } = setupService();
      const ctx = mockRequestContext(staff, client.cuid) as any;

      await service.acknowledgePass(ctx, pass.vpuid);

      expect(emitterService.emit).toHaveBeenCalledWith(
        EventTypes.GUEST_PASS_ACKNOWLEDGED,
        expect.objectContaining({
          cuid: client.cuid,
          vpuid: pass.vpuid,
          acknowledgedBy: staff._id.toString(),
        })
      );
    });

    it('should throw for already acknowledged pass', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      const pass = await GuestPassModel.create({
        cuid: client.cuid,
        code: '554433',
        propertyId: property._id,
        visitorInfo: { name: 'Already Acked Visitor' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedBy: new Types.ObjectId(),
      });

      const { service } = setupService();
      const ctx = mockRequestContext(staff, client.cuid) as any;

      await expect(service.acknowledgePass(ctx, pass.vpuid)).rejects.toThrow(
        /not found.*acknowledged|already acknowledged|not active/i
      );
    });
  });

  // -------------------------------------------------------------------------
  // bulkAcknowledgePasses
  // -------------------------------------------------------------------------
  describe('bulkAcknowledgePasses', () => {
    it('should bulk acknowledge multiple passes', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      const pass1 = await GuestPassModel.create({
        cuid: client.cuid,
        code: '101010',
        propertyId: property._id,
        visitorInfo: { name: 'Bulk Visitor 1' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      const pass2 = await GuestPassModel.create({
        cuid: client.cuid,
        code: '202020',
        propertyId: property._id,
        visitorInfo: { name: 'Bulk Visitor 2' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const { service } = setupService();
      const ctx = mockRequestContext(staff, client.cuid) as any;

      const result = await service.bulkAcknowledgePasses(ctx, [pass1.vpuid, pass2.vpuid]);

      expect(result.success).toBe(true);
      expect(result.data.acknowledged).toBe(2);

      // Verify DB state
      const dbPass1 = await GuestPassModel.findById(pass1._id);
      const dbPass2 = await GuestPassModel.findById(pass2._id);
      expect(dbPass1!.isAcknowledged).toBe(true);
      expect(dbPass2!.isAcknowledged).toBe(true);
    });

    it('should skip already acknowledged passes and return correct count', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      const pass1 = await GuestPassModel.create({
        cuid: client.cuid,
        code: '303030',
        propertyId: property._id,
        visitorInfo: { name: 'Not Acked' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });
      const pass2 = await GuestPassModel.create({
        cuid: client.cuid,
        code: '404040',
        propertyId: property._id,
        visitorInfo: { name: 'Already Acked' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedBy: new Types.ObjectId(),
      });

      const { service } = setupService();
      const ctx = mockRequestContext(staff, client.cuid) as any;

      const result = await service.bulkAcknowledgePasses(ctx, [pass1.vpuid, pass2.vpuid]);

      expect(result.success).toBe(true);
      expect(result.data.acknowledged).toBe(1); // only pass1 was not yet acknowledged
    });
  });

  // -------------------------------------------------------------------------
  // createGuestPass delivery (Phase 4)
  // -------------------------------------------------------------------------
  describe('createGuestPass delivery', () => {
    it('should enqueue SMS job when sendViaSms is true and visitorPhone provided', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service, smsQueue } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await service.createGuestPass(ctx, {
        ...baseGuestPassInput(property.pid),
        sendViaSms: true,
        sendViaEmail: false,
        visitorPhone: '+15551234567',
      });

      expect(smsQueue.addToSmsQueue).toHaveBeenCalledWith(
        'guest-pass-code',
        expect.objectContaining({
          to: '+15551234567',
          cuid: client.cuid,
        })
      );
    });

    it('should enqueue email job when sendViaEmail is true and visitorEmail provided', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service, emailQueue } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      const visitorEmail = 'visitor@example.com';
      await service.createGuestPass(ctx, {
        ...baseGuestPassInput(property.pid),
        sendViaEmail: true,
        sendViaSms: false,
        visitorEmail,
      });

      expect(emailQueue.addToEmailQueue).toHaveBeenCalledWith(
        'guest-pass-code',
        expect.objectContaining({
          to: visitorEmail,
          subject: 'Your Visitor Access Code',
        })
      );
    });

    it('should not enqueue SMS when sendViaSms is false', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const { service, smsQueue } = setupService();
      const ctx = mockRequestContext(manager, client.cuid) as any;

      await service.createGuestPass(ctx, {
        ...baseGuestPassInput(property.pid),
        sendViaSms: false,
        sendViaEmail: true,
      });

      expect(smsQueue.addToSmsQueue).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Display fields — what pms-ui reads from list / expected / validate responses
  // -------------------------------------------------------------------------
  describe('response display fields', () => {
    // Mirrors res.json(): virtuals such as createdBy.fullname only exist after serialisation
    const toApiJson = (value: unknown) => JSON.parse(JSON.stringify(value));

    const seedHostedPass = async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const unit = await createTestPropertyUnit(client.cuid, property._id);
      const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const host = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
      const hostProfile = await createTestProfile(host._id, client._id);

      await GuestPassModel.create({
        cuid: client.cuid,
        code: '424242',
        propertyId: property._id,
        propertyUnitId: unit._id,
        visitorInfo: { name: 'Ada Visitor', phone: '+15550001111', email: 'ada@example.com' },
        purpose: 'Delivery',
        hostNotes: 'Leave at the front desk',
        createdBy: host._id,
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
      });

      const hostFullName = `${hostProfile.personalInfo.firstName} ${hostProfile.personalInfo.lastName}`;
      return { client, property, unit, manager, host, hostFullName };
    };

    const expectDisplayFields = (
      pass: any,
      expected: { property: any; unit: any; host: any; hostFullName: string }
    ) => {
      expect(pass.visitorInfo).toEqual({
        name: 'Ada Visitor',
        phone: '+15550001111',
        email: 'ada@example.com',
      });
      expect(pass.purpose).toBe('Delivery');
      expect(pass.hostNotes).toBe('Leave at the front desk');
      expect(pass.propertyId).toMatchObject({
        _id: expected.property._id.toString(),
        pid: expected.property.pid,
        name: expected.property.name,
        address: { fullAddress: expected.property.address.fullAddress },
      });
      expect(pass.propertyUnitId).toMatchObject({
        _id: expected.unit._id.toString(),
        puid: expected.unit.puid,
        unitNumber: expected.unit.unitNumber,
      });
      expect(pass.createdBy).toMatchObject({
        _id: expected.host._id.toString(),
        uid: expected.host.uid,
        fullname: expected.hostFullName,
      });
      // Never leak credentials through the host populate
      expect(pass.createdBy.password).toBeUndefined();
    };

    it('getMyPasses returns visitor, host, property and unit display fields', async () => {
      const seeded = await seedHostedPass();
      const { service } = setupService();
      const ctx = mockRequestContext(seeded.manager, seeded.client.cuid) as any;

      const result = toApiJson(await service.getMyPasses(ctx, {}));

      expect(result.data.passes).toHaveLength(1);
      expectDisplayFields(result.data.passes[0], seeded);
    });

    it('getExpectedVisitors returns visitor, host, property and unit display fields', async () => {
      const seeded = await seedHostedPass();
      const { service } = setupService();
      const ctx = mockRequestContext(seeded.manager, seeded.client.cuid) as any;

      const result = toApiJson(await service.getExpectedVisitors(ctx, {}));

      expect(result.data.passes).toHaveLength(1);
      expectDisplayFields(result.data.passes[0], seeded);
    });

    it('validateCode returns the populated pass with usedAt set', async () => {
      const seeded = await seedHostedPass();
      const { service } = setupService();
      const ctx = mockRequestContext(seeded.manager, seeded.client.cuid) as any;

      const result = toApiJson(
        await service.validateCode(ctx, { code: '424242', propertyId: seeded.property.pid })
      );

      expect(result.data.valid).toBe(true);
      expectDisplayFields(result.data.pass, seeded);
      expect(result.data.pass.status).toBe(GuestPassStatus.USED);
      expect(result.data.pass.usedAt).toBeDefined();
    });

    it('a tenant host only receives their own passes with display fields', async () => {
      const seeded = await seedHostedPass();
      const otherTenant = await createTestUser(seeded.client.cuid, { roles: [ROLES.TENANT] });
      const { service } = setupService();

      const hostResult = toApiJson(
        await service.getMyPasses(mockRequestContext(seeded.host, seeded.client.cuid) as any, {})
      );
      const otherResult = await service.getMyPasses(
        mockRequestContext(otherTenant, seeded.client.cuid) as any,
        {}
      );

      expectDisplayFields(hostResult.data.passes[0], seeded);
      expect(otherResult.data.passes).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // UI/API contract fixes — public ids, detail endpoint, host info, revoke reason
  // -------------------------------------------------------------------------
  describe('UI/API contract', () => {
    const seedPass = (
      cuid: string,
      propertyId: Types.ObjectId,
      overrides: Record<string, any> = {}
    ) =>
      GuestPassModel.create({
        cuid,
        code: faker.string.numeric(6),
        propertyId,
        visitorInfo: { name: 'Contract Visitor' },
        createdBy: new Types.ObjectId(),
        validUntil: dayjs().add(30, 'minute').toDate(),
        expiryMinutes: 30,
        status: GuestPassStatus.ACTIVE,
        isAcknowledged: false,
        ...overrides,
      });

    describe('createGuestPass host info', () => {
      it("stores hostInfo when a manager issues a pass on a resident's behalf", async () => {
        const client = await createTestClient();
        const property = await createTestProperty(client.cuid, client._id);
        const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
        const { service } = setupService();

        const result = await service.createGuestPass(
          mockRequestContext(manager, client.cuid) as any,
          {
            ...baseGuestPassInput(property.pid),
            hostName: 'Rita Resident',
            hostPhone: '+1 555 010 0200',
          }
        );

        const dbPass = await GuestPassModel.findById(result.data._id).lean();
        expect(dbPass!.hostInfo).toEqual({ name: 'Rita Resident', phone: '+1 555 010 0200' });
      });

      it('ignores host info sent by a tenant (the tenant is the host)', async () => {
        const client = await createTestClient();
        const property = await createTestProperty(client.cuid, client._id);
        const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
        await createActiveLease(client.cuid, tenant._id, property._id);
        const { service } = setupService();

        const result = await service.createGuestPass(
          mockRequestContext(tenant, client.cuid) as any,
          {
            ...baseGuestPassInput(property.pid),
            hostName: 'Someone Else',
            hostPhone: '+15550000000',
          }
        );

        const dbPass = await GuestPassModel.findById(result.data._id).lean();
        expect(dbPass!.hostInfo).toBeUndefined();
      });
    });

    describe('getPass', () => {
      it('returns a populated pass by vpuid for a manager', async () => {
        const client = await createTestClient();
        const property = await createTestProperty(client.cuid, client._id);
        const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
        const pass = await seedPass(client.cuid, property._id, {
          createdBy: manager._id,
          hostInfo: { name: 'Rita Resident', phone: '+15550100200' },
        });
        const { service } = setupService();

        const result = JSON.parse(
          JSON.stringify(
            await service.getPass(mockRequestContext(manager, client.cuid) as any, pass.vpuid)
          )
        );

        expect(result.data.vpuid).toBe(pass.vpuid);
        expect(result.data.propertyId.name).toBe(property.name);
        expect(result.data.hostInfo).toEqual({ name: 'Rita Resident', phone: '+15550100200' });
      });

      it("lets a tenant read their own pass but not another tenant's", async () => {
        const client = await createTestClient();
        const property = await createTestProperty(client.cuid, client._id);
        const tenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
        const other = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
        const own = await seedPass(client.cuid, property._id, { createdBy: tenant._id });
        const theirs = await seedPass(client.cuid, property._id, { createdBy: other._id });
        const { service } = setupService();
        const ctx = mockRequestContext(tenant, client.cuid) as any;

        expect((await service.getPass(ctx, own.vpuid)).data.vpuid).toBe(own.vpuid);
        await expect(service.getPass(ctx, theirs.vpuid)).rejects.toThrow(/not found/i);
      });

      it('limits staff to passes for their assigned properties', async () => {
        const client = await createTestClient();
        const assigned = await createTestProperty(client.cuid, client._id);
        const unassigned = await createTestProperty(client.cuid, client._id);
        const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
        await Property.updateOne({ _id: assigned._id }, { $set: { assignedStaff: [staff._id] } });
        const visible = await seedPass(client.cuid, assigned._id);
        const hidden = await seedPass(client.cuid, unassigned._id);
        const { service } = setupService();
        const ctx = mockRequestContext(staff, client.cuid) as any;

        expect((await service.getPass(ctx, visible.vpuid)).data.vpuid).toBe(visible.vpuid);
        await expect(service.getPass(ctx, hidden.vpuid)).rejects.toThrow(/not found/i);
      });

      it('does not return a pass from another client', async () => {
        const client = await createTestClient();
        const otherClient = await createTestClient();
        const property = await createTestProperty(otherClient.cuid, otherClient._id);
        const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
        const foreign = await seedPass(otherClient.cuid, property._id);
        const { service } = setupService();

        await expect(
          service.getPass(mockRequestContext(manager, client.cuid) as any, foreign.vpuid)
        ).rejects.toThrow(/not found/i);
      });
    });

    describe('acknowledge by vpuid', () => {
      it('acknowledges single and bulk passes by vpuid, scoped to the cuid', async () => {
        const client = await createTestClient();
        const otherClient = await createTestClient();
        const property = await createTestProperty(client.cuid, client._id);
        const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
        const single = await seedPass(client.cuid, property._id);
        const bulk = await seedPass(client.cuid, property._id);
        const foreign = await seedPass(otherClient.cuid, property._id);
        const { service } = setupService();
        const ctx = mockRequestContext(staff, client.cuid) as any;

        expect((await service.acknowledgePass(ctx, single.vpuid)).data.isAcknowledged).toBe(true);
        const bulkResult = await service.bulkAcknowledgePasses(ctx, [bulk.vpuid, foreign.vpuid]);

        expect(bulkResult.data.acknowledged).toBe(1);
        expect((await GuestPassModel.findById(foreign._id))!.isAcknowledged).toBe(false);
        await expect(service.acknowledgePass(ctx, foreign.vpuid)).rejects.toThrow();
      });
    });

    describe('property ids sent by the UI (pid or _id)', () => {
      it('validateCode accepts the property _id as well as the pid', async () => {
        const client = await createTestClient();
        const property = await createTestProperty(client.cuid, client._id);
        const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
        await seedPass(client.cuid, property._id, { code: '515151' });
        const { service } = setupService();

        const result = await service.validateCode(mockRequestContext(manager, client.cuid) as any, {
          code: '515151',
          propertyId: property._id.toString(),
        });

        expect(result.data.valid).toBe(true);
      });

      it('getStats and getMyPasses filter by pid or _id', async () => {
        const client = await createTestClient();
        const property = await createTestProperty(client.cuid, client._id);
        const otherProperty = await createTestProperty(client.cuid, client._id);
        const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
        await seedPass(client.cuid, property._id);
        await seedPass(client.cuid, otherProperty._id);
        const { service } = setupService();
        const ctx = mockRequestContext(manager, client.cuid) as any;

        expect((await service.getStats(ctx, property._id.toString())).data.total).toBe(1);
        expect((await service.getStats(ctx, property.pid)).data.total).toBe(1);
        expect(
          (await service.getMyPasses(ctx, { propertyId: property.pid })).data.passes
        ).toHaveLength(1);
        expect(
          (await service.getExpectedVisitors(ctx, { propertyId: property.pid })).data.passes
        ).toHaveLength(1);
        await expect(service.getMyPasses(ctx, { propertyId: 'unknown-pid' })).rejects.toThrow(
          /not found/i
        );
      });
    });

    describe('revokePass reason', () => {
      it('stores the revoke reason next to revokedAt', async () => {
        const client = await createTestClient();
        const property = await createTestProperty(client.cuid, client._id);
        const manager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
        const pass = await seedPass(client.cuid, property._id);
        const { service } = setupService();

        const result = await service.revokePass(
          mockRequestContext(manager, client.cuid) as any,
          pass.vpuid,
          'Visitor cancelled'
        );

        expect(result.data.revokedReason).toBe('Visitor cancelled');
        expect(result.data.revokedAt).toBeDefined();
      });
    });
  });
});
