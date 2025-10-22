#!/usr/bin/env ts-node

import path from 'path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from 'dotenv';

import { DEFAULT_CONFIG, RegionConfig, SeedConfig, PRESETS, REGIONS } from './config/seed-config';
import {
  createAdminUser,
  createStaffUser,
  createProperty,
  cleanDatabase,
  createClient,
  createVendor,
  createUnits,
} from './utils/seed-helpers';
import {
  generateVendorEmployeeData,
  generatePropertyData,
  generateClientData,
  generateVendorData,
  generateAdminData,
  generateStaffData,
} from './utils/generators';

// Load environment variables
config({ path: path.resolve(__dirname, '../../.env') });

interface SeedOptions {
  preset?: 'minimal' | 'full' | 'singleRegion' | 'large';
  properties?: number;
  regions?: string[]; // ['canada', 'uk', 'nigeria']
  vendors?: number;
  clean?: boolean;
  admins?: number;
  staff?: number;
}

class DatabaseSeeder {
  private config: SeedConfig;
  private stats = {
    clients: 0,
    admins: 0,
    staff: 0,
    vendors: 0,
    vendorEmployees: 0,
    properties: 0,
    units: 0,
  };

  constructor(options: SeedOptions = {}) {
    // Apply preset if specified
    if (options.preset && PRESETS[options.preset]) {
      this.config = PRESETS[options.preset];
    } else {
      this.config = { ...DEFAULT_CONFIG };
    }

    // Override with custom options
    if (options.regions) {
      this.config.regions = options.regions.map((r) => REGIONS[r.toLowerCase()]).filter(Boolean);
    }
    if (options.admins) this.config.counts.adminsPerClient = options.admins;
    if (options.staff) this.config.counts.staffPerClient = options.staff;
    if (options.vendors) this.config.counts.vendorsPerClient = options.vendors;
    if (options.properties) this.config.counts.propertiesPerClient = options.properties;
  }

  async connect() {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/pms-app-2-test';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB');
  }

  async disconnect() {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  }

  async seed() {
    console.log('\n🌱 Starting database seed...\n');
    console.log('Configuration:');
    console.log(`  Regions: ${this.config.regions.map((r) => r.name).join(', ')}`);
    console.log(`  Admins per client: ${this.config.counts.adminsPerClient}`);
    console.log(`  Staff per client: ${this.config.counts.staffPerClient}`);
    console.log(`  Vendors per client: ${this.config.counts.vendorsPerClient}`);
    console.log(`  Properties per client: ${this.config.counts.propertiesPerClient}\n`);

    const hash = '$2b$10$TbUkAvcUsKD7TRaMBP7Am.gaLpHbqPcCoa80wc4YSOQZVwIj0k1oO';
    const password = 'Password123!';

    const match = await bcrypt.compare(password, hash);
    console.log(match ? '✅ Match' : '❌ No match');

    for (const region of this.config.regions) {
      await this.seedRegion(region);
    }

    this.printSummary();
  }

  async seedRegion(region: RegionConfig) {
    console.log(`\n📍 Seeding ${region.name} (${region.planTier.toUpperCase()} tier)...\n`);

    // 1. Generate and create client
    const clientData = generateClientData(region);

    // Create first admin to use as createdBy
    const firstAdminData = generateAdminData(region, clientData.companyEmail);
    const tempAdmin = {
      _id: new mongoose.Types.ObjectId(),
      ...firstAdminData,
    };

    const client = await createClient(clientData, tempAdmin);
    this.stats.clients++;
    console.log(`  ✓ Created client: ${client.displayName}`);

    // 2. Create admins
    const admins = [];
    for (let i = 0; i < this.config.counts.adminsPerClient; i++) {
      const adminData =
        i === 0 ? firstAdminData : generateAdminData(region, clientData.companyEmail);
      const admin = await createAdminUser(adminData, client, region);
      admins.push(admin);
      this.stats.admins++;
    }

    // Update client with actual first admin
    await client.updateOne({ accountAdmin: admins[0]._id });
    console.log(`  ✓ Created ${admins.length} admins`);

    // 3. Create staff
    const staff = [];
    for (let i = 0; i < this.config.counts.staffPerClient; i++) {
      const isOperations = i < this.config.counts.staffInOperations;
      const staffData = generateStaffData(region, clientData.companyEmail, isOperations);
      const staffUser = await createStaffUser(staffData, client, admins[0], region);
      staff.push(staffUser);
      this.stats.staff++;
    }
    console.log(
      `  ✓ Created ${staff.length} staff (${this.config.counts.staffInOperations} in operations)`
    );

    // 4. Create vendors
    const vendors = [];
    for (let i = 0; i < this.config.counts.vendorsPerClient; i++) {
      const vendorData = generateVendorData(region, i);

      // Generate employees separately
      const employeeDataList = [];
      for (let j = 0; j < this.config.counts.vendorEmployeesPerVendor; j++) {
        employeeDataList.push(generateVendorEmployeeData(region, vendorData.email));
      }

      // Add employees to vendorData for createVendor function
      const vendorDataWithEmployees = {
        ...vendorData,
        employees: employeeDataList,
      };

      const { vendor, primaryUser, employees } = await createVendor(
        vendorDataWithEmployees,
        client
      );
      vendors.push({ vendor, primaryUser, employees });
      this.stats.vendors++;
      this.stats.vendorEmployees += employees.length;
    }
    console.log(
      `  ✓ Created ${vendors.length} vendors with ${vendors.length * this.config.counts.vendorEmployeesPerVendor} employees`
    );

    // 5. Create properties
    const properties = [];
    const multiTenantCount = this.config.counts.multiTenantProperties;
    const housesCount = 2; // Always 2 houses
    const commercialCount = this.config.counts.propertiesPerClient - multiTenantCount - housesCount;

    // Multi-tenant residential
    for (let i = 0; i < multiTenantCount; i++) {
      const propertyData = generatePropertyData(region, true, false);
      const property = await createProperty(
        propertyData,
        client,
        staff[0] || admins[0], // managedBy
        admins[0] // createdBy
      );
      properties.push(property);
      this.stats.properties++;

      // Create units
      await createUnits(
        property,
        this.config.counts.unitsPerMultiTenant,
        region.currency,
        admins[0]
      );
      this.stats.units += this.config.counts.unitsPerMultiTenant;
    }

    // Commercial property
    for (let i = 0; i < commercialCount; i++) {
      const propertyData = generatePropertyData(region, false, true);
      const property = await createProperty(propertyData, client, staff[0] || admins[0], admins[0]);
      properties.push(property);
      this.stats.properties++;
    }

    // Houses
    for (let i = 0; i < housesCount; i++) {
      const propertyData = generatePropertyData(region, false, false);
      const property = await createProperty(propertyData, client, staff[0] || admins[0], admins[0]);
      properties.push(property);
      this.stats.properties++;
    }

    console.log(
      `  ✓ Created ${properties.length} properties (${multiTenantCount} multi-tenant with ${this.config.counts.unitsPerMultiTenant} units each, ${commercialCount} commercial, ${housesCount} houses)`
    );
  }

  printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Database seeded successfully!\n');
    console.log('Summary:');
    console.log('--------');
    console.log(`✓ ${this.stats.clients} Clients`);
    console.log(`✓ ${this.stats.admins} Admins`);
    console.log(`✓ ${this.stats.staff} Staff`);
    console.log(`✓ ${this.stats.vendors} Vendors`);
    console.log(`✓ ${this.stats.vendorEmployees} Vendor Employees`);
    console.log(`✓ ${this.stats.properties} Properties`);
    console.log(`✓ ${this.stats.units} Units`);
    console.log(
      `\nTotal Users: ${this.stats.admins + this.stats.staff + this.stats.vendors + this.stats.vendorEmployees}`
    );
    console.log('\nDefault password for all users: Password123!');
    console.log('='.repeat(60) + '\n');
  }
}

