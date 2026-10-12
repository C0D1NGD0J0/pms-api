import { z } from 'zod';
import { Response, Request } from 'express';
import { envVariables } from '@shared/config';
import { validateRequest } from '@shared/validations/setup';
import { collectStrippedPaths } from '@shared/validations/strippedPaths';
import { GuestPassValidations } from '@shared/validations/GuestPassValidation';
import { MaintenanceSchemas } from '@shared/validations/MaintenanceRequestValidation/schemas';

jest.mock('@services/index', () => ({}));
jest.mock('@di/setup', () => ({ container: { cradle: {} } }));
jest.mock('@utils/helpers', () => {
  const actual = jest.requireActual('@utils/helpers');
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { ...actual, createLogger: () => logger, __logger: logger };
});

const { __logger: mockLogger } = jest.requireMock('@utils/helpers');

const run = async (schema: Parameters<typeof validateRequest>[0], req: Partial<Request>) => {
  const fullReq = {
    method: 'POST',
    originalUrl: '/api/v1/properties/abc123',
    body: {},
    query: {},
    params: {},
    container: { cradle: { emitterService: { emit: jest.fn() } } },
    ...req,
  } as unknown as Request;
  const next = jest.fn();
  await validateRequest(schema)(fullReq, {} as Response, next);
  return { req: fullReq, next };
};

describe('validateRequest', () => {
  const originalEnv = envVariables.SERVER.ENV;
  const bodySchema = z.object({ email: z.string(), address: z.object({ city: z.string() }) });

  beforeEach(() => mockLogger.warn.mockClear());
  afterEach(() => (envVariables.SERVER.ENV = originalEnv));

  it('strips undeclared body fields and warns with their paths, never the values', async () => {
    envVariables.SERVER.ENV = 'dev';
    const body = { email: 'a@b.com', password: 'Secret1!', address: { city: 'T', unit: '4B' } };
    const { req, next } = await run({ body: bodySchema }, { body });

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ email: 'a@b.com', address: { city: 'T' } });
    expect(mockLogger.warn.mock.calls[0][0]).toEqual({
      route: 'POST /api/v1/properties/abc123',
      strippedPaths: ['body.password', 'body.address.unit'],
    });
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain('Secret1!');
  });

  it('does not warn in production', async () => {
    envVariables.SERVER.ENV = 'production';
    await run(
      { body: bodySchema },
      { body: { email: 'a', password: 'x', address: { city: 'T' } } }
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('keeps params inherited via mergeParams that the schema does not declare', async () => {
    const { req } = await run(
      { params: z.object({ cuid: z.string().trim() }) },
      { params: { cuid: ' c1 ', pid: 'p1' } }
    );
    expect(req.params).toEqual({ cuid: 'c1', pid: 'p1' });
  });
});

describe('collectStrippedPaths', () => {
  it('collapses array indices and ignores values reshaped by a transform', () => {
    const raw = { docs: [{ type: 'a', ssn: '1' }, { ssn: '2' }], when: { day: 1 }, list: 'a,b' };
    const parsed = { docs: [{ type: 'a' }, {}], when: new Date(), list: ['a', 'b'] };
    expect([...collectStrippedPaths(raw, parsed, 'body')]).toEqual(['body.docs[].ssn']);
  });
});

describe('schemas keep the fields services rely on', () => {
  it('maintenance assignmentBody keeps a valid technician.userId and rejects a malformed one', () => {
    const userId = '507f1f77bcf86cd799439011';
    const parse = (id: string) =>
      MaintenanceSchemas.assignmentBody.parse({
        action: 'accept',
        technician: { name: 'T', userId: id },
      });
    expect(parse(userId).technician?.userId).toBe(userId);
    expect(() => parse('not-an-id')).toThrow('Must be a valid ID');
  });

  it('guest pass createPass keeps host fields and treats blank inputs as missing', () => {
    const base = { propertyId: 'PID123', visitorName: 'V', sendViaSms: true, sendViaEmail: false };
    const parse = (extra: Record<string, unknown>) =>
      GuestPassValidations.createPass.parse({ ...base, visitorPhone: '+15555550100', ...extra });

    expect(parse({ hostName: ' Rita ', hostPhone: '+1 (555) 010-0200' })).toMatchObject({
      hostName: 'Rita',
      hostPhone: '+1 (555) 010-0200',
    });
    expect(parse({ unitId: '', hostPhone: '', purpose: '' })).toMatchObject({
      unitId: undefined,
      hostPhone: undefined,
      purpose: undefined,
    });
    expect(() => parse({ hostPhone: '1'.repeat(21) })).toThrow();
    expect(() => parse({ expiryMinutes: 90 })).toThrow();
  });
});
