import { nanoid } from 'nanoid';
import { faker } from '@faker-js/faker';

import UserModel from '../../../app/models/user/user.model';
import UnitModel from '../../../app/models/unit/unit.model';
import ClientModel from '../../../app/models/client/client.model';
import VendorModel from '../../../app/models/vendor/vendor.model';
import ProfileModel from '../../../app/models/profile/profile.model';
import PropertyModel from '../../../app/models/property/property.model';

const DEFAULT_PASSWORD = 'Password123!';

/**
 * Create vendor with primary user and employees
 */
export async function createVendor(vendorData: any, client: any) {
  // Create primary vendor user
  const primaryUser = await UserModel.create({
    uid: generateUid(),
    activecuid: client.cuid,
    email: vendorData.email,
    password: DEFAULT_PASSWORD,
    firstName: vendorData.primaryContact.firstName,
    lastName: vendorData.primaryContact.lastName,
    isActive: true,
    isEmailVerified: true,
    cuids: [
      {
        cuid: client.cuid,
        roles: ['vendor'],
        isConnected: true,
        clientDisplayName: client.displayName,
      },
    ],
  });

  // Create vendor entity
  const vendor = await VendorModel.create({
    companyName: vendorData.companyName,
    businessType: vendorData.businessType,
    taxId: vendorData.taxId,
    registrationNumber: vendorData.registrationNumber,
    yearsInBusiness: vendorData.yearsInBusiness,
    servicesOffered: vendorData.servicesOffered,
    connectedClients: [
      {
        cuid: client.cuid,
        isConnected: true,
        primaryAccountHolder: primaryUser._id,
      },
    ],
    contactPerson: {
      name: `${vendorData.primaryContact.firstName} ${vendorData.primaryContact.lastName}`,
      email: vendorData.email,
      phone: vendorData.phone,
      jobTitle: vendorData.primaryContact.jobTitle,
    },
  });

  // Link vendor to user
  await UserModel.updateOne({ _id: primaryUser._id }, { linkedVendorEntity: vendor._id });

  // Create vendor profile
  await ProfileModel.create({
    user: primaryUser._id,
    puid: generateUid(),
    personalInfo: {
      firstName: vendorData.primaryContact.firstName,
      lastName: vendorData.primaryContact.lastName,
      displayName: `${vendorData.primaryContact.firstName} ${vendorData.primaryContact.lastName}`,
      location: `${vendorData.address.city}, ${vendorData.address.country}`,
      phoneNumber: vendorData.phone,
      avatar: {
        url: faker.image.avatar(),
      },
    },
    vendorInfo: {
      companyName: vendorData.companyName,
      businessType: vendorData.businessType,
      servicesOffered: Object.keys(vendorData.servicesOffered).filter(
        (key) => vendorData.servicesOffered[key]
      ),
    },
  });

  // Create vendor employees
  const employees = [];
  for (const empData of vendorData.employees) {
    const employee = await UserModel.create({
      uid: generateUid(),
      activecuid: client.cuid,
      email: empData.email,
      password: DEFAULT_PASSWORD,
      firstName: empData.firstName,
      lastName: empData.lastName,
      isActive: true,
      isEmailVerified: true,
      cuids: [
        {
          cuid: client.cuid,
          roles: ['vendor'],
          isConnected: true,
          clientDisplayName: client.displayName,
        },
      ],
      linkedVendorEntity: vendor._id,
    });

    await ProfileModel.create({
      user: employee._id,
      puid: generateUid(),
      personalInfo: {
        firstName: empData.firstName,
        lastName: empData.lastName,
        displayName: `${empData.firstName} ${empData.lastName}`,
        location: `${vendorData.address.city}, ${vendorData.address.country}`,
        phoneNumber: empData.phoneNumber,
        avatar: {
          url: faker.image.avatar(),
        },
      },
      vendorInfo: {
        companyName: vendorData.companyName,
        businessType: vendorData.businessType,
      },
    });

    employees.push(employee);
  }

  return { vendor, primaryUser, employees };
}

/**
 * Create property
 */
export async function createProperty(
  propertyData: any,
  client: any,
  managedBy: any,
  createdBy: any
) {
  const property = await PropertyModel.create({
    cuid: client.cuid,
    name: propertyData.name,
    propertyType: propertyData.propertyType,
    status: propertyData.status,
    occupancyStatus: propertyData.occupancyStatus,
    address: {
      street: propertyData.address.street,
      streetNumber: propertyData.address.streetNumber,
      city: propertyData.address.city,
      state: propertyData.address.state,
      country: propertyData.address.country,
      postCode: propertyData.address.postCode,
      fullAddress: `${propertyData.address.street}, ${propertyData.address.city}, ${propertyData.address.state}, ${propertyData.address.postCode}`,
    },
    computedLocation: {
      type: 'Point',
      coordinates: propertyData.coordinates,
    },
    specifications: propertyData.specifications,
    fees: {
      currency: client.companyProfile?.currency || 'USD',
      rentalAmount: propertyData.fees.rentalAmount,
      managementFees: propertyData.fees.managementFees,
      taxAmount: propertyData.fees.taxAmount,
      securityDeposit: propertyData.fees.securityDeposit || 0,
    },
    utilities: propertyData.utilities,
    interiorAmenities: propertyData.interiorAmenities,
    communityAmenities: propertyData.communityAmenities,
    description: propertyData.description,
    yearBuilt: propertyData.yearBuilt,
    maxAllowedUnits: propertyData.maxAllowedUnits,
    managedBy: managedBy._id,
    createdBy: createdBy._id,
    approvalStatus: 'approved',
  });

  return property;
}

