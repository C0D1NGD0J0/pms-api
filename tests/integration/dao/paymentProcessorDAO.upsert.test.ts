import { Types } from 'mongoose';
import { PaymentProcessor } from '@models/index';
import { clearTestDatabase } from '@tests/helpers';
import { PaymentProcessorDAO } from '@dao/paymentProcessorDAO';

// BaseDAO.upsert must hand back the saved document itself (not a { value, ok } wrapper),
// both when it inserts and when it updates. upsertForVendor is its main caller.
describe('PaymentProcessorDAO.upsertForVendor (BaseDAO.upsert)', () => {
  let dao: PaymentProcessorDAO;
  const firstClientId = new Types.ObjectId();

  beforeAll(() => {
    dao = new PaymentProcessorDAO({ paymentProcessorModel: PaymentProcessor });
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('creates the vendor processor and returns the saved document', async () => {
    const saved = await dao.upsertForVendor({
      vuid: 'VENDOR_1',
      cuid: 'CLIENT_A',
      client: firstClientId,
      accountId: 'acct_vendor_1',
      chargesEnabled: false,
    } as any);

    expect(saved).not.toBeNull();
    expect(saved).not.toHaveProperty('value');
    expect(saved?._id).toBeDefined();
    expect(saved?.ppuid).toEqual(expect.any(String));
    expect(saved?.accountId).toBe('acct_vendor_1');
    expect(saved?.ownerType).toBe('vendor');
    expect(saved?.cuid).toBe('CLIENT_A');
  });

  it('updates status fields and returns the updated document, keeping the first client', async () => {
    const first = await dao.upsertForVendor({
      vuid: 'VENDOR_1',
      cuid: 'CLIENT_A',
      client: firstClientId,
      accountId: 'acct_vendor_1',
      chargesEnabled: false,
    } as any);

    // The same vendor is connected through a second client later
    const updated = await dao.upsertForVendor({
      vuid: 'VENDOR_1',
      cuid: 'CLIENT_B',
      client: new Types.ObjectId(),
      accountId: 'acct_vendor_1',
      chargesEnabled: true,
      payoutsEnabled: true,
    } as any);

    expect(updated?._id.toString()).toBe(first?._id.toString());
    expect(updated?.chargesEnabled).toBe(true);
    expect(updated?.payoutsEnabled).toBe(true);
    // $setOnInsert fields are not overwritten by the second client
    expect(updated?.cuid).toBe('CLIENT_A');
    expect(updated?.client.toString()).toBe(firstClientId.toString());
    expect(await PaymentProcessor.countDocuments({ vuid: 'VENDOR_1' })).toBe(1);
  });
});
