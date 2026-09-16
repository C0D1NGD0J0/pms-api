import { UserDAO } from '@dao/userDAO';
import { User as UserModel } from '@models/index';
import { clearTestDatabase } from '@tests/helpers';
import { IPasskeyCredential } from '@interfaces/user.interface';

const makeUserDoc = (overrides: Record<string, unknown> = {}) =>
  ({
    email: `test-${Date.now()}@example.com`,
    password: 'hashed-password-123456',
    isActive: true,
    activecuid: 'CUID_TEST',
    uid: `UID${Date.now()}`,
    cuids: [
      {
        cuid: 'CUID_TEST',
        roles: ['super-admin'],
        clientDisplayName: 'Test Client',
        isConnected: true,
      },
    ],
    ...overrides,
  }) as any;

const makePasskey = (overrides: Partial<IPasskeyCredential> = {}): IPasskeyCredential => ({
  credentialId: `cred-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  publicKey: 'dGVzdC1wdWJsaWMta2V5LWRhdGE',
  counter: 0,
  deviceType: 'singleDevice',
  backedUp: false,
  transports: ['internal'],
  friendlyName: 'Test Passkey',
  createdAt: new Date(),
  lastUsedAt: null,
  ...overrides,
});

describe('UserDAO Passkey Methods (Integration)', () => {
  let dao: UserDAO;

  beforeAll(() => {
    dao = new UserDAO({ userModel: UserModel });
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('addPasskey + getUserPasskeys', () => {
    it('adds a passkey and retrieves it', async () => {
      const user = await UserModel.create(makeUserDoc());
      const passkey = makePasskey({ friendlyName: 'MacBook Touch ID' });

      await dao.addPasskey(user._id.toString(), passkey);

      const passkeys = await dao.getUserPasskeys(user._id.toString());
      expect(passkeys).toHaveLength(1);
      expect(passkeys[0].credentialId).toBe(passkey.credentialId);
      expect(passkeys[0].friendlyName).toBe('MacBook Touch ID');
      expect(passkeys[0].publicKey).toBe(passkey.publicKey);
      expect(passkeys[0].counter).toBe(0);
    });

    it('returns empty array when user has no passkeys', async () => {
      const user = await UserModel.create(makeUserDoc());

      const passkeys = await dao.getUserPasskeys(user._id.toString());
      expect(passkeys).toEqual([]);
    });

    it('can store multiple passkeys', async () => {
      const user = await UserModel.create(makeUserDoc());

      await dao.addPasskey(user._id.toString(), makePasskey({ friendlyName: 'Passkey 1' }));
      await dao.addPasskey(user._id.toString(), makePasskey({ friendlyName: 'Passkey 2' }));

      const passkeys = await dao.getUserPasskeys(user._id.toString());
      expect(passkeys).toHaveLength(2);
      expect(passkeys.map((p) => p.friendlyName)).toEqual(
        expect.arrayContaining(['Passkey 1', 'Passkey 2'])
      );
    });
  });

  describe('hasPasskeys', () => {
    it('returns true when user has passkeys', async () => {
      const email = `has-passkeys-${Date.now()}@test.com`;
      const user = await UserModel.create(makeUserDoc({ email }));
      await dao.addPasskey(user._id.toString(), makePasskey());

      const result = await dao.hasPasskeys(email);
      expect(result).toBe(true);
    });

    it('returns false when user has no passkeys', async () => {
      const email = `no-passkeys-${Date.now()}@test.com`;
      await UserModel.create(makeUserDoc({ email }));

      const result = await dao.hasPasskeys(email);
      expect(result).toBe(false);
    });

    it('returns false for inactive user with passkeys', async () => {
      const email = `inactive-${Date.now()}@test.com`;
      const user = await UserModel.create(makeUserDoc({ email, isActive: false }));
      await dao.addPasskey(user._id.toString(), makePasskey());

      const result = await dao.hasPasskeys(email);
      expect(result).toBe(false);
    });

    it('returns false for soft-deleted user', async () => {
      const email = `deleted-${Date.now()}@test.com`;
      const user = await UserModel.create(makeUserDoc({ email, deletedAt: new Date() }));
      await dao.addPasskey(user._id.toString(), makePasskey());

      const result = await dao.hasPasskeys(email);
      expect(result).toBe(false);
    });
  });

  describe('findByPasskeyCredentialId', () => {
    it('finds user by credential ID', async () => {
      const user = await UserModel.create(makeUserDoc());
      const passkey = makePasskey({ credentialId: 'find-me-cred' });
      await dao.addPasskey(user._id.toString(), passkey);

      const found = await dao.findByPasskeyCredentialId('find-me-cred');

      expect(found).not.toBeNull();
      expect(found!._id.toString()).toBe(user._id.toString());
      expect(found!.passkeys).toBeDefined();
      expect(found!.passkeys).toHaveLength(1);
      expect(found!.passkeys![0].credentialId).toBe('find-me-cred');
    });

    it('returns null for unknown credential ID', async () => {
      const found = await dao.findByPasskeyCredentialId('nonexistent-cred');
      expect(found).toBeNull();
    });

    it('excludes soft-deleted users', async () => {
      const user = await UserModel.create(makeUserDoc({ deletedAt: new Date() }));
      await dao.addPasskey(user._id.toString(), makePasskey({ credentialId: 'deleted-user-cred' }));

      const found = await dao.findByPasskeyCredentialId('deleted-user-cred');
      expect(found).toBeNull();
    });
  });

  describe('removePasskey', () => {
    it('removes a specific passkey by credential ID', async () => {
      const user = await UserModel.create(makeUserDoc());
      const pk1 = makePasskey({ credentialId: 'keep-me', friendlyName: 'Keep' });
      const pk2 = makePasskey({ credentialId: 'remove-me', friendlyName: 'Remove' });

      await dao.addPasskey(user._id.toString(), pk1);
      await dao.addPasskey(user._id.toString(), pk2);

      await dao.removePasskey(user._id.toString(), 'remove-me');

      const passkeys = await dao.getUserPasskeys(user._id.toString());
      expect(passkeys).toHaveLength(1);
      expect(passkeys[0].credentialId).toBe('keep-me');
    });
  });

  describe('updatePasskeyCounter', () => {
    it('updates the counter and sets lastUsedAt', async () => {
      const user = await UserModel.create(makeUserDoc());
      const passkey = makePasskey({ credentialId: 'counter-test' });
      await dao.addPasskey(user._id.toString(), passkey);

      await dao.updatePasskeyCounter(user._id.toString(), 'counter-test', 5);

      const passkeys = await dao.getUserPasskeys(user._id.toString());
      expect(passkeys[0].counter).toBe(5);
      expect(passkeys[0].lastUsedAt).not.toBeNull();
    });

    it('increments counter on successive calls', async () => {
      const user = await UserModel.create(makeUserDoc());
      await dao.addPasskey(user._id.toString(), makePasskey({ credentialId: 'inc-test' }));

      await dao.updatePasskeyCounter(user._id.toString(), 'inc-test', 1);
      await dao.updatePasskeyCounter(user._id.toString(), 'inc-test', 3);

      const passkeys = await dao.getUserPasskeys(user._id.toString());
      expect(passkeys[0].counter).toBe(3);
    });
  });

  describe('passkeys field is select: false by default', () => {
    it('does not include passkeys in normal findFirst queries', async () => {
      const user = await UserModel.create(makeUserDoc());
      await dao.addPasskey(user._id.toString(), makePasskey());

      const found = await dao.findFirst({ _id: user._id });
      // passkeys should be undefined because select: false
      expect(found?.passkeys).toBeUndefined();
    });
  });
});
