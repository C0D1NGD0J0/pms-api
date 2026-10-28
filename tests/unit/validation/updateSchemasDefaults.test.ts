jest.mock('@di/setup', () => ({
  container: {
    cradle: { propertyDAO: { findFirst: jest.fn() }, propertyUnitDAO: { findFirst: jest.fn() } },
  },
}));

import { z } from 'zod';
import { partialWithoutDefaults } from '@shared/validations/UtilsValidation';
import { UpdatePropertySchema } from '@shared/validations/PropertyValidation/schema';
import { UpdateUnitSchema } from '@shared/validations/PropertyUnitValidation/schemas';
import { UpdateLeaseSchema, RenewLeaseSchema } from '@shared/validations/LeaseValidation/schemas';

// Zod 4 fills `.default()` values even on optional fields; a PATCH that leaves a field out
// must not write the create-time default over the stored value.
describe('update schemas leave omitted fields undefined', () => {
  it('partialWithoutDefaults drops defaults but keeps them on the source schema', () => {
    const source = z.object({ status: z.string().default('active'), name: z.string() });

    expect(partialWithoutDefaults(source).parse({})).toEqual({});
    expect(source.parse({ name: 'x' })).toEqual({ name: 'x', status: 'active' });
  });

  it('UpdatePropertySchema adds no status or unit-count defaults', async () => {
    const result = await UpdatePropertySchema.parseAsync({ name: 'Harbour View' });

    expect(result).toEqual({ name: 'Harbour View' });
  });

  it('UpdateUnitSchema adds no fee or specification defaults', () => {
    const result = UpdateUnitSchema.parse({
      fees: { rentAmount: 1200 },
      specifications: { totalArea: 80 },
    });

    expect(result.fees).toEqual({ rentAmount: 1200 });
    expect(result.specifications).toEqual({ totalArea: 80 });
  });

  it.each([
    ['UpdateLeaseSchema', UpdateLeaseSchema],
    ['RenewLeaseSchema', RenewLeaseSchema],
  ])('%s adds no autoRenew default', async (_name, schema) => {
    const result = await (schema as z.ZodType).parseAsync({
      renewalOptions: { noticePeriodDays: 30 },
    });

    expect((result as { renewalOptions: unknown }).renewalOptions).toEqual({
      noticePeriodDays: 30,
    });
  });
});

describe('zod 3 compatible messages', () => {
  it('reports a missing enum as Required and a wrongly typed one by type', () => {
    const schema = z.object({ kind: z.enum(['a', 'b']) });

    expect(schema.safeParse({}).error?.issues[0].message).toBe('Required');
    expect(schema.safeParse({ kind: 1 }).error?.issues[0].message).toBe(
      "Expected 'a' | 'b', received integer"
    );
    expect(schema.safeParse({ kind: 'c' }).error?.issues[0].message).toBe(
      "Invalid enum value. Expected 'a' | 'b', received 'c'"
    );
  });
});
