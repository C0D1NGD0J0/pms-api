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
    settings: {
      lang: 'en',
      timeZone: 'UTC',
      theme: 'light',
      loginType: 'password',
      notifications: {
        emailNotifications: true,
        inAppNotifications: true,
        emailFrequency: 'daily',
        propertyUpdates: true,
        announcements: true,
        maintenance: true,
        comments: true,
        messages: true,
        payments: true,
        system: true,
      },
      gdprSettings: {
        dataRetentionPolicy: 'standard',
        dataProcessingConsent: true,
        processingConsentDate: new Date(),
        retentionExpiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    },
    policies: {
      tos: {
        accepted: true,
        acceptedOn: new Date(),
      },
      marketing: {
        accepted: false,
        acceptedOn: null,
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
      settings: {
        lang: 'en',
        timeZone: 'UTC',
        theme: 'light',
        loginType: 'password',
        notifications: {
          emailNotifications: true,
          inAppNotifications: true,
          emailFrequency: 'daily',
          propertyUpdates: true,
          announcements: true,
          maintenance: true,
          comments: true,
          messages: true,
          payments: true,
          system: true,
        },
        gdprSettings: {
          dataRetentionPolicy: 'standard',
          dataProcessingConsent: true,
          processingConsentDate: new Date(),
          retentionExpiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      },
      policies: {
        tos: {
          accepted: true,
          acceptedOn: new Date(),
        },
        marketing: {
          accepted: false,
          acceptedOn: null,
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
 * Create units for multi-tenant property
 */
export async function createUnits(property: any, count: number, currency: string, createdBy: any) {
  const units = [];

  // Create 3-7 units as requested
  const numUnits = Math.max(3, Math.min(count, 7));

  for (let i = 1; i <= numUnits; i++) {
    // Generate floor number (0-5 for variety)
    const floor = i <= 2 ? 1 : Math.floor((i - 1) / 2) + 1; // Units 1-2 on floor 1, then 2 per floor
    const unitNumber = `${floor}0${i % 2 === 0 ? 2 : 1}`; // 101, 102, 201, 202, 301, 302, 401

    const bedrooms = faker.number.int({ min: 1, max: 3 }); // 1-3 bedrooms
    const bathrooms = faker.number.int({ min: 1, max: 2 }); // 1-2 bathrooms
    const totalArea = faker.number.int({ min: 650, max: 1200 }); // 650-1200 sq ft

    const rentAmount =
      property.fees.rentalAmount * 0.7 + Math.random() * property.fees.rentalAmount * 0.3; // 70-100% of property base rent

    units.push({
      propertyId: property._id,
      cuid: property.cuid,
      unitNumber,
      unitType: 'residential',
      status: i % 4 === 0 ? 'occupied' : 'available', // Every 4th unit is occupied
      floor,
      specifications: {
        bedrooms,
        bathrooms,
        totalArea,
        maxOccupants: bedrooms * 2, // 2 people per bedroom
      },
      fees: {
        currency,
        rentAmount: Math.floor(rentAmount),
        securityDeposit: Math.floor(rentAmount), // Security deposit = 1 month rent
      },
      utilities: {
        water: faker.datatype.boolean(),
        gas: faker.datatype.boolean(),
        heating: faker.datatype.boolean(),
        trash: faker.datatype.boolean(),
        centralAC: faker.datatype.boolean(),
      },
      amenities: {
        airConditioning: faker.datatype.boolean(),
        washerDryer: faker.datatype.boolean(),
        dishwasher: faker.datatype.boolean(),
        parking: faker.datatype.boolean(),
        storage: faker.datatype.boolean(),
        cableTV: faker.datatype.boolean(),
        internet: faker.datatype.boolean(),
      },
      isActive: true,
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
    settings: {
      lang: region.lang || 'en',
      timeZone: region.timezone || 'UTC',
      theme: 'light',
      loginType: 'password',
      notifications: {
        emailNotifications: true,
        inAppNotifications: true,
        emailFrequency: 'daily',
        propertyUpdates: true,
        announcements: true,
        maintenance: true,
        comments: true,
        messages: true,
        payments: true,
        system: true,
      },
      gdprSettings: {
        dataRetentionPolicy: 'standard',
        dataProcessingConsent: true,
        processingConsentDate: new Date(),
        retentionExpiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    },
    policies: {
      tos: {
        accepted: true,
        acceptedOn: new Date(),
      },
      marketing: {
        accepted: false,
        acceptedOn: null,
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
    settings: {
      lang: region.lang || 'en',
      timeZone: region.timezone || 'UTC',
      theme: 'light',
      loginType: 'password',
      notifications: {
        emailNotifications: true,
        inAppNotifications: true,
        emailFrequency: 'daily',
        propertyUpdates: true,
        announcements: true,
        maintenance: true,
        comments: true,
        messages: true,
        payments: true,
        system: true,
      },
      gdprSettings: {
        dataRetentionPolicy: 'standard',
        dataProcessingConsent: true,
        processingConsentDate: new Date(),
        retentionExpiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    },
    policies: {
      tos: {
        accepted: true,
        acceptedOn: new Date(),
      },
      marketing: {
        accepted: false,
        acceptedOn: null,
      },
    },
  });

  return user;
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
