import { LeaseType } from '@interfaces/lease.interface';
import { LeaseTemplateDataMapper } from '@services/lease/leaseTemplateDataMapper';

describe('LeaseTemplateDataMapper', () => {
  let mapper: LeaseTemplateDataMapper;

  beforeEach(() => {
    mapper = new LeaseTemplateDataMapper();
  });

  describe('transformForTemplate', () => {
    it('should transform basic lease preview data', () => {
      const previewData = {
        leaseNumber: 'LEASE-2025-001',
        currentDate: '2025-01-15',
        jurisdiction: 'California',
        landlordName: 'Test Landlord LLC',
        landlordAddress: '123 Main St',
        landlordEmail: 'landlord@test.com',
        landlordPhone: '+1-555-0100',
        tenantName: 'John Doe',
        tenantEmail: 'john@example.com',
        tenantPhone: '+1-555-0200',
        propertyAddress: '456 Oak Ave',
        leaseType: LeaseType.FIXED_TERM,
        startDate: '2025-02-01',
        endDate: '2026-02-01',
        monthlyRent: 1500,
        securityDeposit: 3000,
        rentDueDay: 1,
        currency: 'USD',
        signingMethod: 'manual',
      };

      const result = mapper.transformForTemplate(previewData as any);

      expect(result).toMatchObject({
        leaseNumber: 'LEASE-2025-001',
        jurisdiction: 'California',
        landlordName: 'Test Landlord LLC',
        landlordAddress: '123 Main St',
        landlordEmail: 'landlord@test.com',
        landlordPhone: '+1-555-0100',
        tenantName: 'John Doe',
        tenantEmail: 'john@example.com',
        tenantPhone: '+1-555-0200',
        propertyAddress: '456 Oak Ave',
        signingMethod: 'manual',
      });

      expect(result.startDate).toBeDefined();
      expect(result.endDate).toBeDefined();
      expect(result.monthlyRent).toContain('$');
      expect(result.securityDeposit).toContain('$');
    });

    describe('ownership context fields', () => {
      it('should include ownership context fields with defaults', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.hasUnitOwner).toBe(false);
        expect(result.isMultiUnit).toBe(false);
        expect(result.ownershipType).toBe('company_owned');
        expect(result.isUnitLease).toBe(false);
        expect(result.isExternalOwner).toBe(false);
      });

      it('should set hasUnitOwner when provided', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          hasUnitOwner: true,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.hasUnitOwner).toBe(true);
      });

      it('should set isMultiUnit when provided', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          isMultiUnit: true,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.isMultiUnit).toBe(true);
      });

      it('should set ownershipType when provided', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          ownershipType: 'external_owner',
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.ownershipType).toBe('external_owner');
      });

      it('should calculate isUnitLease correctly when unitNumber and isMultiUnit are present', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          unitNumber: '101',
          isMultiUnit: true,
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.isUnitLease).toBe(true);
        expect(result.unitNumber).toBe('101');
        expect(result.isMultiUnit).toBe(true);
      });

      it('should set isUnitLease to false when unitNumber is missing', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          isMultiUnit: true,
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.isUnitLease).toBe(false);
      });

      it('should set isUnitLease to false when isMultiUnit is false', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          unitNumber: '101',
          isMultiUnit: false,
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.isUnitLease).toBe(false);
      });

      it('should include isExternalOwner flag', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          isExternalOwner: true,
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.isExternalOwner).toBe(true);
      });
    });

    describe('management company information', () => {
      it('should include management company info when provided', () => {
        const previewData = {
          landlordName: 'Property Owner',
          landlordAddress: '123 Main St',
          landlordEmail: 'owner@example.com',
          landlordPhone: '+1-555-0100',
          tenantName: 'Test Tenant',
          propertyAddress: '456 Oak Ave',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          isExternalOwner: true,
          managementCompanyName: 'Test Property Management LLC',
          managementCompanyAddress: '789 Business Blvd',
          managementCompanyEmail: 'info@testpm.com',
          managementCompanyPhone: '+1-555-0200',
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.isExternalOwner).toBe(true);
        expect(result.managementCompanyName).toBe('Test Property Management LLC');
        expect(result.managementCompanyAddress).toBe('789 Business Blvd');
        expect(result.managementCompanyEmail).toBe('info@testpm.com');
        expect(result.managementCompanyPhone).toBe('+1-555-0200');
      });

      it('should handle missing management company info', () => {
        const previewData = {
          landlordName: 'Property Owner',
          tenantName: 'Test Tenant',
          propertyAddress: '456 Oak Ave',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.managementCompanyName).toBeNull();
        expect(result.managementCompanyAddress).toBeNull();
        expect(result.managementCompanyEmail).toBeNull();
        expect(result.managementCompanyPhone).toBeNull();
      });
    });

    describe('date formatting', () => {
      it('should format dates correctly', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: new Date('2025-02-15T12:00:00Z'),
          endDate: new Date('2026-02-15T12:00:00Z'),
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.startDate).toContain('2025');
        expect(result.endDate).toContain('2026');
        expect(result.startDate).toBeDefined();
        expect(result.endDate).toBeDefined();
      });
    });

    describe('currency formatting', () => {
      it('should format USD currency correctly', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.monthlyRent).toBe('$1,500.00');
        expect(result.securityDeposit).toBe('$3,000.00');
      });
    });

    describe('ordinal suffix for rent due day', () => {
      it('should format 1st correctly', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.rentDueDayOrdinal).toBe('1st');
      });

      it('should format 2nd correctly', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 2,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.rentDueDayOrdinal).toBe('2nd');
      });

      it('should format 3rd correctly', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 3,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.rentDueDayOrdinal).toBe('3rd');
      });

      it('should format 15th correctly', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 15,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.rentDueDayOrdinal).toBe('15th');
      });
    });

    describe('utilities included', () => {
      it('should transform utilities array to string', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          utilitiesIncluded: ['water', 'trash', 'electricity'],
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.utilitiesIncluded).toBe('water, trash, electricity');
      });

      it('should handle empty utilities array', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          utilitiesIncluded: [],
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.utilitiesIncluded).toBeNull();
      });
    });

    describe('signedDate handling', () => {
      it('should return null for signedDate when not provided', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 250000, // cents
          securityDeposit: 500000, // cents
          rentDueDay: 1,
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.signedDate).toBeNull();
      });

      it('should format signedDate when provided', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 250000,
          securityDeposit: 500000,
          rentDueDay: 1,
          signedDate: '2025-01-15T10:00:00Z',
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.signedDate).not.toBeNull();
        expect(result.signedDate).toContain('2025');
        expect(result.signedDate).toContain('January');
      });

      it('should format signedDate as Date object', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 250000,
          securityDeposit: 500000,
          rentDueDay: 1,
          signedDate: new Date('2025-01-20'),
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.signedDate).not.toBeNull();
        expect(result.signedDate).toContain('2025');
      });
    });

    describe('currency formatting with cents', () => {
      it('should convert cents to dollars for monthlyRent', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 250000, // 250000 cents = $2,500.00
          securityDeposit: 500000, // 500000 cents = $5,000.00
          rentDueDay: 1,
          currency: 'USD',
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.monthlyRent).toBe('$2,500.00');
        expect(result.securityDeposit).toBe('$5,000.00');
      });

      it('should handle zero values correctly', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 0,
          securityDeposit: 0,
          rentDueDay: 1,
          currency: 'USD',
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.monthlyRent).toBe('$0.00');
        expect(result.securityDeposit).toBe('$0.00');
      });

      it('should handle large amounts in cents correctly', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 1234567, // $12,345.67
          securityDeposit: 9876543, // $98,765.43
          rentDueDay: 1,
          currency: 'USD',
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.monthlyRent).toBe('$12,345.67');
        expect(result.securityDeposit).toBe('$98,765.43');
      });

      it('should handle CAD currency correctly', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 250000,
          securityDeposit: 500000,
          rentDueDay: 1,
          currency: 'CAD',
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.monthlyRent).toContain('2,500.00');
        expect(result.securityDeposit).toContain('5,000.00');
      });

      it('should handle pet policy deposit in cents', () => {
        const previewData = {
          landlordName: 'Test Landlord',
          tenantName: 'Test Tenant',
          propertyAddress: '123 Main St',
          startDate: '2025-01-01',
          endDate: '2026-01-01',
          monthlyRent: 250000,
          securityDeposit: 500000,
          rentDueDay: 1,
          currency: 'USD',
          petPolicy: {
            allowed: true,
            maxPets: 2,
            types: ['dogs', 'cats'],
            deposit: 50000, // 50000 cents = $500.00
          },
        };

        const result = mapper.transformForTemplate(previewData as any);

        expect(result.petPolicy).toBeDefined();
        expect(result.petPolicy.deposit).toBe('$500.00');
      });
    });
  });
});
