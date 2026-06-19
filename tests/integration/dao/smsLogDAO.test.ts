/**
 * SMSLogDAO Integration Tests
 *
 * Uses mongodb-memory-server (via test.config.integration.ts) to test
 * real DAO + Mongoose interactions against an in-memory MongoDB instance.
 */

import { Types } from 'mongoose';
import { clearTestDatabase } from '@tests/helpers';
import { SMSLogDAO } from '@dao/smsLogDAO';
import { SMSLog } from '@models/index';
import { SMSMessageType, SMSStatus } from '@interfaces/index';

describe('SMSLogDAO Integration Tests', () => {
  let smsLogDAO: SMSLogDAO;
  const testCuid = 'TEST_CLIENT';

  beforeAll(async () => {
    smsLogDAO = new SMSLogDAO({ smsLogModel: SMSLog });
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  // =========================================================================
  // createLog
  // =========================================================================

  describe('createLog', () => {
    it('should insert a document and return it with smsuid', async () => {
      const log = await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155551234',
        messageType: SMSMessageType.PAYMENT_REMINDER,
        status: SMSStatus.QUEUED,
        twilioSid: 'SM_test_sid',
        sentBy: new Types.ObjectId(),
        sentAt: new Date(),
      });

      expect(log).toBeDefined();
      expect(log._id).toBeDefined();
      expect(log.smsuid).toBeDefined();
      expect(typeof log.smsuid).toBe('string');
      expect(log.smsuid.length).toBeGreaterThan(0);
      expect(log.cuid).toBe(testCuid);
      expect(log.recipientPhone).toBe('+14155551234');
      expect(log.messageType).toBe(SMSMessageType.PAYMENT_REMINDER);
      expect(log.status).toBe(SMSStatus.QUEUED);
      expect(log.twilioSid).toBe('SM_test_sid');
    });

    it('should auto-generate smsuid when not provided', async () => {
      const log = await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155559999',
        messageType: SMSMessageType.SYSTEM,
        status: SMSStatus.SENT,
      });

      expect(log.smsuid).toBeDefined();
      expect(log.smsuid.length).toBeGreaterThan(0);
    });

    it('should generate unique smsuids for multiple logs', async () => {
      const log1 = await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155551111',
        messageType: SMSMessageType.SYSTEM,
        status: SMSStatus.SENT,
      });

      const log2 = await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155552222',
        messageType: SMSMessageType.OTP,
        status: SMSStatus.SENT,
      });

      expect(log1.smsuid).not.toBe(log2.smsuid);
    });

    it('should default status to QUEUED when not provided', async () => {
      const log = await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155551234',
        messageType: SMSMessageType.MAINTENANCE_UPDATE,
      } as any);

      expect(log.status).toBe(SMSStatus.QUEUED);
    });

    it('should persist the document to the database', async () => {
      const log = await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155551234',
        messageType: SMSMessageType.LEASE_REMINDER,
        status: SMSStatus.DELIVERED,
      });

      const found = await SMSLog.findById(log._id);
      expect(found).not.toBeNull();
      expect(found!.smsuid).toBe(log.smsuid);
    });
  });

  // =========================================================================
  // getLogsByCuid
  // =========================================================================

  describe('getLogsByCuid', () => {
    beforeEach(async () => {
      // Seed test data with staggered creation
      await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155551111',
        messageType: SMSMessageType.PAYMENT_REMINDER,
        status: SMSStatus.DELIVERED,
      });

      await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155552222',
        messageType: SMSMessageType.MAINTENANCE_UPDATE,
        status: SMSStatus.FAILED,
      });

      await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155553333',
        messageType: SMSMessageType.PAYMENT_REMINDER,
        status: SMSStatus.DELIVERED,
      });

      // Different cuid — should not appear in results
      await smsLogDAO.createLog({
        cuid: 'OTHER_CLIENT',
        recipientPhone: '+14155554444',
        messageType: SMSMessageType.SYSTEM,
        status: SMSStatus.SENT,
      });
    });

    it('should return paginated results for the given cuid', async () => {
      const result = await smsLogDAO.getLogsByCuid(testCuid);

      expect(result.items).toBeDefined();
      expect(result.items.length).toBe(3);
      // Should not include logs from other cuids
      result.items.forEach((log) => {
        expect(log.cuid).toBe(testCuid);
      });
    });

    it('should sort by createdAt descending', async () => {
      const result = await smsLogDAO.getLogsByCuid(testCuid);

      for (let i = 0; i < result.items.length - 1; i++) {
        const current = new Date(result.items[i].createdAt).getTime();
        const next = new Date(result.items[i + 1].createdAt).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });

    it('should filter by messageType', async () => {
      const result = await smsLogDAO.getLogsByCuid(testCuid, {
        messageType: SMSMessageType.PAYMENT_REMINDER,
      });

      expect(result.items.length).toBe(2);
      result.items.forEach((log) => {
        expect(log.messageType).toBe(SMSMessageType.PAYMENT_REMINDER);
      });
    });

    it('should filter by status', async () => {
      const result = await smsLogDAO.getLogsByCuid(testCuid, {
        status: SMSStatus.FAILED,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].status).toBe(SMSStatus.FAILED);
    });

    it('should filter by both messageType and status', async () => {
      const result = await smsLogDAO.getLogsByCuid(testCuid, {
        messageType: SMSMessageType.PAYMENT_REMINDER,
        status: SMSStatus.DELIVERED,
      });

      expect(result.items.length).toBe(2);
      result.items.forEach((log) => {
        expect(log.messageType).toBe(SMSMessageType.PAYMENT_REMINDER);
        expect(log.status).toBe(SMSStatus.DELIVERED);
      });
    });

    it('should return empty items when no logs match filters', async () => {
      const result = await smsLogDAO.getLogsByCuid(testCuid, {
        messageType: SMSMessageType.OTP,
      });

      expect(result.items.length).toBe(0);
    });

    it('should return empty items for a nonexistent cuid', async () => {
      const result = await smsLogDAO.getLogsByCuid('NONEXISTENT_CUID');

      expect(result.items.length).toBe(0);
    });

    it('should respect pagination options', async () => {
      const result = await smsLogDAO.getLogsByCuid(testCuid, undefined, {
        skip: 0,
        limit: 2,
      });

      expect(result.items.length).toBe(2);
      expect(result.pagination).toBeDefined();
    });
  });

  // =========================================================================
  // getUsageByType
  // =========================================================================

  describe('getUsageByType', () => {
    it('should aggregate counts by messageType for a date range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155551111',
        messageType: SMSMessageType.PAYMENT_REMINDER,
        status: SMSStatus.DELIVERED,
        sentAt: now,
      });

      await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155552222',
        messageType: SMSMessageType.PAYMENT_REMINDER,
        status: SMSStatus.DELIVERED,
        sentAt: oneHourAgo,
      });

      await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155553333',
        messageType: SMSMessageType.OTP,
        status: SMSStatus.SENT,
        sentAt: oneHourAgo,
      });

      await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155554444',
        messageType: SMSMessageType.SYSTEM,
        status: SMSStatus.SENT,
        sentAt: twoHoursAgo,
      });

      const result = await smsLogDAO.getUsageByType(testCuid, twoHoursAgo, now);

      expect(result[SMSMessageType.PAYMENT_REMINDER]).toBe(2);
      expect(result[SMSMessageType.OTP]).toBe(1);
      expect(result[SMSMessageType.SYSTEM]).toBe(1);
    });

    it('should only include logs within the date range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

      // Inside range
      await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155551111',
        messageType: SMSMessageType.SYSTEM,
        status: SMSStatus.SENT,
        sentAt: oneHourAgo,
      });

      // Outside range (too old)
      await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155552222',
        messageType: SMSMessageType.SYSTEM,
        status: SMSStatus.SENT,
        sentAt: threeHoursAgo,
      });

      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const result = await smsLogDAO.getUsageByType(testCuid, twoHoursAgo, now);

      expect(result[SMSMessageType.SYSTEM]).toBe(1);
    });

    it('should only include logs for the given cuid', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155551111',
        messageType: SMSMessageType.OTP,
        status: SMSStatus.SENT,
        sentAt: now,
      });

      await smsLogDAO.createLog({
        cuid: 'OTHER_CLIENT',
        recipientPhone: '+14155552222',
        messageType: SMSMessageType.OTP,
        status: SMSStatus.SENT,
        sentAt: now,
      });

      const result = await smsLogDAO.getUsageByType(testCuid, oneHourAgo, now);

      expect(result[SMSMessageType.OTP]).toBe(1);
    });

    it('should return empty object when no logs exist in range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      const result = await smsLogDAO.getUsageByType(testCuid, oneHourAgo, now);

      expect(result).toEqual({});
    });
  });

  // =========================================================================
  // updateBySid
  // =========================================================================

  describe('updateBySid', () => {
    it('should update a log by its twilioSid', async () => {
      await smsLogDAO.createLog({
        cuid: testCuid,
        recipientPhone: '+14155551234',
        messageType: SMSMessageType.PAYMENT_REMINDER,
        status: SMSStatus.QUEUED,
        twilioSid: 'SM_update_test',
      });

      const updated = await smsLogDAO.updateBySid('SM_update_test', {
        status: SMSStatus.DELIVERED,
      });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe(SMSStatus.DELIVERED);
    });

    it('should return null when twilioSid does not exist', async () => {
      const updated = await smsLogDAO.updateBySid('SM_nonexistent', {
        status: SMSStatus.DELIVERED,
      });

      expect(updated).toBeNull();
    });
  });
});
