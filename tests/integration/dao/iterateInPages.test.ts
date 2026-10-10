import { BaseDAO } from '@dao/baseDAO';
import { iterateInPages } from '@utils/index';
import { Document, Schema, model } from 'mongoose';
import { clearTestDatabase } from '@tests/helpers';

interface IIterateTestDocument extends Document {
  status: string;
  seq: number;
}

const IterateTestModel = model<IIterateTestDocument>(
  'IterateInPagesTest',
  new Schema({ status: String, seq: Number })
);

const collect = async (iterator: AsyncGenerator<IIterateTestDocument>) => {
  const docs: IIterateTestDocument[] = [];
  for await (const doc of iterator) docs.push(doc);
  return docs;
};

describe('iterateInPages over a DAO', () => {
  const dao = new BaseDAO<IIterateTestDocument>(IterateTestModel);

  beforeEach(async () => {
    await clearTestDatabase();
    await IterateTestModel.insertMany(
      Array.from({ length: 25 }, (_, seq) => ({ status: seq % 5 === 0 ? 'closed' : 'open', seq }))
    );
  });

  it('yields every matching document across pages, beyond the list() default of 20', async () => {
    const docs = await collect(iterateInPages(dao, { status: 'open' }, undefined, 3));

    expect(docs).toHaveLength(20);
    expect(new Set(docs.map((doc) => doc.seq)).size).toBe(20);
    expect(docs.every((doc) => doc.status === 'open')).toBe(true);
  });

  it('keeps going when the caller updates documents so they stop matching', async () => {
    const seen: number[] = [];
    for await (const doc of iterateInPages(dao, { status: 'open' }, undefined, 4)) {
      seen.push(doc.seq);
      await IterateTestModel.updateOne({ _id: doc._id }, { status: 'processed' });
    }

    expect(seen).toHaveLength(20);
    expect(await IterateTestModel.countDocuments({ status: 'open' })).toBe(0);
  });

  it('applies the projection to each page', async () => {
    const [first] = await collect(iterateInPages(dao, {}, { projection: 'seq' }, 10));

    expect(first.seq).toBeDefined();
    expect(first.status).toBeUndefined();
  });
});
