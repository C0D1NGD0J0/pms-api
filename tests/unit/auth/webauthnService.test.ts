import { WebAuthnService } from '@services/auth/webauthn.service';
import { UnauthorizedError, BadRequestError, NotFoundError } from '@shared/customErrors';

// ── Mock @simplewebauthn/server ─────────────────────────────────────────────

const mockGenerateRegOptions = jest.fn();
const mockVerifyRegResponse = jest.fn();
const mockGenerateAuthOptions = jest.fn();
const mockVerifyAuthResponse = jest.fn();

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (...args: unknown[]) => mockGenerateRegOptions(...args),
  verifyRegistrationResponse: (...args: unknown[]) => mockVerifyRegResponse(...args),
  generateAuthenticationOptions: (...args: unknown[]) => mockGenerateAuthOptions(...args),
  verifyAuthenticationResponse: (...args: unknown[]) => mockVerifyAuthResponse(...args),
}));

jest.mock('@simplewebauthn/server/helpers', () => ({
  isoBase64URL: {
    fromBuffer: (buf: Uint8Array) => Buffer.from(buf).toString('base64url'),
    toBuffer: (str: string) => Buffer.from(str, 'base64url'),
  },
}));

jest.mock('@shared/config', () => ({
  envVariables: {
    WEBAUTHN: {
      RP_ID: 'localhost',
      RP_NAME: 'TestApp',
      RP_ORIGIN: 'http://localhost:3000',
      ENABLED: true,
    },
  },
}));

jest.mock('@utils/index', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }),
  httpStatusCodes: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    INTERNAL_SERVER: 500,
  },
}));

// ── Factories ───────────────────────────────────────────────────────────────

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'user-123' },
  email: 'test@example.com',
  isActive: true,
  ...overrides,
});

const makePasskey = (overrides: Record<string, unknown> = {}) => ({
  credentialId: 'cred-abc-123',
  publicKey: 'dGVzdC1wdWJsaWMta2V5', // base64url encoded
  counter: 0,
  deviceType: 'singleDevice',
  backedUp: false,
  transports: ['internal'],
  friendlyName: 'Test Passkey',
  createdAt: new Date(),
  lastUsedAt: null,
  ...overrides,
});

