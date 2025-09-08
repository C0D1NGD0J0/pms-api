import { InvitationValidations } from '@shared/validations/InvitationValidation';

describe('InvitationValidations', () => {
  describe('linkedVendorUid validation', () => {
    const schema = InvitationValidations.invitationCsv;

    it('should accept valid vendor UIDs with old format (A-Z0-9)', async () => {
      const validData = {
        inviteeEmail: 'test@example.com',
        role: 'vendor',
        firstName: 'Test',
        lastName: 'User',
        status: 'pending',
        linkedVendorUid: 'GNTM8EMXMA2Z',
        cuid: 'test-client',
      };

      const result = await schema.safeParseAsync(validData);
      expect(result.success).toBe(true);
    });

    it('should accept valid vendor UIDs with dashes', async () => {
      const validData = {
        inviteeEmail: 'test@example.com',
        role: 'vendor',
        firstName: 'Test',
        lastName: 'User',
        status: 'pending',
        linkedVendorUid: 'BQ--E29IUASZ',
        cuid: 'test-client',
      };

      const result = await schema.safeParseAsync(validData);
      expect(result.success).toBe(true);
    });

    it('should accept valid vendor UIDs with underscores', async () => {
      const validData = {
        inviteeEmail: 'test@example.com',
        role: 'vendor',
        firstName: 'Test',
        lastName: 'User',
        status: 'pending',
        linkedVendorUid: '__PV4RILXPLT',
        cuid: 'test-client',
      };

      const result = await schema.safeParseAsync(validData);
      expect(result.success).toBe(true);
    });

    it('should accept valid MongoDB ObjectIds', async () => {
      const validData = {
        inviteeEmail: 'test@example.com',
        role: 'vendor',
        firstName: 'Test',
        lastName: 'User',
        status: 'pending',
        linkedVendorUid: '507f1f77bcf86cd799439011',
        cuid: 'test-client',
      };

      const result = await schema.safeParseAsync(validData);
      expect(result.success).toBe(true);
    });

    it('should reject vendor UIDs that are too long', async () => {
      const invalidData = {
        inviteeEmail: 'test@example.com',
        role: 'vendor',
        firstName: 'Test',
        lastName: 'User',
        status: 'pending',
        linkedVendorUid: 'TOOLONGVENDORID',
        cuid: 'test-client',
      };

      await expect(schema.parseAsync(invalidData)).rejects.toThrow('linkedVendorUid must be a valid vendor UID');
    });

    it('should reject vendor UIDs with invalid characters', async () => {
      const invalidData = {
        inviteeEmail: 'test@example.com',
        role: 'vendor',
        firstName: 'Test',
        lastName: 'User',
        status: 'pending',
        linkedVendorUid: 'invalid@#$%',
        cuid: 'test-client',
      };

      await expect(schema.parseAsync(invalidData)).rejects.toThrow('linkedVendorUid must be a valid vendor UID');
    });
  });
});