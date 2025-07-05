import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import { MailType } from '@interfaces/utils.interface';
import { generateShortUID, hashGenerator } from '@utils/index';
import { ICurrentUser, ISignupData, IUserRole } from '@interfaces/user.interface';

/**
 * Auth-specific test data factories
 */
export class AuthTestFactory {
  static createSignupData(overrides: Partial<ISignupData> = {}): ISignupData {
    return {
      email: faker.internet.email(),
      password: 'Password123!',
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      displayName: faker.internet.username(),
      phoneNumber: faker.phone.number(),
      location: faker.location.city(),
      lang: 'en',
      timeZone: 'America/New_York',
      accountType: {
        planId: 'basic',
        planName: 'Basic Plan',
        isCorporate: false,
        isEnterpriseAccount: false,
      },
      ...overrides,
    };
  }

  static createCorporateSignupData(overrides: Partial<ISignupData> = {}): ISignupData {
    const baseData = this.createSignupData();
    return {
      ...baseData,
      accountType: {
        planId: 'enterprise',
        planName: 'Enterprise Plan',
        isCorporate: true,
        isEnterpriseAccount: true,
      },
      companyProfile: {
        legalEntityName: faker.company.name(),
        tradingName: faker.company.name(),
        registrationNumber: faker.finance.accountNumber(8),
        industry: faker.commerce.department(),
        website: faker.internet.url(),
        contactInfo: {
          email: faker.internet.email(),
          phoneNumber: faker.phone.number(),
          contactPerson: faker.person.fullName(),
        },
      },
      ...overrides,
    };
  }

  static createLoginData(overrides = {}) {
    return {
      email: faker.internet.email(),
      password: 'Password123!',
      rememberMe: false,
      ...overrides,
    };
  }

