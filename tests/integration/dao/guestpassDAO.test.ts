import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { Property, User } from '@models/index';
import GuestPassModel from '@models/guestPass/guestpass.model';
import { GuestPassStatus } from '@interfaces/guestPass.interface';
import { GUEST_PASS_DISPLAY_POPULATE, GuestPassDAO } from '@dao/guestpassDAO';
import { createTestPropertyUnit, createTestProfile, clearTestDatabase } from '@tests/helpers';

describe('GuestPassDAO Integration Tests', () => {
  let dao: GuestPassDAO;
  let testCuid: string;
  let otherCuid: string;
  let userId: Types.ObjectId;
  let validatorId: Types.ObjectId;
  let propertyId: Types.ObjectId;
  let propertyId2: Types.ObjectId;

  beforeAll(async () => {
    dao = new GuestPassDAO({ guestPassModel: GuestPassModel });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    testCuid = 'TEST_CLIENT';
    otherCuid = 'OTHER_CLIENT';
    userId = new Types.ObjectId();
    validatorId = new Types.ObjectId();
    propertyId = new Types.ObjectId();
    propertyId2 = new Types.ObjectId();

    await User.create({
      _id: userId,
      uid: 'user-uid-1',
      email: 'user1@example.com',
      password: 'hashed',
      activecuid: testCuid,
      cuids: [],
    });
    await User.create({
      _id: validatorId,
      uid: 'user-uid-2',
      email: 'validator@example.com',
      password: 'hashed',
      activecuid: testCuid,
      cuids: [],
    });

    await Property.create({
      _id: propertyId,
      pid: 'prop-uid-1',
      cuid: testCuid,
      name: 'Test Property',
      managedBy: userId,
      createdBy: userId,
      propertyType: 'apartment',
      operationalStatus: 'available',
      occupancyStatus: 'vacant',
      maxAllowedUnits: 10,
      address: {
        fullAddress: '123 Main St, Toronto, ON M5V1A1',
        street: 'Main St',
        streetNumber: '123',
        city: 'Toronto',
        state: 'ON',
        postCode: 'M5V1A1',
        country: 'Canada',
      },
      computedLocation: {
        type: 'Point',
        coordinates: [-79.3832, 43.6532],
      },
      description: { text: 'Test property' },
    });
    await Property.create({
      _id: propertyId2,
      pid: 'prop-uid-2',
      cuid: testCuid,
      name: 'Second Property',
      managedBy: userId,
      createdBy: userId,
      propertyType: 'apartment',
      operationalStatus: 'available',
      occupancyStatus: 'vacant',
      maxAllowedUnits: 10,
      address: {
        fullAddress: '456 Queen St, Vancouver, BC V6B1A1',
        street: 'Queen St',
        streetNumber: '456',
        city: 'Vancouver',
        state: 'BC',
        postCode: 'V6B1A1',
        country: 'Canada',
      },
      computedLocation: {
        type: 'Point',
        coordinates: [-123.1207, 49.2827],
      },
      description: { text: 'Second property' },
    });
  });

  async function createPass(overrides: Record<string, any> = {}) {
    const defaults = {
      cuid: testCuid,
      code: '123456',
      propertyId,
      visitorInfo: { name: 'Jane Doe' },
      createdBy: userId,
      validUntil: dayjs().add(1, 'hour').toDate(),
      expiryMinutes: 30,
      status: GuestPassStatus.ACTIVE,
      isAcknowledged: false,
    };
    return GuestPassModel.create({ ...defaults, ...overrides });
  }

  // ---------------------------------------------------------------------------
  // findByCode
  // ---------------------------------------------------------------------------
  describe('findByCode', () => {
    it('should find an active pass by code and cuid', async () => {
      const pass = await createPass({ code: 'AABB11' });
      const found = await dao.findByCode('AABB11', testCuid);

      expect(found).not.toBeNull();
      expect(found!._id.toString()).toBe(pass._id.toString());
    });

    it('should populate propertyId fields', async () => {
      await createPass({ code: 'PPOP11' });
      const found = await dao.findByCode('PPOP11', testCuid);

      expect(found).not.toBeNull();
      expect((found!.propertyId as any).name).toBe('Test Property');
    });

    it('should return null for an expired pass', async () => {
      await createPass({
        code: 'EXP001',
        validUntil: dayjs().subtract(1, 'hour').toDate(),
      });

      const found = await dao.findByCode('EXP001', testCuid);
      expect(found).toBeNull();
    });

    it('should return null for a non-ACTIVE status pass', async () => {
      await createPass({ code: 'USED01', status: GuestPassStatus.USED });

      const found = await dao.findByCode('USED01', testCuid);
      expect(found).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // markAsUsed
  // ---------------------------------------------------------------------------
  describe('markAsUsed', () => {
    it('should mark an active pass as USED and set validatedBy', async () => {
      const pass = await createPass();
      const result = await dao.markAsUsed(
        pass._id.toString(),
        testCuid,
        validatorId.toString(),
        'Visitor verified at gate'
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe(GuestPassStatus.USED);
      expect(result!.validatedBy!.toString()).toBe(validatorId.toString());
      expect(result!.entryNotes).toBe('Visitor verified at gate');
    });

    it('should stamp usedAt when the pass is validated', async () => {
      const before = new Date();
      const pass = await createPass();
      const result = await dao.markAsUsed(pass._id.toString(), testCuid, validatorId.toString());

      expect(result!.usedAt).toBeInstanceOf(Date);
      expect(result!.usedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });

    it('should return null when pass is already USED', async () => {
      const pass = await createPass({ status: GuestPassStatus.USED });
      const result = await dao.markAsUsed(pass._id.toString(), testCuid, validatorId.toString());
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // revokePass
  // ---------------------------------------------------------------------------
  describe('revokePass', () => {
    it('should revoke an ACTIVE pass', async () => {
      const pass = await createPass();
      const result = await dao.revokePass(pass._id.toString(), testCuid, userId.toString());

      expect(result).not.toBeNull();
      expect(result!.status).toBe(GuestPassStatus.REVOKED);
      expect(result!.revokedBy!.toString()).toBe(userId.toString());
      expect(result!.revokedAt).toBeDefined();
    });

    it('should revoke a PENDING pass', async () => {
      const pass = await createPass({ status: GuestPassStatus.PENDING });
      const result = await dao.revokePass(pass._id.toString(), testCuid, userId.toString());

      expect(result).not.toBeNull();
      expect(result!.status).toBe(GuestPassStatus.REVOKED);
    });

    it('should not revoke a USED or already REVOKED pass', async () => {
      const used = await createPass({ code: 'USED01', status: GuestPassStatus.USED });
      const revoked = await createPass({ code: 'REVK01', status: GuestPassStatus.REVOKED });

      expect(await dao.revokePass(used._id.toString(), testCuid, userId.toString())).toBeNull();
      expect(await dao.revokePass(revoked._id.toString(), testCuid, userId.toString())).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // expireOldPasses
  // ---------------------------------------------------------------------------
  describe('expireOldPasses', () => {
    it('should expire ACTIVE and PENDING passes with validUntil in the past', async () => {
      await createPass({
        code: 'OLD001',
        status: GuestPassStatus.ACTIVE,
        validUntil: dayjs().subtract(10, 'minute').toDate(),
      });
      await createPass({
        code: 'OLD002',
        status: GuestPassStatus.PENDING,
        validUntil: dayjs().subtract(5, 'minute').toDate(),
      });
      await createPass({ code: 'FUT001', validUntil: dayjs().add(1, 'hour').toDate() });

      const count = await dao.expireOldPasses();
      expect(count).toBe(2);
    });

    it('should not expire USED or REVOKED passes', async () => {
      await createPass({
        code: 'USED01',
        status: GuestPassStatus.USED,
        validUntil: dayjs().subtract(1, 'hour').toDate(),
      });
      await createPass({
        code: 'REVK01',
        status: GuestPassStatus.REVOKED,
        validUntil: dayjs().subtract(1, 'hour').toDate(),
      });

      const count = await dao.expireOldPasses();
      expect(count).toBe(0);
    });

    it('should filter by cuid when provided', async () => {
      await createPass({
        code: 'CID001',
        cuid: testCuid,
        validUntil: dayjs().subtract(5, 'minute').toDate(),
      });
      await createPass({
        code: 'CID002',
        cuid: otherCuid,
        validUntil: dayjs().subtract(5, 'minute').toDate(),
      });

      const count = await dao.expireOldPasses(testCuid);
      expect(count).toBe(1);

      const other = await GuestPassModel.findOne({ code: 'CID002' });
      expect(other!.status).toBe(GuestPassStatus.ACTIVE);
    });
  });

  // ---------------------------------------------------------------------------
  // acknowledgePass
  // ---------------------------------------------------------------------------
  describe('acknowledgePass', () => {
    it('should acknowledge an unacknowledged ACTIVE pass', async () => {
      const pass = await createPass();
      const result = await dao.acknowledgePass(testCuid, pass.vpuid, validatorId.toString());

      expect(result).not.toBeNull();
      expect(result!.isAcknowledged).toBe(true);
      expect(result!.acknowledgedBy!.toString()).toBe(validatorId.toString());
      expect(result!.acknowledgedAt).toBeDefined();
    });

    it('should return null for already-acknowledged or EXPIRED pass', async () => {
      const acked = await createPass({ code: 'ACK001', isAcknowledged: true });
      const expired = await createPass({ code: 'EXP001', status: GuestPassStatus.EXPIRED });

      expect(await dao.acknowledgePass(testCuid, acked.vpuid, validatorId.toString())).toBeNull();
      expect(await dao.acknowledgePass(testCuid, expired.vpuid, validatorId.toString())).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // bulkAcknowledge
  // ---------------------------------------------------------------------------
  describe('bulkAcknowledge', () => {
    it('should acknowledge multiple passes and return count', async () => {
      const p1 = await createPass({ code: 'BLK001' });
      const p2 = await createPass({ code: 'BLK002' });

      const count = await dao.bulkAcknowledge(
        testCuid,
        [p1.vpuid, p2.vpuid],
        validatorId.toString()
      );

      expect(count).toBe(2);
    });

    it('should skip already-acknowledged passes', async () => {
      const p1 = await createPass({ code: 'ACK001', isAcknowledged: true });
      const p2 = await createPass({ code: 'ACK002', isAcknowledged: false });

      const count = await dao.bulkAcknowledge(
        testCuid,
        [p1.vpuid, p2.vpuid],
        validatorId.toString()
      );

      expect(count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getUnacknowledgedPasses
  // ---------------------------------------------------------------------------
  describe('getUnacknowledgedPasses', () => {
    it('should return only unacknowledged active/used passes for specific property', async () => {
      await createPass({ code: 'UNA001', propertyId, isAcknowledged: false });
      await createPass({
        code: 'UNA002',
        propertyId,
        status: GuestPassStatus.USED,
        isAcknowledged: false,
      });
      // wrong property
      await createPass({ code: 'UNA003', propertyId: propertyId2, isAcknowledged: false });
      // acknowledged
      await createPass({ code: 'UNA004', propertyId, isAcknowledged: true });
      // expired status
      await createPass({
        code: 'UNA005',
        propertyId,
        status: GuestPassStatus.EXPIRED,
        isAcknowledged: false,
      });

      const passes = await dao.getUnacknowledgedPasses(testCuid, propertyId.toString());

      expect(passes).toHaveLength(2);
      const codes = passes.map((p) => p.code).sort();
      expect(codes).toEqual(['UNA001', 'UNA002']);
    });
  });

  // ---------------------------------------------------------------------------
  // getUnacknowledgedCount
  // ---------------------------------------------------------------------------
  describe('getUnacknowledgedCount', () => {
    it('should count unacknowledged passes and filter by propertyId', async () => {
      await createPass({ code: 'CNT001', propertyId, isAcknowledged: false });
      await createPass({ code: 'CNT002', propertyId: propertyId2, isAcknowledged: false });
      await createPass({ code: 'CNT003', propertyId, isAcknowledged: true });

      expect(await dao.getUnacknowledgedCount(testCuid)).toBe(2);
      expect(await dao.getUnacknowledgedCount(testCuid, propertyId.toString())).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getStats
  // ---------------------------------------------------------------------------
  describe('getStats', () => {
    it('should return correct counts for each status bucket', async () => {
      await createPass({ code: 'ST0001', status: GuestPassStatus.ACTIVE });
      await createPass({ code: 'ST0002', status: GuestPassStatus.ACTIVE });
      await createPass({ code: 'ST0003', status: GuestPassStatus.PENDING });
      await createPass({ code: 'ST0004', status: GuestPassStatus.USED });
      await createPass({ code: 'ST0005', status: GuestPassStatus.EXPIRED });
      await createPass({ code: 'ST0006', status: GuestPassStatus.REVOKED });
      // active but expired by time — counts in expired bucket
      await createPass({
        code: 'ST0007',
        status: GuestPassStatus.ACTIVE,
        validUntil: dayjs().subtract(1, 'hour').toDate(),
      });
      await createPass({ code: 'ST0008', status: GuestPassStatus.ACTIVE, isAcknowledged: false });

      const stats = await dao.getStats(testCuid);

      expect(stats.active).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.used).toBe(1);
      expect(stats.expired).toBe(2);
      expect(stats.revoked).toBe(1);
      expect(stats.unacknowledged).toBe(4);
      expect(stats.total).toBe(8);
    });

    it('should filter stats by propertyId', async () => {
      await createPass({ code: 'FP0001', propertyId });
      await createPass({ code: 'FP0002', propertyId: propertyId2 });

      const stats = await dao.getStats(testCuid, propertyId.toString());

      expect(stats.total).toBe(1);
      expect(stats.active).toBe(1);
    });

    it('should isolate stats by cuid', async () => {
      await createPass({ code: 'ISO001', cuid: testCuid });
      await createPass({ code: 'ISO002', cuid: otherCuid });

      const stats = await dao.getStats(testCuid);
      expect(stats.total).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Display populate — host name, property name, unit number for the UI
  // ---------------------------------------------------------------------------
  describe('GUEST_PASS_DISPLAY_POPULATE', () => {
    // Mirrors res.json(): virtuals such as createdBy.fullname only exist after serialisation
    const toApiJson = (value: unknown) => JSON.parse(JSON.stringify(value));

    let unitId: Types.ObjectId;
    let unitNumber: string;
    let hostFullName: string;

    beforeEach(async () => {
      const unit = await createTestPropertyUnit(testCuid, propertyId);
      unitId = unit._id as Types.ObjectId;
      unitNumber = unit.unitNumber;
      const profile = await createTestProfile(userId, new Types.ObjectId());
      hostFullName = `${profile.personalInfo.firstName} ${profile.personalInfo.lastName}`;
    });

    const createDisplayPass = (overrides: Record<string, any> = {}) =>
      createPass({
        propertyUnitId: unitId,
        visitorInfo: { name: 'Ada Visitor', phone: '+15550001111', email: 'ada@example.com' },
        purpose: 'Delivery',
        hostNotes: 'Leave at the front desk',
        ...overrides,
      });

    const expectDisplayFields = (pass: any) => {
      expect(pass.visitorInfo.name).toBe('Ada Visitor');
      expect(pass.purpose).toBe('Delivery');
      expect(pass.hostNotes).toBe('Leave at the front desk');
      expect(pass.propertyId).toMatchObject({
        _id: propertyId.toString(),
        pid: 'prop-uid-1',
        name: 'Test Property',
        address: { fullAddress: '123 Main St, Toronto, ON M5V1A1' },
      });
      expect(pass.propertyUnitId).toMatchObject({ _id: unitId.toString(), unitNumber });
      expect(pass.createdBy).toMatchObject({
        _id: userId.toString(),
        uid: 'user-uid-1',
        fullname: hostFullName,
      });
      expect(pass.createdBy.password).toBeUndefined();
    };

    it('list() with the display populate returns host, property, unit, purpose and hostNotes', async () => {
      await createDisplayPass({ code: 'DSP001' });

      const result = await dao.list({ cuid: testCuid }, { populate: GUEST_PASS_DISPLAY_POPULATE });

      expect(result.items).toHaveLength(1);
      expectDisplayFields(toApiJson(result.items[0]));
    });

    it('findByCode returns the display fields', async () => {
      await createDisplayPass({ code: 'DSP002' });

      const found = await dao.findByCode('DSP002', testCuid);

      expectDisplayFields(toApiJson(found));
    });

    it('getUnacknowledgedPasses returns the display fields', async () => {
      await createDisplayPass({ code: 'DSP003' });

      const passes = await dao.getUnacknowledgedPasses(testCuid, propertyId.toString());

      expect(passes).toHaveLength(1);
      expectDisplayFields(toApiJson(passes[0]));
    });

    it("a createdBy-scoped (tenant) query returns only that host's passes", async () => {
      await createDisplayPass({ code: 'DSP004' });
      await createDisplayPass({ code: 'DSP005', createdBy: validatorId });
      await createDisplayPass({ code: 'DSP006', cuid: otherCuid });

      const result = await dao.list(
        { cuid: testCuid, createdBy: userId },
        { populate: GUEST_PASS_DISPLAY_POPULATE }
      );

      expect(result.items.map((p) => p.code)).toEqual(['DSP004']);
      expectDisplayFields(toApiJson(result.items[0]));
    });

    it('leaves the host name null when the creator has no profile', async () => {
      await createDisplayPass({ code: 'DSP007', createdBy: validatorId });

      const found = toApiJson(await dao.findByCode('DSP007', testCuid));

      expect(found.createdBy.uid).toBe('user-uid-2');
      expect(found.createdBy.fullname).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Public-id acknowledge, revoke reason, host info
  // ---------------------------------------------------------------------------
  describe('public ids and persisted UI fields', () => {
    it('acknowledgePass and bulkAcknowledge match by vpuid within the cuid only', async () => {
      const own = await createPass({ code: 'VPU001' });
      const foreign = await createPass({ code: 'VPU002', cuid: otherCuid });

      expect(await dao.acknowledgePass(testCuid, foreign.vpuid, validatorId.toString())).toBeNull();
      expect(
        await dao.bulkAcknowledge(testCuid, [own.vpuid, foreign.vpuid], validatorId.toString())
      ).toBe(1);
    });

    it('revokePass stores the reason when given', async () => {
      const pass = await createPass({ code: 'RVK001' });
      const result = await dao.revokePass(
        pass._id.toString(),
        testCuid,
        userId.toString(),
        'Visitor cancelled'
      );

      expect(result!.revokedReason).toBe('Visitor cancelled');
    });

    it('persists hostInfo and returns it with the display populate', async () => {
      await createPass({
        code: 'HST001',
        hostInfo: { name: 'Rita Resident', phone: '+15550100200' },
      });

      const found = await dao.findByCode('HST001', testCuid);

      expect(found!.hostInfo).toEqual({ name: 'Rita Resident', phone: '+15550100200' });
    });
  });
});