/**
 * Create units for multi-tenant property
 */
export async function createUnits(property: any, count: number, currency: string, createdBy: any) {
  const units = [];

  for (let i = 1; i <= count; i++) {
    const unitNumber = (100 + i).toString(); // 101, 102, ..., 115
    const rentAmount =
      property.fees.rentalAmount * 0.6 + Math.random() * property.fees.rentalAmount * 0.4; // 60-100% of property base rent

    units.push({
      propertyId: property._id,
      cuid: property.cuid,
      unitNumber,
      unitType: 'residential',
      status: i % 3 === 0 ? 'occupied' : 'available', // Every 3rd unit is occupied
      occupancyStatus: i % 3 === 0 ? 'occupied' : 'vacant',
      specifications: {
        bedrooms: Math.floor(Math.random() * 2) + 1, // 1-2 bedrooms
        bathrooms: 1,
        totalArea: 650 + Math.random() * 300, // 650-950 sq ft
        floors: 1,
      },
      fees: {
        currency,
        rentAmount: Math.floor(rentAmount),
        managementFees: Math.floor(property.fees.managementFees * 0.1),
        taxAmount: Math.floor(property.fees.taxAmount * 0.1),
      },
      utilities: property.utilities,
      interiorAmenities: property.interiorAmenities,
      createdBy: createdBy._id,
    });
  }

  await UnitModel.insertMany(units);
  return units;
}

/**
 * Create staff user
 */
export async function createStaffUser(
  staffData: any,
  client: any,
  reportsToUser: any,
  region: any
) {
  const user = await UserModel.create({
    uid: generateUid(),
    activecuid: client.cuid,
    email: staffData.email,
    password: DEFAULT_PASSWORD,
    firstName: staffData.firstName,
    lastName: staffData.lastName,
    isActive: true,
    isEmailVerified: true,
    cuids: [
      {
        cuid: client.cuid,
        roles: ['staff'],
        isConnected: true,
        clientDisplayName: client.displayName,
      },
    ],
  });

  await ProfileModel.create({
    user: user._id,
    puid: generateUid(),
    personalInfo: {
      firstName: staffData.firstName,
      lastName: staffData.lastName,
      displayName: `${staffData.firstName} ${staffData.lastName}`,
      location: `${region.city}, ${region.state}, ${region.country}`,
      phoneNumber: staffData.phoneNumber,
      avatar: {
        url: faker.image.avatar(),
      },
    },
    employeeInfo: {
      department: staffData.department,
      jobTitle: staffData.jobTitle,
      reportsTo: reportsToUser._id,
    },
  });

  return user;
}

/**
 * Create admin user
 */
export async function createAdminUser(adminData: any, client: any, region: any) {
  const user = await UserModel.create({
    uid: generateUid(),
    activecuid: client.cuid,
    email: adminData.email,
    password: DEFAULT_PASSWORD,
    firstName: adminData.firstName,
    lastName: adminData.lastName,
    isActive: true,
    isEmailVerified: true,
    cuids: [
      {
        cuid: client.cuid,
        roles: ['admin'],
        isConnected: true,
        clientDisplayName: client.displayName,
      },
    ],
  });

  await ProfileModel.create({
    user: user._id,
    puid: generateUid(),
    personalInfo: {
      firstName: adminData.firstName,
      lastName: adminData.lastName,
      displayName: `${adminData.firstName} ${adminData.lastName}`,
      location: `${region.city}, ${region.state}, ${region.country}`,
      phoneNumber: adminData.phoneNumber,
      avatar: {
        url: faker.image.avatar(),
      },
    },
  });

  return user;
}

/**
 * Create a client account
 */
export async function createClient(data: any, createdBy: any) {
  const client = await ClientModel.create({
    cuid: generateCuid(),
    displayName: data.displayName,
    accountType: {
      planId: data.planId,
      planName: data.planName,
      isEnterpriseAccount: data.isEnterpriseAccount,
    },
    companyProfile: {
      legalEntityName: data.legalEntityName,
      tradingName: data.tradingName,
      companyEmail: data.companyEmail,
      companyPhone: data.companyPhone,
      industry: data.industry,
      website: data.website,
      registrationNumber: data.registrationNumber,
    },
    settings: {
      timeZone: data.timeZone,
      lang: data.lang,
      notificationPreferences: {
        email: true,
        sms: true,
        inApp: true,
      },
    },
    isVerified: true,
    accountAdmin: createdBy._id,
    createdBy: createdBy._id,
    lastModifiedBy: createdBy._id,
  });

  return client;
}

/**
 * Clean database before seeding
 */
export async function cleanDatabase() {
  await Promise.all([
    ClientModel.deleteMany({}),
    UserModel.deleteMany({}),
    ProfileModel.deleteMany({}),
    VendorModel.deleteMany({}),
    PropertyModel.deleteMany({}),
    UnitModel.deleteMany({}),
  ]);
}

/**
 * Generate unique client ID (cuid)
 */
export function generateCuid(): string {
  return `client_${faker.string.alphanumeric(12)}`;
}

/**
 * Generate a unique user ID
 */
function generateUid(): string {
  return nanoid(12).toUpperCase();
}
