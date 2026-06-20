/**
 * TwilioService Unit Tests
 *
 * Tests the Twilio SDK wrapper in isolation.
 * The Twilio SDK is mocked — no real API calls are made.
 */

// ---------------------------------------------------------------------------
// Mock the Twilio SDK BEFORE importing the service
// ---------------------------------------------------------------------------

const mockMessagesCreate = jest.fn();
const mockVerificationsCreate = jest.fn();
const mockVerificationChecksCreate = jest.fn();

const mockTwilioClient = {
  messages: { create: mockMessagesCreate },
  verify: {
    v2: {
      services: jest.fn().mockReturnValue({
        verifications: { create: mockVerificationsCreate },
        verificationChecks: { create: mockVerificationChecksCreate },
      }),
    },
  },
};

jest.mock('twilio', () => {
  // Twilio is called as a function: Twilio(accountSid, authToken)
  return {
    __esModule: true,
    default: jest.fn().mockReturnValue(mockTwilioClient),
  };
});

// Mock envVariables so we can control feature flags and credentials per test
const defaultEnv = {
  TWILIO: {
    ACCOUNT_SID: 'AC_test_sid',
    AUTH_TOKEN: 'test_auth_token',
    MESSAGING_SERVICE_SID: 'MG_test_messaging',
    VERIFY_SERVICE_SID: 'VA_test_verify',
  },
  FEATURES: {
    SMS_ENABLED: true,
  },
};

let envOverrides: Record<string, any> = {};

jest.mock('@shared/config', () => ({
  envVariables: new Proxy(
    {},
    {
      get(_target, prop) {
        const merged = { ...defaultEnv, ...envOverrides };
        return (merged as any)[prop as string];
      },
    }
  ),
}));

jest.mock('@utils/index', () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

import { TwilioService } from '@services/external/twilio/twilio.service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TwilioService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    envOverrides = {};
  });

  // =========================================================================
  // Constructor
  // =========================================================================

  describe('constructor', () => {
    it('should throw when SMS is enabled but credentials are missing', () => {
      envOverrides = {
        TWILIO: {
          ACCOUNT_SID: '',
          AUTH_TOKEN: '',
          MESSAGING_SERVICE_SID: '',
          VERIFY_SERVICE_SID: '',
        },
        FEATURES: { SMS_ENABLED: true },
      };

      expect(() => new TwilioService()).toThrow(
        'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required when SMS feature is enabled'
      );
    });

    it('should warn but not throw when SMS is disabled and credentials are missing', () => {
      envOverrides = {
        TWILIO: {
          ACCOUNT_SID: '',
          AUTH_TOKEN: '',
          MESSAGING_SERVICE_SID: '',
          VERIFY_SERVICE_SID: '',
        },
        FEATURES: { SMS_ENABLED: false },
      };

      expect(() => new TwilioService()).not.toThrow();
    });

    it('should construct successfully when credentials are provided', () => {
      // Uses defaultEnv which has valid creds
      expect(() => new TwilioService()).not.toThrow();
    });
  });

  // =========================================================================
  // sendSMS
  // =========================================================================

  describe('sendSMS', () => {
    let service: TwilioService;

    beforeEach(() => {
      service = new TwilioService();
    });

    it('should call client.messages.create with messagingServiceSid and return sid+status', async () => {
      mockMessagesCreate.mockResolvedValue({
        sid: 'SM_test_sid_123',
        status: 'queued',
      });

      const result = await service.sendSMS('+14155551234', 'Hello tenant!');

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messagingServiceSid: 'MG_test_messaging',
          to: '+14155551234',
          body: 'Hello tenant!',
        })
      );
      expect(result).toEqual({ sid: 'SM_test_sid_123', status: 'queued' });
    });

    it('should include statusCallback when API_BASE_URL is set', async () => {
      const originalBaseUrl = process.env.API_BASE_URL;
      process.env.API_BASE_URL = 'https://api.example.com';

      mockMessagesCreate.mockResolvedValue({
        sid: 'SM_callback_test',
        status: 'queued',
      });

      await service.sendSMS('+14155551234', 'Test');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCallback: 'https://api.example.com/api/v1/webhooks/twilio/status',
        })
      );

      // Restore
      if (originalBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = originalBaseUrl;
      }
    });

    it('should throw on Twilio API error', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Invalid phone number'));

      await expect(service.sendSMS('+1invalid', 'Hello')).rejects.toThrow(
        'Twilio API Error: Invalid phone number'
      );
    });
  });

  // =========================================================================
  // sendOTP
  // =========================================================================

  describe('sendOTP', () => {
    let service: TwilioService;

    beforeEach(() => {
      service = new TwilioService();
    });

    it('should call verify.v2.services().verifications.create and return sid+status', async () => {
      mockVerificationsCreate.mockResolvedValue({
        sid: 'VE_test_sid_456',
        status: 'pending',
      });

      const result = await service.sendOTP('+14155551234');

      expect(mockTwilioClient.verify.v2.services).toHaveBeenCalledWith('VA_test_verify');
      expect(mockVerificationsCreate).toHaveBeenCalledWith({
        to: '+14155551234',
        channel: 'sms',
      });
      expect(result).toEqual({ sid: 'VE_test_sid_456', status: 'pending' });
    });

    it('should throw on Twilio API error', async () => {
      mockVerificationsCreate.mockRejectedValue(new Error('Service unavailable'));

      await expect(service.sendOTP('+14155551234')).rejects.toThrow(
        'Twilio API Error: Service unavailable'
      );
    });
  });

  // =========================================================================
  // verifyOTP
  // =========================================================================

  describe('verifyOTP', () => {
    let service: TwilioService;

    beforeEach(() => {
      service = new TwilioService();
    });

    it('should call verificationChecks.create and return valid=true for correct code', async () => {
      mockVerificationChecksCreate.mockResolvedValue({
        valid: true,
        status: 'approved',
      });

      const result = await service.verifyOTP('+14155551234', '123456');

      expect(mockTwilioClient.verify.v2.services).toHaveBeenCalledWith('VA_test_verify');
      expect(mockVerificationChecksCreate).toHaveBeenCalledWith({
        to: '+14155551234',
        code: '123456',
      });
      expect(result).toEqual({ valid: true, status: 'approved' });
    });

    it('should return valid=false for wrong code', async () => {
      mockVerificationChecksCreate.mockResolvedValue({
        valid: false,
        status: 'pending',
      });

      const result = await service.verifyOTP('+14155551234', '000000');

      expect(result).toEqual({ valid: false, status: 'pending' });
    });

    it('should throw on Twilio API error', async () => {
      mockVerificationChecksCreate.mockRejectedValue(new Error('Too many attempts'));

      await expect(service.verifyOTP('+14155551234', '123456')).rejects.toThrow(
        'Twilio API Error: Too many attempts'
      );
    });
  });
});