const makeService = (mocks: Record<string, Record<string, jest.Mock>> = {}) => {
  const userDAO = {
    getUserById: jest.fn(),
    getActiveUserByEmail: jest.fn(),
    getUserPasskeys: jest.fn().mockResolvedValue([]),
    hasPasskeys: jest.fn().mockResolvedValue(false),
    findByPasskeyCredentialId: jest.fn(),
    addPasskey: jest.fn(),
    removePasskey: jest.fn(),
    updatePasskeyCounter: jest.fn(),
    ...mocks.userDAO,
  };

  const profileDAO = {
    findFirst: jest.fn().mockResolvedValue({
      personalInfo: { firstName: 'Test', lastName: 'User' },
      settings: { loginType: 'password' },
    }),
    updateById: jest.fn(),
    ...mocks.profileDAO,
  };

  const authCache = {
    saveWebAuthnRegChallenge: jest.fn().mockResolvedValue({ success: true }),
    getAndDeleteWebAuthnRegChallenge: jest.fn(),
    saveWebAuthnAuthChallenge: jest.fn().mockResolvedValue({ success: true }),
    getAndDeleteWebAuthnAuthChallenge: jest.fn(),
    ...mocks.authCache,
  };

  const service = new WebAuthnService({ userDAO, authCache, profileDAO } as any);

  return { service, userDAO, profileDAO, authCache };
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('WebAuthnService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── generateRegistrationOptions ─────────────────────────────────────────

  describe('generateRegistrationOptions', () => {
    it('generates options and stores challenge in Redis', async () => {
      const user = makeUser();
      const mockOptions = { challenge: 'test-challenge-abc', rp: { id: 'localhost' } };
      mockGenerateRegOptions.mockResolvedValue(mockOptions);

      const { service, userDAO, authCache } = makeService({
        userDAO: {
          getUserById: jest.fn().mockResolvedValue(user),
          getUserPasskeys: jest.fn().mockResolvedValue([]),
        } as any,
      });

      const result = await service.generateRegistrationOptions('user-123');

      expect(result).toEqual(mockOptions);
      expect(userDAO.getUserById).toHaveBeenCalledWith('user-123');
      expect(authCache.saveWebAuthnRegChallenge).toHaveBeenCalledWith(
        'user-123',
        'test-challenge-abc'
      );
      expect(mockGenerateRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpName: 'TestApp',
          rpID: 'localhost',
          userName: 'test@example.com',
          attestationType: 'none',
        })
      );
    });

    it('passes existing passkeys as excludeCredentials', async () => {
      const existingPasskey = makePasskey();
      mockGenerateRegOptions.mockResolvedValue({ challenge: 'ch' });

      const { service } = makeService({
        userDAO: {
          getUserById: jest.fn().mockResolvedValue(makeUser()),
          getUserPasskeys: jest.fn().mockResolvedValue([existingPasskey]),
        } as any,
      });

      await service.generateRegistrationOptions('user-123');

      expect(mockGenerateRegOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: [expect.objectContaining({ id: 'cred-abc-123' })],
        })
      );
    });

    it('throws NotFoundError if user not found', async () => {
      const { service } = makeService({
        userDAO: { getUserById: jest.fn().mockResolvedValue(null) } as any,
      });

      await expect(service.generateRegistrationOptions('bad-id')).rejects.toThrow(NotFoundError);
    });
  });

  // ── verifyRegistration ──────────────────────────────────────────────────

  describe('verifyRegistration', () => {
    const mockRegResponse = { id: 'new-cred', response: {}, type: 'public-key' };

    it('verifies registration and saves passkey to DB', async () => {
      mockVerifyRegResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'new-cred-id',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ['internal'],
          },
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
        },
      });

      const { service, userDAO } = makeService({
        authCache: {
          getAndDeleteWebAuthnRegChallenge: jest.fn().mockResolvedValue('stored-challenge'),
        } as any,
      });

      const result = await service.verifyRegistration(
        'user-123',
        mockRegResponse as any,
        'MacBook Touch ID'
      );

      expect(result.credentialId).toBe('new-cred-id');
      expect(result.friendlyName).toBe('MacBook Touch ID');
      expect(result).not.toHaveProperty('publicKey');
      expect(userDAO.addPasskey).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          credentialId: 'new-cred-id',
          friendlyName: 'MacBook Touch ID',
          counter: 0,
          deviceType: 'singleDevice',
          backedUp: false,
        })
      );
    });

    it('throws BadRequestError if challenge expired', async () => {
      const { service } = makeService({
        authCache: {
          getAndDeleteWebAuthnRegChallenge: jest.fn().mockResolvedValue(null),
        } as any,
      });

      await expect(
        service.verifyRegistration('user-123', mockRegResponse as any, 'Test')
      ).rejects.toThrow(BadRequestError);
    });

    it('throws BadRequestError if verification fails', async () => {
      mockVerifyRegResponse.mockResolvedValue({ verified: false });

      const { service } = makeService({
        authCache: {
          getAndDeleteWebAuthnRegChallenge: jest.fn().mockResolvedValue('challenge'),
        } as any,
      });

      await expect(
        service.verifyRegistration('user-123', mockRegResponse as any, 'Test')
      ).rejects.toThrow(BadRequestError);
    });
  });

  // ── generateAuthenticationOptions ───────────────────────────────────────

  describe('generateAuthenticationOptions', () => {
    it('generates options with allowCredentials from stored passkeys', async () => {
      const passkey = makePasskey();
      const mockOptions = { challenge: 'auth-challenge', rpId: 'localhost' };
      mockGenerateAuthOptions.mockResolvedValue(mockOptions);

      const { service, authCache } = makeService({
        userDAO: {
          getActiveUserByEmail: jest.fn().mockResolvedValue(makeUser()),
          getUserPasskeys: jest.fn().mockResolvedValue([passkey]),
        } as any,
      });

      const result = await service.generateAuthenticationOptions('test@example.com');

      expect(result).toEqual(mockOptions);
      expect(authCache.saveWebAuthnAuthChallenge).toHaveBeenCalledWith(
        'test@example.com',
        'auth-challenge'
      );
      expect(mockGenerateAuthOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: 'localhost',
          allowCredentials: [expect.objectContaining({ id: 'cred-abc-123' })],
        })
      );
    });

    it('throws NotFoundError if user not found', async () => {
      const { service } = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(null) } as any,
      });

      await expect(service.generateAuthenticationOptions('nobody@example.com')).rejects.toThrow(
        NotFoundError
      );
    });

    it('throws BadRequestError if user has no passkeys', async () => {
      const { service } = makeService({
        userDAO: {
          getActiveUserByEmail: jest.fn().mockResolvedValue(makeUser()),
          getUserPasskeys: jest.fn().mockResolvedValue([]),
        } as any,
      });

      await expect(service.generateAuthenticationOptions('test@example.com')).rejects.toThrow(
        BadRequestError
      );
    });
  });

  // ── verifyAuthentication ────────────────────────────────────────────────

  describe('verifyAuthentication', () => {
    const mockAuthResponse = {
      id: 'cred-abc-123',
      response: {},
      type: 'public-key',
      authenticatorAttachment: 'platform',
    };

    it('verifies authentication and updates counter', async () => {
      const storedPasskey = makePasskey();
      const user = { ...makeUser(), passkeys: [storedPasskey] };

      mockVerifyAuthResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      });

      const { service, userDAO } = makeService({
        authCache: {
          getAndDeleteWebAuthnAuthChallenge: jest.fn().mockResolvedValue('auth-challenge'),
        } as any,
        userDAO: {
          findByPasskeyCredentialId: jest.fn().mockResolvedValue(user),
          updatePasskeyCounter: jest.fn(),
        } as any,
      });

      const result = await service.verifyAuthentication(
        'test@example.com',
        mockAuthResponse as any
      );

      expect(result).toBe(user);
      expect(userDAO.updatePasskeyCounter).toHaveBeenCalledWith('user-123', 'cred-abc-123', 1);
    });

    it('throws BadRequestError if challenge expired', async () => {
      const { service } = makeService({
        authCache: {
          getAndDeleteWebAuthnAuthChallenge: jest.fn().mockResolvedValue(null),
        } as any,
      });

      await expect(
        service.verifyAuthentication('test@example.com', mockAuthResponse as any)
      ).rejects.toThrow(BadRequestError);
    });

    it('throws UnauthorizedError if credential not found', async () => {
      const { service } = makeService({
        authCache: {
          getAndDeleteWebAuthnAuthChallenge: jest.fn().mockResolvedValue('challenge'),
        } as any,
        userDAO: {
          findByPasskeyCredentialId: jest.fn().mockResolvedValue(null),
        } as any,
      });

      await expect(
        service.verifyAuthentication('test@example.com', mockAuthResponse as any)
      ).rejects.toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError if verification fails', async () => {
      const storedPasskey = makePasskey();
      const user = { ...makeUser(), passkeys: [storedPasskey] };

      mockVerifyAuthResponse.mockResolvedValue({ verified: false });

      const { service } = makeService({
        authCache: {
          getAndDeleteWebAuthnAuthChallenge: jest.fn().mockResolvedValue('challenge'),
        } as any,
        userDAO: {
          findByPasskeyCredentialId: jest.fn().mockResolvedValue(user),
        } as any,
      });

      await expect(
        service.verifyAuthentication('test@example.com', mockAuthResponse as any)
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  // ── deletePasskey ───────────────────────────────────────────────────────

  describe('deletePasskey', () => {
    it('removes passkey from user', async () => {
      const { service, userDAO } = makeService({
        userDAO: {
          removePasskey: jest.fn(),
          getUserPasskeys: jest.fn().mockResolvedValue([makePasskey()]),
        } as any,
      });

      await service.deletePasskey('user-123', 'cred-abc');

      expect(userDAO.removePasskey).toHaveBeenCalledWith('user-123', 'cred-abc');
    });

    it('reverts loginType to password when last passkey is deleted', async () => {
      const { service, profileDAO } = makeService({
        userDAO: {
          removePasskey: jest.fn(),
          getUserPasskeys: jest.fn().mockResolvedValue([]),
        } as any,
        profileDAO: {
          findFirst: jest.fn().mockResolvedValue({
            _id: { toString: () => 'profile-1' },
            settings: { loginType: 'passkey' },
          }),
          updateById: jest.fn(),
        } as any,
      });

      await service.deletePasskey('user-123', 'cred-abc');

      expect(profileDAO.updateById).toHaveBeenCalledWith('profile-1', {
        'settings.loginType': 'password',
      });
    });

    it('does not change loginType when other passkeys remain', async () => {
      const { service, profileDAO } = makeService({
        userDAO: {
          removePasskey: jest.fn(),
          getUserPasskeys: jest.fn().mockResolvedValue([makePasskey()]),
        } as any,
      });

      await service.deletePasskey('user-123', 'cred-abc');

      expect(profileDAO.updateById).not.toHaveBeenCalled();
    });
  });
});
