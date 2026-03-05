import { Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import { ROLES } from '@shared/constants/roles.constants';
import { IUserDocument } from '@interfaces/user.interface';
import { ILeaseDocument } from '@interfaces/lease.interface';
import { IClientDocument } from '@interfaces/client.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { IPropertyDocument } from '@interfaces/property.interface';
import { IInvitationDocument } from '@interfaces/invitation.interface';
import { Subscription, Invitation, Profile, Client, User } from '@models/index';
import { IPropertyUnitDocument } from '@interfaces/propertyUnit.interface';
import { ISubscriptionDocument } from '@interfaces/subscription.interface';

export interface SeededTestData {
  invitations: {
    pending1: IInvitationDocument;
    pending2: IInvitationDocument;
    accepted1: IInvitationDocument;
    declined1: IInvitationDocument;
    revoked1: IInvitationDocument;
  };

  users: {
    admin1: IUserDocument;
    staff1: IUserDocument;
    admin2: IUserDocument;
    staff2: IUserDocument;
    admin3: IUserDocument;
    multiClientUser: IUserDocument;
  };

  profiles: {
    admin1Profile: IProfileDocument;
    staff1Profile: IProfileDocument;
    admin2Profile: IProfileDocument;
  };

  properties: {
    property1: IPropertyDocument;
    property2: IPropertyDocument;
    property3: IPropertyDocument;
  };

  units: {
    unit1A: IPropertyUnitDocument;
    unit1B: IPropertyUnitDocument;
    unit2A: IPropertyUnitDocument;
  };

  leases: {
    activeLease1: ILeaseDocument;
    activeLease2: ILeaseDocument;
    expiredLease1: ILeaseDocument;
  };

  clients: {
    client1: IClientDocument;
    client2: IClientDocument;
    client3: IClientDocument;
  };

  subscriptions: {
    subscription1: ISubscriptionDocument;
    subscription2: ISubscriptionDocument;
  };
}

/**
 * Seed the test database with sample data
 * Call this in beforeAll() for read-heavy test suites
 */
export const seedTestData = async (): Promise<SeededTestData> => {
  const client1 = await Client.create({
    cuid: `test-client-1-${faker.string.alphanumeric(8)}`,
    displayName: 'Acme Property Management',
    accountAdmin: new Types.ObjectId(),
    accountType: {
      category: 'individual',
      isEnterpriseAccount: false,
    },
  });

  const client2 = await Client.create({
    cuid: `test-client-2-${faker.string.alphanumeric(8)}`,
    displayName: 'Summit Realty Group',
    accountAdmin: new Types.ObjectId(),
    accountType: {
      category: 'individual',
      isEnterpriseAccount: false,
    },
  });

  const client3 = await Client.create({
    cuid: `test-client-3-${faker.string.alphanumeric(8)}`,
    displayName: 'Coastal Properties LLC',
    accountAdmin: new Types.ObjectId(),
    accountType: {
      category: 'business',
      isEnterpriseAccount: true,
    },
    companyProfile: {
      tradingName: 'Coastal Properties LLC',
      legalEntityName: 'Coastal Properties Limited Liability Company',
      companyEmail: 'admin@coastal-props.com',
      companyAddress: '123 Ocean Drive, Miami Beach, FL 33139',
      companyPhone: '+13055550003',
    },
  });

  const admin1 = await User.create({
    uid: `uid-admin1-${faker.string.alphanumeric(10)}`,
    email: 'admin1@test.com',
    password: '$2b$10$hashedPasswordForTesting',
    firstName: 'John',
    lastName: 'Admin',
    isActive: true,
    isEmailVerified: true,
    cuids: [
      {
        cuid: client1.cuid,
        roles: [ROLES.ADMIN],
        clientDisplayName: client1.displayName,
        isConnected: true,
      },
    ],
    activecuid: client1.cuid,
    accountAdmin: true,
  });

  const staff1 = await User.create({
    uid: `uid-staff1-${faker.string.alphanumeric(10)}`,
    email: 'staff1@test.com',
    password: '$2b$10$hashedPasswordForTesting',
    firstName: 'Jane',
    lastName: 'Staff',
    isActive: true,
    isEmailVerified: true,
    cuids: [
      {
        cuid: client1.cuid,
        roles: [ROLES.STAFF],
        clientDisplayName: client1.displayName,
        isConnected: true,
      },
    ],
    activecuid: client1.cuid,
    accountAdmin: false,
  });

  const admin2 = await User.create({
    uid: `uid-admin2-${faker.string.alphanumeric(10)}`,
    email: 'admin2@test.com',
    password: '$2b$10$hashedPasswordForTesting',
    firstName: 'Bob',
    lastName: 'Manager',
    isActive: true,
    isEmailVerified: true,
    cuids: [
      {
        cuid: client2.cuid,
        roles: [ROLES.ADMIN],
        clientDisplayName: client2.displayName,
        isConnected: true,
      },
    ],
    activecuid: client2.cuid,
    accountAdmin: true,
  });

  const staff2 = await User.create({
    uid: `uid-staff2-${faker.string.alphanumeric(10)}`,
    email: 'staff2@test.com',
    password: '$2b$10$hashedPasswordForTesting',
    firstName: 'Alice',
    lastName: 'Worker',
    isActive: true,
    isEmailVerified: true,
    cuids: [
      {
        cuid: client2.cuid,
        roles: [ROLES.STAFF],
        clientDisplayName: client2.displayName,
        isConnected: true,
      },
    ],
    activecuid: client2.cuid,
    accountAdmin: false,
  });

  const admin3 = await User.create({
    uid: `uid-admin3-${faker.string.alphanumeric(10)}`,
    email: 'admin3@test.com',
    password: '$2b$10$hashedPasswordForTesting',
    firstName: 'Charlie',
    lastName: 'Director',
    isActive: true,
    isEmailVerified: true,
    cuids: [
      {
        cuid: client3.cuid,
        roles: [ROLES.ADMIN],
        clientDisplayName: client3.displayName,
        isConnected: true,
      },
    ],
    activecuid: client3.cuid,
    accountAdmin: true,
  });

  const multiClientUser = await User.create({
    uid: `uid-multi-${faker.string.alphanumeric(10)}`,
    email: 'multiclient@test.com',
    password: '$2b$10$hashedPasswordForTesting',
    firstName: 'Multi',
    lastName: 'Access',
    isActive: true,
    isEmailVerified: true,
    cuids: [
      {
        cuid: client1.cuid,
        roles: [ROLES.STAFF],
        clientDisplayName: client1.displayName,
        isConnected: true,
      },
      {
        cuid: client2.cuid,
        roles: [ROLES.STAFF],
        clientDisplayName: client2.displayName,
        isConnected: true,
      },
    ],
    activecuid: client1.cuid,
    accountAdmin: false,
  });

  const admin1Profile = await Profile.create({
    puid: `puid-admin1-${faker.string.alphanumeric(10)}`,
    user: admin1._id,
    personalInfo: {
      firstName: 'John',
      lastName: 'Admin',
      displayName: 'John Admin',
      location: 'San Francisco',
      phoneNumber: '555-1001',
    },
  });

  const staff1Profile = await Profile.create({
    puid: `puid-staff1-${faker.string.alphanumeric(10)}`,
    user: staff1._id,
    personalInfo: {
      firstName: 'Jane',
      lastName: 'Staff',
      displayName: 'Jane Staff',
      location: 'San Francisco',
      phoneNumber: '555-1002',
    },
  });

  const admin2Profile = await Profile.create({
    puid: `puid-admin2-${faker.string.alphanumeric(10)}`,
    user: admin2._id,
    personalInfo: {
      firstName: 'Bob',
      lastName: 'Manager',
      displayName: 'Bob Manager',
      location: 'Miami',
      phoneNumber: '555-2001',
    },
  });

  const pending1 = await Invitation.create({
    iuid: `inv-pending1-${faker.string.alphanumeric(10)}`,
    clientId: client1._id,
    inviteeEmail: 'pending1@test.com',
    role: ROLES.STAFF,
    status: 'pending',
    invitedBy: admin1._id,
    invitationToken: faker.string.alphanumeric(64),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    personalInfo: {
      firstName: 'Pending',
      lastName: 'User1',
    },
  });

  const pending2 = await Invitation.create({
    iuid: `inv-pending2-${faker.string.alphanumeric(10)}`,
    clientId: client1._id,
    inviteeEmail: 'pending2@test.com',
    role: ROLES.MANAGER,
    status: 'pending',
    invitedBy: admin1._id,
    invitationToken: faker.string.alphanumeric(64),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    personalInfo: {
      firstName: 'Pending',
      lastName: 'User2',
    },
  });

  const accepted1 = await Invitation.create({
    iuid: `inv-accepted1-${faker.string.alphanumeric(10)}`,
    clientId: client2._id,
    cuid: client2.cuid,
    inviteeEmail: staff2.email,
    role: ROLES.STAFF,
    status: 'accepted',
    invitedBy: admin2._id,
    invitationToken: faker.string.alphanumeric(64),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: new Date(),
    personalInfo: {
      firstName: 'Alice',
      lastName: 'Worker',
    },
  });

  const declined1 = await Invitation.create({
    iuid: `inv-declined1-${faker.string.alphanumeric(10)}`,
    clientId: client1._id,
    cuid: client1.cuid,
    inviteeEmail: 'declined@test.com',
    role: ROLES.STAFF,
    status: 'declined',
    invitedBy: admin1._id,
    invitationToken: faker.string.alphanumeric(64),
    expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    personalInfo: {
      firstName: 'Declined',
      lastName: 'User',
    },
  });

  const revoked1 = await Invitation.create({
    iuid: `inv-revoked1-${faker.string.alphanumeric(10)}`,
    clientId: client1._id,
    cuid: client1.cuid,
    inviteeEmail: 'revoked@test.com',
    role: ROLES.STAFF,
    status: 'revoked',
    invitedBy: admin1._id,
    invitationToken: faker.string.alphanumeric(64),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: new Date(),
    revokedBy: admin1._id,
    revokeReason: 'Position filled',
    personalInfo: {
      firstName: 'Revoked',
      lastName: 'User',
    },
  });

  // Create subscriptions for clients
  const subscription1 = await Subscription.create({
    cuid: client1.cuid,
    client: client1._id,
    planName: 'portfolio',
    status: 'active',
    startDate: new Date(),
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    billingInterval: 'monthly',
    billing: {
      customerId: 'cus_test123',
      provider: 'stripe',
      planId: 'price_portfolio123',
    },
    totalMonthlyPrice: 4900,
    currentSeats: 2,
    currentProperties: 0,
    currentUnits: 0,
  });

  const subscription2 = await Subscription.create({
    cuid: client2.cuid,
    client: client2._id,
    planName: 'essential',
    status: 'active',
    startDate: new Date(),
    endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
    billingInterval: 'monthly',
    billing: {
      customerId: 'none',
      provider: 'none',
      planId: 'plan_essential',
    },
    totalMonthlyPrice: 0,
    currentSeats: 2,
    currentProperties: 0,
    currentUnits: 0,
  });

  // Update client1 to reference subscription
  client1.subscription = subscription1._id;
  await client1.save();

  client2.subscription = subscription2._id;
  await client2.save();

  const property1 = null as any;
  const property2 = null as any;
  const property3 = null as any;
  const unit1A = null as any;
  const unit1B = null as any;
  const unit2A = null as any;
  const activeLease1 = null as any;
  const activeLease2 = null as any;
  const expiredLease1 = null as any;

  return {
    clients: {
      client1,
      client2,
      client3,
    },
    users: {
      admin1,
      staff1,
      admin2,
      staff2,
      admin3,
      multiClientUser,
    },
    profiles: {
      admin1Profile,
      staff1Profile,
      admin2Profile,
    },
    invitations: {
      pending1,
      pending2,
      accepted1,
      declined1,
      revoked1,
    },
    properties: {
      property1,
      property2,
      property3,
    },
    units: {
      unit1A,
      unit1B,
      unit2A,
    },
    leases: {
      activeLease1,
      activeLease2,
      expiredLease1,
    },
    subscriptions: {
      subscription1,
      subscription2,
    },
  };
};
