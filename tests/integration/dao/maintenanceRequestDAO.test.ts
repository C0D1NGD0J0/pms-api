import { Types } from 'mongoose';
import { clearTestDatabase } from '@tests/helpers';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import InvoiceModel from '@models/invoice/invoice.model';
import { MaintenanceRequest as MaintenanceRequestModel } from '@models/index';
import {
  MaintenanceRequestPriority,
  MaintenanceRequestStatus,
  MaintenanceCategory,
  InvoiceStatus,
} from '@interfaces/maintenanceRequest.interface';

const BASE_CUID = 'TEST_CLIENT_001';

function makeRequest(overrides: Record<string, any> = {}) {
  return {
    cuid: BASE_CUID,
    propertyId: new Types.ObjectId(),
    title: 'Test maintenance request',
    description: { text: 'Test description text' },
    category: MaintenanceCategory.PLUMBING,
    priority: MaintenanceRequestPriority.MEDIUM,
    status: MaintenanceRequestStatus.OPEN,
    permissionToEnter: false,
    ...overrides,
  };
}

describe('MaintenanceRequestDAO Integration Tests', () => {
  let dao: MaintenanceRequestDAO;

  beforeAll(async () => {
    dao = new MaintenanceRequestDAO({ maintenanceRequestModel: MaintenanceRequestModel });
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('getByMruid', () => {
    it('should find a request by mruid scoped to the correct cuid', async () => {
      const doc = await MaintenanceRequestModel.create(makeRequest());

      const result = await dao.getByMruid(doc.mruid, BASE_CUID);

      expect(result).not.toBeNull();
      expect(result?.mruid).toBe(doc.mruid);
      expect(result?.cuid).toBe(BASE_CUID);
    });

    it('should return null when cuid does not match', async () => {
      const doc = await MaintenanceRequestModel.create(makeRequest());

      const result = await dao.getByMruid(doc.mruid, 'WRONG_CUID');

      expect(result).toBeNull();
    });

    it('should return null for a soft-deleted request', async () => {
      const doc = await MaintenanceRequestModel.create(makeRequest({ deletedAt: new Date() }));

      const result = await dao.getByMruid(doc.mruid, BASE_CUID);

      expect(result).toBeNull();
    });

    it('should return null for a non-existent mruid', async () => {
      const result = await dao.getByMruid('MR-NONEXISTENT-0000', BASE_CUID);

      expect(result).toBeNull();
    });
  });

  describe('findByMruid', () => {
    it('should find a request by mruid without cuid scoping', async () => {
      const doc = await MaintenanceRequestModel.create(makeRequest({ cuid: 'ANOTHER_CLIENT' }));

      const result = await dao.findByMruid(doc.mruid);

      expect(result).not.toBeNull();
      expect(result?.mruid).toBe(doc.mruid);
    });

    it('should return null for a non-existent mruid', async () => {
      const result = await dao.findByMruid('MR-NONEXISTENT-0000');

      expect(result).toBeNull();
    });

    it('should return null for a soft-deleted request', async () => {
      const doc = await MaintenanceRequestModel.create(makeRequest({ deletedAt: new Date() }));

      const result = await dao.findByMruid(doc.mruid);

      expect(result).toBeNull();
    });
  });

  describe('listWithDetails', () => {
    it('should return items matching the filter', async () => {
      await MaintenanceRequestModel.create(makeRequest({ status: MaintenanceRequestStatus.OPEN }));
      await MaintenanceRequestModel.create(makeRequest({ status: MaintenanceRequestStatus.OPEN }));
      await MaintenanceRequestModel.create(
        makeRequest({ status: MaintenanceRequestStatus.COMPLETED })
      );

      const result = await dao.listWithDetails({
        cuid: BASE_CUID,
        status: MaintenanceRequestStatus.OPEN,
        deletedAt: null,
      });

      expect(result.items).toHaveLength(2);
      result.items.forEach((item) => expect(item.status).toBe(MaintenanceRequestStatus.OPEN));
    });

    it('should exclude soft-deleted records', async () => {
      await MaintenanceRequestModel.create(makeRequest());
      await MaintenanceRequestModel.create(makeRequest({ deletedAt: new Date() }));

      const result = await dao.listWithDetails({ cuid: BASE_CUID, deletedAt: null });

      expect(result.items).toHaveLength(1);
    });

    it('should return pagination metadata when limit/skip are provided', async () => {
      await Promise.all([1, 2, 3].map(() => MaintenanceRequestModel.create(makeRequest())));

      const result = await dao.listWithDetails(
        { cuid: BASE_CUID, deletedAt: null },
        { limit: 2, skip: 0 }
      );

      expect(result.items).toHaveLength(2);
      expect(result.pagination).toBeDefined();
      expect(result.pagination?.total).toBe(3);
    });

    it('should return empty items array when no records match', async () => {
      const result = await dao.listWithDetails({ cuid: 'NO_SUCH_CLIENT', deletedAt: null });

      expect(result.items).toHaveLength(0);
    });
  });

  describe('getVendorQueue', () => {
    it('should return only ASSIGNED and IN_PROGRESS requests for a vendor', async () => {
      const vendorId = new Types.ObjectId();

      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.ASSIGNED })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.IN_PROGRESS })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.COMPLETED })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.CANCELLED })
      );

      const queue = await dao.getVendorQueue(vendorId.toString());

      expect(queue).toHaveLength(2);
      const statuses = queue.map((r) => r.status);
      expect(statuses).toContain(MaintenanceRequestStatus.ASSIGNED);
      expect(statuses).toContain(MaintenanceRequestStatus.IN_PROGRESS);
    });

    it('should return requests across multiple clients (cross-cuid)', async () => {
      const vendorId = new Types.ObjectId();

      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, cuid: 'CLIENT_A', status: MaintenanceRequestStatus.ASSIGNED })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, cuid: 'CLIENT_B', status: MaintenanceRequestStatus.IN_PROGRESS })
      );

      const queue = await dao.getVendorQueue(vendorId.toString());

      expect(queue).toHaveLength(2);
      const cuids = queue.map((r) => r.cuid);
      expect(cuids).toContain('CLIENT_A');
      expect(cuids).toContain('CLIENT_B');
    });

    it('should not include soft-deleted requests', async () => {
      const vendorId = new Types.ObjectId();

      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.ASSIGNED })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.ASSIGNED, deletedAt: new Date() })
      );

      const queue = await dao.getVendorQueue(vendorId.toString());

      expect(queue).toHaveLength(1);
    });

    it('should return an empty array when vendor has no active jobs', async () => {
      const vendorId = new Types.ObjectId();

      const queue = await dao.getVendorQueue(vendorId.toString());

      expect(queue).toEqual([]);
    });

    it('should not return requests belonging to a different vendor', async () => {
      const vendorA = new Types.ObjectId();
      const vendorB = new Types.ObjectId();

      await MaintenanceRequestModel.create(
        makeRequest({ vendorId: vendorA, status: MaintenanceRequestStatus.ASSIGNED })
      );

      const queue = await dao.getVendorQueue(vendorB.toString());

      expect(queue).toHaveLength(0);
    });
  });

  describe('getVendorStats', () => {
    it('should return zero stats for a vendor with no requests', async () => {
      const vendorId = new Types.ObjectId();

      const stats = await dao.getVendorStats(vendorId.toString());

      expect(stats.total).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.inProgress).toBe(0);
      expect(stats.assigned).toBe(0);
      expect(stats.cancelled).toBe(0);
      expect(stats.avgCompletionDays).toBeUndefined();
    });

    it('should correctly count requests by status', async () => {
      const vendorId = new Types.ObjectId();

      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.COMPLETED })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.COMPLETED })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.IN_PROGRESS })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.ASSIGNED })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.CANCELLED })
      );

      const stats = await dao.getVendorStats(vendorId.toString());

      expect(stats.total).toBe(5);
      expect(stats.completed).toBe(2);
      expect(stats.inProgress).toBe(1);
      expect(stats.assigned).toBe(1);
      expect(stats.cancelled).toBe(1);
    });

    it('should calculate avgCompletionDays for completed requests with timestamps', async () => {
      const vendorId = new Types.ObjectId();
      const assignedAt = new Date('2024-01-01T00:00:00Z');
      const completedAt = new Date('2024-01-03T00:00:00Z'); // 2 days later

      await MaintenanceRequestModel.create(
        makeRequest({
          vendorId,
          status: MaintenanceRequestStatus.COMPLETED,
          assignedAt,
          completedAt,
        })
      );

      const stats = await dao.getVendorStats(vendorId.toString());

      expect(stats.avgCompletionDays).toBeDefined();
      expect(stats.avgCompletionDays).toBeCloseTo(2, 1);
    });

    it('should return undefined avgCompletionDays when no completed requests exist', async () => {
      const vendorId = new Types.ObjectId();

      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.ASSIGNED })
      );

      const stats = await dao.getVendorStats(vendorId.toString());

      expect(stats.avgCompletionDays).toBeUndefined();
    });

    it('should not include soft-deleted requests in stats', async () => {
      const vendorId = new Types.ObjectId();

      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.COMPLETED })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, status: MaintenanceRequestStatus.COMPLETED, deletedAt: new Date() })
      );

      const stats = await dao.getVendorStats(vendorId.toString());

      expect(stats.total).toBe(1);
      expect(stats.completed).toBe(1);
    });

    it('should aggregate stats across multiple clients (cross-cuid)', async () => {
      const vendorId = new Types.ObjectId();

      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, cuid: 'CLIENT_X', status: MaintenanceRequestStatus.COMPLETED })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ vendorId, cuid: 'CLIENT_Y', status: MaintenanceRequestStatus.IN_PROGRESS })
      );

      const stats = await dao.getVendorStats(vendorId.toString());

      expect(stats.total).toBe(2);
      expect(stats.completed).toBe(1);
      expect(stats.inProgress).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return zero stats for a client with no requests', async () => {
      const stats = await dao.getStats(BASE_CUID);

      expect(stats.total).toBe(0);
      expect(stats.open).toBe(0);
      expect(stats.inProgress).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.cancelled).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.pendingInvoices).toBe(0);
      expect(stats.byCategory).toEqual({});
      expect(stats.byPriority).toEqual({});
    });

    it('should correctly count requests by status scoped to the client', async () => {
      await MaintenanceRequestModel.create(makeRequest({ status: MaintenanceRequestStatus.OPEN }));
      await MaintenanceRequestModel.create(makeRequest({ status: MaintenanceRequestStatus.OPEN }));
      await MaintenanceRequestModel.create(
        makeRequest({ status: MaintenanceRequestStatus.IN_PROGRESS })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ status: MaintenanceRequestStatus.COMPLETED })
      );
      // different client — must not be counted
      await MaintenanceRequestModel.create(
        makeRequest({ cuid: 'OTHER_CLIENT', status: MaintenanceRequestStatus.OPEN })
      );

      const stats = await dao.getStats(BASE_CUID);

      expect(stats.total).toBe(4);
      expect(stats.open).toBe(2);
      expect(stats.inProgress).toBe(1);
      expect(stats.completed).toBe(1);
    });

    it('should group results by category', async () => {
      await MaintenanceRequestModel.create(makeRequest({ category: MaintenanceCategory.PLUMBING }));
      await MaintenanceRequestModel.create(makeRequest({ category: MaintenanceCategory.PLUMBING }));
      await MaintenanceRequestModel.create(
        makeRequest({ category: MaintenanceCategory.ELECTRICAL })
      );

      const stats = await dao.getStats(BASE_CUID);

      expect(stats.byCategory[MaintenanceCategory.PLUMBING]).toBe(2);
      expect(stats.byCategory[MaintenanceCategory.ELECTRICAL]).toBe(1);
    });

    it('should group results by priority', async () => {
      await MaintenanceRequestModel.create(
        makeRequest({ priority: MaintenanceRequestPriority.HIGH })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ priority: MaintenanceRequestPriority.MEDIUM })
      );
      await MaintenanceRequestModel.create(
        makeRequest({ priority: MaintenanceRequestPriority.LOW })
      );

      const stats = await dao.getStats(BASE_CUID);

      expect(stats.byPriority[MaintenanceRequestPriority.HIGH]).toBe(1);
      expect(stats.byPriority[MaintenanceRequestPriority.MEDIUM]).toBe(1);
      expect(stats.byPriority[MaintenanceRequestPriority.LOW]).toBe(1);
    });

    it('should count only pending invoices', async () => {
      const submittedBy = new Types.ObjectId();

      // Create MRs first
      const mr1 = await MaintenanceRequestModel.create(
        makeRequest({ status: MaintenanceRequestStatus.COMPLETED })
      );
      const mr2 = await MaintenanceRequestModel.create(
        makeRequest({ status: MaintenanceRequestStatus.COMPLETED })
      );
      await MaintenanceRequestModel.create(makeRequest({ status: MaintenanceRequestStatus.OPEN }));

      // Create invoices in the separate Invoice collection (used by $lookup)
      await InvoiceModel.create({
        cuid: BASE_CUID,
        maintenanceRequestId: mr1._id,
        mruid: mr1.mruid || 'mr-pending',
        status: InvoiceStatus.PENDING,
        amountInCents: 10000,
        description: 'Pending invoice',
        submittedBy,
        submittedAt: new Date(),
        currency: 'USD',
      });
      await InvoiceModel.create({
        cuid: BASE_CUID,
        maintenanceRequestId: mr2._id,
        mruid: mr2.mruid || 'mr-approved',
        status: InvoiceStatus.APPROVED,
        amountInCents: 5000,
        description: 'Approved invoice',
        submittedBy,
        submittedAt: new Date(),
        currency: 'USD',
      });

      const stats = await dao.getStats(BASE_CUID);

      expect(stats.pendingInvoices).toBe(1);
    });

    it('should scope stats to a specific property when propertyId is provided', async () => {
      const propertyId = new Types.ObjectId();
      const otherPropertyId = new Types.ObjectId();

      await MaintenanceRequestModel.create(makeRequest({ propertyId }));
      await MaintenanceRequestModel.create(makeRequest({ propertyId }));
      await MaintenanceRequestModel.create(makeRequest({ propertyId: otherPropertyId }));

      const stats = await dao.getStats(BASE_CUID, { propertyId: propertyId.toString() });

      expect(stats.total).toBe(2);
    });

    it('should not include soft-deleted requests', async () => {
      await MaintenanceRequestModel.create(makeRequest({ status: MaintenanceRequestStatus.OPEN }));
      await MaintenanceRequestModel.create(
        makeRequest({ status: MaintenanceRequestStatus.OPEN, deletedAt: new Date() })
      );

      const stats = await dao.getStats(BASE_CUID);

      expect(stats.total).toBe(1);
    });
  });
});
