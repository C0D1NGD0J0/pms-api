/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { ProfileDAO } from '@dao/profileDAO';
import { Profile } from '@models/index';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { 
  BadRequestError,
  NotFoundError 
} from '@shared/customErrors';
import { Types } from 'mongoose';
import { setupDAOTestMocks } from '@tests/mocks/dao/commonMocks';

// Setup centralized mocks
setupDAOTestMocks();

describe('ProfileDAO - Unit Tests', () => {
  let profileDAO: ProfileDAO;
  let mockProfileModel: any;
  let mockLogger: any;

  beforeAll(() => {
    mockProfileModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    profileDAO = new ProfileDAO({ 
      profileModel: mockProfileModel 
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createUserProfile', () => {
    describe('Successful profile creation', () => {
      it('should create profile with auto-generated PUID', async () => {
        // Arrange
        const userId = 'user-123';
        const profileData = TestDataFactory.createProfile({
          puid: undefined,
          personalInfo: {
            firstName: 'John',
            lastName: 'Doe',
            displayName: 'johndoe',
            location: 'New York',
          },
        });

        const createdProfile = { 
          ...profileData, 
          puid: 'profile-12345',
          user: new Types.ObjectId(userId),
          _id: 'profile-obj-123' 
        };

        profileDAO.insert = jest.fn().mockResolvedValue(createdProfile);

        // Act
        const result = await profileDAO.createUserProfile(userId, profileData);

        // Assert
        expect(result).toEqual(createdProfile);
        expect(profileDAO.insert).toHaveBeenCalledWith(
          expect.objectContaining({
            ...profileData,
            user: expect.any(Types.ObjectId),
            puid: 'profile-12345',
          }),
          undefined
        );
      });

      it('should create profile with provided PUID', async () => {
        // Arrange
        const userId = new Types.ObjectId('user-456');
        const profileData = TestDataFactory.createProfile({
          puid: 'custom-puid',
          personalInfo: {
            firstName: 'Jane',
            lastName: 'Smith',
            displayName: 'janesmith',
            location: 'Los Angeles',
          },
        });

        const createdProfile = { 
          ...profileData,
          user: userId,
          _id: 'profile-obj-456' 
        };

        profileDAO.insert = jest.fn().mockResolvedValue(createdProfile);

        // Act
        const result = await profileDAO.createUserProfile(userId, profileData);

        // Assert
        expect(result).toEqual(createdProfile);
        expect(profileDAO.insert).toHaveBeenCalledWith(
          expect.objectContaining({
            ...profileData,
            user: userId,
          }),
          undefined
        );
      });

      it('should create profile with minimal personalInfo when not provided', async () => {
        // Arrange
        const userId = 'user-789';
        const profileData = { 
          settings: {
            theme: 'dark',
            loginType: 'password',
          },
        };

        const createdProfile = { 
          ...profileData,
          user: new Types.ObjectId(userId),
          puid: 'profile-12345',
          personalInfo: {
            firstName: '',
            lastName: '',
            displayName: '',
            location: '',
          },
          _id: 'profile-obj-789' 
        };

        profileDAO.insert = jest.fn().mockResolvedValue(createdProfile);

        // Act
        const result = await profileDAO.createUserProfile(userId, profileData);

        // Assert
        expect(result).toEqual(createdProfile);
        expect(result.personalInfo).toBeDefined();
        expect(result.personalInfo.firstName).toBe('');
      });

      it('should create profile with session', async () => {
        // Arrange
        const userId = 'user-session';
        const profileData = TestDataFactory.createProfile();
        const mockSession = { commit: jest.fn(), abort: jest.fn() };

        const createdProfile = { 
          ...profileData,
          user: new Types.ObjectId(userId),
          _id: 'profile-session-123' 
        };

        profileDAO.insert = jest.fn().mockResolvedValue(createdProfile);

        // Act
        const result = await profileDAO.createUserProfile(userId, profileData, mockSession);

        // Assert
        expect(result).toEqual(createdProfile);
        expect(profileDAO.insert).toHaveBeenCalledWith(
          expect.any(Object),
          mockSession
        );
      });
    });

    describe('Profile creation errors', () => {
      it('should handle database insertion errors', async () => {
        // Arrange
        const userId = 'user-error';
        const profileData = TestDataFactory.createProfile();
        const dbError = new Error('Validation failed');

        profileDAO.insert = jest.fn().mockRejectedValue(dbError);
        profileDAO.throwErrorHandler = jest.fn().mockReturnValue(dbError);

        // Act & Assert
        await expect(profileDAO.createUserProfile(userId, profileData))
          .rejects.toThrow('Validation failed');

        expect(profileDAO.throwErrorHandler).toHaveBeenCalledWith(dbError);
      });
    });
  });

  describe('getProfileByUserId', () => {
    describe('Successful profile retrieval', () => {
      it('should get profile by user ID string', async () => {
        // Arrange
        const userId = 'user-123';
        const profile = TestDataFactory.createProfile({
          user: new Types.ObjectId(userId),
        });

        profileDAO.findFirst = jest.fn().mockResolvedValue(profile);

        // Act
        const result = await profileDAO.getProfileByUserId(userId);

        // Assert
        expect(result).toEqual(profile);
        expect(profileDAO.findFirst).toHaveBeenCalledWith({
          user: expect.any(Types.ObjectId),
        });
      });

      it('should get profile by user ObjectId', async () => {
        // Arrange
        const userId = new Types.ObjectId('user-456');
        const profile = TestDataFactory.createProfile({
          user: userId,
        });

        profileDAO.findFirst = jest.fn().mockResolvedValue(profile);

        // Act
        const result = await profileDAO.getProfileByUserId(userId);

        // Assert
        expect(result).toEqual(profile);
        expect(profileDAO.findFirst).toHaveBeenCalledWith({
          user: userId,
        });
      });

      it('should return null for non-existent user', async () => {
        // Arrange
        const userId = 'non-existent-user';

        profileDAO.findFirst = jest.fn().mockResolvedValue(null);

        // Act
        const result = await profileDAO.getProfileByUserId(userId);

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('Profile retrieval errors', () => {
      it('should handle database query errors', async () => {
        // Arrange
        const userId = 'user-error';
        const dbError = new Error('Database connection failed');

        profileDAO.findFirst = jest.fn().mockRejectedValue(dbError);
        profileDAO.throwErrorHandler = jest.fn().mockReturnValue(dbError);

        // Act & Assert
        await expect(profileDAO.getProfileByUserId(userId))
          .rejects.toThrow('Database connection failed');

        expect(profileDAO.throwErrorHandler).toHaveBeenCalledWith(dbError);
      });
    });
  });

  describe('updatePersonalInfo', () => {
    describe('Successful personal info update', () => {
      it('should update personal information successfully', async () => {
        // Arrange
        const profileId = 'profile-123';
        const personalInfo = {
          firstName: 'John',
          lastName: 'Updated',
          displayName: 'johnupdated',
          bio: 'Updated bio',
          headline: 'Software Developer',
          location: 'San Francisco',
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          personalInfo,
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updatePersonalInfo(profileId, personalInfo);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: {
              'personalInfo.firstName': 'John',
              'personalInfo.lastName': 'Updated',
              'personalInfo.displayName': 'johnupdated',
              'personalInfo.bio': 'Updated bio',
              'personalInfo.headline': 'Software Developer',
              'personalInfo.location': 'San Francisco',
            },
          }
        );
      });

      it('should handle partial personal info updates', async () => {
        // Arrange
        const profileId = 'profile-456';
        const partialInfo = {
          firstName: 'Jane',
          bio: 'New bio',
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          personalInfo: partialInfo,
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updatePersonalInfo(profileId, partialInfo);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: {
              'personalInfo.firstName': 'Jane',
              'personalInfo.bio': 'New bio',
            },
          }
        );
      });
    });
  });

  describe('updateAvatar', () => {
    describe('Successful avatar update', () => {
      it('should update avatar successfully', async () => {
        // Arrange
        const profileId = 'profile-123';
        const avatarData = {
          url: 'https://example.com/avatar.jpg',
          filename: 'avatar.jpg',
          key: 'avatars/user-123/avatar.jpg',
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          personalInfo: {
            avatar: avatarData,
          },
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateAvatar(profileId, avatarData);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: { 'personalInfo.avatar': avatarData },
          }
        );
      });

      it('should update avatar with minimal data', async () => {
        // Arrange
        const profileId = 'profile-456';
        const avatarData = {
          url: 'https://example.com/new-avatar.png',
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          personalInfo: {
            avatar: avatarData,
          },
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateAvatar(profileId, avatarData);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(result.personalInfo.avatar.url).toBe('https://example.com/new-avatar.png');
      });
    });
  });

  describe('updateTheme', () => {
    describe('Successful theme update', () => {
      it('should update theme to dark', async () => {
        // Arrange
        const profileId = 'profile-123';
        const theme = 'dark';

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          settings: { theme },
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateTheme(profileId, theme);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: { 'settings.theme': 'dark' },
          }
        );
      });

      it('should update theme to light', async () => {
        // Arrange
        const profileId = 'profile-456';
        const theme = 'light';

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          settings: { theme },
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateTheme(profileId, theme);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(result.settings.theme).toBe('light');
      });
    });
  });

  describe('updateLoginType', () => {
    describe('Successful login type update', () => {
      it('should update login type to password', async () => {
        // Arrange
        const profileId = 'profile-123';
        const loginType = 'password';

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          settings: { loginType },
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateLoginType(profileId, loginType);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: { 'settings.loginType': 'password' },
          }
        );
      });

      it('should update login type to otp', async () => {
        // Arrange
        const profileId = 'profile-456';
        const loginType = 'otp';

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          settings: { loginType },
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateLoginType(profileId, loginType);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(result.settings.loginType).toBe('otp');
      });
    });
  });

  describe('updateGDPRSettings', () => {
    describe('Successful GDPR settings update', () => {
      it('should update GDPR settings successfully', async () => {
        // Arrange
        const profileId = 'profile-123';
        const gdprSettings = {
          dataRetentionPolicy: 'delete_after_2_years',
          dataProcessingConsent: true,
          processingConsentDate: new Date('2024-01-01'),
          retentionExpiryDate: new Date('2026-01-01'),
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          settings: { gdprSettings },
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateGDPRSettings(profileId, gdprSettings);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: {
              'settings.gdprSettings.dataRetentionPolicy': 'delete_after_2_years',
              'settings.gdprSettings.dataProcessingConsent': true,
              'settings.gdprSettings.processingConsentDate': expect.any(Date),
              'settings.gdprSettings.retentionExpiryDate': expect.any(Date),
            },
          }
        );
      });

      it('should handle partial GDPR settings updates', async () => {
        // Arrange
        const profileId = 'profile-456';
        const partialGdprSettings = {
          dataProcessingConsent: false,
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          settings: { gdprSettings: partialGdprSettings },
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateGDPRSettings(profileId, partialGdprSettings);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: {
              'settings.gdprSettings.dataProcessingConsent': false,
            },
          }
        );
      });
    });
  });

  describe('updateIdentification', () => {
    describe('Successful identification update', () => {
      it('should update identification successfully', async () => {
        // Arrange
        const profileId = 'profile-123';
        const identificationData = {
          idType: 'passport',
          issueDate: new Date('2020-01-01'),
          expiryDate: new Date('2030-01-01'),
          idNumber: 'P123456789',
          authority: 'Department of State',
          issuingState: 'NY',
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          identification: identificationData,
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateIdentification(profileId, identificationData);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: { identification: identificationData },
          }
        );
      });

      it('should handle identification without authority', async () => {
        // Arrange
        const profileId = 'profile-456';
        const identificationData = {
          idType: 'drivers_license',
          issueDate: new Date('2022-01-01'),
          expiryDate: new Date('2027-01-01'),
          idNumber: 'DL987654321',
          issuingState: 'CA',
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          identification: identificationData,
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateIdentification(profileId, identificationData);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(result.identification.idType).toBe('drivers_license');
      });
    });

    describe('Identification update validation errors', () => {
      it('should throw error when expiry date is before issue date', async () => {
        // Arrange
        const profileId = 'profile-invalid';
        const invalidIdentificationData = {
          idType: 'passport',
          issueDate: new Date('2025-01-01'),
          expiryDate: new Date('2024-01-01'), // Invalid: expiry before issue
          idNumber: 'P123456789',
          issuingState: 'NY',
        };

        profileDAO.throwErrorHandler = jest.fn().mockImplementation((error) => error);

        // Act & Assert
        await expect(profileDAO.updateIdentification(profileId, invalidIdentificationData))
          .rejects.toThrow('Expiry date must be after issue date');
      });
    });
  });

  describe('updateNotificationPreferences', () => {
    describe('Successful notification preferences update', () => {
      it('should update all notification preferences', async () => {
        // Arrange
        const profileId = 'profile-123';
        const preferences = {
          messages: true,
          comments: false,
          announcements: true,
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          settings: {
            notifications: preferences,
          },
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateNotificationPreferences(profileId, preferences);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: {
              'settings.notifications.messages': true,
              'settings.notifications.comments': false,
              'settings.notifications.announcements': true,
            },
          }
        );
      });

      it('should update partial notification preferences', async () => {
        // Arrange
        const profileId = 'profile-456';
        const partialPreferences = {
          messages: false,
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          settings: {
            notifications: partialPreferences,
          },
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateNotificationPreferences(profileId, partialPreferences);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: {
              'settings.notifications.messages': false,
            },
          }
        );
      });
    });
  });

  describe('updateLocaleSettings', () => {
    describe('Successful locale settings update', () => {
      it('should update timezone and language', async () => {
        // Arrange
        const profileId = 'profile-123';
        const settings = {
          timeZone: 'America/New_York',
          lang: 'es',
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          timeZone: settings.timeZone,
          lang: settings.lang,
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateLocaleSettings(profileId, settings);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: {
              timeZone: 'America/New_York',
              lang: 'es',
            },
          }
        );
      });

      it('should update only timezone', async () => {
        // Arrange
        const profileId = 'profile-456';
        const settings = {
          timeZone: 'Europe/London',
        };

        const updatedProfile = TestDataFactory.createProfile({
          _id: profileId,
          timeZone: settings.timeZone,
        });

        profileDAO.updateById = jest.fn().mockResolvedValue(updatedProfile);

        // Act
        const result = await profileDAO.updateLocaleSettings(profileId, settings);

        // Assert
        expect(result).toEqual(updatedProfile);
        expect(profileDAO.updateById).toHaveBeenCalledWith(
          profileId,
          {
            $set: {
              timeZone: 'Europe/London',
            },
          }
        );
      });
    });
  });

  describe('searchProfiles', () => {
    describe('Successful profile search', () => {
      it('should search profiles by display name', async () => {
        // Arrange
        const searchTerm = 'john';
        const matchingProfiles = [
          TestDataFactory.createProfile({
            personalInfo: { displayName: 'johnsmith' },
          }),
          TestDataFactory.createProfile({
            personalInfo: { displayName: 'johndoe' },
          }),
        ];

        const searchResult = {
          data: matchingProfiles,
          pagination: {
            page: 1,
            limit: 10,
            total: 2,
            pages: 1,
          },
        };

        profileDAO.list = jest.fn().mockResolvedValue(searchResult);

        // Act
        const result = await profileDAO.searchProfiles(searchTerm);

        // Assert
        expect(result).toEqual(searchResult);
        expect(profileDAO.list).toHaveBeenCalledWith(
          {
            $or: [
              { 'personalInfo.displayName': { $regex: searchTerm, $options: 'i' } },
              { 'personalInfo.firstName': { $regex: searchTerm, $options: 'i' } },
              { 'personalInfo.lastName': { $regex: searchTerm, $options: 'i' } },
              { 'personalInfo.bio': { $regex: searchTerm, $options: 'i' } },
              { 'personalInfo.headline': { $regex: searchTerm, $options: 'i' } },
              { 'personalInfo.location': { $regex: searchTerm, $options: 'i' } },
            ],
          },
          undefined
        );
      });

      it('should search profiles with find options', async () => {
        // Arrange
        const searchTerm = 'developer';
        const opts = { limit: 5, page: 1 };
        const matchingProfiles = [
          TestDataFactory.createProfile({
            personalInfo: { headline: 'Software Developer' },
          }),
        ];

        const searchResult = {
          data: matchingProfiles,
          pagination: { page: 1, limit: 5, total: 1, pages: 1 },
        };

        profileDAO.list = jest.fn().mockResolvedValue(searchResult);

        // Act
        const result = await profileDAO.searchProfiles(searchTerm, opts);

        // Assert
        expect(result).toEqual(searchResult);
        expect(profileDAO.list).toHaveBeenCalledWith(
          expect.any(Object),
          opts
        );
      });

      it('should handle empty search results', async () => {
        // Arrange
        const searchTerm = 'nonexistent';
        const emptyResult = {
          data: [],
          pagination: { page: 1, limit: 10, total: 0, pages: 0 },
        };

        profileDAO.list = jest.fn().mockResolvedValue(emptyResult);

        // Act
        const result = await profileDAO.searchProfiles(searchTerm);

        // Assert
        expect(result.data).toHaveLength(0);
        expect(result.pagination.total).toBe(0);
      });
    });
  });

  describe('generateCurrentUserInfo', () => {
    describe('Successful current user generation', () => {
      it('should generate current user info successfully', async () => {
        // Arrange
        const userId = 'user-123';
        const currentUserData = {
          sub: userId,
          email: 'john@example.com',
          isActive: true,
          displayName: 'johnsmith',
          fullname: 'John Smith',
          avatarUrl: 'https://example.com/avatar.jpg',
          preferences: {
            theme: 'dark',
            lang: 'en',
            timezone: 'America/New_York',
          },
          client: {
            csub: 'client-123',
            displayname: 'Test Company',
            role: 'admin',
          },
          clients: [
            {
              id: 'client-123',
              displayname: 'Test Company',
              role: 'admin',
              isActive: true,
            },
          ],
          gdpr: {
            dataRetentionPolicy: 'delete_after_2_years',
            dataProcessingConsent: true,
            processingConsentDate: new Date('2024-01-01'),
            retentionExpiryDate: new Date('2026-01-01'),
          },
          permissions: [],
        };

        profileDAO.aggregate = jest.fn().mockResolvedValue([currentUserData]);

        // Act
        const result = await profileDAO.generateCurrentUserInfo(userId);

        // Assert
        expect(result).toEqual(currentUserData);
        expect(profileDAO.aggregate).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              $match: {
                user: expect.any(Types.ObjectId),
              },
            }),
          ])
        );
      });

      it('should return null for non-existent user', async () => {
        // Arrange
        const userId = 'non-existent-user';

        profileDAO.aggregate = jest.fn().mockResolvedValue([]);

        // Act
        const result = await profileDAO.generateCurrentUserInfo(userId);

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('Current user generation errors', () => {
      it('should handle database aggregation errors', async () => {
        // Arrange
        const userId = 'user-error';
        const dbError = new Error('Aggregation failed');

        profileDAO.aggregate = jest.fn().mockRejectedValue(dbError);
        profileDAO.throwErrorHandler = jest.fn().mockReturnValue(dbError);

        // Act & Assert
        await expect(profileDAO.generateCurrentUserInfo(userId))
          .rejects.toThrow('Aggregation failed');

        expect(profileDAO.throwErrorHandler).toHaveBeenCalledWith(dbError);
      });
    });
  });
});