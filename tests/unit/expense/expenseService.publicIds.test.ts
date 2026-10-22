/**
 * ExpenseService — public identifier boundary
 *
 * The API accepts pid/puid, resolves them to internal ObjectId refs scoped to the
 * client, and never exposes the internal propertyId/unitId refs in responses.
 */
import { Types } from 'mongoose';

jest.mock('@di/index', () => ({ container: {} }));
jest.mock('@di/setup', () => ({ container: { cradle: {} } }));

import { NotFoundError } from '@shared/customErrors';
import { ExpenseService } from '@services/expense/expense.service';
import { ExpenseValidations } from '@shared/validations/ExpenseValidation';

const CUID = 'TEST_CUID_001';
const PID = 'PROPERTYPID1';
const PUID = 'UNITPUID0001';
const EXPUID = 'EXP_TEST_001';
const USER_ID = new Types.ObjectId().toString();
const PROPERTY_ID = new Types.ObjectId();
const UNIT_ID = new Types.ObjectId();

const property = { _id: PROPERTY_ID, pid: PID, name: 'Maple Court', address: { city: 'X' } };
const unit = { _id: UNIT_ID, puid: PUID, unitNumber: '4B' };

const baseCreateInput = {
  amount: 25000,
  category: 'repairs_maintenance' as any,
  date: new Date('2026-05-01'),
  description: 'Boiler repair',
  paymentMethod: 'cash' as any,
  currency: 'USD',
};

const makeService = () => {
  const expenseDAO = {
    findByExpuid: jest.fn(),
    findByClient: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  };
  const propertyDAO = { findFirst: jest.fn().mockResolvedValue(property), aggregate: jest.fn() };
  const propertyUnitDAO = { findFirst: jest.fn().mockResolvedValue(unit) };
  const service = new ExpenseService({
    expenseDAO: expenseDAO as any,
    propertyDAO: propertyDAO as any,
    propertyUnitDAO: propertyUnitDAO as any,
    paymentDAO: {} as any,
    emitterService: { emit: jest.fn() } as any,
  });
  return { service, expenseDAO, propertyDAO, propertyUnitDAO };
};

const populatedExpense = (overrides: Record<string, any> = {}) => ({
  expuid: EXPUID,
  cuid: CUID,
  amount: 25000,
  propertyId: property,
  unitId: unit,
  ...overrides,
});

