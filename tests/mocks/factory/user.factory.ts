import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { v4 as uuid } from 'uuid';
import { faker } from '@faker-js/faker';
import { User, Client } from '@models/index';
import { hashGenerator } from '@utils/index';
import { ICompanyInfo } from '@interfaces/client.interface';
import { IUserRole, IUserDocument, ISignupData } from '@interfaces/user.interface';

class UserFactory {
  create = async (data: Partial<ISignupData>) => {
    const _userId = new Types.ObjectId();
    const clientId = uuid();

    // create client record with proper accountType structure
    await Client.create({
      cid: clientId,
      accountAdmin: _userId,
      accountType: data?.accountType || this.defaultAccountType(),
      ...(data?.accountType?.isEnterpriseAccount
        ? { companyInfo: await this.defaultCompany() }
        : {}),
    });

    // create user record
    return (await User.create({
      ...(await this.defaultUser()),
      ...data,
      uid: uuid(),
      _id: _userId,
      cid: clientId,
      isActive: true,
      activationToken: hashGenerator({ usenano: true }),
      cids: [{ cid: clientId, roles: [IUserRole.ADMIN], isConnected: false }],
      activationTokenExpiresAt: dayjs().add(2, 'hour').toDate(),
    })) as IUserDocument;
  };

  build = async (data: Partial<ISignupData>) => {
    const _userId = new Types.ObjectId();
    const clientId = uuid();

    // create client record with proper accountType structure
    await Client.create({
      cid: clientId,
      accountAdmin: _userId,
      accountType: data?.accountType || this.defaultAccountType(),
      ...(data?.accountType?.isEnterpriseAccount
        ? { companyInfo: data.companyInfo || (await this.defaultCompany()) }
        : {}),
    });

    // create user record
    return new User({
      ...(await this.defaultUser()),
      ...data,
      uid: uuid(),
      _id: _userId,
      cid: clientId,
      isActive: false,
      activationToken: hashGenerator({ usenano: true }),
      cids: [{ cid: clientId, roles: [IUserRole.ADMIN], isConnected: false }],
      activationTokenExpiresAt: dayjs().add(2, 'hour').toDate(),
    }) as IUserDocument;
  };

  getPlainUserObject = async () => {
    return {
      user: await this.defaultUser(),
      accountType: this.defaultAccountType(false),
      companyInfo: await this.defaultCompany(),
    };
  };

  seedUsersAndClients = async () => {
    try {
      const maxUsers = [1, 2, 3, 4, 5];
      for (const x of maxUsers) {
        const data: Partial<ISignupData> = {
          accountType:
            x > 3
              ? {
                  planId: 'enterprise',
                  planName: 'Enterprise Plan',
                  isEnterpriseAccount: true,
                }
              : {
                  planId: 'basic',
                  planName: 'Basic Plan',
                  isEnterpriseAccount: false,
                },
        };

        if (data.accountType.isEnterpriseAccount) {
          data.companyInfo = await this.defaultCompany();
        }

        await this.create(data);
      }
      return { success: true };
    } catch (error) {
      console.log(error);
    }
  };

  getUser = async () => {
    try {
      const users = (await User.find({})) as IUserDocument[];
      return users[0];
    } catch (error) {
      console.log(error);
    }
  };

  private defaultUser = async () => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();

    return {
      lastName,
      firstName,
      password: 'password',
      phoneNumber: faker.phone.number(),
      location: faker.location.city(),
      email: `${firstName.toLowerCase()}_${lastName.toLowerCase()}@yopmail.com`,
    };
  };

  private defaultAccountType = (isIndividual = true) => {
    return isIndividual
      ? {
          planId: 'basic',
          planName: 'Basic Plan',
          isEnterpriseAccount: false,
        }
      : {
          planId: 'enterprise',
          planName: 'Enterprise Plan',
          isEnterpriseAccount: true,
        };
  };

  private defaultCompany = async (): Promise<ICompanyInfo> => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const entityName = faker.company.name();
    const tradingName = entityName.split(' ')[0];

    return {
      legalEntityName: entityName,
      tradingName: tradingName,
      businessType: 'Corporation',
      registrationNumber: faker.finance.accountNumber(8),
      yearEstablished: 2010 + Math.floor(Math.random() * 13), // Random year between 2010-2023
      industry: faker.commerce.department(),
      website: `https://www.${entityName.toLowerCase().replace(/\s/g, '')}.com`,
      contactInfo: {
        email: `contact@${entityName.toLowerCase().replace(/\s/g, '')}.com`,
        address: faker.location.streetAddress(),
        phoneNumber: faker.phone.number(),
        contactPerson: `${firstName} ${lastName}`,
      },
    };
  };
}

export default new UserFactory();
