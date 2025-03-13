/* eslint-disable no-useless-catch */
import * as uuid from 'uuid';
// import * as dayjs from 'dayjs';
import { Types } from 'mongoose';
import * as utils from '@utils/index';
// import { EmailQueue } from '@queues/index';
import { JOB_NAME } from '@utils/constants';
import { AuthService } from '@root/app/services/index';
import { MailType } from '@interfaces/utils.interface';
import '@tests/di';
import { InvalidRequestError } from '@shared/customErrors';

// Mock dependencies
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));
jest.mock('dayjs', () => {
  const actualDayjs = jest.requireActual('dayjs');
  const mockDayjsInstance = {
    add: jest.fn().mockReturnThis(),
    toDate: jest.fn().mockReturnValue(new Date('2023-01-01T00:00:00.000Z')),
  };
  const dayjs = jest.fn(() => mockDayjsInstance);
  Object.assign(dayjs, actualDayjs);
  return dayjs;
});
jest.mock('@utils/index', () => ({
  hashGenerator: jest.fn((_hashOpts = {}) => 'test-activation-token'),
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  })),
  JOB_NAME: {
    ACCOUNT_ACTIVATION_JOB: 'account-activation-job',
  },
  getLocationDetails: jest.fn((location) =>
    location ? { city: location, country: 'Nigeria' } : null
  ),
}));

// Setup environment variables
process.env.FRONTEND_URL = 'https://example.com';

describe('AuthService', () => {
  let authService: AuthService;
  let mockUserDAO: any;
  let mockClientDAO: any;
  let mockProfileDAO: any;
  let mockEmailQueue: any;
  let mockSession: any;
  // let mockdayjs: any;

  const mockUserId = new Types.ObjectId();
  const mockClientId = 'mock-cid';
  const mockSignupData = {
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    password: 'password123',
    location: 'Lagos',
    accountType: {
      planId: 'basic',
      planName: 'Basic Plan',
      isEnterpriseAccount: false,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // mockdayjs = jest.mock('dayjs', () => {
    //   const actualDayjs = jest.requireActual('dayjs');
    //   const mockDayjsInstance = {
    //     add: jest.fn().mockReturnThis(),
    //     toDate: jest.fn().mockReturnValue(new Date('2023-01-01T00:00:00.000Z')),
    //   };
    //   const dayjs = jest.fn(() => mockDayjsInstance);
    //   Object.assign(dayjs, actualDayjs);
    //   return dayjs;
    // });
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

    mockEmailQueue = {
      addToEmailQueue: jest.fn(),
    };

    authService = new AuthService({
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      emailQueue: mockEmailQueue,
    });
  });

  describe('signup', () => {
    xit('should successfully create a user, client, and profile', async () => {
      jest.spyOn(utils, 'hashGenerator').mockReturnValue('test-activation-token');
      (uuid.v4 as jest.Mock).mockReturnValue(mockClientId);
      const result: any = await authService.signup(mockSignupData);

      expect(result.success).toBe(true);
      expect(result.data.emailData).toBeDefined();
      expect(result.data.emailData.to).toBe(mockSignupData.email);
      expect(result.data.emailData.emailType).toBe(MailType.ACCOUNT_ACTIVATION);
      expect(mockUserDAO.startSession).toHaveBeenCalled();
      expect(mockUserDAO.withTransaction).toHaveBeenCalled();

      expect(mockClientDAO.insert).toHaveBeenCalledTimes(1);
      expect(mockProfileDAO.createUserProfile).toHaveBeenCalledTimes(1);

      const expectedActivationUrl = `https://example.com/account_activation/${mockClientId}?t=test-activation-token`;
      expect(result.data.emailData.data.activationUrl).toBe(expectedActivationUrl);

      // Verify email queue was called with correct parameters
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
        JOB_NAME.ACCOUNT_ACTIVATION_JOB,
        result.data.emailData
      );
    });

    xit('should handle enterprise account with company info', async () => {
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

    xit('should throw InvalidRequestError when user creation fails', async () => {
      mockUserDAO.insert.mockResolvedValueOnce(null);
      mockUserDAO.withTransaction.mockImplementationOnce((session: any, callback: any) => {
        try {
          return callback(session);
        } catch (error) {
          throw error;
        }
      });

      await expect(authService.signup(mockSignupData)).rejects.toThrow(InvalidRequestError);
    });

    xit('should handle exceptions in the transaction', async () => {
      const testError = new Error('Transaction failed');
      mockUserDAO.withTransaction.mockRejectedValueOnce(testError);

      // Convert error to InvalidRequestError in test layer since the
      // actual service might be handling this differently
      await expect(authService.signup(mockSignupData)).rejects.toThrow();
    });

    xit('should handle client creation failure', async () => {
      mockClientDAO.insert.mockRejectedValueOnce(new Error('Client creation failed'));
      mockUserDAO.withTransaction.mockImplementationOnce((session: any, callback: any) => {
        try {
          return callback(session);
        } catch (error) {
          throw error;
        }
      });

      await expect(authService.signup(mockSignupData)).rejects.toThrow();
    });

    xit('should handle profile creation failure', async () => {
      mockProfileDAO.createUserProfile.mockRejectedValueOnce(new Error('Profile creation failed'));
      mockUserDAO.withTransaction.mockImplementationOnce((session: any, callback: any) => {
        try {
          return callback(session);
        } catch (error) {
          throw error;
        }
      });

      await expect(authService.signup(mockSignupData)).rejects.toThrow();
    });

    it('should create user with activation token expiry 2 hours in the future', async () => {
      // jest.spyOn(dayjs, 'add').mockReturnValue('fuck me');
      await authService.signup(mockSignupData);

      // expect(dayjs().add).toHaveBeenCalled();
      expect(mockUserDAO.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          activationTokenExpiresAt: new Date('2023-01-01T00:00:00.000Z'),
        }),
        mockSession
      );
    });

    it('should use location details from getLocationDetails helper', async () => {
      const locationDetail = { city: 'Lagos', country: 'Nigeria' };
      jest.spyOn(utils, 'getLocationDetails').mockReturnValue(locationDetail as any);
      await authService.signup(mockSignupData);

      expect(utils.getLocationDetails).toHaveBeenCalledWith(mockSignupData.location);
      expect(mockUserDAO.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          location: locationDetail,
        }),
        mockSession
      );
    });

    it('should use original location if getLocationDetails returns null', async () => {
      (utils.getLocationDetails as jest.Mock).mockReturnValueOnce(null);

      await authService.signup(mockSignupData);

      expect(mockUserDAO.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          location: mockSignupData.location,
        }),
        mockSession
      );
    });
  });
});