  static createUserDocument(overrides = {}) {
    const userId = new Types.ObjectId();
    const clientId = generateShortUID();

    return {
      _id: userId,
      uid: generateShortUID(),
      email: faker.internet.email(),
      password: 'hashedPassword123',
      isActive: true,
      activeCid: clientId,
      activationToken: hashGenerator({ _usenano: true }),
      activationTokenExpiresAt: dayjs().add(2, 'hours').toDate(),
      passwordResetToken: null,
      passwordResetTokenExpiresAt: null,
      cids: [
        {
          cid: clientId,
          isConnected: true,
          roles: [IUserRole.ADMIN],
          displayName: faker.internet.username(),
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  static createMultiClientUserDocument() {
    const userId = new Types.ObjectId();
    const primaryClientId = generateShortUID();
    const secondaryClientId = generateShortUID();

    return {
      _id: userId,
      uid: generateShortUID(),
      email: faker.internet.email(),
      password: 'hashedPassword123',
      isActive: true,
      activeCid: primaryClientId,
      cids: [
        {
          cid: primaryClientId,
          isConnected: true,
          roles: [IUserRole.ADMIN],
          displayName: 'Primary Account',
        },
        {
          cid: secondaryClientId,
          isConnected: true,
          roles: [IUserRole.STAFF],
          displayName: 'Secondary Account',
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  static createClientDocument(overrides = {}) {
    return {
      cid: generateShortUID(),
      accountAdmin: new Types.ObjectId(),
      displayName: faker.company.name(),
      accountType: {
        planId: 'basic',
        planName: 'Basic Plan',
        isCorporate: false,
        isEnterpriseAccount: false,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  static createProfileDocument(overrides = {}) {
    return {
      _id: new Types.ObjectId(),
      user: new Types.ObjectId(),
      puid: generateShortUID(),
      personalInfo: {
        displayName: faker.internet.username(),
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        location: faker.location.city(),
        phoneNumber: faker.phone.number(),
      },
      lang: 'en',
      timeZone: 'America/New_York',
      fullname: faker.person.fullName(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  static createCurrentUserInfo(overrides: Partial<ICurrentUser> = {}): ICurrentUser {
    return {
      sub: new Types.ObjectId().toString(),
      email: faker.internet.email(),
      fullname: faker.person.fullName(),
      displayName: faker.internet.username(),
      avatarUrl: faker.image.avatar(),
      isActive: true,
      permissions: ['read', 'write', 'delete'],
      preferences: {
        theme: 'light',
        lang: 'en',
        timezone: 'America/New_York',
      },
      client: {
        csub: generateShortUID(),
        displayname: faker.company.name(),
        role: 'admin',
      },
      clients: [],
      ...overrides,
    };
  }

  static createJwtTokens(overrides = {}) {
    return {
      accessToken: 'mock-access-token-' + faker.string.alphanumeric(20),
      refreshToken: 'mock-refresh-token-' + faker.string.alphanumeric(30),
      rememberMe: false,
      ...overrides,
    };
  }

  static createRefreshTokenData(overrides = {}) {
    return {
      refreshToken: 'mock-refresh-token-' + faker.string.alphanumeric(30),
      userId: new Types.ObjectId().toString(),
      ...overrides,
    };
  }

  static createEmailData(type: MailType, overrides = {}) {
    const baseEmailData = {
      to: faker.internet.email(),
      subject: 'Test Email',
      emailType: type,
      data: {},
    };

    switch (type) {
      case MailType.ACCOUNT_ACTIVATION:
        return {
          ...baseEmailData,
          subject: 'Activate your account',
          data: {
            fullname: faker.person.fullName(),
            activationUrl: `${process.env.FRONTEND_URL}/${generateShortUID()}/account_activation?t=${hashGenerator({ _usenano: true })}`,
          },
          ...overrides,
        };

      case MailType.FORGOT_PASSWORD:
        return {
          ...baseEmailData,
          subject: 'Account Password Reset',
          data: {
            fullname: faker.person.fullName(),
            resetUrl: `${process.env.FRONTEND_URL}/reset_password/${hashGenerator({ _usenano: true })}`,
          },
          ...overrides,
        };

      case MailType.PASSWORD_RESET:
        return {
          ...baseEmailData,
          subject: 'Account Password Reset',
          data: {
            fullname: faker.person.fullName(),
          },
          ...overrides,
        };

      default:
        return {
          ...baseEmailData,
          ...overrides,
        };
    }
  }
}

/**
 * Auth test scenarios for comprehensive testing
 */
export class AuthTestScenarios {
  static getValidSignupScenarios() {
    return [
      {
        name: 'Individual basic account',
        data: AuthTestFactory.createSignupData(),
      },
      {
        name: 'Corporate enterprise account',
        data: AuthTestFactory.createCorporateSignupData(),
      },
      {
        name: 'Account with minimal required fields',
        data: AuthTestFactory.createSignupData({
          phoneNumber: undefined,
          location: undefined,
        }),
      },
    ];
  }

  static getInvalidSignupScenarios() {
    return [
      {
        name: 'Missing email',
        data: AuthTestFactory.createSignupData({ email: '' }),
        expectedError: 'validation',
      },
      {
        name: 'Invalid email format',
        data: AuthTestFactory.createSignupData({ email: 'invalid-email' }),
        expectedError: 'validation',
      },
      {
        name: 'Weak password',
        data: AuthTestFactory.createSignupData({ password: '123' }),
        expectedError: 'validation',
      },
      {
        name: 'Missing required fields',
        data: AuthTestFactory.createSignupData({
          firstName: '',
          lastName: '',
          displayName: '',
        }),
        expectedError: 'validation',
      },
    ];
  }

  static getValidLoginScenarios() {
    return [
      {
        name: 'Standard login without remember me',
        data: AuthTestFactory.createLoginData({ rememberMe: false }),
      },
      {
        name: 'Login with remember me enabled',
        data: AuthTestFactory.createLoginData({ rememberMe: true }),
      },
    ];
  }

  static getInvalidLoginScenarios() {
    return [
      {
        name: 'Missing email',
        data: AuthTestFactory.createLoginData({ email: '' }),
        expectedError: 'BadRequestError',
      },
      {
        name: 'Missing password',
        data: AuthTestFactory.createLoginData({ password: '' }),
        expectedError: 'BadRequestError',
      },
      {
        name: 'Non-existent user',
        data: AuthTestFactory.createLoginData({ email: 'nonexistent@example.com' }),
        expectedError: 'NotFoundError',
      },
      {
        name: 'Incorrect password',
        data: AuthTestFactory.createLoginData({ password: 'WrongPassword' }),
        expectedError: 'NotFoundError',
      },
      {
        name: 'Inactive user account',
        data: AuthTestFactory.createLoginData(),
        expectedError: 'InvalidRequestError',
      },
    ];
  }

  static getTokenRefreshScenarios() {
    return [
      {
        name: 'Valid refresh token',
        data: AuthTestFactory.createRefreshTokenData(),
      },
      {
        name: 'Refresh with remember me',
        data: AuthTestFactory.createRefreshTokenData(),
        rememberMe: true,
      },
    ];
  }

  static getInvalidTokenRefreshScenarios() {
    return [
      {
        name: 'Missing refresh token',
        data: AuthTestFactory.createRefreshTokenData({ refreshToken: '' }),
        expectedError: 'UnauthorizedError',
      },
      {
        name: 'Missing user ID',
        data: AuthTestFactory.createRefreshTokenData({ userId: '' }),
        expectedError: 'UnauthorizedError',
      },
      {
        name: 'Invalid refresh token',
        data: AuthTestFactory.createRefreshTokenData({ refreshToken: 'invalid-token' }),
        expectedError: 'UnauthorizedError',
      },
      {
        name: 'Expired refresh token',
        data: AuthTestFactory.createRefreshTokenData(),
        expectedError: 'UnauthorizedError',
      },
    ];
  }

  static getPasswordResetScenarios() {
    return [
      {
        name: 'Valid email for password reset',
        email: faker.internet.email(),
      },
      {
        name: 'Valid token and email for reset completion',
        email: faker.internet.email(),
        token: hashGenerator({ _usenano: true }),
      },
    ];
  }

  static getAccountActivationScenarios() {
    return [
      {
        name: 'Valid activation token',
        token: hashGenerator({ _usenano: true }),
      },
      {
        name: 'Resend activation link',
        email: faker.internet.email(),
      },
    ];
  }
}

/**
 * Auth-specific assertion helpers
 */
export class AuthAssertions {
  static expectTokenStructure(tokens: any) {
    expect(tokens).toHaveProperty('accessToken');
    expect(tokens).toHaveProperty('refreshToken');
    expect(tokens).toHaveProperty('rememberMe');
    expect(typeof tokens.accessToken).toBe('string');
    expect(typeof tokens.refreshToken).toBe('string');
    expect(typeof tokens.rememberMe).toBe('boolean');
  }

  static expectUserStructure(user: any) {
    expect(user).toHaveProperty('_id');
    expect(user).toHaveProperty('email');
    expect(user).toHaveProperty('isActive');
    expect(user).toHaveProperty('cids');
    expect(Array.isArray(user.cids)).toBe(true);
  }

  static expectClientStructure(client: any) {
    expect(client).toHaveProperty('cid');
    expect(client).toHaveProperty('accountAdmin');
    expect(client).toHaveProperty('displayName');
    expect(client).toHaveProperty('accountType');
  }

  static expectProfileStructure(profile: any) {
    expect(profile).toHaveProperty('personalInfo');
    expect(profile).toHaveProperty('fullname');
    expect(profile.personalInfo).toHaveProperty('firstName');
    expect(profile.personalInfo).toHaveProperty('lastName');
  }

  static expectEmailQueueCall(mockEmailQueue: any, emailType: MailType, recipient: string) {
    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        to: recipient,
        emailType: emailType,
      })
    );
  }

  static expectCacheOperations(mockAuthCache: any, operation: string, userId?: string) {
    switch (operation) {
      case 'invalidateUserSession':
        expect(mockAuthCache.invalidateUserSession).toHaveBeenCalledWith(userId);
        break;
      case 'saveRefreshToken':
        expect(mockAuthCache.saveRefreshToken).toHaveBeenCalledWith(
          userId,
          expect.any(String),
          expect.any(Boolean)
        );
        break;
      case 'getRefreshToken':
        expect(mockAuthCache.getRefreshToken).toHaveBeenCalledWith(userId);
        break;
      case 'saveCurrentUser':
        expect(mockAuthCache.saveCurrentUser).toHaveBeenCalledWith(expect.any(Object));
        break;
    }
  }

  static expectValidationError(error: any, field?: string) {
    expect(error).toBeInstanceOf(Error);
    if (field && error.errorInfo && error.errorInfo[field]) {
      expect(error.errorInfo[field]).toBeDefined();
    }
  }

  static expectSecurityMeasures(user: any) {
    // Ensure password is not exposed
    expect(user).not.toHaveProperty('password');

    // Ensure tokens have proper format
    if (user.activationToken) {
      expect(user.activationToken).toMatch(/^[a-zA-Z0-9]+$/);
    }

    if (user.passwordResetToken) {
      expect(user.passwordResetToken).toMatch(/^[a-zA-Z0-9]+$/);
    }
  }
}
