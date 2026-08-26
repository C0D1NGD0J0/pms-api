/**
 * ExpenseService — event emission tests
 *
 * Verifies that CRUD operations emit the correct events for
 * downstream metrics invalidation and SSE broadcasting.
 */
import { Types } from 'mongoose';

jest.mock('@di/index', () => ({ container: {} }));

import { EventTypes } from '@interfaces/events.interface';
import { ExpenseService } from '@services/expense/expense.service';

const CUID = 'TEST_CUID_001';
const USER_ID = new Types.ObjectId().toString();
const EXPUID = 'EXP_TEST_001';

const makeExpenseDoc = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  expuid: EXPUID,
  cuid: CUID,
  amount: 25000,
  category: 'repairs_maintenance',
  ...overrides,
});

const makeMockDAO = () => ({
  findByExpuid: jest.fn(),
  findByClient: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  findFirst: jest.fn(),
  aggregateByCategory: jest.fn(),
  aggregateByProperty: jest.fn(),
  aggregate: jest.fn(),
  getExpenseStats: jest.fn(),
});

const makeMockEmitter = () => ({
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
});

const makeService = (overrides: Record<string, any> = {}) => {
  const expenseDAO = overrides.expenseDAO ?? makeMockDAO();
  const emitterService = overrides.emitterService ?? makeMockEmitter();

  return {
    service: new ExpenseService({
      expenseDAO,
      propertyDAO: {
        findFirst: jest
          .fn()
          .mockReturnValue(Promise.resolve({ _id: new Types.ObjectId(), cuid: CUID })),
        aggregate: jest.fn().mockReturnValue(Promise.resolve([])),
      } as any,
      paymentDAO: {} as any,
      emitterService,
    }),
    expenseDAO,
    emitterService,
  };
};

describe('ExpenseService — event emission', () => {
  afterEach(() => jest.clearAllMocks());

  it('should emit EXPENSE_CREATED after creating an expense', async () => {
    const doc = makeExpenseDoc();
    const { service, expenseDAO, emitterService } = makeService();
    expenseDAO.insert.mockReturnValue(Promise.resolve(doc));

    await service.createExpense(CUID, USER_ID, {
      propertyId: new Types.ObjectId(),
      amount: 25000,
      category: 'repairs_maintenance' as any,
      date: new Date(),
      description: 'Test expense',
      paymentMethod: 'cash' as any,
      currency: 'USD',
    } as any);

    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.EXPENSE_CREATED,
      expect.objectContaining({
        expuid: EXPUID,
        cuid: CUID,
        amount: 25000,
        category: 'repairs_maintenance',
      })
    );
  });

  it('should emit EXPENSE_UPDATED after updating an expense', async () => {
    const doc = makeExpenseDoc();
    const { service, expenseDAO, emitterService } = makeService();
    expenseDAO.findByExpuid.mockReturnValue(Promise.resolve(doc));
    expenseDAO.update.mockReturnValue(Promise.resolve(doc));

    await service.updateExpense(EXPUID, CUID, { description: 'Updated' });

    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.EXPENSE_UPDATED,
      expect.objectContaining({ expuid: EXPUID, cuid: CUID })
    );
  });

  it('should emit EXPENSE_DELETED after soft-deleting an expense', async () => {
    const doc = makeExpenseDoc();
    const { service, expenseDAO, emitterService } = makeService();
    expenseDAO.findByExpuid.mockReturnValue(Promise.resolve(doc));
    expenseDAO.update.mockReturnValue(Promise.resolve(doc));

    await service.softDeleteExpense(EXPUID, CUID);

    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.EXPENSE_DELETED,
      expect.objectContaining({
        expuid: EXPUID,
        cuid: CUID,
        amount: 25000,
        category: 'repairs_maintenance',
      })
    );
  });

  it('should NOT emit events when expense is not found (delete)', async () => {
    const { service, expenseDAO, emitterService } = makeService();
    expenseDAO.findByExpuid.mockReturnValue(Promise.resolve(null));

    await expect(service.softDeleteExpense(EXPUID, CUID)).rejects.toThrow();
    expect(emitterService.emit).not.toHaveBeenCalled();
  });

  it('should NOT emit events when expense is not found (update)', async () => {
    const { service, expenseDAO, emitterService } = makeService();
    expenseDAO.findByExpuid.mockReturnValue(Promise.resolve(null));

    await expect(service.updateExpense(EXPUID, CUID, { description: 'x' })).rejects.toThrow();
    expect(emitterService.emit).not.toHaveBeenCalled();
  });
});
