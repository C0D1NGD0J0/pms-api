/**
 * AuthService — signup event emission tests
 *
 * Verifies that USER_SIGNUP_INITIATED is emitted after a successful
 * signup so downstream workflows (analytics, onboarding) can trigger.
 */
import { Types } from 'mongoose';

jest.mock('@di/index', () => ({ container: {} }));

import { AuthService } from '@services/auth/auth.service';
import { EventTypes } from '@interfaces/events.interface';
import { ISignupData } from '@interfaces/user.interface';

const USER_ID = new Types.ObjectId();
const CLIENT_ID = new Types.ObjectId();
const SUBSCRIPTION_ID = new Types.ObjectId();
const TEST_EMAIL = 'signup-test@example.com';

const makeSignupData = (overrides: Record<string, any> = {}): ISignupData => ({
  email: TEST_EMAIL,
  password: 'SecureP@ss123',
  firstName: 'Test',
  lastName: 'User',
  displayName: 'Test User',
  location: 'Toronto, Ontario, Canada',
  phoneNumber: '+14165551234',
  lang: 'en',
  timeZone: 'America/Toronto',
  termsAccepted: true,
  accountType: {
    category: 'individual',
    planName: 'essential',
    planId: 'price_essential',
    planLookUpKey: 'essential_monthly',
    billingInterval: 'monthly',
    totalMonthlyPrice: 0,
    isEnterpriseAccount: false,
  },
  ...overrides,
});

const makeMocks = () => {
  const userDAO = {
    startSession: jest.fn().mockReturnValue(Promise.resolve({ endSession: jest.fn() })),
    withTransaction: jest.fn().mockImplementation(async (_session: any, fn: any) => fn(_session)),
    findFirst: jest.fn().mockReturnValue(Promise.resolve(null)), // no duplicate
    insert: jest.fn().mockReturnValue(
      Promise.resolve({
        _id: USER_ID,
        email: TEST_EMAIL,
        activationToken: 'mock-token',
      })
    ),
  } as any;

  const clientDAO = {
    insert: jest.fn().mockReturnValue(
      Promise.resolve({
        _id: CLIENT_ID,
        cuid: 'MOCK_CUID',
      })
    ),
  } as any;

  const profileDAO = {
    createUserProfile: jest.fn().mockReturnValue(
      Promise.resolve({
        fullname: 'Test User',
      })
    ),
  } as any;

  const subscriptionService = {
    createSubscription: jest.fn().mockReturnValue(
      Promise.resolve({
        success: true,
        data: { _id: SUBSCRIPTION_ID },
      })
    ),
  } as any;

  const emitterService = {
    emit: jest.fn(),
    on: jest.fn(),
  } as any;

  const queueFactory = {
    getQueue: jest.fn().mockReturnValue({
      addToEmailQueue: jest.fn(),
    }),
  } as any;

  return {
    userDAO,
    clientDAO,
    profileDAO,
    subscriptionService,
    emitterService,
    queueFactory,
  };
};

const makeService = (mocks: ReturnType<typeof makeMocks>) =>
  new AuthService({
    ...mocks,
    tokenService: {} as any,
    authCache: {} as any,
    userCache: {} as any,
    vendorService: {} as any,
    leaseDAO: {} as any,
    paymentProcessorDAO: {} as any,
    paymentGatewayService: {} as any,
    paymentService: {} as any,
    twilioService: {} as any,
    featureFlagService: { isEnabled: jest.fn().mockReturnValue(false) } as any,
  } as any);

describe('AuthService — USER_SIGNUP_INITIATED event emission', () => {
  afterEach(() => jest.clearAllMocks());

  it('should emit USER_SIGNUP_INITIATED after successful signup', async () => {
    const mocks = makeMocks();
    const service = makeService(mocks);

    await service.signup(makeSignupData());

    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.USER_SIGNUP_INITIATED,
      expect.objectContaining({
        subscriptionId: SUBSCRIPTION_ID.toString(),
        billingInterval: 'monthly',
        planLookUpKey: 'essential_monthly',
        planName: 'essential',
        planId: 'price_essential',
        clientId: CLIENT_ID.toString(),
        email: TEST_EMAIL,
      })
    );

    // userId is generated internally by signup(), verify it's present
    const emittedPayload = mocks.emitterService.emit.mock.calls[0][1];
    expect(emittedPayload.userId).toBeDefined();
    expect(typeof emittedPayload.userId).toBe('string');
  });

  it('should NOT emit event when subscription creation fails', async () => {
    const mocks = makeMocks();
    mocks.subscriptionService.createSubscription.mockReturnValue(
      Promise.resolve({ success: false, message: 'Plan error' })
    );
    const service = makeService(mocks);

    await expect(service.signup(makeSignupData())).rejects.toThrow();
    expect(mocks.emitterService.emit).not.toHaveBeenCalledWith(
      EventTypes.USER_SIGNUP_INITIATED,
      expect.anything()
    );
  });

  it('should NOT emit event when user already exists', async () => {
    const mocks = makeMocks();
    mocks.userDAO.findFirst.mockReturnValue(
      Promise.resolve({ _id: USER_ID, email: TEST_EMAIL })
    );
    const service = makeService(mocks);

    await expect(service.signup(makeSignupData())).rejects.toThrow();
    expect(mocks.emitterService.emit).not.toHaveBeenCalledWith(
      EventTypes.USER_SIGNUP_INITIATED,
      expect.anything()
    );
  });
});
