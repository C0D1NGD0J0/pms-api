import mongoose from 'mongoose';
import { runSchemaSync } from '@database/schema-sync';

import {
  disconnectTestDatabase,
  setupTestDatabase,
  clearTestDatabase,
} from '../../setup/testDatabase';

const leases = () => mongoose.connection.db!.collection('leases');

const insertLease = async (renewalOptions: Record<string, unknown>) => {
  const { insertedId } = await leases().insertOne({ luid: `L-${Date.now()}`, renewalOptions });
  return insertedId;
};

const getRenewalOptions = async (id: mongoose.Types.ObjectId) =>
  (await leases().findOne({ _id: id }))?.renewalOptions;

describe('schema sync — renewalOptions.requireApproval → autoApproveRenewal', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  it('maps requireApproval=false to autoApproveRenewal=true and removes the old field', async () => {
    const id = await insertLease({ autoRenew: false, requireApproval: false });

    await runSchemaSync();

    const options = await getRenewalOptions(id);
    expect(options.autoApproveRenewal).toBe(true);
    expect(options).not.toHaveProperty('requireApproval');
  });

  it('keeps autoRenew leases auto-approved, as they were before the rename', async () => {
    const id = await insertLease({ autoRenew: true, requireApproval: true });

    await runSchemaSync();

    const options = await getRenewalOptions(id);
    expect(options.autoApproveRenewal).toBe(true);
    expect(options).not.toHaveProperty('requireApproval');
  });

  it('defaults other leases to autoApproveRenewal=false', async () => {
    const id = await insertLease({ autoRenew: false, requireApproval: true });

    await runSchemaSync();

    const options = await getRenewalOptions(id);
    expect(options.autoApproveRenewal).toBe(false);
    expect(options).not.toHaveProperty('requireApproval');
  });

  it('does not override an existing autoApproveRenewal value', async () => {
    const id = await insertLease({ autoRenew: true, autoApproveRenewal: false });

    await runSchemaSync();
    await runSchemaSync();

    expect((await getRenewalOptions(id)).autoApproveRenewal).toBe(false);
  });
});
