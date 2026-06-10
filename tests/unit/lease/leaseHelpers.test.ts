import { LeaseStatus } from '@interfaces/lease.interface';
import { ValidationRequestError } from '@shared/customErrors';
import {
  hasSignatureInvalidatingChanges,
  validateImmutableFields,
  validateAllowedFields,
  hasHighImpactChanges,
} from '@services/lease/leaseHelpers';

describe('Lease Helpers', () => {
  describe('validateImmutableFields', () => {
    it('should pass when no immutable fields updated', () => {
      expect(() => validateImmutableFields({ internalNotes: [] })).not.toThrow();
    });

    it('should throw error for immutable field updates', () => {
      expect(() => validateImmutableFields({ tenantId: 'new-id' } as any)).toThrow(
        ValidationRequestError
      );
    });
  });

  describe('validateAllowedFields', () => {
    it('should allow all fields for DRAFT status', () => {
      expect(() =>
        validateAllowedFields({ fees: { rentAmount: 1000 } } as any, LeaseStatus.DRAFT)
      ).not.toThrow();
    });

    it('should reject disallowed fields for ACTIVE status', () => {
      expect(() =>
        validateAllowedFields({ fees: { rentAmount: 1000 } } as any, LeaseStatus.ACTIVE)
      ).toThrow(ValidationRequestError);
    });

    it('should allow internalNotes for ACTIVE status', () => {
      expect(() =>
        validateAllowedFields({ internalNotes: [] }, LeaseStatus.ACTIVE)
      ).not.toThrow();
    });
  });

  describe('hasHighImpactChanges', () => {
    it('should return true for property changes', () => {
      expect(hasHighImpactChanges({ property: { id: 'prop-123' } } as any)).toBe(true);
    });

    it('should return true for fees changes', () => {
      expect(hasHighImpactChanges({ fees: { rentAmount: 1500 } } as any)).toBe(true);
    });

    it('should return false for low-impact changes', () => {
      expect(hasHighImpactChanges({ internalNotes: [] } as any)).toBe(false);
    });
  });

  describe('hasSignatureInvalidatingChanges', () => {
    it('should return true for fees changes', () => {
      expect(hasSignatureInvalidatingChanges({ fees: { rentAmount: 1500 } } as any)).toBe(true);
    });

    it('should return true for duration changes', () => {
      expect(hasSignatureInvalidatingChanges({ duration: { monthCount: 24 } } as any)).toBe(true);
    });

    it('should return false for property changes', () => {
      expect(hasSignatureInvalidatingChanges({ property: { id: 'prop' } } as any)).toBe(false);
    });
  });
});
