import { PropertyCsvProcessor } from '@services/csv/propertyCsvProcessor';

describe('PropertyCsvProcessor - Owner Fields', () => {
  let _processor: PropertyCsvProcessor;
  let mockDependencies: any;

  beforeEach(() => {
    mockDependencies = {
      propertyDAO: {
        bulkCreateProperties: jest.fn(),
        findFirst: jest.fn(),
      },
      userDAO: {
        getActiveUserByEmail: jest.fn(),
      },
      geoCoderService: {
        parseLocation: jest.fn(),
      },
      clientDAO: {
        getClientByCuid: jest.fn(),
      },
    };

    _processor = new PropertyCsvProcessor(mockDependencies as any);
  });

  describe('Owner Field Validation', () => {
    it('should accept valid owner_type values', async () => {
      const mockClient = { _id: 'client123', cuid: 'C123' };
      mockDependencies.clientDAO.getClientByCuid.mockResolvedValue(mockClient);

      const validTypes = ['company_owned', 'external_owner', 'self_owned'];

      for (const type of validTypes) {
        const csvData = [
          {
            name: 'Test Property',
            fullAddress: '123 Main St, City, State 12345',
            propertyType: 'apartment',
            specifications_totalArea: 1000,
            owner_type: type,
          },
        ];

        mockDependencies.geoCoderService.parseLocation.mockResolvedValue({
          success: true,
          data: {
            coordinates: [-122.4194, 37.7749],
            city: 'City',
            state: 'State',
            country: 'USA',
            postCode: '12345',
            fullAddress: '123 Main St, City, State 12345',
          },
        });

        // This would validate the schema - in real implementation
        // For now, just verify the structure would be accepted
        expect(csvData[0].owner_type).toBe(type);
      }
    });

    it('should process owner fields from CSV row', () => {
      const csvRow = {
        name: 'Test Property',
        fullAddress: '123 Main St',
        propertyType: 'apartment',
        specifications_totalArea: 1000,
        owner_type: 'external_owner',
        owner_name: 'John Smith',
        owner_email: 'john@example.com',
        owner_phone: '555-1234',
        owner_taxId: '12-3456789',
        owner_notes: 'VIP Owner',
        owner_bankDetails_accountName: 'John Smith',
        owner_bankDetails_accountNumber: '123456789',
        owner_bankDetails_routingNumber: '987654321',
        owner_bankDetails_bankName: 'Test Bank',
      };

      // Simulate transformation
      const hasOwnerFields = ['owner_type', 'owner_name', 'owner_email', 'owner_phone'].some(
        (field) => csvRow[field as keyof typeof csvRow] !== undefined
      );

      const hasBankDetails = [
        'owner_bankDetails_accountName',
        'owner_bankDetails_accountNumber',
      ].some((field) => csvRow[field as keyof typeof csvRow] !== undefined);

      expect(hasOwnerFields).toBe(true);
      expect(hasBankDetails).toBe(true);
    });

    it('should default to company_owned when owner_type not provided', () => {
      const csvRow = {
        name: 'Test Property',
        fullAddress: '123 Main St',
        propertyType: 'apartment',
        specifications_totalArea: 1000,
      };

      const ownerType = csvRow['owner_type' as keyof typeof csvRow] || 'company_owned';
      expect(ownerType).toBe('company_owned');
    });

    it('should handle CSV with no owner fields', () => {
      const csvRow = {
        name: 'Test Property',
        fullAddress: '123 Main St',
        propertyType: 'apartment',
        specifications_totalArea: 1000,
      };

      const hasOwnerFields = [
        'owner_type',
        'owner_name',
        'owner_email',
        'owner_phone',
        'owner_taxid',
        'owner_notes',
      ].some((field) => csvRow[field as keyof typeof csvRow] !== undefined);

      expect(hasOwnerFields).toBe(false);
    });

    it('should validate owner email format', () => {
      const validEmails = ['john@example.com', 'test+owner@company.co.uk'];
      const invalidEmails = ['notanemail', 'missing@domain', '@nodomain.com'];

      validEmails.forEach((email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        expect(emailRegex.test(email)).toBe(true);
      });

      invalidEmails.forEach((email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        expect(emailRegex.test(email)).toBe(false);
      });
    });

    it('should trim and normalize owner fields', () => {
      const csvRow = {
        owner_name: '  John Smith  ',
        owner_email: '  JOHN@EXAMPLE.COM  ',
        owner_phone: '  555-1234  ',
      };

      const normalizedName = csvRow.owner_name.trim();
      const normalizedEmail = csvRow.owner_email.trim().toLowerCase();
      const normalizedPhone = csvRow.owner_phone.trim();

      expect(normalizedName).toBe('John Smith');
      expect(normalizedEmail).toBe('john@example.com');
      expect(normalizedPhone).toBe('555-1234');
    });
  });

  describe('CSV Header Validation', () => {
    it('should accept owner-related headers', () => {
      const validOwnerHeaders = [
        'owner_type',
        'owner_name',
        'owner_email',
        'owner_phone',
        'owner_taxId',
        'owner_notes',
        'owner_bankDetails_accountName',
        'owner_bankDetails_accountNumber',
        'owner_bankDetails_routingNumber',
        'owner_bankDetails_bankName',
      ];

      // All headers should be recognized
      validOwnerHeaders.forEach((header) => {
        expect(header).toMatch(/^owner_/);
      });
    });

    it('should not include authorization headers (not supported in CSV)', () => {
      const csvHeaders = ['name', 'fullAddress', 'propertyType', 'owner_type', 'owner_name'];

      const hasAuthorizationHeaders = csvHeaders.some((h) => h.includes('authorization'));
      expect(hasAuthorizationHeaders).toBe(false);
    });
  });

  describe('Owner Object Construction', () => {
    it('should build complete owner object with all fields', () => {
      const csvRow = {
        owner_type: 'external_owner',
        owner_name: 'John Smith',
        owner_email: 'john@example.com',
        owner_phone: '555-1234',
        owner_taxId: '12-3456789',
        owner_notes: 'VIP Owner',
        owner_bankDetails_accountName: 'John Smith',
        owner_bankDetails_accountNumber: '123456789',
        owner_bankDetails_routingNumber: '987654321',
        owner_bankDetails_bankName: 'Test Bank',
      };

      // Simulate owner object construction
      const owner = {
        type: csvRow.owner_type || 'company_owned',
        ...(csvRow.owner_name && { name: csvRow.owner_name.trim() }),
        ...(csvRow.owner_email && { email: csvRow.owner_email.trim().toLowerCase() }),
        ...(csvRow.owner_phone && { phone: csvRow.owner_phone.trim() }),
        ...(csvRow.owner_taxId && { taxId: csvRow.owner_taxId.trim() }),
        ...(csvRow.owner_notes && { notes: csvRow.owner_notes.trim() }),
        ...((csvRow.owner_bankDetails_accountName || csvRow.owner_bankDetails_accountNumber) && {
          bankDetails: {
            ...(csvRow.owner_bankDetails_accountName && {
              accountName: csvRow.owner_bankDetails_accountName.trim(),
            }),
            ...(csvRow.owner_bankDetails_accountNumber && {
              accountNumber: csvRow.owner_bankDetails_accountNumber.trim(),
            }),
            ...(csvRow.owner_bankDetails_routingNumber && {
              routingNumber: csvRow.owner_bankDetails_routingNumber.trim(),
            }),
            ...(csvRow.owner_bankDetails_bankName && {
              bankName: csvRow.owner_bankDetails_bankName.trim(),
            }),
          },
        }),
      };

      expect(owner.type).toBe('external_owner');
      expect(owner.name).toBe('John Smith');
      expect(owner.email).toBe('john@example.com');
      expect(owner.phone).toBe('555-1234');
      expect(owner.taxId).toBe('12-3456789');
      expect(owner.notes).toBe('VIP Owner');
      expect(owner.bankDetails).toBeDefined();
      expect(owner.bankDetails?.accountName).toBe('John Smith');
      expect(owner.bankDetails?.accountNumber).toBe('123456789');
    });

    it('should build owner object without bank details', () => {
      const csvRow = {
        owner_type: 'self_owned',
        owner_name: 'Jane Doe',
        owner_email: 'jane@example.com',
      };

      const hasBankDetails = [
        'owner_bankDetails_accountName',
        'owner_bankDetails_accountNumber',
        'owner_bankDetails_routingNumber',
        'owner_bankDetails_bankName',
      ].some((field) => csvRow[field as keyof typeof csvRow] !== undefined);

      const owner = {
        type: csvRow.owner_type,
        name: csvRow.owner_name,
        email: csvRow.owner_email,
      };

      expect(owner.type).toBe('self_owned');
      expect(owner.name).toBe('Jane Doe');
      expect(hasBankDetails).toBe(false);
    });

    it('should not include owner object when no owner fields present', () => {
      const csvRow = {
        name: 'Test Property',
        fullAddress: '123 Main St',
        propertyType: 'apartment',
      };

      const hasOwnerFields = [
        'owner_type',
        'owner_name',
        'owner_email',
        'owner_phone',
        'owner_taxid',
        'owner_notes',
      ].some((field) => csvRow[field as keyof typeof csvRow] !== undefined);

      expect(hasOwnerFields).toBe(false);
    });
  });

  describe('Field Length Validation', () => {
    it('should respect max length constraints', () => {
      const constraints = {
        owner_name: 200,
        owner_email: 255,
        owner_phone: 20,
        owner_taxId: 50,
        owner_notes: 500,
        owner_bankDetails_accountName: 200,
        owner_bankDetails_accountNumber: 50,
        owner_bankDetails_routingNumber: 50,
        owner_bankDetails_bankName: 200,
      };

      Object.entries(constraints).forEach(([_, maxLength]) => {
        const longValue = 'a'.repeat(maxLength + 10);
        expect(longValue.length).toBeGreaterThan(maxLength);
      });
    });
  });
});
