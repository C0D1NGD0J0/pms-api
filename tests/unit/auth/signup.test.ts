/* eslint-disable no-useless-catch */
import * as uuid from 'uuid';
import { Types } from 'mongoose';
import * as utils from '@utils/index';
import { JOB_NAME } from '@utils/constants';
import { AuthService } from '@root/app/services/index';
import { MailType } from '@interfaces/utils.interface';
import '@tests/di';
import { NotFoundError, BadRequestError } from '@shared/customErrors';

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

process.env.FRONTEND_URL = 'https://example.com';

describe('AuthService', () => {
  let authService: AuthService;
  let mockUserDAO: any;
  let mockClientDAO: any;
  let mockProfileDAO: any;
  let mockEmailQueue: any;
  let mockSession: any;
  let mockTokenService: any;
  let mockAuthCache: any;

  const mockUserId = new Types.ObjectId();
  const mockClientId = 'mock-cid';
  const mockSignupData = {
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    password: 'password123',
    location: 'Lagos',
    phoneNumber: '1234567890',
    accountType: {
      planId: 'basic',
      planName: 'Basic Plan',
      isCorporate: false,
    },
    displayName: 'Test User',
    lang: 'en',
    timeZone: 'UTC',
    companyProfile: {
      contactInfo: {
        email: 'company_admin@company.com',
        address: '123, Company Street',
        phoneNumber: '12344321',
        contactPerson: 'James Brown',
      },
      registrationNumber: 'ABC123456',
      yearEstablished: '2000',
      legalEntityName: 'Boring Company',
      businessType: 'software',
      tradingName: 'Boring Co',
      industry: 'IT/Tech',
      website: 'boringcompany.com',
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
      activateAccount: jest.fn(),
      createActivationToken: jest.fn(),
      createPasswordResetToken: jest.fn(),
      resetPassword: jest.fn(),
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
    mockTokenService = {
      createJwtTokens: jest.fn(),
    };
    mockAuthCache = {
      saveRefreshToken: jest.fn(),
    };

    mockEmailQueue = {
      addToEmailQueue: jest.fn(),
    };

    authService = new AuthService({
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      emailQueue: mockEmailQueue,
      tokenService: mockTokenService,
      authCache: mockAuthCache,
    });
  });

  describe('signup', () => {
    it('should create user with activation token expiry 2 hours in the future', async () => {
      await authService.signup(mockSignupData);

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

  describe('accountActivation', () => {
    it('should successfully activate an account with valid token', async () => {
      mockUserDAO.activateAccount.mockResolvedValue(true);

      const result = await authService.accountActivation('valid-token');

      expect(result.success).toBe(true);
      expect(result.msg).toBe('Account activated successfully.');
      expect(mockUserDAO.activateAccount).toHaveBeenCalledWith('valid-token');
    });

    it('should throw NotFoundError for invalid or expired token', async () => {
      mockUserDAO.activateAccount.mockResolvedValue(false);

      await expect(authService.accountActivation('invalid-token')).rejects.toThrow(NotFoundError);
      expect(mockUserDAO.activateAccount).toHaveBeenCalledWith('invalid-token');
    });

    it('should throw BadRequestError if token is missing', async () => {
      await expect(authService.accountActivation('')).rejects.toThrow(BadRequestError);
      expect(mockUserDAO.activateAccount).not.toHaveBeenCalled();
    });
  });

  describe('sendActivationLink', () => {
    it('should successfully send activation link for valid email', async () => {
      mockUserDAO.createActivationToken.mockResolvedValue({
        email: 'test@example.com',
        fullname: 'Test User',
        cid: mockClientId,
        activationToken: 'new-activation-token',
      });

      const result = await authService.sendActivationLink('test@example.com');

      expect(result.success).toBe(true);
      expect(result.msg).toContain('Account activation link has been sent');
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
        JOB_NAME.ACCOUNT_ACTIVATION_JOB,
        expect.objectContaining({
          to: 'test@example.com',
          emailType: MailType.ACCOUNT_ACTIVATION,
        })
      );
    });

    it('should throw NotFoundError if email not found', async () => {
      mockUserDAO.createActivationToken.mockResolvedValue(null);

      await expect(authService.sendActivationLink('nonexistent@example.com')).rejects.toThrow(
        NotFoundError
      );
      expect(mockUserDAO.createActivationToken).toHaveBeenCalledWith('', 'nonexistent@example.com');
    });

    it('should throw BadRequestError if email is missing', async () => {
      await expect(authService.sendActivationLink('')).rejects.toThrow(BadRequestError);
      expect(mockUserDAO.createActivationToken).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('should successfully send password reset email for valid email', async () => {
      mockUserDAO.createPasswordResetToken.mockResolvedValue({
        email: 'test@example.com',
        fullname: 'Test User',
        passwordResetToken: 'reset-token',
      });

      const result = await authService.forgotPassword('test@example.com');

      expect(result.success).toBe(true);
      expect(result.msg).toContain('Password reset email has been sent');
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
        JOB_NAME.ACCOUNT_ACTIVATION_JOB,
        expect.objectContaining({
          to: 'test@example.com',
          emailType: MailType.FORGOT_PASSWORD,
        })
      );
    });

    it('should throw NotFoundError if email not found', async () => {
      mockUserDAO.createPasswordResetToken.mockResolvedValue(null);

      await expect(authService.forgotPassword('nonexistent@example.com')).rejects.toThrow(
        NotFoundError
      );
      expect(mockUserDAO.createPasswordResetToken).toHaveBeenCalledWith('nonexistent@example.com');
    });

    it('should throw BadRequestError if email is missing', async () => {
      await expect(authService.forgotPassword('')).rejects.toThrow(BadRequestError);
      expect(mockUserDAO.createPasswordResetToken).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should successfully reset password with valid email and token', async () => {
      mockUserDAO.resetPassword.mockResolvedValue({
        email: 'test@example.com',
        fullname: 'Test User',
      });

      const result = await authService.resetPassword('test@example.com', 'valid-token');

      expect(result.success).toBe(true);
      expect(result.msg).toContain('Password reset email has been sent');
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
        JOB_NAME.ACCOUNT_ACTIVATION_JOB,
        expect.objectContaining({
          to: 'test@example.com',
          emailType: MailType.PASSWORD_RESET,
        })
      );
    });

    it('should throw NotFoundError if email/token combination not found', async () => {
      mockUserDAO.resetPassword.mockResolvedValue(null);

      await expect(authService.resetPassword('test@example.com', 'invalid-token')).rejects.toThrow(
        NotFoundError
      );
      expect(mockUserDAO.resetPassword).toHaveBeenCalledWith('test@example.com', 'invalid-token');
    });

    it('should throw BadRequestError if both email and token are missing', async () => {
      await expect(authService.resetPassword('', '')).rejects.toThrow(BadRequestError);
      expect(mockUserDAO.resetPassword).not.toHaveBeenCalled();
    });
  });
});