describe('ExpenseService — pid/puid boundary', () => {
  describe('createExpense', () => {
    it('resolves pid and puid to internal ObjectId refs scoped to the client', async () => {
      const { service, expenseDAO, propertyDAO, propertyUnitDAO } = makeService();
      expenseDAO.insert.mockResolvedValue({
        ...populatedExpense(),
        propertyId: PROPERTY_ID,
        unitId: UNIT_ID,
      });

      const result = await service.createExpense(CUID, USER_ID, {
        ...baseCreateInput,
        pid: PID,
        puid: PUID,
      });

      expect(propertyDAO.findFirst).toHaveBeenCalledWith({ pid: PID, cuid: CUID, deletedAt: null });
      expect(propertyUnitDAO.findFirst).toHaveBeenCalledWith({
        puid: PUID,
        cuid: CUID,
        deletedAt: null,
        propertyId: PROPERTY_ID,
      });
      const inserted = expenseDAO.insert.mock.calls[0][0];
      expect(inserted.propertyId).toBe(PROPERTY_ID);
      expect(inserted.unitId).toBe(UNIT_ID);
      expect(inserted).not.toHaveProperty('pid');
      expect(inserted).not.toHaveProperty('puid');

      expect(result.data).toMatchObject({
        pid: PID,
        puid: PUID,
        property: { pid: PID, name: 'Maple Court' },
        unit: { puid: PUID, unitNumber: '4B' },
      });
      expect(result.data).not.toHaveProperty('propertyId');
      expect(result.data).not.toHaveProperty('unitId');
    });

    it('throws NotFound for a pid outside the client', async () => {
      const { service, expenseDAO, propertyDAO } = makeService();
      propertyDAO.findFirst.mockResolvedValue(null);

      await expect(
        service.createExpense(CUID, USER_ID, { ...baseCreateInput, pid: PID })
      ).rejects.toThrow(NotFoundError);
      expect(expenseDAO.insert).not.toHaveBeenCalled();
    });

    it('throws NotFound for a puid that does not belong to the property', async () => {
      const { service, expenseDAO, propertyUnitDAO } = makeService();
      propertyUnitDAO.findFirst.mockResolvedValue(null);

      await expect(
        service.createExpense(CUID, USER_ID, { ...baseCreateInput, pid: PID, puid: PUID })
      ).rejects.toThrow(NotFoundError);
      expect(expenseDAO.insert).not.toHaveBeenCalled();
    });
  });

  describe('listExpenses', () => {
    it('translates pid/puid filters to internal ids and maps items to the public shape', async () => {
      const { service, expenseDAO } = makeService();
      expenseDAO.findByClient.mockResolvedValue({
        items: [populatedExpense()],
        pagination: { total: 1 },
      });

      const result = await service.listExpenses(CUID, { pid: PID, puid: PUID, page: 1 });

      const [, filters] = expenseDAO.findByClient.mock.calls[0];
      expect(filters).toEqual({
        page: 1,
        propertyId: PROPERTY_ID.toString(),
        unitId: UNIT_ID.toString(),
      });
      expect(result.data.items[0]).toMatchObject({ pid: PID, puid: PUID });
      expect(result.data.items[0]).not.toHaveProperty('propertyId');
      expect(result.data.pagination).toEqual({ total: 1 });
    });
  });

  describe('getExpenseById', () => {
    it('returns null unit refs when the expense has no unit', async () => {
      const { service, expenseDAO } = makeService();
      expenseDAO.findByExpuid.mockResolvedValue(populatedExpense({ unitId: null }));

      const result = await service.getExpenseById(EXPUID, CUID);

      expect(result.data.pid).toBe(PID);
      expect(result.data.unit).toBeNull();
      expect(result.data.puid).toBeUndefined();
    });
  });

  describe('updateExpense', () => {
    it('clears the unit when the property changes without a new puid', async () => {
      const { service, expenseDAO, propertyDAO } = makeService();
      const otherProperty = { _id: new Types.ObjectId(), pid: 'OTHER_PID_01', name: 'Elm' };
      propertyDAO.findFirst.mockResolvedValue(otherProperty);
      expenseDAO.findByExpuid.mockResolvedValue(populatedExpense());
      expenseDAO.update.mockResolvedValue(populatedExpense());

      await service.updateExpense(EXPUID, CUID, { pid: 'OTHER_PID_01' });

      const [, update] = expenseDAO.update.mock.calls[0];
      expect(update.$set.propertyId).toBe(otherProperty._id);
      expect(update.$set.unitId).toBeNull();
    });

    it('scopes a new puid to the expense’s current property', async () => {
      const { service, expenseDAO, propertyUnitDAO } = makeService();
      expenseDAO.findByExpuid.mockResolvedValue(populatedExpense({ unitId: null }));
      expenseDAO.update.mockResolvedValue(populatedExpense());

      await service.updateExpense(EXPUID, CUID, { puid: PUID });

      expect(propertyUnitDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ puid: PUID, cuid: CUID, propertyId: PROPERTY_ID })
      );
      const [, update] = expenseDAO.update.mock.calls[0];
      expect(update.$set.unitId).toBe(UNIT_ID);
      expect(update.$set).not.toHaveProperty('propertyId');
    });

    it('ignores raw propertyId/unitId in the payload', async () => {
      const { service, expenseDAO } = makeService();
      expenseDAO.findByExpuid.mockResolvedValue(populatedExpense());
      expenseDAO.update.mockResolvedValue(populatedExpense());

      await service.updateExpense(EXPUID, CUID, {
        description: 'Updated',
        propertyId: new Types.ObjectId(),
      } as any);

      const [, update] = expenseDAO.update.mock.calls[0];
      expect(update.$set).toEqual({ description: 'Updated' });
    });
  });
});

