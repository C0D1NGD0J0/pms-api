import { BaseDAO } from '@dao/baseDAO';
import { Document, Schema, model } from 'mongoose';
import { clearTestDatabase } from '@tests/helpers';

interface IPaginationTestDocument extends Document {
  seq: number;
}

const PaginationTestModel = model<IPaginationTestDocument>(
  'BaseDAOPaginationTest',
  new Schema({ seq: Number })
);

describe('BaseDAO.list pagination metadata', () => {
  const dao = new BaseDAO<IPaginationTestDocument>(PaginationTestModel);

  beforeEach(async () => {
    await clearTestDatabase();
    await PaginationTestModel.insertMany(Array.from({ length: 25 }, (_, seq) => ({ seq })));
  });

  it('reports the default page size it actually returns when no limit is given', async () => {
    const result = await dao.list({});

    expect(result.items).toHaveLength(20);
    expect(result.pagination).toMatchObject({
      total: 25,
      perPage: 20,
      totalPages: 2,
      currentPage: 1,
      hasMoreResource: true,
    });
  });

  it('reports the requested page size and page from skip', async () => {
    const result = await dao.list({}, { skip: 10, limit: 5 });

    expect(result.items).toHaveLength(5);
    expect(result.pagination).toMatchObject({ perPage: 5, totalPages: 5, currentPage: 3 });
  });

  it('reports the capped page size when the requested limit exceeds the maximum', async () => {
    const result = await dao.list({}, { limit: 5000 });

    expect(result.items).toHaveLength(25);
    expect(result.pagination).toMatchObject({ perPage: 1000, totalPages: 1 });
  });
});
