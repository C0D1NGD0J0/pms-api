import { Types } from 'mongoose';
import { ProfileDAO } from '@dao/profileDAO';
import { Profile, User } from '@models/index';
import { DataRetentionPolicy } from '@interfaces/profile.interface';
import { clearTestDatabase } from '@tests/helpers';

describe('ProfileDAO Integration Tests', () => {
  let profileDAO: ProfileDAO;
  let testUserId: Types.ObjectId;
  let testProfileId: Types.ObjectId;

  beforeAll(async () => {
    profileDAO = new ProfileDAO({ profileModel: Profile });
  });
  beforeEach(async () => {
    await clearTestDatabase();
    testUserId = new Types.ObjectId();

    // Create test user
    await User.create({
      _id: testUserId,
      uid: 'test-user-uid',
      email: 'testuser@example.com',
      password: 'hashed',
      activecuid: 'TEST_CUID',
      cuids: [
        {
          cuid: 'TEST_CUID',
          clientDisplayName: 'Test Client',
          roles: ['tenant'],
          isConnected: true,
        },
      ],
    });

    // Create test profile
    const profile = await Profile.create({
      user: testUserId,
      puid: 'test-puid',
      personalInfo: {
        displayName: 'Test User',
        firstName: 'Test',
        lastName: 'User',
        location: 'New York',
        phoneNumber: '1234567890',
      },
      settings: {
        lang: 'en',
        timeZone: 'UTC',
        theme: 'light',
        loginType: 'password',
        notifications: {
          messages: false,
          comments: false,
          announcements: true,
          maintenance: true,
          payments: true,
          system: true,
          propertyUpdates: true,
          emailNotifications: true,
          inAppNotifications: true,
          emailFrequency: 'immediate',
        },
      },
    });

    testProfileId = profile._id;
  });

  describe('updatePersonalInfo', () => {
    it('should update personal info fields', async () => {
      const result = await profileDAO.updatePersonalInfo(testProfileId.toString(), {
        bio: 'Updated bio',
        headline: 'Software Developer',
      });

      expect(result).not.toBeNull();
      expect(result?.personalInfo.bio).toBe('Updated bio');
      expect(result?.personalInfo.headline).toBe('Software Developer');
    });

    it('should update phone number', async () => {
      const result = await profileDAO.updatePersonalInfo(testProfileId.toString(), {
        phoneNumber: '9876543210',
      });

      expect(result?.personalInfo.phoneNumber).toBe('9876543210');
    });

    it('should update multiple fields at once', async () => {
      const result = await profileDAO.updatePersonalInfo(testProfileId.toString(), {
        displayName: 'New Display Name',
        location: 'San Francisco',
        bio: 'New bio',
      });

      expect(result?.personalInfo.displayName).toBe('New Display Name');
      expect(result?.personalInfo.location).toBe('San Francisco');
      expect(result?.personalInfo.bio).toBe('New bio');
    });

    it('should return null for non-existent profile', async () => {
      const fakeId = new Types.ObjectId();
      const result = await profileDAO.updatePersonalInfo(fakeId.toString(), {
        bio: 'Test',
      });

      expect(result).toBeNull();
    });
  });

  describe('updateAvatar', () => {
    it('should update avatar with all fields', async () => {
      const avatarData = {
        url: 'https://example.com/avatar.jpg',
        filename: 'avatar.jpg',
        key: 'uploads/avatar.jpg',
      };

      const result = await profileDAO.updateAvatar(testProfileId.toString(), avatarData);

      expect(result?.personalInfo.avatar?.url).toBe(avatarData.url);
      expect(result?.personalInfo.avatar?.filename).toBe(avatarData.filename);
      expect(result?.personalInfo.avatar?.key).toBe(avatarData.key);
    });

    it('should update avatar with only url', async () => {
      const result = await profileDAO.updateAvatar(testProfileId.toString(), {
        url: 'https://example.com/new-avatar.png',
      });

      expect(result?.personalInfo.avatar?.url).toBe('https://example.com/new-avatar.png');
    });

    it('should replace existing avatar', async () => {
      await profileDAO.updateAvatar(testProfileId.toString(), {
        url: 'https://example.com/old-avatar.jpg',
        filename: 'old.jpg',
      });

      const result = await profileDAO.updateAvatar(testProfileId.toString(), {
        url: 'https://example.com/new-avatar.jpg',
        filename: 'new.jpg',
      });

      expect(result?.personalInfo.avatar?.url).toBe('https://example.com/new-avatar.jpg');
      expect(result?.personalInfo.avatar?.filename).toBe('new.jpg');
    });
  });

  describe('updateTheme', () => {
    it('should update theme to dark', async () => {
      const result = await profileDAO.updateTheme(testProfileId.toString(), 'dark');

      expect(result?.settings.theme).toBe('dark');
    });

    it('should update theme to light', async () => {
      await profileDAO.updateTheme(testProfileId.toString(), 'dark');
      const result = await profileDAO.updateTheme(testProfileId.toString(), 'light');

      expect(result?.settings.theme).toBe('light');
    });

    it('should return null for non-existent profile', async () => {
      const fakeId = new Types.ObjectId();
      const result = await profileDAO.updateTheme(fakeId.toString(), 'dark');

      expect(result).toBeNull();
    });
  });

  describe('updateLoginType', () => {
    it('should update login type to otp', async () => {
      const result = await profileDAO.updateLoginType(testProfileId.toString(), 'otp');

      expect(result?.settings.loginType).toBe('otp');
    });

    it('should update login type to password', async () => {
      await profileDAO.updateLoginType(testProfileId.toString(), 'otp');
      const result = await profileDAO.updateLoginType(testProfileId.toString(), 'password');

      expect(result?.settings.loginType).toBe('password');
    });
  });

  describe('updateGDPRSettings', () => {
    it('should update GDPR consent', async () => {
      const result = await profileDAO.updateGDPRSettings(testProfileId.toString(), {
        dataProcessingConsent: true,
        processingConsentDate: new Date(),
      });

      expect(result?.settings.gdprSettings?.dataProcessingConsent).toBe(true);
      expect(result?.settings.gdprSettings?.processingConsentDate).toBeInstanceOf(Date);
    });

    it('should update data retention policy', async () => {
      const result = await profileDAO.updateGDPRSettings(testProfileId.toString(), {
        dataRetentionPolicy: DataRetentionPolicy.EXTENDED,
      });

      expect(result?.settings.gdprSettings?.dataRetentionPolicy).toBe('extended');
    });

    it('should update multiple GDPR fields', async () => {
      const result = await profileDAO.updateGDPRSettings(testProfileId.toString(), {
        dataRetentionPolicy: DataRetentionPolicy.MINIMAL,
        dataProcessingConsent: true,
      });

      expect(result?.settings.gdprSettings?.dataRetentionPolicy).toBe('minimal');
      expect(result?.settings.gdprSettings?.dataProcessingConsent).toBe(true);
    });

    it('should handle empty GDPR settings', async () => {
      const result = await profileDAO.updateGDPRSettings(testProfileId.toString(), {});

      expect(result).not.toBeNull();
    });
  });

  describe('updateIdentification', () => {
    it('should update identification successfully', async () => {
      const issueDate = new Date('2020-01-01');
      const expiryDate = new Date('2030-01-01');

      const identificationData = {
        idType: 'passport',
        issueDate,
        expiryDate,
        idNumber: 'P123456789',
        authority: 'US Government',
        issuingState: 'California',
      };

      const result = await profileDAO.updateIdentification(
        testProfileId.toString(),
        identificationData
      );

      expect(result?.personalInfo.identification?.idType).toBe('passport');
      expect(result?.personalInfo.identification?.idNumber).toBe('P123456789');
      expect(result?.personalInfo.identification?.authority).toBe('US Government');
    });

    it('should throw error if expiry date is before issue date', async () => {
      const issueDate = new Date('2030-01-01');
      const expiryDate = new Date('2020-01-01');

      const identificationData = {
        idType: 'passport',
        issueDate,
        expiryDate,
        idNumber: 'P123456789',
        issuingState: 'California',
      };

      await expect(
        profileDAO.updateIdentification(testProfileId.toString(), identificationData)
      ).rejects.toThrow();
    });

    it('should update drivers license', async () => {
      const identificationData = {
        idType: 'drivers-license',
        issueDate: new Date('2021-01-01'),
        expiryDate: new Date('2026-01-01'),
        idNumber: 'DL987654321',
        issuingState: 'New York',
      };

      const result = await profileDAO.updateIdentification(
        testProfileId.toString(),
        identificationData
      );

      expect(result?.personalInfo.identification?.idType).toBe('drivers-license');
      expect(result?.personalInfo.identification?.idNumber).toBe('DL987654321');
    });
  });

  describe('updateNotificationPreferences', () => {
    it('should update boolean notification preferences', async () => {
      const result = await profileDAO.updateNotificationPreferences(testProfileId.toString(), {
        messages: true,
        comments: true,
        payments: false,
      });

      expect(result?.settings.notifications?.messages).toBe(true);
      expect(result?.settings.notifications?.comments).toBe(true);
      expect(result?.settings.notifications?.payments).toBe(false);
    });

    it('should update email frequency', async () => {
      const result = await profileDAO.updateNotificationPreferences(testProfileId.toString(), {
        emailFrequency: 'daily',
      });

      expect(result?.settings.notifications?.emailFrequency).toBe('daily');
    });

    it('should update all notification preferences', async () => {
      const result = await profileDAO.updateNotificationPreferences(testProfileId.toString(), {
        messages: true,
        comments: true,
        announcements: false,
        maintenance: false,
        payments: false,
        system: false,
        propertyUpdates: false,
        emailNotifications: false,
        inAppNotifications: false,
        emailFrequency: 'daily',
      });

      expect(result?.settings.notifications?.messages).toBe(true);
      expect(result?.settings.notifications?.emailFrequency).toBe('daily');
      expect(result?.settings.notifications?.announcements).toBe(false);
    });

    it('should preserve unmodified preferences', async () => {
      const result = await profileDAO.updateNotificationPreferences(testProfileId.toString(), {
        messages: true,
      });

      expect(result?.settings.notifications?.messages).toBe(true);
      expect(result?.settings.notifications?.announcements).toBe(true); // unchanged
      expect(result?.settings.notifications?.maintenance).toBe(true); // unchanged
    });
  });

  describe('getNotificationPreferences', () => {
    it('should retrieve notification preferences by user ID', async () => {
      const result = await profileDAO.getNotificationPreferences(testUserId.toString());

      expect(result).not.toBeNull();
      expect(result?.emailFrequency).toBe('immediate');
      expect(result?.announcements).toBe(true);
    });

    it('should return null for non-existent user', async () => {
      const fakeUserId = new Types.ObjectId();
      const result = await profileDAO.getNotificationPreferences(fakeUserId.toString());

      expect(result).toBeNull();
    });

    it('should return updated preferences', async () => {
      await profileDAO.updateNotificationPreferences(testProfileId.toString(), {
        emailFrequency: 'daily',
        messages: true,
      });

      const result = await profileDAO.getNotificationPreferences(testUserId.toString());

      expect(result?.emailFrequency).toBe('daily');
      expect(result?.messages).toBe(true);
    });
  });

  describe('updateLocaleSettings', () => {
    it('should update timezone', async () => {
      const result = await profileDAO.updateLocaleSettings(testProfileId.toString(), {
        timeZone: 'America/New_York',
      });

      expect(result?.settings.timeZone).toBe('America/New_York');
    });

    it('should update language', async () => {
      const result = await profileDAO.updateLocaleSettings(testProfileId.toString(), {
        lang: 'es',
      });

      expect(result?.settings.lang).toBe('es');
    });

    it('should update both timezone and language', async () => {
      const result = await profileDAO.updateLocaleSettings(testProfileId.toString(), {
        timeZone: 'Europe/London',
        lang: 'en-GB',
      });

      expect(result?.settings.timeZone).toBe('Europe/London');
      expect(result?.settings.lang).toBe('en-GB');
    });

    it('should handle empty settings object', async () => {
      const result = await profileDAO.updateLocaleSettings(testProfileId.toString(), {});

      expect(result).not.toBeNull();
      expect(result?.settings.timeZone).toBe('UTC'); // unchanged
    });
  });

  describe('createUserProfile', () => {
    it('should create profile with string user ID', async () => {
      const newUserId = new Types.ObjectId();
      await User.create({
        _id: newUserId,
        uid: 'new-user-uid',
        email: 'newuser@example.com',
        password: 'hashed',
        activecuid: 'NEW_CUID',
        cuids: [],
      });

      const profile = await profileDAO.createUserProfile(newUserId.toString(), {
        personalInfo: {
          displayName: 'New User',
          firstName: 'New',
          lastName: 'User',
          location: 'Boston',
        },
      });

      expect(profile).toBeDefined();
      expect(profile.user.toString()).toBe(newUserId.toString());
      expect(profile.puid).toBeDefined();
      expect(profile.personalInfo.displayName).toBe('New User');
    });

    it('should create profile with ObjectId user ID', async () => {
      const newUserId = new Types.ObjectId();
      await User.create({
        _id: newUserId,
        uid: 'another-user-uid',
        email: 'another@example.com',
        password: 'hashed',
        activecuid: 'ANOTHER_CUID',
        cuids: [],
      });

      const profile = await profileDAO.createUserProfile(newUserId, {
        personalInfo: {
          displayName: 'Another User',
          firstName: 'Another',
          lastName: 'User',
          location: 'Seattle',
        },
      });

      expect(profile.user).toEqual(newUserId);
    });

    it('should auto-generate puid if not provided', async () => {
      const newUserId = new Types.ObjectId();
      await User.create({
        _id: newUserId,
        uid: 'puid-test-uid',
        email: 'puid@example.com',
        password: 'hashed',
        activecuid: 'PUID_CUID',
        cuids: [],
      });

      const profile = await profileDAO.createUserProfile(newUserId.toString(), {
        personalInfo: {
          displayName: 'PUID Test',
          firstName: 'PUID',
          lastName: 'Test',
          location: 'Miami',
        },
      });

      expect(profile.puid).toBeDefined();
      expect(profile.puid.length).toBeGreaterThan(0);
    });

    it('should use provided puid', async () => {
      const newUserId = new Types.ObjectId();
      await User.create({
        _id: newUserId,
        uid: 'custom-puid-uid',
        email: 'custom@example.com',
        password: 'hashed',
        activecuid: 'CUSTOM_CUID',
        cuids: [],
      });

      const profile = await profileDAO.createUserProfile(newUserId.toString(), {
        puid: 'CUSTOM_PUID_123',
        personalInfo: {
          displayName: 'Custom PUID',
          firstName: 'Custom',
          lastName: 'PUID',
          location: 'Austin',
        },
      });

      expect(profile.puid).toBe('CUSTOM_PUID_123');
    });
  });

  describe('searchProfiles', () => {
    beforeEach(async () => {
      // Create additional test profiles
      const user2Id = new Types.ObjectId();
      const user3Id = new Types.ObjectId();

      await User.create({
        _id: user2Id,
        uid: 'john-doe-uid',
        email: 'john@example.com',
        password: 'hashed',
        activecuid: 'USER2_CUID',
        cuids: [],
      });

      await User.create({
        _id: user3Id,
        uid: 'jane-smith-uid',
        email: 'jane@example.com',
        password: 'hashed',
        activecuid: 'USER3_CUID',
        cuids: [],
      });

      await Profile.create({
        user: user2Id,
        puid: 'john-puid',
        personalInfo: {
          displayName: 'John Doe',
          firstName: 'John',
          lastName: 'Doe',
          location: 'Chicago',
          bio: 'Software engineer with 5 years experience',
        },
      });

      await Profile.create({
        user: user3Id,
        puid: 'jane-puid',
        personalInfo: {
          displayName: 'Jane Smith',
          firstName: 'Jane',
          lastName: 'Smith',
          location: 'Boston',
          headline: 'Product Manager',
        },
      });
    });

    it('should search profiles by first name', async () => {
      const result = await profileDAO.searchProfiles('John');

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.some((p) => p.personalInfo.firstName === 'John')).toBe(true);
    });

    it('should search profiles by last name', async () => {
      const result = await profileDAO.searchProfiles('Smith');

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.some((p) => p.personalInfo.lastName === 'Smith')).toBe(true);
    });

    it('should search profiles by display name', async () => {
      const result = await profileDAO.searchProfiles('Jane');

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.some((p) => p.personalInfo.displayName.includes('Jane'))).toBe(true);
    });

    it('should search profiles by bio', async () => {
      const result = await profileDAO.searchProfiles('engineer');

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.some((p) => p.personalInfo.bio?.includes('engineer'))).toBe(true);
    });

    it('should search profiles by headline', async () => {
      const result = await profileDAO.searchProfiles('Product Manager');

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.some((p) => p.personalInfo.headline?.includes('Product'))).toBe(true);
    });

    it('should return empty result for non-matching search', async () => {
      const result = await profileDAO.searchProfiles('NonExistentName');

      expect(result.items.length).toBe(0);
    });

    it('should be case-insensitive', async () => {
      const result = await profileDAO.searchProfiles('john');

      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.some((p) => p.personalInfo.firstName === 'John')).toBe(true);
    });
  });

  describe('getProfileByUserId', () => {
    it('should find profile by user ID string', async () => {
      const profile = await profileDAO.getProfileByUserId(testUserId.toString());

      expect(profile).not.toBeNull();
      expect(profile?.user.toString()).toBe(testUserId.toString());
      expect(profile?.personalInfo.displayName).toBe('Test User');
    });

    it('should find profile by ObjectId', async () => {
      const profile = await profileDAO.getProfileByUserId(testUserId);

      expect(profile).not.toBeNull();
      expect(profile?.user).toEqual(testUserId);
    });

    it('should return null for non-existent user', async () => {
      const fakeUserId = new Types.ObjectId();
      const profile = await profileDAO.getProfileByUserId(fakeUserId);

      expect(profile).toBeNull();
    });
  });

  describe('generateCurrentUserInfo', () => {
    beforeEach(async () => {
      // Update user with proper client connections for testing
      await User.updateOne(
        { _id: testUserId },
        {
          cuids: [
            {
              cuid: 'TEST_CUID',
              clientDisplayName: 'Test Client',
              roles: ['tenant'],
              isConnected: true,
            },
          ],
        }
      );
    });

    it('should generate current user info successfully', async () => {
      const result = await profileDAO.generateCurrentUserInfo(testUserId.toString());

      expect(result).not.toBeNull();
      expect(result?.uid).toBe('test-user-uid');
      expect(result?.email).toBe('testuser@example.com');
      expect(result?.displayName).toBe('Test User');
    });

    it('should include preferences', async () => {
      const result = await profileDAO.generateCurrentUserInfo(testUserId.toString());

      expect(result?.preferences).toBeDefined();
      expect(result?.preferences.theme).toBe('light');
      expect(result?.preferences.lang).toBe('en');
      expect(result?.preferences.timezone).toBe('UTC');
    });

    it('should return null for non-existent user', async () => {
      const fakeUserId = new Types.ObjectId();
      const result = await profileDAO.generateCurrentUserInfo(fakeUserId.toString());

      expect(result).toBeNull();
    });
  });

  describe('updateCommonEmployeeInfo', () => {
    it('should update employee info fields', async () => {
      // First initialize employeeInfo
      await Profile.updateOne({ _id: testProfileId }, { employeeInfo: {} });

      const result = await profileDAO.updateCommonEmployeeInfo(testProfileId.toString(), {
        department: 'maintenance',
        jobTitle: 'Maintenance Technician',
      });

      expect(result?.employeeInfo?.department).toBe('maintenance');
      expect(result?.employeeInfo?.jobTitle).toBe('Maintenance Technician');
    });

    it('should update start date', async () => {
      // First initialize employeeInfo
      await Profile.updateOne({ _id: testProfileId }, { employeeInfo: {} });

      const startDate = new Date('2023-01-01');
      const result = await profileDAO.updateCommonEmployeeInfo(testProfileId.toString(), {
        startDate,
      });

      expect(result?.employeeInfo?.startDate).toEqual(startDate);
    });

    it('should throw error for invalid employee info', async () => {
      await expect(
        profileDAO.updateCommonEmployeeInfo(testProfileId.toString(), null as any)
      ).rejects.toThrow();
    });

    it('should update multiple employee fields', async () => {
      // First initialize employeeInfo
      await Profile.updateOne({ _id: testProfileId }, { employeeInfo: {} });

      const result = await profileDAO.updateCommonEmployeeInfo(testProfileId.toString(), {
        department: 'accounting',
        jobTitle: 'Accountant',
        employeeId: 'EMP-12345',
      });

      expect(result?.employeeInfo?.department).toBe('accounting');
      expect(result?.employeeInfo?.jobTitle).toBe('Accountant');
    });
  });

  describe('updateVendorReference', () => {
    it('should update vendor reference fields', async () => {
      // First initialize vendorInfo
      await Profile.updateOne({ _id: testProfileId }, { vendorInfo: {} });

      const vendorId = new Types.ObjectId();
      const result = await profileDAO.updateVendorReference(testProfileId.toString(), {
        vendorId: vendorId.toString(),
        linkedVendorUid: 'primary-vendor-uid',
        isLinkedAccount: true,
      });

      expect(result?.vendorInfo?.linkedVendorUid).toBe('primary-vendor-uid');
      expect(result?.vendorInfo?.isLinkedAccount).toBe(true);
    });

    it('should update only linkedVendorUid', async () => {
      // First initialize vendorInfo
      await Profile.updateOne({ _id: testProfileId }, { vendorInfo: {} });

      const result = await profileDAO.updateVendorReference(testProfileId.toString(), {
        linkedVendorUid: 'vendor-123',
      });

      expect(result?.vendorInfo?.linkedVendorUid).toBe('vendor-123');
    });

    it('should throw error for invalid vendor reference', async () => {
      await expect(
        profileDAO.updateVendorReference(testProfileId.toString(), null as any)
      ).rejects.toThrow();
    });

    it('should return profile unchanged if no valid fields', async () => {
      const result = await profileDAO.updateVendorReference(testProfileId.toString(), {
        invalidField: 'value',
      } as any);

      expect(result).not.toBeNull();
    });
  });

  describe('getProfileInfo', () => {
    it('should return basic profile info', async () => {
      const result = await profileDAO.getProfileInfo(testProfileId.toString());

      expect(result).not.toBeNull();
      expect(result?.userId).toBe(testUserId.toString());
    });

    it('should include vendor info if present', async () => {
      // First initialize vendorInfo
      await Profile.updateOne({ _id: testProfileId }, { vendorInfo: {} });

      await profileDAO.updateVendorReference(testProfileId.toString(), {
        linkedVendorUid: 'vendor-uid',
        isLinkedAccount: true,
      });

      const result = await profileDAO.getProfileInfo(testProfileId.toString());

      expect(result?.vendorInfo).toBeDefined();
      expect(result?.vendorInfo?.linkedVendorUid).toBe('vendor-uid');
    });

    it('should include employee info if present', async () => {
      // First initialize employeeInfo
      await Profile.updateOne({ _id: testProfileId }, { employeeInfo: {} });

      await profileDAO.updateCommonEmployeeInfo(testProfileId.toString(), {
        department: 'operations',
      });

      const result = await profileDAO.getProfileInfo(testProfileId.toString());

      expect(result?.employeeInfo).toBeDefined();
    });

    it('should return null for non-existent profile', async () => {
      const fakeId = new Types.ObjectId();
      const result = await profileDAO.getProfileInfo(fakeId.toString());

      expect(result).toBeNull();
    });
  });

  describe('getProfileUserId', () => {
    it('should return user ID for existing profile', async () => {
      const result = await profileDAO.getProfileUserId(testUserId.toString());

      expect(result).toBe(testUserId.toString());
    });

    it('should return null for non-existent user', async () => {
      const fakeUserId = new Types.ObjectId();
      const result = await profileDAO.getProfileUserId(fakeUserId.toString());

      expect(result).toBeNull();
    });
  });
});