function printHelp() {
  console.log(`
Database Seeder - Property Management System

Usage:
  npm run seed:db [options]

Options:
  --clean                      Clean database before seeding
  --preset <name>              Use preset config: minimal, full, singleRegion, large
  --regions <list>             Comma-separated regions: canada,uk,nigeria
  --admins <number>            Number of admins per client
  --staff <number>             Number of staff per client
  --vendors <number>           Number of vendors per client
  --properties <number>        Number of properties per client
  --help                       Show this help message

Examples:
  # Seed with default config (all 3 regions)
  npm run seed:db

  # Clean and seed with minimal preset
  npm run seed:db -- --clean --preset minimal

  # Seed only Canada with custom counts
  npm run seed:db -- --regions canada --admins 3 --staff 10

  # Seed UK and Nigeria only
  npm run seed:db -- --regions uk,nigeria

  # Large dataset
  npm run seed:db -- --preset large

Presets:
  minimal      - 1 region, minimal counts (quick testing)
  full         - All 3 regions with default counts (default)
  singleRegion - 1 region (Canada) with full counts
  large        - All 3 regions with large counts (stress test)
  `);
}

// Parse command line arguments
function parseArgs(): SeedOptions {
  const args = process.argv.slice(2);
  const options: SeedOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--properties':
        options.properties = parseInt(args[++i]);
        break;
      case '--regions':
        options.regions = args[++i].split(',');
        break;
      case '--vendors':
        options.vendors = parseInt(args[++i]);
        break;
      case '--preset':
        options.preset = args[++i] as any;
        break;
      case '--admins':
        options.admins = parseInt(args[++i]);
        break;
      case '--clean':
        options.clean = true;
        break;
      case '--staff':
        options.staff = parseInt(args[++i]);
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

// Main execution
async function main() {
  const options = parseArgs();

  const seeder = new DatabaseSeeder(options);

  try {
    await seeder.connect();

    if (options.clean) {
      console.log('🧹 Cleaning database...');
      await cleanDatabase();
      console.log('✓ Database cleaned\n');
    }

    await seeder.seed();
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  } finally {
    await seeder.disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { DatabaseSeeder, SeedOptions };
