import {
  CreatePropertySchema,
  UpdatePropertySchema,
  UnassignStaffSchema,
  AssignStaffSchema,
} from '@shared/validations/PropertyValidation/schema';

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

  describe('multipart media entries for files uploaded in the request', () => {
    it('accepts document entries without url/uploadedBy and keeps their documentType', () => {
      const result = UpdatePropertySchema.safeParse({
        documents: [{ documentType: 'deed', externalUrl: '' }],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.documents?.[0]).toEqual(
          expect.objectContaining({ documentType: 'deed', status: 'active' })
        );
        expect(result.data.documents?.[0].url).toBeUndefined();
        expect(result.data.documents?.[0].externalUrl).toBeUndefined();
      }
    });

    it('fills index gaps left by entries that only carried a file', () => {
      const documents: any[] = [];
      documents[1] = { documentType: 'tax' };

      const result = UpdatePropertySchema.safeParse({ documents });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.documents).toHaveLength(2);
        expect(result.data.documents?.[1].documentType).toBe('tax');
      }
    });

    it('still validates url when present', () => {
      const result = UpdatePropertySchema.safeParse({
        images: [{ url: 'not-a-url' }],
      });

      expect(result.success).toBe(false);
    });

    it('still caps images at 5', () => {
      const images = Array.from({ length: 6 }, () => ({ url: 'https://cdn.example.com/a.png' }));

      expect(UpdatePropertySchema.safeParse({ images }).success).toBe(false);
    });

    it('keeps an _id on existing images, documents and notes', () => {
      const _id = '507f1f77bcf86cd799439011';
      const result = UpdatePropertySchema.safeParse({
        images: [{ _id, url: 'https://cdn.example.com/a.png' }],
        documents: [{ _id, url: 'https://cdn.example.com/d.pdf' }],
        notes: [{ _id, text: 'hello', author: { uid: 'u1', name: 'Ana' } }],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.images?.[0]._id).toBe(_id);
        expect(result.data.documents?.[0]._id).toBe(_id);
        expect(result.data.notes?.[0]._id).toBe(_id);
      }
    });

    it('rejects a malformed _id', () => {
      expect(
        UpdatePropertySchema.safeParse({
          images: [{ _id: 'abc', url: 'https://cdn.example.com/a.png' }],
        }).success
      ).toBe(false);
    });
  });

  describe('address.unitNumber', () => {
    it('is kept on update', () => {
      const result = UpdatePropertySchema.safeParse({
        address: { fullAddress: '12 Elm Street, Toronto', streetNumber: '12', unitNumber: ' 4B ' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.address?.unitNumber).toBe('4B');
      }
    });
  });

  describe('assignedStaff and managedBy on create (user uids)', () => {
    const baseCreate = {
      name: 'Elm Street',
      propertyType: 'house',
      managedBy: 'MANAGER00001',
      description: { text: 'Nice' },
      cuid: 'client-1',
      specifications: {},
      fees: {},
      address: { fullAddress: '12 Elm Street, Toronto', streetNumber: '12', unitNumber: '4B' },
    };
    const staffId = (n: number) => `STAFFUID00${String(n).padStart(2, '0')}`;

    it('keeps assignedStaff and address.unitNumber', () => {
      const result = CreatePropertySchema.safeParse({
        ...baseCreate,
        assignedStaff: [staffId(20), staffId(21)],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assignedStaff).toEqual([staffId(20), staffId(21)]);
        expect(result.data.address.unitNumber).toBe('4B');
      }
    });

    it('rejects staff ids that are not user uids, including ObjectIds', () => {
      for (const staff of ['nope', '507f1f77bcf86cd799439011']) {
        expect(
          CreatePropertySchema.safeParse({ ...baseCreate, assignedStaff: [staff] }).success
        ).toBe(false);
      }
    });

    it('rejects an ObjectId manager and treats a blank one as unset', () => {
      expect(
        CreatePropertySchema.safeParse({ ...baseCreate, managedBy: '507f1f77bcf86cd799439011' })
          .success
      ).toBe(false);

      const blank = CreatePropertySchema.safeParse({ ...baseCreate, managedBy: '' });
      expect(blank.success).toBe(true);
      if (blank.success) expect(blank.data.managedBy).toBeUndefined();
    });

    it('rejects more than 10 staff', () => {
      const assignedStaff = Array.from({ length: 11 }, (_, i) => staffId(i + 20));

      expect(CreatePropertySchema.safeParse({ ...baseCreate, assignedStaff }).success).toBe(false);
    });

    it('is not accepted on update (assign/unassign endpoints own it)', () => {
      const result = UpdatePropertySchema.safeParse({ assignedStaff: [staffId(20)] });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('assignedStaff');
      }
    });
  });

  describe('assign/unassign staff body', () => {
    it.each([
      ['AssignStaffSchema', AssignStaffSchema],
      ['UnassignStaffSchema', UnassignStaffSchema],
    ])('%s takes a user uid, not an ObjectId', (_name, schema) => {
      expect(schema.safeParse({ uid: 'STAFFUID0001' }).success).toBe(true);
      expect(schema.safeParse({ uid: '507f1f77bcf86cd799439011' }).success).toBe(false);
      expect(schema.safeParse({ userId: '507f1f77bcf86cd799439011' }).success).toBe(false);
    });
  });
});
