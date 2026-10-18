import { MaintenanceSchemas } from '@shared/validations/MaintenanceRequestValidation/schemas';

jest.mock('@di/setup', () => ({ container: { cradle: {} } }));

// Query strings arrive as text, so 'false' must not be coerced to true
describe('MaintenanceSchemas.listQuery', () => {
  const parse = (query: Record<string, string>) => MaintenanceSchemas.listQuery.parse(query);

  it.each([
    ['true', true],
    ['false', false],
  ])('reads isBillable=%s as %s', (raw, expected) => {
    expect(parse({ isBillable: raw }).isBillable).toBe(expected);
  });

  it('leaves isBillable unset when it is not sent', () => {
    expect(parse({}).isBillable).toBeUndefined();
  });

  it('rejects an isBillable value that is not true or false', () => {
    expect(() => parse({ isBillable: 'yes' })).toThrow();
  });

  it('keeps a whitelisted sort so it reaches the service', () => {
    expect(parse({ sort: '-createdAt' }).sort).toBe('-createdAt');
    expect(parse({ sort: 'title' }).sort).toBe('title');
  });

  it('rejects a sort on a field outside the whitelist', () => {
    expect(() => parse({ sort: 'tenantId' })).toThrow();
  });

  it('keeps page and limit as numbers', () => {
    expect(parse({ page: '3', limit: '25' })).toMatchObject({ page: 3, limit: 25 });
  });
});
