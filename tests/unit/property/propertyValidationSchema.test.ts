import { UpdatePropertySchema } from '@shared/validations/PropertyValidation/schema';

// UpdatePropertySchema is CreatePropertySchema.partial() with no async superRefine,
// so it exercises the same coercion logic without touching the DB uniqueness check.
describe('PropertyValidation schema — FormData coercion', () => {
  describe('specifications numeric coercion', () => {
    it('coerces numeric strings to numbers', () => {
      const result = UpdatePropertySchema.safeParse({
        specifications: { totalArea: '1500', bedrooms: '3', floors: '2' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.specifications).toEqual(
          expect.objectContaining({ totalArea: 1500, bedrooms: 3, floors: 2 })
        );
      }
    });

    it('treats an empty string as undefined instead of failing optional validation', () => {
      const result = UpdatePropertySchema.safeParse({
        specifications: { totalArea: '', bedrooms: '4' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.specifications?.totalArea).toBeUndefined();
        expect(result.data.specifications?.bedrooms).toBe(4);
      }
    });

    it('accepts a fractional lot size (e.g. 0.25 acres)', () => {
      const result = UpdatePropertySchema.safeParse({
        specifications: { lotSize: '0.25' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.specifications?.lotSize).toBe(0.25);
      }
    });

    it('still rejects values that violate field constraints once coerced', () => {
      const result = UpdatePropertySchema.safeParse({
        specifications: { bedrooms: '-1' },
      });

      expect(result.success).toBe(false);
    });
  });

  describe('fees numeric coercion with defaults', () => {
    it('falls back to the default when the string is empty', () => {
      const result = UpdatePropertySchema.safeParse({
        fees: { rentAmount: '', managementFees: '500', securityDeposit: '1000' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fees).toEqual(
          expect.objectContaining({ rentAmount: 0, managementFees: 500, securityDeposit: 1000 })
        );
      }
    });

    it('rejects negative fee amounts once coerced to a number', () => {
      const result = UpdatePropertySchema.safeParse({
        fees: { rentAmount: '-50' },
      });

      expect(result.success).toBe(false);
    });
  });

  describe('boolean coercion for utilities/amenities checkboxes', () => {
    it('coerces the string "true"/"false" sent by FormData to real booleans', () => {
      const result = UpdatePropertySchema.safeParse({
        utilities: { water: 'true', gas: 'false', electricity: true },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.utilities).toEqual(
          expect.objectContaining({ water: true, gas: false, electricity: true })
        );
      }
    });

    it('defaults unset checkbox fields to false', () => {
      const result = UpdatePropertySchema.safeParse({ utilities: {} });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.utilities).toEqual(
          expect.objectContaining({ water: false, gas: false, electricity: false })
        );
      }
    });
  });

  describe('owner email', () => {
    it('accepts an empty string (blank form field) instead of failing email validation', () => {
      const result = UpdatePropertySchema.safeParse({
        owner: { type: 'external_owner', email: '' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.owner?.email).toBe('');
      }
    });

    it('still rejects a malformed, non-empty email', () => {
      const result = UpdatePropertySchema.safeParse({
        owner: { type: 'external_owner', email: 'not-an-email' },
      });

      expect(result.success).toBe(false);
    });
  });

  describe('document type enum', () => {
    it.each(['authorization_letter', 'proof_of_ownership', 'management_agreement'])(
      'accepts the new "%s" document type',
      (documentType) => {
        const result = UpdatePropertySchema.safeParse({
          documents: [
            { documentType, url: 'https://cdn.example.com/doc.pdf', uploadedBy: 'user-1' },
          ],
        });

        expect(result.success).toBe(true);
      }
    );

    it('rejects an unsupported document type', () => {
      const result = UpdatePropertySchema.safeParse({
        documents: [
          {
            documentType: 'not-a-real-type',
            url: 'https://cdn.example.com/doc.pdf',
            uploadedBy: 'user-1',
          },
        ],
      });

      expect(result.success).toBe(false);
    });
  });
});
