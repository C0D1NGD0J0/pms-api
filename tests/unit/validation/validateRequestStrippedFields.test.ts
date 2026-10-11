import { z } from 'zod';
import { Response, Request } from 'express';
import { collectStrippedPaths, validateRequest } from '@shared/validations/setup';

jest.mock('@services/index', () => ({}));
jest.mock('@utils/helpers', () => {
  const actual = jest.requireActual('@utils/helpers');
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { ...actual, createLogger: () => logger, __logger: logger };
});

const { __logger: mockLogger } = jest.requireMock('@utils/helpers');

const bodySchema = z.object({
  email: z.string(),
  address: z.object({ city: z.string() }),
  documents: z.array(z.object({ documentType: z.string() })),
});

const buildReq = (body: Record<string, any>) =>
  ({
    method: 'POST',
    originalUrl: '/api/v1/properties/abc123',
    body,
    query: {},
    params: {},
    container: { cradle: { emitterService: { emit: jest.fn() } } },
  }) as unknown as Request;

const runValidation = async (req: Request) => {
  const next = jest.fn();
  await validateRequest({ body: bodySchema })(req, {} as Response, next);
  return next;
};

describe('validateRequest — stripped field guardrail', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    mockLogger.warn.mockClear();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('warns once with the route and stripped paths, never the values', async () => {
    process.env.NODE_ENV = 'development';
    const req = buildReq({
      email: 'a@b.com',
      password: 'SuperSecret1!',
      address: { city: 'Toronto', unitNumber: '4B' },
      documents: [
        { documentType: 'deed', ssn: '123-45-6789' },
        { documentType: 'tax', ssn: '987-65-4321' },
      ],
    });

    const next = await runValidation(req);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({
      email: 'a@b.com',
      address: { city: 'Toronto' },
      documents: [{ documentType: 'deed' }, { documentType: 'tax' }],
    });
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    const [logged] = mockLogger.warn.mock.calls[0];
    expect(logged).toEqual({
      route: 'POST /api/v1/properties/abc123',
      strippedPaths: ['body.password', 'body.address.unitNumber', 'body.documents[].ssn'],
    });
    const serialized = JSON.stringify(mockLogger.warn.mock.calls);
    expect(serialized).not.toContain('SuperSecret1!');
    expect(serialized).not.toContain('123-45-6789');
    expect(serialized).not.toContain('4B');
  });

  it('stays silent when nothing was stripped', async () => {
    process.env.NODE_ENV = 'development';
    await runValidation(
      buildReq({ email: 'a@b.com', address: { city: 'Toronto' }, documents: [] })
    );

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('stays silent in production', async () => {
    process.env.NODE_ENV = 'production';
    const req = buildReq({
      email: 'a@b.com',
      password: 'x',
      address: { city: 'Toronto' },
      documents: [],
    });

    const next = await runValidation(req);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).not.toHaveProperty('password');
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('reports stripped query and params paths too', () => {
    const found = collectStrippedPaths({ cuid: 'c1', pid: 'p1' }, { cuid: 'c1' }, 'params');

    expect([...found]).toEqual(['params.pid']);
  });

  it('ignores keys whose value changed type through a transform', () => {
    const found = collectStrippedPaths(
      { when: { day: 1 }, list: 'a,b' },
      { when: new Date(), list: ['a', 'b'] },
      'body'
    );

    expect(found.size).toBe(0);
  });
});
