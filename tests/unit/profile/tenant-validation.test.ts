import { Types } from 'mongoose';
import { BackgroundCheckStatus } from '@interfaces/profile.interface';
import { ProfileValidations } from '@shared/validations/ProfileValidation';

describe('TenantInfo Validation', () => {
  describe('tenantInfoSchema', () => {
    it('should validate complete tenant information successfully', () => {
      const validTenantInfo = {
        activeLease: {
          leaseId: new Types.ObjectId().toString(),
          propertyId: new Types.ObjectId().toString(),
          unitId: new Types.ObjectId().toString(),
          durationMonths: 12,
          rentAmount: 1500.5,
          paymentDueDate: new Date('2024-01-01'),
        },
        employerInfo: {
          companyName: 'Test Company Inc.',
          position: 'Software Engineer',
          monthlyIncome: 6000,
        },
        rentalReferences: [
          {
            landlordName: 'John Doe',
            propertyAddress: '123 Main Street, City, State 12345',
          },
          {
            landlordName: 'Jane Smith',
            propertyAddress: '456 Oak Avenue, Another City, State 67890',
          },
        ],
        pets: [
          {
            type: 'dog',
            breed: 'Golden Retriever',
            isServiceAnimal: false,
          },
          {
            type: 'cat',
            breed: 'Persian',
            isServiceAnimal: true,
          },
        ],
        emergencyContact: {
          name: 'Emergency Contact Name',
          phone: '+1-234-567-8900',
          relationship: 'spouse',
          email: 'emergency@example.com',
        },
        backgroundCheckStatus: BackgroundCheckStatus.APPROVED,
      };

      const result = ProfileValidations.updateTenantInfo.safeParse(validTenantInfo);
      expect(result.success).toBe(true);
    });

    it('should validate partial tenant information successfully', () => {
      const partialTenantInfo = {
        employerInfo: {
          companyName: 'Test Company',
          position: 'Developer',
          monthlyIncome: 5000,
        },
        backgroundCheckStatus: BackgroundCheckStatus.PENDING,
      };

      const result = ProfileValidations.updateTenantInfo.safeParse(partialTenantInfo);
      expect(result.success).toBe(true);
    });

    it('should validate empty tenant information', () => {
      const result = ProfileValidations.updateTenantInfo.safeParse({});
      expect(result.success).toBe(true);
    });

    describe('activeLease validation', () => {
      it('should accept valid lease information', () => {
        const tenantInfo = {
          activeLease: {
            leaseId: new Types.ObjectId().toString(),
            propertyId: new Types.ObjectId().toString(),
            unitId: new Types.ObjectId().toString(),
            durationMonths: 6,
            rentAmount: 800,
            paymentDueDate: new Date(),
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(true);
      });

      it('should reject invalid ObjectId formats', () => {
        const tenantInfo = {
          activeLease: {
            leaseId: 'invalid-object-id',
            propertyId: new Types.ObjectId().toString(),
            unitId: new Types.ObjectId().toString(),
            durationMonths: 12,
            rentAmount: 1200,
            paymentDueDate: new Date(),
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(
          /Lease ID must be a valid MongoDB ObjectId/
        );
      });

      it('should reject duration less than 1 month', () => {
        const tenantInfo = {
          activeLease: {
            leaseId: new Types.ObjectId().toString(),
            propertyId: new Types.ObjectId().toString(),
            unitId: new Types.ObjectId().toString(),
            durationMonths: 0,
            rentAmount: 1200,
            paymentDueDate: new Date(),
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(/Duration must be at least 1 month/);
      });

      it('should reject duration exceeding 60 months', () => {
        const tenantInfo = {
          activeLease: {
            leaseId: new Types.ObjectId().toString(),
            propertyId: new Types.ObjectId().toString(),
            unitId: new Types.ObjectId().toString(),
            durationMonths: 61,
            rentAmount: 1200,
            paymentDueDate: new Date(),
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(/Duration cannot exceed 60 months/);
      });

      it('should reject negative rent amount', () => {
        const tenantInfo = {
          activeLease: {
            leaseId: new Types.ObjectId().toString(),
            propertyId: new Types.ObjectId().toString(),
            unitId: new Types.ObjectId().toString(),
            durationMonths: 12,
            rentAmount: -100,
            paymentDueDate: new Date(),
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(/Rent amount cannot be negative/);
      });
    });

    describe('employerInfo validation', () => {
      it('should accept valid employer information', () => {
        const tenantInfo = {
          employerInfo: {
            companyName: 'Acme Corporation',
            position: 'Senior Software Engineer',
            monthlyIncome: 8500.75,
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(true);
      });

      it('should reject company name shorter than 2 characters', () => {
        const tenantInfo = {
          employerInfo: {
            companyName: 'A',
            position: 'Engineer',
            monthlyIncome: 5000,
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(
          /Company name must be at least 2 characters/
        );
      });

      it('should reject company name longer than 100 characters', () => {
        const tenantInfo = {
          employerInfo: {
            companyName: 'A'.repeat(101),
            position: 'Engineer',
            monthlyIncome: 5000,
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(
          /Company name cannot exceed 100 characters/
        );
      });

      it('should reject negative monthly income', () => {
        const tenantInfo = {
          employerInfo: {
            companyName: 'Test Company',
            position: 'Engineer',
            monthlyIncome: -1000,
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(/Monthly income cannot be negative/);
      });
    });

    describe('rentalReferences validation', () => {
      it('should accept valid rental references', () => {
        const tenantInfo = {
          rentalReferences: [
            {
              landlordName: 'John Doe',
              propertyAddress: '123 Main St, City, State',
            },
            {
              landlordName: 'Jane Smith Property Management',
              propertyAddress: '456 Oak Avenue, Apartment 2B, Another City, State 12345',
            },
          ],
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(true);
      });

      it('should reject landlord name shorter than 2 characters', () => {
        const tenantInfo = {
          rentalReferences: [
            {
              landlordName: 'A',
              propertyAddress: '123 Main St, City, State',
            },
          ],
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(
          /Landlord name must be at least 2 characters/
        );
      });

      it('should reject property address shorter than 5 characters', () => {
        const tenantInfo = {
          rentalReferences: [
            {
              landlordName: 'John Doe',
              propertyAddress: '123',
            },
          ],
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(
          /Property address must be at least 5 characters/
        );
      });
    });

    describe('pets validation', () => {
      it('should accept valid pet information', () => {
        const tenantInfo = {
          pets: [
            {
              type: 'dog',
              breed: 'Golden Retriever',
              isServiceAnimal: false,
            },
            {
              type: 'cat',
              breed: 'Persian',
              isServiceAnimal: true,
            },
          ],
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(true);
      });

      it('should default isServiceAnimal to false', () => {
        const tenantInfo = {
          pets: [
            {
              type: 'dog',
              breed: 'Labrador',
            },
          ],
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.pets?.[0].isServiceAnimal).toBe(false);
        }
      });

      it('should reject pet type shorter than 2 characters', () => {
        const tenantInfo = {
          pets: [
            {
              type: 'D',
              breed: 'Golden Retriever',
              isServiceAnimal: false,
            },
          ],
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(/Pet type must be at least 2 characters/);
      });
    });

    describe('emergencyContact validation', () => {
      it('should accept valid emergency contact', () => {
        const tenantInfo = {
          emergencyContact: {
            name: 'Emergency Contact',
            phone: '+1 (234) 567-8900',
            relationship: 'spouse',
            email: 'contact@example.com',
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(true);
      });

      it('should accept various phone number formats', () => {
        const phoneNumbers = [
          '+1234567890',
          '(234) 567-8900',
          '234-567-8900',
          '234 567 8900',
          '+1 234 567 8900',
        ];

        phoneNumbers.forEach((phone) => {
          const tenantInfo = {
            emergencyContact: {
              name: 'Contact Name',
              phone,
              relationship: 'friend',
              email: 'test@example.com',
            },
          };

          const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
          expect(result.success).toBe(true);
        });
      });

      it('should reject invalid phone number format', () => {
        const tenantInfo = {
          emergencyContact: {
            name: 'Contact Name',
            phone: 'invalid-phone',
            relationship: 'friend',
            email: 'test@example.com',
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(/Invalid phone number format/);
      });

      it('should reject invalid email format', () => {
        const tenantInfo = {
          emergencyContact: {
            name: 'Contact Name',
            phone: '+1234567890',
            relationship: 'friend',
            email: 'invalid-email',
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toMatch(/Invalid email format/);
      });

      it('should convert email to lowercase', () => {
        const tenantInfo = {
          emergencyContact: {
            name: 'Contact Name',
            phone: '+1234567890',
            relationship: 'friend',
            email: 'TEST@EXAMPLE.COM',
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.emergencyContact?.email).toBe('test@example.com');
        }
      });
    });

    describe('backgroundCheckStatus validation', () => {
      it('should accept valid background check statuses', () => {
        const validStatuses = [
          BackgroundCheckStatus.PENDING,
          BackgroundCheckStatus.APPROVED,
          BackgroundCheckStatus.FAILED,
          BackgroundCheckStatus.NOT_REQUIRED,
        ];

        validStatuses.forEach((status) => {
          const tenantInfo = {
            backgroundCheckStatus: status,
          };

          const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
          expect(result.success).toBe(true);
        });
      });

      it('should handle missing backgroundCheckStatus', () => {
        const tenantInfo = {
          employerInfo: {
            companyName: 'Test Company',
            position: 'Developer',
            monthlyIncome: 5000,
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(true);
        // backgroundCheckStatus is optional, so it may be undefined
        if (result.success) {
          expect(result.data.backgroundCheckStatus).toBeUndefined();
        }
      });

      it('should reject invalid background check status', () => {
        const tenantInfo = {
          backgroundCheckStatus: 'invalid-status' as any,
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(false);
      });
    });

    describe('field trimming', () => {
      it('should trim string fields in employer info', () => {
        const tenantInfo = {
          employerInfo: {
            companyName: '  Test Company  ',
            position: '  Software Engineer  ',
            monthlyIncome: 5000,
          },
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.employerInfo?.companyName).toBe('Test Company');
          expect(result.data.employerInfo?.position).toBe('Software Engineer');
        }
      });

      it('should trim string fields in rental references', () => {
        const tenantInfo = {
          rentalReferences: [
            {
              landlordName: '  John Doe  ',
              propertyAddress: '  123 Main St  ',
            },
          ],
        };

        const result = ProfileValidations.updateTenantInfo.safeParse(tenantInfo);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.rentalReferences?.[0].landlordName).toBe('John Doe');
          expect(result.data.rentalReferences?.[0].propertyAddress).toBe('123 Main St');
        }
      });
    });
  });
});
