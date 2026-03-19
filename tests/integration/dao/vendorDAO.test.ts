import { Types } from 'mongoose';
import { VendorDAO } from '@dao/vendorDAO';
import { Vendor, User } from '@models/index';
import { clearTestDatabase } from '@tests/helpers';

describe('VendorDAO Integration Tests', () => {
  let vendorDAO: VendorDAO;
  let testUserId: Types.ObjectId;
  let testUserId2: Types.ObjectId;
  let testCuid: string;
  let testCuid2: string;

  beforeAll(async () => {
    vendorDAO = new VendorDAO({ vendorModel: Vendor });
  });
  beforeEach(async () => {
    await clearTestDatabase();
    testUserId = new Types.ObjectId();
    testUserId2 = new Types.ObjectId();
    testCuid = 'TEST_CLIENT_1';
    testCuid2 = 'TEST_CLIENT_2';

    // Create test users for vendor relationships
    await User.create({
      _id: testUserId,
      uid: 'user-uid-1',
      email: 'user1@example.com',
      firstName: 'Test',
      lastName: 'User',
      password: 'hashed',
      activecuid: testCuid,
      cuids: [{ cuid: testCuid, clientDisplayName: 'Test Client 1', roles: [], isConnected: true }],
    });

    await User.create({
      _id: testUserId2,
      uid: 'user-uid-2',
      email: 'user2@example.com',
      firstName: 'Test',
      lastName: 'User2',
      password: 'hashed',
      activecuid: testCuid2,
      cuids: [{ cuid: testCuid2, clientDisplayName: 'Test Client 2', roles: [], isConnected: true }],
      isActive: true,
    });
  });

  describe('createVendor', () => {
    it('should create a vendor with required fields', async () => {
      const vendorData = {
        companyName: 'ABC Plumbing Inc',
        businessType: 'Plumbing',
        registrationNumber: 'REG123456',
        isPrimaryAccountHolder: true,
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      };

      const vendor = await vendorDAO.createVendor(vendorData);

      expect(vendor).toBeDefined();
      expect(vendor.vuid).toBeDefined();
      expect(vendor.companyName).toBe('ABC Plumbing Inc');
      expect(vendor.registrationNumber).toBe('REG123456');
      expect(vendor.connectedClients.length).toBe(1);
    });

    it('should create vendor with optional fields', async () => {
      const vendorData = {
        companyName: 'XYZ Electrical',
        businessType: 'Electrical',
        registrationNumber: 'REG789012',
        taxId: 'TAX-123',
        yearsInBusiness: 10,
        isPrimaryAccountHolder: true,
        servicesOffered: {
          electrical: true,
          plumbing: true,
        },
        contactPerson: {
          name: 'John Smith',
          jobTitle: 'Manager',
          email: 'john@xyz.com',
          phone: '555-1234',
        },
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      };

      const vendor = await vendorDAO.createVendor(vendorData);

      expect(vendor.taxId).toBe('TAX-123');
      expect(vendor.yearsInBusiness).toBe(10);
      expect(vendor.servicesOffered?.electrical).toBe(true);
      expect(vendor.contactPerson?.name).toBe('John Smith');
    });

    it('should create vendor with multiple connected clients', async () => {
      const vendorData = {
        companyName: 'Multi-Client Vendor',
        businessType: 'General Contractor',
        registrationNumber: 'REG-MULTI',
        isPrimaryAccountHolder: true,
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
          {
            cuid: testCuid2,
            isConnected: false,
            primaryAccountHolder: testUserId2,
          },
        ],
      };

      const vendor = await vendorDAO.createVendor(vendorData);

      expect(vendor.connectedClients.length).toBe(2);
      expect(vendor.connectedClients[0].isConnected).toBe(true);
      expect(vendor.connectedClients[1].isConnected).toBe(false);
    });

    it('should create vendor with address information', async () => {
      const vendorData = {
        companyName: 'Located Vendor',
        businessType: 'HVAC',
        registrationNumber: 'REG-LOC',
        isPrimaryAccountHolder: true,
        address: {
          street: 'Main St',
          streetNumber: '123',
          city: 'Toronto',
          state: 'ON',
          country: 'Canada',
          postCode: 'M5V 1A1',
          fullAddress: '123 Main St, Toronto, ON M5V 1A1',
          computedLocation: {
            type: 'Point' as const,
            coordinates: [-79.3832, 43.6532] as [number, number],
          },
        },
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      };

      const vendor = await vendorDAO.createVendor(vendorData);

      expect(vendor.address?.city).toBe('Toronto');
      expect(vendor.address?.state).toBe('ON');
      expect(vendor.address?.computedLocation.coordinates).toEqual([-79.3832, 43.6532]);
    });

    it('should create vendor with insurance information', async () => {
      const vendorData = {
        companyName: 'Insured Vendor',
        businessType: 'Roofing',
        registrationNumber: 'REG-INS',
        isPrimaryAccountHolder: true,
        insuranceInfo: {
          provider: 'State Farm',
          policyNumber: 'POL-123',
          expirationDate: new Date('2026-12-31'),
          coverageAmount: 1000000,
        },
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      };

      const vendor = await vendorDAO.createVendor(vendorData);

      expect(vendor.insuranceInfo?.provider).toBe('State Farm');
      expect(vendor.insuranceInfo?.policyNumber).toBe('POL-123');
      expect(vendor.insuranceInfo?.coverageAmount).toBe(1000000);
    });
  });

  describe('getVendorById', () => {
    it('should find vendor by MongoDB ObjectId', async () => {
      const created = await Vendor.create({
        companyName: 'Find By ObjectId',
        businessType: 'Plumbing',
        registrationNumber: 'REG-OBJ',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.getVendorById(created._id);

      expect(vendor).not.toBeNull();
      expect(vendor?._id.toString()).toBe(created._id.toString());
      expect(vendor?.companyName).toBe('Find By ObjectId');
    });

    it('should find vendor by vuid string', async () => {
      const created = await Vendor.create({
        companyName: 'Find By VUID',
        businessType: 'Electrical',
        registrationNumber: 'REG-VUID',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.getVendorById(created.vuid);

      expect(vendor).not.toBeNull();
      expect(vendor?.vuid).toBe(created.vuid);
      expect(vendor?.companyName).toBe('Find By VUID');
    });

    it('should return null for non-existent ObjectId', async () => {
      const fakeId = new Types.ObjectId();
      const vendor = await vendorDAO.getVendorById(fakeId);

      expect(vendor).toBeNull();
    });

    it('should return null for non-existent vuid', async () => {
      const vendor = await vendorDAO.getVendorById('NONEXISTENT_VUID');

      expect(vendor).toBeNull();
    });

    it('should not return soft-deleted vendors by vuid', async () => {
      const created = await Vendor.create({
        companyName: 'Deleted Vendor',
        businessType: 'Plumbing',
        registrationNumber: 'REG-DEL',
        deletedAt: new Date(),
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.getVendorById(created.vuid);

      expect(vendor).toBeNull();
    });
  });

  describe('getVendorByVuid', () => {
    it('should find vendor by vuid', async () => {
      const created = await Vendor.create({
        companyName: 'VUID Test Vendor',
        businessType: 'HVAC',
        registrationNumber: 'REG-VUID-TEST',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.getVendorByVuid(created.vuid);

      expect(vendor).not.toBeNull();
      expect(vendor?.vuid).toBe(created.vuid);
    });

    it('should return null for non-existent vuid', async () => {
      const vendor = await vendorDAO.getVendorByVuid('FAKE_VUID');

      expect(vendor).toBeNull();
    });

    it('should not return soft-deleted vendors', async () => {
      const created = await Vendor.create({
        companyName: 'Deleted VUID Vendor',
        businessType: 'Plumbing',
        registrationNumber: 'REG-DEL-VUID',
        deletedAt: new Date(),
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.getVendorByVuid(created.vuid);

      expect(vendor).toBeNull();
    });
  });

  describe('getVendorByPrimaryAccountHolder', () => {
    it('should find vendor by primary account holder user ID', async () => {
      await Vendor.create({
        companyName: 'Account Holder Vendor',
        businessType: 'Painting',
        registrationNumber: 'REG-HOLDER',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.getVendorByPrimaryAccountHolder(testUserId);

      expect(vendor).not.toBeNull();
      expect(vendor?.companyName).toBe('Account Holder Vendor');
      expect(vendor?.connectedClients[0].primaryAccountHolder.toString()).toBe(testUserId.toString());
    });

    it('should return null for non-existent account holder', async () => {
      const fakeUserId = new Types.ObjectId();
      const vendor = await vendorDAO.getVendorByPrimaryAccountHolder(fakeUserId);

      expect(vendor).toBeNull();
    });

    it('should find vendor when user is account holder for one of multiple clients', async () => {
      await Vendor.create({
        companyName: 'Multi-Client Account Holder',
        businessType: 'Carpentry',
        registrationNumber: 'REG-MULTI-HOLDER',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
          {
            cuid: testCuid2,
            isConnected: true,
            primaryAccountHolder: testUserId2,
          },
        ],
      });

      const vendor = await vendorDAO.getVendorByPrimaryAccountHolder(testUserId2);

      expect(vendor).not.toBeNull();
      expect(vendor?.companyName).toBe('Multi-Client Account Holder');
    });
  });

  describe('findByRegistrationNumber', () => {
    it('should find vendor by registration number', async () => {
      await Vendor.create({
        companyName: 'Registration Test',
        businessType: 'Security',
        registrationNumber: 'REG-UNIQUE-123',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.findByRegistrationNumber('REG-UNIQUE-123');

      expect(vendor).not.toBeNull();
      expect(vendor?.registrationNumber).toBe('REG-UNIQUE-123');
    });

    it('should trim whitespace from registration number', async () => {
      await Vendor.create({
        companyName: 'Trim Test',
        businessType: 'Cleaning',
        registrationNumber: 'REG-TRIM',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.findByRegistrationNumber('  REG-TRIM  ');

      expect(vendor).not.toBeNull();
      expect(vendor?.companyName).toBe('Trim Test');
    });

    it('should return null for non-existent registration number', async () => {
      const vendor = await vendorDAO.findByRegistrationNumber('NONEXISTENT-REG');

      expect(vendor).toBeNull();
    });

    it('should not return soft-deleted vendors', async () => {
      await Vendor.create({
        companyName: 'Deleted Registration',
        businessType: 'Landscaping',
        registrationNumber: 'REG-DELETED',
        deletedAt: new Date(),
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.findByRegistrationNumber('REG-DELETED');

      expect(vendor).toBeNull();
    });
  });

  describe('findByCompanyName', () => {
    it('should find vendor by company name', async () => {
      await Vendor.create({
        companyName: 'Unique Company Name LLC',
        businessType: 'Pest Control',
        registrationNumber: 'REG-COMPANY',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.findByCompanyName('Unique Company Name LLC');

      expect(vendor).not.toBeNull();
      expect(vendor?.companyName).toBe('Unique Company Name LLC');
    });

    it('should trim whitespace from company name', async () => {
      await Vendor.create({
        companyName: 'Trimmed Company',
        businessType: 'Appliance Repair',
        registrationNumber: 'REG-COMPANY-TRIM',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.findByCompanyName('  Trimmed Company  ');

      expect(vendor).not.toBeNull();
      expect(vendor?.companyName).toBe('Trimmed Company');
    });

    it('should return null for non-existent company name', async () => {
      const vendor = await vendorDAO.findByCompanyName('Nonexistent Company');

      expect(vendor).toBeNull();
    });

    it('should not return soft-deleted vendors', async () => {
      await Vendor.create({
        companyName: 'Deleted Company',
        businessType: 'Maintenance',
        registrationNumber: 'REG-DELETED-COMPANY',
        deletedAt: new Date(),
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const vendor = await vendorDAO.findByCompanyName('Deleted Company');

      expect(vendor).toBeNull();
    });
  });

  describe('updateVendor', () => {
    it('should update vendor by ObjectId', async () => {
      const created = await Vendor.create({
        companyName: 'Original Name',
        businessType: 'Plumbing',
        registrationNumber: 'REG-UPDATE-OBJ',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const updated = await vendorDAO.updateVendor(created._id, {
        companyName: 'Updated Name',
        taxId: 'NEW-TAX-ID',
      });

      expect(updated).not.toBeNull();
      expect(updated?.companyName).toBe('Updated Name');
      expect(updated?.taxId).toBe('NEW-TAX-ID');
    });

    it('should update vendor by vuid', async () => {
      const created = await Vendor.create({
        companyName: 'Original VUID Name',
        businessType: 'Electrical',
        registrationNumber: 'REG-UPDATE-VUID',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const updated = await vendorDAO.updateVendor(created.vuid, {
        companyName: 'Updated VUID Name',
        yearsInBusiness: 15,
      });

      expect(updated).not.toBeNull();
      expect(updated?.companyName).toBe('Updated VUID Name');
      expect(updated?.yearsInBusiness).toBe(15);
    });

    it('should update nested contact person information', async () => {
      const created = await Vendor.create({
        companyName: 'Contact Update Test',
        businessType: 'HVAC',
        registrationNumber: 'REG-CONTACT',
        contactPerson: {
          name: 'Old Name',
          jobTitle: 'Manager',
        },
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const updated = await vendorDAO.updateVendor(created._id, {
        contactPerson: {
          name: 'New Name',
          jobTitle: 'Senior Manager',
          email: 'new@example.com',
          phone: '555-9999',
        },
      });

      expect(updated?.contactPerson?.name).toBe('New Name');
      expect(updated?.contactPerson?.jobTitle).toBe('Senior Manager');
      expect(updated?.contactPerson?.email).toBe('new@example.com');
    });

    it('should update services offered', async () => {
      const created = await Vendor.create({
        companyName: 'Services Update',
        businessType: 'General Contractor',
        registrationNumber: 'REG-SERVICES',
        servicesOffered: {
          plumbing: true,
        },
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const updated = await vendorDAO.updateVendor(created._id, {
        servicesOffered: {
          plumbing: true,
          electrical: true,
          hvac: true,
        },
      });

      expect(updated?.servicesOffered?.plumbing).toBe(true);
      expect(updated?.servicesOffered?.electrical).toBe(true);
      expect(updated?.servicesOffered?.hvac).toBe(true);
    });

    it('should return null for non-existent vendor', async () => {
      const fakeId = new Types.ObjectId();
      const updated = await vendorDAO.updateVendor(fakeId, {
        companyName: 'Should Not Update',
      });

      expect(updated).toBeNull();
    });

    it('should not update soft-deleted vendors by vuid', async () => {
      const created = await Vendor.create({
        companyName: 'Deleted Update Test',
        businessType: 'Painting',
        registrationNumber: 'REG-DEL-UPDATE',
        deletedAt: new Date(),
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const updated = await vendorDAO.updateVendor(created.vuid, {
        companyName: 'Should Not Update',
      });

      expect(updated).toBeNull();
    });
  });

  describe('getClientVendors', () => {
    beforeEach(async () => {
      // Create vendors for different clients
      await Vendor.create({
        companyName: 'Client 1 Vendor Active',
        businessType: 'Plumbing',
        registrationNumber: 'REG-C1-ACTIVE',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      await Vendor.create({
        companyName: 'Client 1 Vendor Inactive',
        businessType: 'Electrical',
        registrationNumber: 'REG-C1-INACTIVE',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: false,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      await Vendor.create({
        companyName: 'Client 2 Vendor',
        businessType: 'HVAC',
        registrationNumber: 'REG-C2',
        connectedClients: [
          {
            cuid: testCuid2,
            isConnected: true,
            primaryAccountHolder: testUserId2,
          },
        ],
      });
    });

    it('should return only active vendors for a client', async () => {
      const result = await vendorDAO.getClientVendors(testCuid);

      expect(result.items.length).toBe(1);
      expect(result.items[0].companyName).toBe('Client 1 Vendor Active');
    });

    it('should return empty list for client with no vendors', async () => {
      const result = await vendorDAO.getClientVendors('NONEXISTENT_CLIENT');

      expect(result.items.length).toBe(0);
      expect(result.pagination?.total).toBe(0);
    });

    it('should not return soft-deleted vendors', async () => {
      await Vendor.create({
        companyName: 'Deleted Client Vendor',
        businessType: 'Painting',
        registrationNumber: 'REG-DELETED-CLIENT',
        deletedAt: new Date(),
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const result = await vendorDAO.getClientVendors(testCuid);

      expect(result.items.length).toBe(1);
      expect(result.items[0].companyName).toBe('Client 1 Vendor Active');
    });

    it('should return correct pagination information', async () => {
      const result = await vendorDAO.getClientVendors(testCuid);

      expect(result.pagination).toBeDefined();
      expect(result.pagination?.total).toBe(1);
    });
  });

  describe('getFilteredVendors', () => {
    beforeEach(async () => {
      // Create diverse vendor dataset
      await Vendor.insertMany([
        {
          companyName: 'Alpha Plumbing',
          businessType: 'Plumbing',
          registrationNumber: 'REG-ALPHA',
          contactPerson: {
            name: 'Alice Anderson',
            jobTitle: 'Manager',
          },
          servicesOffered: {
            plumbing: true,
          },
          connectedClients: [
            {
              cuid: testCuid,
              isConnected: true,
              primaryAccountHolder: testUserId,
            },
          ],
        },
        {
          companyName: 'Beta Electrical',
          businessType: 'Electrical',
          registrationNumber: 'REG-BETA',
          contactPerson: {
            name: 'Bob Brown',
            jobTitle: 'Owner',
          },
          servicesOffered: {
            electrical: true,
          },
          connectedClients: [
            {
              cuid: testCuid,
              isConnected: true,
              primaryAccountHolder: testUserId,
            },
          ],
        },
        {
          companyName: 'Gamma HVAC',
          businessType: 'HVAC',
          registrationNumber: 'REG-GAMMA',
          contactPerson: {
            name: 'Charlie Chen',
            jobTitle: 'Technician',
          },
          servicesOffered: {
            hvac: true,
          },
          connectedClients: [
            {
              cuid: testCuid,
              isConnected: false,
              primaryAccountHolder: testUserId,
            },
          ],
        },
        {
          companyName: 'Delta Plumbing',
          businessType: 'Plumbing',
          registrationNumber: 'REG-DELTA',
          servicesOffered: {
            plumbing: true,
          },
          connectedClients: [
            {
              cuid: testCuid,
              isConnected: true,
              primaryAccountHolder: testUserId,
            },
          ],
        },
      ]);
    });

    it('should return all vendors for a client with no filters', async () => {
      const result = await vendorDAO.getFilteredVendors(testCuid, {});

      expect(result.items.length).toBe(4);
      expect(result.pagination!.total).toBe(4);
    });

    it('should filter vendors by business type', async () => {
      const result = await vendorDAO.getFilteredVendors(testCuid, {
        businessType: 'Plumbing',
      });

      expect(result.items.length).toBe(2);
      expect(result.items.every((v) => v.businessType === 'Plumbing')).toBe(true);
    });

    it('should filter vendors by connection status active', async () => {
      const result = await vendorDAO.getFilteredVendors(testCuid, {
        status: 'active',
      });

      expect(result.items.length).toBe(3);
      expect(
        result.items.every((v) => v.connectedClients.some((c) => c.cuid === testCuid && c.isConnected))
      ).toBe(true);
    });

    it('should filter vendors by connection status inactive', async () => {
      const result = await vendorDAO.getFilteredVendors(testCuid, {
        status: 'inactive',
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].companyName).toBe('Gamma HVAC');
    });

    it('should search vendors by company name', async () => {
      const result = await vendorDAO.getFilteredVendors(testCuid, {
        search: 'Alpha',
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].companyName).toBe('Alpha Plumbing');
    });

    it('should search vendors by contact person name', async () => {
      const result = await vendorDAO.getFilteredVendors(testCuid, {
        search: 'Bob',
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].companyName).toBe('Beta Electrical');
    });

    it('should combine multiple filters', async () => {
      const result = await vendorDAO.getFilteredVendors(testCuid, {
        businessType: 'Plumbing',
        status: 'active',
        search: 'Delta',
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].companyName).toBe('Delta Plumbing');
    });
  });

  describe('getFilteredVendors - pagination', () => {
    beforeEach(async () => {
      // Create 15 vendors for pagination testing
      const vendors = Array.from({ length: 15 }, (_, i) => ({
        companyName: `Vendor ${i + 1}`,
        businessType: 'General Contractor',
        registrationNumber: `REG-PAGE-${i + 1}`,
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      }));

      await Vendor.insertMany(vendors);
    });

    it('should paginate results with default limit', async () => {
      const result = await vendorDAO.getFilteredVendors(testCuid, {});

      expect(result.items.length).toBe(10);
      expect(result.pagination!.perPage).toBe(10);
      expect(result.pagination!.total).toBe(15);
      expect(result.pagination!.totalPages).toBe(2);
      expect(result.pagination!.currentPage).toBe(1);
      expect(result.pagination!.hasMoreResource).toBe(true);
    });

    it('should paginate with custom limit', async () => {
      const result = await vendorDAO.getFilteredVendors(testCuid, {}, { limit: 5 });

      expect(result.items.length).toBe(5);
      expect(result.pagination!.perPage).toBe(5);
      expect(result.pagination!.totalPages).toBe(3);
    });

    it('should skip records with offset', async () => {
      const result = await vendorDAO.getFilteredVendors(testCuid, {}, { skip: 10, limit: 10 });

      expect(result.items.length).toBe(5);
      expect(result.pagination!.currentPage).toBe(2);
      expect(result.pagination!.hasMoreResource).toBe(false);
    });

    it('should return correct page information for last page', async () => {
      const result = await vendorDAO.getFilteredVendors(testCuid, {}, { skip: 10, limit: 10 });

      expect(result.pagination!.currentPage).toBe(2);
      expect(result.pagination!.totalPages).toBe(2);
      expect(result.pagination!.hasMoreResource).toBe(false);
    });
  });

  describe('getClientVendorStats', () => {
    beforeEach(async () => {
      await Vendor.insertMany([
        {
          companyName: 'Stats Plumbing 1',
          businessType: 'Plumbing',
          registrationNumber: 'REG-STATS-1',
          servicesOffered: {
            plumbing: true,
            electrical: true,
          },
          connectedClients: [
            {
              cuid: testCuid,
              isConnected: true,
              primaryAccountHolder: testUserId,
            },
          ],
        },
        {
          companyName: 'Stats Plumbing 2',
          businessType: 'Plumbing',
          registrationNumber: 'REG-STATS-2',
          servicesOffered: {
            plumbing: true,
          },
          connectedClients: [
            {
              cuid: testCuid,
              isConnected: true,
              primaryAccountHolder: testUserId,
            },
          ],
        },
        {
          companyName: 'Stats Electrical',
          businessType: 'Electrical',
          registrationNumber: 'REG-STATS-3',
          servicesOffered: {
            electrical: true,
            hvac: true,
          },
          connectedClients: [
            {
              cuid: testCuid,
              isConnected: true,
              primaryAccountHolder: testUserId,
            },
          ],
        },
        {
          companyName: 'Stats HVAC',
          businessType: 'HVAC',
          registrationNumber: 'REG-STATS-4',
          servicesOffered: {
            hvac: true,
          },
          connectedClients: [
            {
              cuid: testCuid,
              isConnected: true,
              primaryAccountHolder: testUserId,
            },
          ],
        },
      ]);
    });

    it('should return total vendor count', async () => {
      const stats = await vendorDAO.getClientVendorStats(testCuid, {});

      expect(stats.totalVendors).toBe(4);
    });

    it('should calculate business type distribution', async () => {
      const stats = await vendorDAO.getClientVendorStats(testCuid, {});

      expect(stats.businessTypeDistribution).toBeDefined();
      expect(stats.businessTypeDistribution.length).toBeGreaterThan(0);

      const plumbingType = stats.businessTypeDistribution.find((t) => t.name === 'Plumbing');
      expect(plumbingType?.value).toBe(2);
      expect(plumbingType?.percentage).toBe(50);

      const electricalType = stats.businessTypeDistribution.find((t) => t.name === 'Electrical');
      expect(electricalType?.value).toBe(1);
      expect(electricalType?.percentage).toBe(25);
    });

    it('should calculate services distribution', async () => {
      const stats = await vendorDAO.getClientVendorStats(testCuid, {});

      expect(stats.servicesDistribution).toBeDefined();
      expect(stats.servicesDistribution.length).toBeGreaterThan(0);

      const plumbingService = stats.servicesDistribution.find((s) => s.name === 'Plumbing');
      expect(plumbingService?.value).toBe(2);

      const electricalService = stats.servicesDistribution.find((s) => s.name === 'Electrical');
      expect(electricalService?.value).toBe(2);

      const hvacService = stats.servicesDistribution.find((s) => s.name === 'Hvac');
      expect(hvacService?.value).toBe(2);
    });

    it('should sort business types by count descending', async () => {
      const stats = await vendorDAO.getClientVendorStats(testCuid, {});

      expect(stats.businessTypeDistribution[0].value).toBeGreaterThanOrEqual(
        stats.businessTypeDistribution[1].value
      );
    });

    it('should sort services by count descending', async () => {
      const stats = await vendorDAO.getClientVendorStats(testCuid, {});

      expect(stats.servicesDistribution[0].value).toBeGreaterThanOrEqual(
        stats.servicesDistribution[1].value
      );
    });

    it('should return zero stats for client with no vendors', async () => {
      const stats = await vendorDAO.getClientVendorStats('NONEXISTENT_CLIENT', {});

      expect(stats.totalVendors).toBe(0);
      expect(stats.businessTypeDistribution.length).toBe(0);
      expect(stats.servicesDistribution.length).toBe(0);
    });

    it('should handle vendors with no services offered', async () => {
      await Vendor.create({
        companyName: 'No Services Vendor',
        businessType: 'General Contractor',
        registrationNumber: 'REG-NO-SERVICES',
        connectedClients: [
          {
            cuid: testCuid,
            isConnected: true,
            primaryAccountHolder: testUserId,
          },
        ],
      });

      const stats = await vendorDAO.getClientVendorStats(testCuid, {});

      expect(stats.totalVendors).toBe(5);
      expect(stats.businessTypeDistribution.length).toBeGreaterThan(0);
    });
  });
});
