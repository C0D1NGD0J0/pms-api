import { Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import { ROLES } from '@shared/constants/roles.constants';
import { IUserDocument } from '@interfaces/user.interface';
import { ILeaseDocument } from '@interfaces/lease.interface';
import { IClientDocument } from '@interfaces/client.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { IPropertyDocument } from '@interfaces/property.interface';
import { IInvitationDocument } from '@interfaces/invitation.interface';
import { IPropertyUnitDocument } from '@interfaces/propertyUnit.interface';
import { PropertyUnit, Invitation, Property, Profile, Client, Lease, User } from '@models/index';

export interface CreateClientOptions {
  status?: 'active' | 'inactive' | 'suspended';
  displayName?: string;
  cuid?: string;
}

export const createTestClient = async (
  options: CreateClientOptions = {}
): Promise<IClientDocument> => {
  const cuid = options.cuid || `test-${faker.string.alphanumeric(8)}`;

  return Client.create({
    cuid,
    displayName: options.displayName || faker.company.name(),
    status: options.status || 'active',
    accountAdmin: new Types.ObjectId(),
    accountType: {
      planName: 'test_plan',
      planId: 'test_plan_id',
      features: [],
    },
    settings: {
      timezone: 'America/Toronto',
      currency: 'USD',
      dateFormat: 'MM/DD/YYYY',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

export interface CreateUserOptions {
  isEmailVerified?: boolean;
  clientCuid?: string;
  activecuid?: string; // Allow custom active cuid
  firstName?: string;
  isActive?: boolean;
  lastName?: string;
  password?: string;
  roles?: string[];
  email?: string;
  cuids?: any[];
}

export const createTestUser = async (
  clientCuid: string,
  options: CreateUserOptions = {}
): Promise<IUserDocument> => {
  const timestamp = Date.now();

  return User.create({
    uid: `uid-${faker.string.alphanumeric(12)}`,
    email: options.email || `user-${timestamp}@test.com`,
    firstName: options.firstName || faker.person.firstName(),
    lastName: options.lastName || faker.person.lastName(),
    password: options.password || '$2b$10$hashedPasswordForTesting',
    isActive: options.isActive ?? true,
    cuids: options.cuids || [
      {
        cuid: clientCuid,
        roles: options.roles || [ROLES.STAFF],
        isConnected: true,
        clientDisplayName: faker.company.name(),
      },
    ],
    activecuid: options.activecuid || clientCuid,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

export const createTestAdminUser = async (clientCuid: string): Promise<IUserDocument> => {
  return createTestUser(clientCuid, { roles: [ROLES.ADMIN] });
};

export const createTestManagerUser = async (clientCuid: string): Promise<IUserDocument> => {
  return createTestUser(clientCuid, { roles: [ROLES.MANAGER] });
};

export const createTestTenantUser = async (clientCuid: string): Promise<IUserDocument> => {
  return createTestUser(clientCuid, { roles: [ROLES.TENANT] });
};

export interface CreateInvitationOptions {
  status?: 'draft' | 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  inviteeEmail?: string;
  expiresAt?: Date;
  role?: string;
}

export const createTestInvitation = async (
  clientIdOrDoc: string | Types.ObjectId | IClientDocument,
  invitedBy: string | Types.ObjectId,
  options: CreateInvitationOptions = {}
): Promise<IInvitationDocument> => {
  const timestamp = Date.now();

  let clientId: Types.ObjectId;

  if (typeof clientIdOrDoc === 'object' && '_id' in clientIdOrDoc) {
    clientId = clientIdOrDoc._id;
  } else if (typeof clientIdOrDoc === 'object' && clientIdOrDoc instanceof Types.ObjectId) {
    clientId = clientIdOrDoc;
  } else {
    clientId = new Types.ObjectId(clientIdOrDoc as string);
  }

  return Invitation.create({
    iuid: `inv-${faker.string.alphanumeric(12)}`,
    inviteeEmail: options.inviteeEmail || `invitee-${timestamp}@test.com`,
    role: options.role || ROLES.STAFF,
    status: options.status || 'pending',
    clientId,
    invitedBy: typeof invitedBy === 'string' ? new Types.ObjectId(invitedBy) : invitedBy,
    invitationToken: faker.string.alphanumeric(64),
    expiresAt: options.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    personalInfo: {
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
    },
    metadata: {
      remindersSent: 0,
      lastReminderAt: null,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

export interface CreatePropertyOptions {
  propertyType?: 'single_family' | 'apartment' | 'condo' | 'townhouse' | 'commercial';
  status?: 'active' | 'inactive' | 'archived';
  maxAllowedUnits?: number;
  name?: string;
}

export const createTestProperty = async (
  cuid: string,
  clientId: string | Types.ObjectId,
  options: CreatePropertyOptions = {}
): Promise<IPropertyDocument> => {
  return Property.create({
    pid: `prop-${faker.string.alphanumeric(12)}`,
    cuid,
    clientId: typeof clientId === 'string' ? new Types.ObjectId(clientId) : clientId,
    name: options.name || `${faker.location.street()} Property`,
    propertyType: options.propertyType || 'apartment',
    status: options.status || 'active',
    maxAllowedUnits: options.maxAllowedUnits || 20,
    address: {
      streetAddress: faker.location.streetAddress(),
      city: faker.location.city(),
      state: faker.location.state(),
      postalCode: faker.location.zipCode(),
      country: 'USA',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

export interface CreatePropertyUnitOptions {
  status?: 'available' | 'occupied' | 'maintenance' | 'reserved';
  monthlyRent?: number;
  unitNumber?: string;
  bathrooms?: number;
  bedrooms?: number;
  floor?: number;
}

export const createTestPropertyUnit = async (
  cuid: string,
  propertyId: string | Types.ObjectId,
  options: CreatePropertyUnitOptions = {}
): Promise<IPropertyUnitDocument> => {
  return PropertyUnit.create({
    puid: `unit-${faker.string.alphanumeric(12)}`,
    cuid,
    propertyId: typeof propertyId === 'string' ? new Types.ObjectId(propertyId) : propertyId,
    unitNumber: options.unitNumber || faker.string.numeric(3),
    status: options.status || 'available',
    floor: options.floor || 1,
    features: {
      bedrooms: options.bedrooms || 2,
      bathrooms: options.bathrooms || 1,
      squareFeet: faker.number.int({ min: 500, max: 2000 }),
    },
    financials: {
      monthlyRent: options.monthlyRent || faker.number.int({ min: 1000, max: 3000 }),
      currency: 'USD',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

export interface CreateProfileOptions {
  type?: 'tenant' | 'employee' | 'vendor';
}

export const createTestProfile = async (
  userId: string | Types.ObjectId,
  clientId: string | Types.ObjectId,
  options: CreateProfileOptions = {}
): Promise<IProfileDocument> => {
  return Profile.create({
    userId: typeof userId === 'string' ? new Types.ObjectId(userId) : userId,
    clientId: typeof clientId === 'string' ? new Types.ObjectId(clientId) : clientId,
    type: options.type || 'employee',
    contactInfo: {
      phone: faker.phone.number(),
      alternateEmail: faker.internet.email(),
    },
    emergencyContact: {
      name: faker.person.fullName(),
      phone: faker.phone.number(),
      relationship: 'spouse',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

export interface CreateLeaseOptions {
  status?: 'draft' | 'pending' | 'active' | 'expired' | 'terminated';
  monthlyRent?: number;
  startDate?: Date;
  endDate?: Date;
}

export const createTestLease = async (
  propertyUnitId: string | Types.ObjectId,
  tenantId: string | Types.ObjectId,
  clientId: string | Types.ObjectId,
  options: CreateLeaseOptions = {}
): Promise<ILeaseDocument> => {
  const startDate = options.startDate || new Date();
  const endDate = options.endDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  return Lease.create({
    luid: `lease-${faker.string.alphanumeric(12)}`,
    propertyUnitId:
      typeof propertyUnitId === 'string' ? new Types.ObjectId(propertyUnitId) : propertyUnitId,
    tenantId: typeof tenantId === 'string' ? new Types.ObjectId(tenantId) : tenantId,
    clientId: typeof clientId === 'string' ? new Types.ObjectId(clientId) : clientId,
    status: options.status || 'active',
    term: {
      startDate,
      endDate,
      type: 'fixed',
    },
    fees: {
      monthlyRent: options.monthlyRent || faker.number.int({ min: 1000, max: 3000 }),
      currency: 'USD',
      securityDeposit: faker.number.int({ min: 500, max: 2000 }),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

export interface TestClientWithAdmin {
  client: IClientDocument;
  admin: IUserDocument;
}

export const createTestClientWithAdmin = async (): Promise<TestClientWithAdmin> => {
  const client = await createTestClient();
  const admin = await createTestAdminUser(client.cuid);
  return { admin, client };
};

export interface TestPropertyWithUnit {
  property: IPropertyDocument;
  unit: IPropertyUnitDocument;
  client: IClientDocument;
}

export const createTestPropertyWithUnit = async (
  clientCuid?: string,
  clientId?: string | Types.ObjectId
): Promise<TestPropertyWithUnit> => {
  let client: IClientDocument;

  if (clientCuid && clientId) {
    client = (await Client.findById(clientId)) as IClientDocument;
  } else {
    client = await createTestClient();
  }

  const property = await createTestProperty(client.cuid, client._id);
  const unit = await createTestPropertyUnit(client.cuid, property._id);

  return { client, property, unit };
};

export interface TestLeaseScenario {
  property: IPropertyDocument;
  unit: IPropertyUnitDocument;
  client: IClientDocument;
  manager: IUserDocument;
  tenant: IUserDocument;
}

export const createTestLeaseScenario = async (): Promise<TestLeaseScenario> => {
  const client = await createTestClient();
  const manager = await createTestManagerUser(client.cuid);
  const tenant = await createTestTenantUser(client.cuid);
  const property = await createTestProperty(client.cuid, client._id);
  const unit = await createTestPropertyUnit(client.cuid, property._id);

  return { client, manager, property, tenant, unit };
};

export const generateUniqueEmail = (): string => {
  return `test-${Date.now()}-${faker.string.alphanumeric(6)}@test.com`;
};

export const generateUniqueId = (prefix = 'test'): string => {
  return `${prefix}-${Date.now()}-${faker.string.alphanumeric(6)}`;
};
