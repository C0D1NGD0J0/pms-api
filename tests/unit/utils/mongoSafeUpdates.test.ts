import { createSafeMongoUpdate } from '@utils/helpers';

describe('createSafeMongoUpdate', () => {
  describe('Nested Object Conversion', () => {
    it('should convert nested objects to dot notation', () => {
      const input = {
        fees: { rentalAmount: 1200, securityDeposit: 500 },
        name: 'Test Property',
      };

      const result = createSafeMongoUpdate(input);

      expect(result).toEqual({
        'fees.rentalAmount': 1200,
        'fees.securityDeposit': 500,
        name: 'Test Property',
      });
    });

    it('should handle deeply nested objects', () => {
      const input = {
        specifications: {
          bedrooms: 3,
          bathrooms: 2,
        },
        financialDetails: {
          marketValue: 250000,
          purchasePrice: 200000,
        },
        status: 'active',
      };

      const result = createSafeMongoUpdate(input);

      expect(result).toEqual({
        'specifications.bedrooms': 3,
        'specifications.bathrooms': 2,
        'financialDetails.marketValue': 250000,
        'financialDetails.purchasePrice': 200000,
        status: 'active',
      });
    });

    it('should handle mixed object and primitive fields', () => {
      const input = {
        fees: { rentalAmount: 1200 },
        lastModifiedBy: 'user123',
        status: 'active',
      };

      const result = createSafeMongoUpdate(input);

      expect(result).toEqual({
        'fees.rentalAmount': 1200,
        lastModifiedBy: 'user123',
        status: 'active',
      });
    });

    it('should handle arrays and dates properly', () => {
      const testDate = new Date('2023-01-01');
      const input = {
        fees: { rentalAmount: 1200 },
        tags: ['residential', 'luxury'],
        createdAt: testDate,
        metadata: null,
      };

      const result = createSafeMongoUpdate(input);

      expect(result).toEqual({
        'fees.rentalAmount': 1200,
        tags: ['residential', 'luxury'],
        createdAt: testDate,
        metadata: null,
      });
    });

    it('should handle empty objects', () => {
      const input = {};
      const result = createSafeMongoUpdate(input);
      expect(result).toEqual({});
    });

    it('should handle primitive values only', () => {
      const input = {
        name: 'Test Property',
        price: 1000,
        isActive: true,
        description: null,
      };

      const result = createSafeMongoUpdate(input);

      expect(result).toEqual({
        name: 'Test Property',
        price: 1000,
        isActive: true,
        description: null,
      });
    });
  });

  describe('Real-world Property Update Scenarios', () => {
    it('should safely update property fees without losing other fee fields', () => {
      // Simulate what happens when user only updates rental amount
      const userUpdate = {
        fees: { rentalAmount: 1500 }, // User only changed this
      };

      const safeUpdate = createSafeMongoUpdate(userUpdate);

      expect(safeUpdate).toEqual({
        'fees.rentalAmount': 1500,
      });

      // This would now preserve securityDeposit, taxAmount, etc. in the database
    });

    it('should safely update property specifications', () => {
      const userUpdate = {
        specifications: { bedrooms: 4 }, // User only changed bedrooms
        name: 'Updated Property Name',
      };

      const safeUpdate = createSafeMongoUpdate(userUpdate);

      expect(safeUpdate).toEqual({
        'specifications.bedrooms': 4,
        name: 'Updated Property Name',
      });
    });

    it('should handle complex property approval scenario', () => {
      // Simulate pending changes from staff approval
      const pendingChanges = {
        fees: { rentalAmount: 1800, managementFees: 200 },
        specifications: { bathrooms: 3 },
        status: 'active',
      };

      const safeUpdate = createSafeMongoUpdate(pendingChanges);

      expect(safeUpdate).toEqual({
        'fees.rentalAmount': 1800,
        'fees.managementFees': 200,
        'specifications.bathrooms': 3,
        status: 'active',
      });
    });
  });
});
