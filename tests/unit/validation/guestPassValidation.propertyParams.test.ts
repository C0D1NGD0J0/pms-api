import { GuestPassValidations } from '@shared/validations/GuestPassValidation';

const PID = 'Q7MNXK2PL9RT';
const OBJECT_ID = '507f1f77bcf86cd799439011';

describe('GuestPassValidations — property identifiers are pids', () => {
  it('accepts a pid as the propertyId route param', () => {
    const result = GuestPassValidations.propertyIdParam.safeParse({ propertyId: PID });

    expect(result.success).toBe(true);
  });

  it('rejects an empty propertyId route param', () => {
    const result = GuestPassValidations.propertyIdParam.safeParse({ propertyId: '' });

    expect(result.success).toBe(false);
  });

  it('accepts a pid as the unacknowledged-count propertyId query', () => {
    const result = GuestPassValidations.unacknowledgedCountQuery.safeParse({ propertyId: PID });

    expect(result.success).toBe(true);
  });

  it('keeps the unacknowledged-count propertyId query optional', () => {
    const result = GuestPassValidations.unacknowledgedCountQuery.safeParse({});

    expect(result.success).toBe(true);
  });

  it('no longer requires an ObjectId shape (the service looks properties up by pid)', () => {
    const asPid = GuestPassValidations.propertyIdParam.safeParse({ propertyId: PID });
    const asObjectId = GuestPassValidations.propertyIdParam.safeParse({ propertyId: OBJECT_ID });

    expect(asPid.success).toBe(true);
    // An ObjectId string is still a syntactically valid id — the pid lookup simply misses
    expect(asObjectId.success).toBe(true);
  });
});
