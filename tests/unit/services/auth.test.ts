/* eslint-disable no-useless-catch */
import dayjs from 'dayjs';
import * as uuid from 'uuid';
import { Types } from 'mongoose';
import * as utils from '@utils/index';
import { AuthService } from '@root/app/services/index';
import { EMAIL_TEMPLATES } from '@utils/constants';
import { IUserRole } from '@interfaces/user.interface';
import { BadRequestError } from '@shared/customErrors';
import '@tests/di';

// Mock dependencies
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));
jest.mock('dayjs', () => {
  const originalDayjs = jest.requireActual('dayjs');
  return Object.assign(() => {
    return Object.assign(originalDayjs(), {
      add: jest.fn().mockReturnValue({
        toDate: jest.fn().mockReturnValue(new Date('2023-01-01T00:00:00.000Z')),
      }),
    });
  }, originalDayjs);
});
jest.mock('@utils/index', () => ({
  hashGenerator: jest.fn((_hashOpts = {}) => 'test-activation-token'),
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  })),
}));

// Setup environment variables
process.env.FRONTEND_URL = 'https://example.com';

describe('AuthService', () => {
  let authService: AuthService;
  let mockUserDAO: any;
  let mockClientDAO: any;
  let mockProfileDAO: any;
  let mockSession: any;

  const mockUserId = new Types.ObjectId();
  const mockClientId = 'mock-cid';
  const mockSignupData = {
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    password: 'password123',
    accountType: {
      planId: 'basic',
      planName: 'Basic Plan',
      isEnterpriseAccount: false,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (uuid.v4 as jest.Mock).mockReturnValue(mockClientId);

    mockSession = {
      endSession: jest.fn(),
    };

    mockUserDAO = {
      startSession: jest.fn().mockResolvedValue(mockSession),
      withTransaction: jest.fn((session, callback) => callback(session)),
      insert: jest.fn().mockResolvedValue({
        _id: mockUserId,
        email: mockSignupData.email,
        firstName: mockSignupData.firstName,
        lastName: mockSignupData.lastName,
        fullname: `${mockSignupData.firstName} ${mockSignupData.lastName}`,
        activationToken: 'test-activation-token',
      }),
    };

    mockClientDAO = {
      insert: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        cid: mockClientId,
        settings: { lang: 'en', timeZone: 'UTC' },
      }),
    };

    mockProfileDAO = {
      createUserProfile: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        user: mockUserId,
      }),
    };

    authService = new AuthService({
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
    });
  });

  describe('signup', () => {
    it('should successfully create a user, client, and profile', async () => {
      jest.spyOn(utils, 'hashGenerator').mockReturnValue('test-activation-token');
      (uuid.v4 as jest.Mock).mockReturnValue(mockClientId);
      const result: any = await authService.signup(mockSignupData);

      expect(result.success).toBe(true);
      expect(result.data.emailData).toBeDefined();
      expect(result.data.emailData.to).toBe(mockSignupData.email);
      expect(result.data.emailData.template).toBe(EMAIL_TEMPLATES.ACCOUNT_ACTIVATION);
      expect(mockUserDAO.startSession).toHaveBeenCalled();
      expect(mockUserDAO.withTransaction).toHaveBeenCalled();

      expect(mockClientDAO.insert).toHaveBeenCalledTimes(1);
      expect(mockProfileDAO.createUserProfile).toHaveBeenCalledTimes(1);

      const expectedActivationUrl = `https://example.com/account_activation/${mockClientId}?t=test-activation-token`;
      expect(result.data.emailData.data.activationUrl).toBe(expectedActivationUrl);
    });

    it('should handle enterprise account with company info', async () => {
      const enterpriseSignupData = {
        ...mockSignupData,
        accountType: {
          planId: 'enterprise',
          planName: 'Enterprise Plan',
          isEnterpriseAccount: true,
        },
        companyInfo: {
          legalEntityName: 'Test Corp',
          tradingName: 'Test',
          businessType: 'Corporation',
          registrationNumber: '123456789',
          yearEstablished: 2020,
          industry: 'Technology',
          website: 'https://testcorp.com',
          contactInfo: {
            email: 'corporate@test.com',
            address: '123 Test St',
            phoneNumber: '123-456-7890',
            contactPerson: 'John Doe',
          },
        },
      };

      const result = await authService.signup(enterpriseSignupData);

      expect(result.success).toBe(true);
      expect(mockClientDAO.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          accountType: enterpriseSignupData.accountType,
          companyInfo: enterpriseSignupData.companyInfo,
        }),
        mockSession
      );
    });

    it('should throw InvalidRequestError when user creation fails', async () => {
      mockUserDAO.insert.mockResolvedValueOnce(null);
      mockUserDAO.withTransaction.mockImplementationOnce((session: any, callback: any) => {
        try {
          return callback(session);
        } catch (error) {
          throw error;
        }
      });

      await expect(authService.signup(mockSignupData)).rejects.toThrow(BadRequestError);
    });

    it('should throw BadRequestError when an exception occurs in the transaction', async () => {
      const testError = new Error('Transaction failed');
      mockUserDAO.withTransaction.mockRejectedValueOnce(testError);

      await expect(authService.signup(mockSignupData)).rejects.toThrow(BadRequestError);
    });

    it('should handle client creation failure', async () => {
      mockClientDAO.insert.mockRejectedValueOnce(new Error('Client creation failed'));
      mockUserDAO.withTransaction.mockImplementationOnce((session: any, callback: any) => {
        try {
          return callback(session);
        } catch (error) {
          throw error;
        }
      });

      await expect(authService.signup(mockSignupData)).rejects.toThrow(BadRequestError);
    });

    it('should handle profile creation failure', async () => {
      mockProfileDAO.createUserProfile.mockRejectedValueOnce(new Error('Profile creation failed'));
      mockUserDAO.withTransaction.mockImplementationOnce((session: any, callback: any) => {
        try {
          return callback(session);
        } catch (error) {
          throw error;
        }
      });

      await expect(authService.signup(mockSignupData)).rejects.toThrow(BadRequestError);
    });

    it('should create user with activation token expiry 2 hours in the future', async () => {
      await authService.signup(mockSignupData);

      expect(dayjs().add).toHaveBeenCalledWith(2, 'hour');
      expect(mockUserDAO.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          activationTokenExpiresAt: new Date('2023-01-01T00:00:00.000Z'),
        }),
        mockSession
      );
    });
  });
});
