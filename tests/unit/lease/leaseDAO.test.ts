import { Types } from 'mongoose';
import { LeaseDAO } from '@dao/leaseDAO';
import { LeaseStatus, LeaseType } from '@interfaces/lease.interface';

// Create chainable query mock
const createQueryMock = (returnValue: any) => {
  const queryMock = {
    exec: jest.fn().mockResolvedValue(returnValue),
    session: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
  };
  return queryMock;
};

const mockLeaseModel = {
  create: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  countDocuments: jest.fn(() => ({
    exec: jest.fn().mockResolvedValue(0),
  })),
  aggregate: jest.fn(() => ({
    exec: jest.fn().mockResolvedValue([]),
  })),
};

describe('LeaseDAO', () => {
  let leaseDAO: LeaseDAO;

  beforeEach(() => {
    leaseDAO = new LeaseDAO({ leaseModel: mockLeaseModel as any });
    jest.clearAllMocks();
  });

  describe('createLease', () => {
    it('should create lease successfully', async () => {
      const createdBy = new Types.ObjectId();
      const mockLeaseData = {
        leaseNumber: 'LEASE-2025-001',
        type: LeaseType.FIXED_TERM,
        tenantId: new Types.ObjectId().toString(),
        property: {
          id: new Types.ObjectId().toString(),
          address: '123 Main St',
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
        },
        createdBy,
      };

      const mockCreatedLease = {
        ...mockLeaseData,
        _id: new Types.ObjectId(),
        luid: 'L-2025-ABC123',
        cuid: 'C123',
        status: LeaseStatus.DRAFT,
      };

      // BaseDAO.insert() returns single document, not array
      mockLeaseModel.create.mockResolvedValue([mockCreatedLease]);

      const result = await leaseDAO.createLease('C123', mockLeaseData as any);

      expect(result).toEqual(mockCreatedLease);
      expect(mockLeaseModel.create).toHaveBeenCalledWith(
        [expect.objectContaining({ cuid: 'C123', createdBy })],
        { session: null }
      );
    });

    it('should enforce client isolation (cuid)', async () => {
      const createdBy = new Types.ObjectId();
      const mockLeaseData = {
        leaseNumber: 'LEASE-2025-001',
        type: LeaseType.FIXED_TERM,
        tenantId: new Types.ObjectId().toString(),
        property: {
          id: new Types.ObjectId().toString(),
          address: '123 Main St',
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
        },
        createdBy,
      };

      mockLeaseModel.create.mockResolvedValue([{ ...mockLeaseData, cuid: 'C123' }]);

      await leaseDAO.createLease('C123', mockLeaseData as any);

      expect(mockLeaseModel.create).toHaveBeenCalledWith(
        [expect.objectContaining({ cuid: 'C123' })],
        expect.any(Object)
      );
    });

    it('should support transaction session', async () => {
      const mockSession = { id: 'session-123' } as any;
      const createdBy = new Types.ObjectId();
      const mockLeaseData = {
        leaseNumber: 'LEASE-2025-001',
        type: LeaseType.FIXED_TERM,
        tenantId: new Types.ObjectId().toString(),
        property: {
          id: new Types.ObjectId().toString(),
          address: '123 Main St',
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
        },
        createdBy,
      };

      mockLeaseModel.create.mockResolvedValue([{ ...mockLeaseData, cuid: 'C123' }]);

      await leaseDAO.createLease('C123', mockLeaseData as any, mockSession);

      expect(mockLeaseModel.create).toHaveBeenCalledWith(expect.any(Array), {
        session: mockSession,
      });
    });

    it('should handle lease with documents', async () => {
      const createdBy = new Types.ObjectId();
      const mockLeaseData = {
        leaseNumber: 'LEASE-2025-001',
        type: LeaseType.FIXED_TERM,
        tenantId: new Types.ObjectId().toString(),
        property: {
          id: new Types.ObjectId().toString(),
          address: '123 Main St',
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
        },
        createdBy,
        leaseDocument: [
          {
            documentType: 'lease_agreement' as const,
            filename: 'lease-agreement.pdf',
            url: 'https://s3.amazonaws.com/bucket/lease-agreement.pdf',
            key: 's3-key-123',
            mimeType: 'application/pdf',
            size: 102400,
            uploadedBy: createdBy,
            uploadedAt: new Date(),
          },
        ],
      };

      const mockCreatedLease = {
        ...mockLeaseData,
        _id: new Types.ObjectId(),
        luid: 'L-2025-ABC123',
        cuid: 'C123',
        status: LeaseStatus.DRAFT,
      };

      mockLeaseModel.create.mockResolvedValue([mockCreatedLease]);

      const result = await leaseDAO.createLease('C123', mockLeaseData as any);

      expect(result).toEqual(mockCreatedLease);
      expect(mockLeaseModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            cuid: 'C123',
            createdBy,
            leaseDocument: expect.arrayContaining([
              expect.objectContaining({
                filename: 'lease-agreement.pdf',
                uploadedBy: createdBy,
                uploadedAt: expect.any(Date),
              }),
            ]),
          }),
        ],
        { session: null }
      );
    });

    it('should set uploadedBy and uploadedAt for documents', async () => {
      const createdBy = new Types.ObjectId();
      const mockLeaseData = {
        leaseNumber: 'LEASE-2025-001',
        type: LeaseType.FIXED_TERM,
        tenantId: new Types.ObjectId().toString(),
        property: {
          id: new Types.ObjectId().toString(),
          address: '123 Main St',
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
        },
        createdBy,
        leaseDocument: [
          {
            filename: 'doc1.pdf',
            url: 'https://s3.amazonaws.com/doc1.pdf',
            key: 'key1',
            uploadedBy: createdBy,
            uploadedAt: new Date(),
          },
        ],
      };

      mockLeaseModel.create.mockResolvedValue([
        { ...mockLeaseData, _id: new Types.ObjectId(), cuid: 'C123' },
      ]);

      await leaseDAO.createLease('C123', mockLeaseData as any);

      const callArg = mockLeaseModel.create.mock.calls[0][0][0];
      expect(callArg.leaseDocument[0].uploadedBy).toEqual(createdBy);
      expect(callArg.leaseDocument[0].uploadedAt).toBeInstanceOf(Date);
    });
  });

  describe('getLeaseById', () => {
    it('should get lease by ID', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockLease = {
        _id: leaseId,
        cuid: 'C123',
        leaseNumber: 'LEASE-2025-001',
        deletedAt: null,
      };

      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockLease),
      };

      mockLeaseModel.findOne.mockReturnValue(mockQuery);

      const result = await leaseDAO.getLeaseById('C123', leaseId);

      expect(result).toEqual(mockLease);
      expect(mockLeaseModel.findOne).toHaveBeenCalledWith({
        _id: leaseId,
        cuid: 'C123',
        deletedAt: null,
      });
    });

    it('should enforce client isolation', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      };

      mockLeaseModel.findOne.mockReturnValue(mockQuery);

      await leaseDAO.getLeaseById('C123', leaseId);

      expect(mockLeaseModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ cuid: 'C123' })
      );
    });

    it('should return null if not found', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      };

      mockLeaseModel.findOne.mockReturnValue(mockQuery);

      const result = await leaseDAO.getLeaseById('C123', leaseId);

      expect(result).toBeNull();
    });

    it('should exclude soft-deleted leases', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      };

      mockLeaseModel.findOne.mockReturnValue(mockQuery);

      await leaseDAO.getLeaseById('C123', leaseId);

      expect(mockLeaseModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: null })
      );
    });

    it('should support populate option', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({}),
      };

      mockLeaseModel.findOne.mockReturnValue(mockQuery);

      await leaseDAO.getLeaseById('C123', leaseId, { populate: 'tenantId' });

      expect(mockQuery.populate).toHaveBeenCalledWith('tenantId');
    });

    it('should support select option', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({}),
      };

      mockLeaseModel.findOne.mockReturnValue(mockQuery);

      await leaseDAO.getLeaseById('C123', leaseId, { select: 'leaseNumber status' });

      expect(mockQuery.select).toHaveBeenCalledWith('leaseNumber status');
    });
  });

  describe('getFilteredLeases', () => {
    beforeEach(() => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);
      mockLeaseModel.countDocuments.mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(0),
      }));
    });

    it('should apply status filter', async () => {
      const mockLeases = [{ _id: 'L1', status: LeaseStatus.ACTIVE }];
      const mockQuery = createQueryMock(mockLeases);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      const result = await leaseDAO.getFilteredLeases(
        'C123',
        { status: LeaseStatus.ACTIVE },
        { page: 1, limit: 10 }
      );

      expect(result.items).toEqual(mockLeases);
      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ status: LeaseStatus.ACTIVE, cuid: 'C123', deletedAt: null })
      );
    });

    it('should apply propertyId filter', async () => {
      const propertyId = new Types.ObjectId();
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.getFilteredLeases('C123', { propertyId }, { page: 1, limit: 10 });

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ 'property.id': propertyId })
      );
    });

    it('should apply unitId filter', async () => {
      const unitId = new Types.ObjectId();
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.getFilteredLeases('C123', { unitId }, { page: 1, limit: 10 });

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ 'property.unitId': unitId })
      );
    });

    it('should apply tenantId filter', async () => {
      const tenantId = new Types.ObjectId();
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.getFilteredLeases('C123', { tenantId }, { page: 1, limit: 10 });

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId })
      );
    });

    it('should apply rent range filters', async () => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.getFilteredLeases(
        'C123',
        { minRent: 1000, maxRent: 2000 },
        { page: 1, limit: 10 }
      );

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          'fees.monthlyRent': { $gte: 1000, $lte: 2000 },
        })
      );
    });

    it('should apply search filter', async () => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.getFilteredLeases('C123', { search: 'LEASE-001' }, { page: 1, limit: 10 });

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ leaseNumber: expect.any(Object) }),
          ]),
        })
      );
    });

    it('should return paginated results', async () => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);
      mockLeaseModel.countDocuments.mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(50),
      }));

      const result = await leaseDAO.getFilteredLeases('C123', {}, { page: 2, limit: 20 });

      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination).toHaveProperty('currentPage', 2);
      expect(result.pagination).toHaveProperty('perPage', 20);
    });

    it('should enforce client isolation', async () => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.getFilteredLeases('C123', {}, { page: 1, limit: 10 });

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ cuid: 'C123' })
      );
    });

    it('should exclude soft-deleted leases', async () => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.getFilteredLeases('C123', {}, { page: 1, limit: 10 });

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: null })
      );
    });
  });

  describe('updateLease', () => {
    it('should update lease successfully', async () => {
      const leaseId = new Types.ObjectId().toString();
      const updateData = { status: LeaseStatus.ACTIVE };
      const mockUpdatedLease = { _id: leaseId, ...updateData };
      const mockQuery = createQueryMock(mockUpdatedLease);

      mockLeaseModel.findOneAndUpdate.mockReturnValue(mockQuery);

      const result = await leaseDAO.updateLease('C123', leaseId, updateData);

      expect(result).toEqual(mockUpdatedLease);
      expect(mockLeaseModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: leaseId, cuid: 'C123', deletedAt: null },
        { $set: updateData },
        expect.objectContaining({ new: true, runValidators: true })
      );
    });

    it('should enforce client isolation', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockQuery = createQueryMock(null);

      mockLeaseModel.findOneAndUpdate.mockReturnValue(mockQuery);

      await leaseDAO.updateLease('C123', leaseId, {});

      expect(mockLeaseModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ cuid: 'C123' }),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should return null if lease not found', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockQuery = createQueryMock(null);

      mockLeaseModel.findOneAndUpdate.mockReturnValue(mockQuery);

      const result = await leaseDAO.updateLease('C123', leaseId, {});

      expect(result).toBeNull();
    });
  });

  describe('deleteLease', () => {
    it('should perform soft delete', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockUpdatedLease = { _id: leaseId, cuid: 'C123', deletedAt: new Date() };
      const mockQuery = createQueryMock(mockUpdatedLease);

      mockLeaseModel.findOneAndUpdate.mockReturnValue(mockQuery);

      const result = await leaseDAO.deleteLease('C123', leaseId);

      expect(result).toBe(true);
      expect(mockLeaseModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: leaseId, cuid: 'C123', deletedAt: null },
        { $set: { deletedAt: expect.any(Date) } },
        expect.objectContaining({ new: true })
      );
    });

    it('should return false if lease not found', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockQuery = createQueryMock(null);

      mockLeaseModel.findOneAndUpdate.mockReturnValue(mockQuery);

      const result = await leaseDAO.deleteLease('C123', leaseId);

      expect(result).toBe(false);
    });

    it('should enforce client isolation', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockUpdatedLease = { _id: leaseId, cuid: 'C123', deletedAt: new Date() };
      const mockQuery = createQueryMock(mockUpdatedLease);

      mockLeaseModel.findOneAndUpdate.mockReturnValue(mockQuery);

      await leaseDAO.deleteLease('C123', leaseId);

      expect(mockLeaseModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ cuid: 'C123' }),
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  describe('checkOverlappingLeases', () => {
    it('should return empty array when no overlap', async () => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      const result = await leaseDAO.checkOverlappingLeases(
        'C123',
        'P123',
        'U123',
        new Date('2025-01-01'),
        new Date('2026-01-01')
      );

      expect(result).toEqual([]);
    });

    it('should detect overlapping dates', async () => {
      const mockOverlappingLease = {
        _id: 'L999',
        duration: {
          startDate: new Date('2025-06-01'),
          endDate: new Date('2026-06-01'),
        },
        status: LeaseStatus.ACTIVE,
      };

      const mockQuery = createQueryMock([mockOverlappingLease]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      const result = await leaseDAO.checkOverlappingLeases(
        'C123',
        'P123',
        'U123',
        new Date('2025-07-01'),
        new Date('2026-07-01')
      );

      expect(result.length).toBe(1);
      expect(result[0]).toEqual(mockOverlappingLease);
    });

    it('should exclude specified lease ID', async () => {
      const excludeLeaseId = 'L123';
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.checkOverlappingLeases(
        'C123',
        'P123',
        'U123',
        new Date('2025-01-01'),
        new Date('2026-01-01'),
        excludeLeaseId
      );

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ _id: { $ne: excludeLeaseId } })
      );
    });

    it('should only check active/pending_signature/draft leases', async () => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.checkOverlappingLeases(
        'C123',
        'P123',
        'U123',
        new Date('2025-01-01'),
        new Date('2026-01-01')
      );

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: {
            $in: [LeaseStatus.ACTIVE, LeaseStatus.PENDING_SIGNATURE, LeaseStatus.DRAFT],
          },
        })
      );
    });

    it('should enforce client isolation', async () => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.checkOverlappingLeases(
        'C123',
        'P123',
        'U123',
        new Date('2025-01-01'),
        new Date('2026-01-01')
      );

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ cuid: 'C123' })
      );
    });

    it('should check for unit-level lease overlaps when unitId is provided', async () => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.checkOverlappingLeases(
        'C123',
        'P123',
        'U123',
        new Date('2025-01-01'),
        new Date('2026-01-01')
      );

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          'property.unitId': 'U123',
        })
      );
    });

    it('should check for property-level lease overlaps when unitId is undefined', async () => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.checkOverlappingLeases(
        'C123',
        'P123',
        undefined,
        new Date('2025-01-01'),
        new Date('2026-01-01')
      );

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          'property.id': 'P123',
          'property.unitId': { $exists: false },
        })
      );
    });
  });

  describe('getActiveLeaseByTenant', () => {
    it('should return active lease for tenant', async () => {
      const tenantId = new Types.ObjectId().toString();
      const mockLease = {
        _id: 'L123',
        tenantId,
        status: LeaseStatus.ACTIVE,
      };

      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockLease),
      };

      mockLeaseModel.findOne.mockReturnValue(mockQuery);

      const result = await leaseDAO.getActiveLeaseByTenant('C123', tenantId);

      expect(result).toEqual(mockLease);
      expect(mockLeaseModel.findOne).toHaveBeenCalledWith({
        cuid: 'C123',
        tenantId,
        status: LeaseStatus.ACTIVE,
        deletedAt: null,
      });
    });

    it('should return null if no active lease', async () => {
      const tenantId = new Types.ObjectId().toString();
      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      };

      mockLeaseModel.findOne.mockReturnValue(mockQuery);

      const result = await leaseDAO.getActiveLeaseByTenant('C123', tenantId);

      expect(result).toBeNull();
    });
  });

  describe('getActiveLeaseByUnit', () => {
    it('should return active lease for unit', async () => {
      const unitId = new Types.ObjectId().toString();
      const mockLease = {
        _id: 'L123',
        property: { unitId },
        status: LeaseStatus.ACTIVE,
      };

      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockLease),
      };

      mockLeaseModel.findOne.mockReturnValue(mockQuery);

      const result = await leaseDAO.getActiveLeaseByUnit('C123', unitId);

      expect(result).toEqual(mockLease);
      expect(mockLeaseModel.findOne).toHaveBeenCalledWith({
        cuid: 'C123',
        'property.unitId': unitId,
        status: LeaseStatus.ACTIVE,
        deletedAt: null,
      });
    });
  });

  describe('getExpiringLeases', () => {
    it('should return leases expiring within X days', async () => {
      const mockLeases = [
        { _id: 'L1', duration: { endDate: new Date('2025-01-15') } },
        { _id: 'L2', duration: { endDate: new Date('2025-01-20') } },
      ];

      const mockQuery = createQueryMock(mockLeases);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      const result = await leaseDAO.getExpiringLeases('C123', 30);

      expect(result).toEqual(mockLeases);
      expect(mockQuery.sort).toHaveBeenCalledWith({ 'duration.endDate': 1 });
    });

    it('should only return active leases', async () => {
      const mockQuery = createQueryMock([]);
      mockLeaseModel.find.mockReturnValue(mockQuery);

      await leaseDAO.getExpiringLeases('C123', 30);

      expect(mockLeaseModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ status: LeaseStatus.ACTIVE })
      );
    });
  });

  describe('updateLeaseStatus', () => {
    it('should update lease status', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockUpdatedLease = { _id: leaseId, status: LeaseStatus.ACTIVE };
      const mockQuery = createQueryMock(mockUpdatedLease);

      mockLeaseModel.findOneAndUpdate.mockReturnValue(mockQuery);

      const result = await leaseDAO.updateLeaseStatus('C123', leaseId, LeaseStatus.ACTIVE);

      expect(result).toBe(true);
      expect(mockLeaseModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: leaseId, cuid: 'C123', deletedAt: null },
        { $set: { status: LeaseStatus.ACTIVE } },
        expect.any(Object)
      );
    });

    it('should return false if lease not found', async () => {
      const leaseId = new Types.ObjectId().toString();
      const mockQuery = createQueryMock(null);

      mockLeaseModel.findOneAndUpdate.mockReturnValue(mockQuery);

      const result = await leaseDAO.updateLeaseStatus('C123', leaseId, LeaseStatus.ACTIVE);

      expect(result).toBe(false);
    });
  });

  describe('terminateLease', () => {
    it('should set termination fields', async () => {
      const leaseId = new Types.ObjectId().toString();
      const terminationData = {
        terminationDate: new Date('2025-06-01'),
        terminationReason: 'Tenant moved out',
        moveOutDate: new Date('2025-05-31'),
        notes: 'Early termination',
      };

      const mockUpdatedLease = {
        _id: leaseId,
        status: LeaseStatus.TERMINATED,
        duration: { terminationDate: terminationData.terminationDate },
      };

      const mockQuery = createQueryMock(mockUpdatedLease);
      mockLeaseModel.findOneAndUpdate.mockReturnValue(mockQuery);

      const result = await leaseDAO.terminateLease('C123', leaseId, terminationData);

      expect(result).toEqual(mockUpdatedLease);
      expect(mockLeaseModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: leaseId, cuid: 'C123', deletedAt: null },
        {
          $set: expect.objectContaining({
            status: LeaseStatus.TERMINATED,
            'duration.terminationDate': terminationData.terminationDate,
            terminationReason: terminationData.terminationReason,
          }),
        },
        expect.objectContaining({ new: true })
      );
    });
  });

  describe('getLeaseStats', () => {
    it('should return comprehensive statistics', async () => {
      // Mock countDocuments to return chainable query
      let countCallCount = 0;
      const countValues = [10, 2, 4, 6, 10, 8];
      mockLeaseModel.countDocuments.mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(countValues[countCallCount++] || 0),
      }));

      // Mock aggregate to return chainable query
      let aggCallCount = 0;
      const aggValues = [
        [
          { _id: 'active', count: 7 },
          { _id: 'draft', count: 2 },
          { _id: 'expired', count: 1 },
        ],
        [{ avgDurationMs: 31536000000 }],
        [{ totalRent: 15000 }],
      ];
      mockLeaseModel.aggregate.mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(aggValues[aggCallCount++] || []),
      }));

      const result = await leaseDAO.getLeaseStats('C123');

      expect(result).toHaveProperty('totalLeases');
      expect(result).toHaveProperty('leasesByStatus');
      expect(result).toHaveProperty('totalMonthlyRent');
      expect(result).toHaveProperty('averageLeaseDuration');
      expect(result).toHaveProperty('occupancyRate');
      expect(result).toHaveProperty('expiringIn30Days');
      expect(result).toHaveProperty('expiringIn60Days');
      expect(result).toHaveProperty('expiringIn90Days');
    });
  });

  describe('getRentRollData', () => {
    it('should return rent roll with joined data', async () => {
      const mockRentRoll = [
        {
          leaseId: 'L123',
          luid: 'L-2025-123',
          leaseNumber: 'LEASE-001',
          status: LeaseStatus.ACTIVE,
          tenantName: 'John Doe',
          tenantEmail: 'john@example.com',
          propertyName: 'Sunset Apartments',
          propertyAddress: '123 Main St',
          unitNumber: '101',
          monthlyRent: 1500,
          securityDeposit: 3000,
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
          daysUntilExpiry: 365,
        },
      ];

      const mockQuery = {
        exec: jest.fn().mockResolvedValue(mockRentRoll),
      };

      mockLeaseModel.aggregate.mockReturnValue(mockQuery);

      const result = await leaseDAO.getRentRollData('C123');

      expect(result).toEqual(mockRentRoll);
      expect(mockLeaseModel.aggregate).toHaveBeenCalled();
    });

    it('should filter by propertyId if provided', async () => {
      const propertyId = 'P123';
      const mockQuery = {
        exec: jest.fn().mockResolvedValue([]),
      };

      mockLeaseModel.aggregate.mockReturnValue(mockQuery);

      await leaseDAO.getRentRollData('C123', propertyId);

      const aggregateCall = mockLeaseModel.aggregate.mock.calls[0][0];
      const matchStage = aggregateCall.find((stage: any) => stage.$match);

      expect(matchStage).toBeDefined();
      expect(matchStage.$match['property.id']).toBe(propertyId);
    });
  });

  describe('Client Isolation', () => {
    it('should not return leases from other clients', async () => {
      const mockQuery = {
        populate: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      };

      mockLeaseModel.findOne.mockReturnValue(mockQuery);

      await leaseDAO.getLeaseById('C123', 'L999');

      expect(mockLeaseModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ cuid: 'C123' })
      );
    });

    it('should not allow updates to other clients leases', async () => {
      const mockQuery = createQueryMock(null);
      mockLeaseModel.findOneAndUpdate.mockReturnValue(mockQuery);

      await leaseDAO.updateLease('C123', 'L999', {});

      expect(mockLeaseModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ cuid: 'C123' }),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should not allow deletion of other clients leases', async () => {
      const mockQuery = createQueryMock(null);
      mockLeaseModel.findOneAndUpdate.mockReturnValue(mockQuery);

      await leaseDAO.deleteLease('C123', 'L999');

      expect(mockLeaseModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ cuid: 'C123' }),
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  // PDF document status updates are tested through integration tests
});