describe('ExpenseService — no ObjectIds in the expense response', () => {
  const AUTHOR_ID = new Types.ObjectId();
  const expenseDocument = () =>
    populatedExpense({
      _id: new Types.ObjectId(),
      id: 'virtual-id',
      __v: 0,
      createdBy: {
        _id: AUTHOR_ID,
        uid: 'AUTHORUID001',
        email: 'pm@example.com',
        profile: { personalInfo: { firstName: 'Pat', lastName: 'Manager' } },
      },
      receipt: {
        url: 'https://s3/receipt.pdf',
        filename: 'receipt.pdf',
        key: 'receipts/receipt.pdf',
        uploadedAt: new Date('2026-05-02'),
        uploadedBy: AUTHOR_ID,
      },
    });

  const collectObjectIds = (value: unknown, path = 'data'): string[] => {
    if (value instanceof Types.ObjectId) return [path];
    if (!value || typeof value !== 'object' || value instanceof Date) return [];
    return Object.entries(value).flatMap(([key, nested]) =>
      collectObjectIds(nested, `${path}.${key}`)
    );
  };

  it('exposes createdBy by uid and display name, and drops the expense _id and receipt uploader', async () => {
    const { service, expenseDAO } = makeService();
    expenseDAO.findByExpuid.mockResolvedValue(expenseDocument());

    const { data } = await service.getExpenseById(EXPUID, CUID);

    expect(data.createdBy).toEqual({ uid: 'AUTHORUID001', displayName: 'Pat Manager' });
    expect(data.receipt).toEqual({
      url: 'https://s3/receipt.pdf',
      filename: 'receipt.pdf',
      key: 'receipts/receipt.pdf',
      uploadedAt: new Date('2026-05-02'),
    });
    expect(data).not.toHaveProperty('_id');
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('__v');
    expect(data.expuid).toBe(EXPUID);
    expect(collectObjectIds(data)).toEqual([]);
  });

  it('falls back to the author email when the profile has no name', async () => {
    const { service, expenseDAO } = makeService();
    expenseDAO.findByClient.mockResolvedValue({
      items: [populatedExpense({ createdBy: { uid: 'AUTHORUID001', email: 'pm@example.com' } })],
      pagination: { total: 1 },
    });

    const { data } = await service.listExpenses(CUID, {});

    expect(data.items[0].createdBy).toEqual({ uid: 'AUTHORUID001', displayName: 'pm@example.com' });
  });

  it('re-reads the created expense so createdBy is public, not the raw ObjectId', async () => {
    const { service, expenseDAO } = makeService();
    expenseDAO.insert.mockResolvedValue({
      ...populatedExpense(),
      _id: new Types.ObjectId(),
      propertyId: PROPERTY_ID,
      createdBy: new Types.ObjectId(USER_ID),
    });
    expenseDAO.findByExpuid.mockResolvedValue(expenseDocument());

    const { data } = await service.createExpense(CUID, USER_ID, { ...baseCreateInput, pid: PID });

    expect(expenseDAO.findByExpuid).toHaveBeenCalledWith(EXPUID, CUID);
    expect(data.createdBy).toEqual({ uid: 'AUTHORUID001', displayName: 'Pat Manager' });
    expect(collectObjectIds(data)).toEqual([]);
  });

  it('returns createdBy null when the author ref is not populated', async () => {
    const { service, expenseDAO } = makeService();
    expenseDAO.findByExpuid.mockResolvedValue(
      populatedExpense({ createdBy: new Types.ObjectId() })
    );

    const { data } = await service.getExpenseById(EXPUID, CUID);

    expect(data.createdBy).toBeNull();
  });
});

