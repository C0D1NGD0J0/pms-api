import { iterateInPages } from '@utils/helpers';

const makeDocs = (count: number, start = 0) =>
  Array.from({ length: count }, (_, i) => ({ _id: `id-${String(start + i).padStart(5, '0')}` }));

const collect = async <T>(iterator: AsyncGenerator<T>) => {
  const docs: T[] = [];
  for await (const doc of iterator) docs.push(doc);
  return docs;
};

describe('iterateInPages', () => {
  it('keeps paging when pageSize is above the 1000-row list() cap', async () => {
    const dao = {
      list: jest
        .fn()
        .mockResolvedValueOnce({ items: makeDocs(1000) })
        .mockResolvedValueOnce({ items: makeDocs(5, 1000) }),
    };

    const docs = await collect(iterateInPages(dao, { status: 'open' }, undefined, 1500));

    expect(docs).toHaveLength(1005);
    expect(dao.list).toHaveBeenCalledTimes(2);
    expect(dao.list.mock.calls[0][1]).toEqual(expect.objectContaining({ limit: 1000 }));
  });
});