describe('ExpenseService.getPnLSummary — properties by pid', () => {
  it('resolves every grouped property to its pid in one query and never sends propertyId', async () => {
    const incomePropertyId = new Types.ObjectId();
    const expenseOnlyPropertyId = new Types.ObjectId();
    const expenseDAO = {
      aggregateByCategory: jest
        .fn()
        .mockResolvedValue([{ _id: { currency: 'USD', category: 'utilities' }, total: 300 }]),
      aggregateByProperty: jest.fn().mockResolvedValue([
        { _id: { propertyId: incomePropertyId.toString(), currency: 'USD' }, total: 100 },
        { _id: { propertyId: expenseOnlyPropertyId.toString(), currency: 'USD' }, total: 200 },
      ]),
    };
    const paymentDAO = {
      getIncomeByPropertyAndCurrency: jest.fn().mockResolvedValue([
        {
          _id: { currency: 'USD', propertyId: incomePropertyId },
          total: 5000,
          propertyName: 'Maple Court',
        },
      ]),
    };
    const propertyDAO = {
      aggregate: jest.fn().mockResolvedValue([
        { _id: incomePropertyId, pid: 'MAPLEPID0001', name: 'Maple Court' },
        { _id: expenseOnlyPropertyId, pid: 'ELMPID000001', name: 'Elm House' },
      ]),
    };
    const service = new ExpenseService({
      expenseDAO: expenseDAO as any,
      propertyDAO: propertyDAO as any,
      propertyUnitDAO: {} as any,
      paymentDAO: paymentDAO as any,
      emitterService: { emit: jest.fn() } as any,
    });

    const { data } = await service.getPnLSummary(CUID, '2026-01-01', '2026-12-31');

    expect(propertyDAO.aggregate).toHaveBeenCalledTimes(1);
    const [{ $match }] = propertyDAO.aggregate.mock.calls[0][0];
    expect($match._id.$in.map(String).sort()).toEqual(
      [incomePropertyId.toString(), expenseOnlyPropertyId.toString()].sort()
    );

    const [usd] = data.byCurrency;
    expect(usd.income.byProperty).toEqual([
      { pid: 'MAPLEPID0001', name: 'Maple Court', amount: 5000 },
    ]);
    expect(usd.expenses.byProperty).toEqual([
      { pid: 'MAPLEPID0001', name: 'Maple Court', amount: 100 },
      { pid: 'ELMPID000001', name: 'Elm House', amount: 200 },
    ]);
    expect(JSON.stringify(data)).not.toContain('propertyId');
  });

  it('labels a property that no longer resolves as Unknown with no pid', async () => {
    const service = new ExpenseService({
      expenseDAO: {
        aggregateByCategory: jest.fn().mockResolvedValue([]),
        aggregateByProperty: jest
          .fn()
          .mockResolvedValue([
            { _id: { propertyId: new Types.ObjectId().toString(), currency: 'USD' }, total: 50 },
          ]),
      } as any,
      propertyDAO: { aggregate: jest.fn().mockResolvedValue([]) } as any,
      propertyUnitDAO: {} as any,
      paymentDAO: { getIncomeByPropertyAndCurrency: jest.fn().mockResolvedValue([]) } as any,
      emitterService: { emit: jest.fn() } as any,
    });

    const { data } = await service.getPnLSummary(CUID, '2026-01-01', '2026-12-31');

    expect(data.byCurrency[0].expenses.byProperty).toEqual([
      { pid: undefined, name: 'Unknown', amount: 50 },
    ]);
  });
});

describe('ExpenseValidations — public identifiers', () => {
  const validBody = {
    pid: PID,
    amount: 1000,
    category: 'utilities',
    date: '2026-05-01',
    description: 'Water bill',
    paymentMethod: 'cash',
  };

  it('accepts pid/puid on create', () => {
    expect(ExpenseValidations.createExpense.safeParse({ ...validBody, puid: PUID }).success).toBe(
      true
    );
  });

  it('requires pid on create', () => {
    const { pid: _pid, ...withoutPid } = validBody;
    expect(ExpenseValidations.createExpense.safeParse(withoutPid).success).toBe(false);
  });

  it('rejects a Mongo _id in place of a pid', () => {
    const result = ExpenseValidations.createExpense.safeParse({
      ...validBody,
      pid: '507f1f77bcf86cd799439011',
    });
    expect(result.success).toBe(false);
  });

  it('strips legacy propertyId/unitId fields', () => {
    const result = ExpenseValidations.updateExpense.safeParse({
      propertyId: '507f1f77bcf86cd799439011',
      unitId: '507f1f77bcf86cd799439012',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });

  it('accepts pid/puid list filters', () => {
    expect(ExpenseValidations.listExpensesQuery.safeParse({ pid: PID, puid: PUID }).success).toBe(
      true
    );
  });
});
