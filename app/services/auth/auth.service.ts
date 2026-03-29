import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { EmailQueue } from '@queues/index';
import { AuthCache } from '@caching/index';
import { envVariables } from '@shared/config';
import { QueueFactory } from '@services/queue';
import { ISignupData } from '@interfaces/user.interface';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { IUserRole } from '@shared/constants/roles.constants';
import { PlanName } from '@interfaces/subscription.interface';
import { IActiveAccountInfo } from '@interfaces/client.interface';
import { UserDisconnectedPayload, EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter/eventsEmitter.service';
import { ISuccessReturnData, TokenType, MailType } from '@interfaces/utils.interface';
import { SubscriptionService, AuthTokenService, VendorService } from '@services/index';
import {
  ValidationRequestError,
  InvalidRequestError,
  UnauthorizedError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '@shared/customErrors';
import {
  STRIPE_SUPPORTED_COUNTRY_CODES,
  getCountryCodeFromLocation,
  getLocationDetails,
  generateShortUID,
  hashGenerator,
  JWT_KEY_NAMES,
  createLogger,
  JOB_NAME,
} from '@utils/index';

interface IConstructor {
  subscriptionService: SubscriptionService;
  emitterService: EventEmitterService;
  tokenService: AuthTokenService;
  vendorService: VendorService;
  queueFactory: QueueFactory;
  profileDAO: ProfileDAO;
  authCache: AuthCache;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class AuthService {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly clientDAO: ClientDAO;
  private readonly authCache: AuthCache;
  private readonly profileDAO: ProfileDAO;
  private readonly queueFactory: QueueFactory;
  private readonly tokenService: AuthTokenService;
  private readonly vendorService: VendorService;
  private readonly subscriptionService: SubscriptionService;
  private readonly emitterService: EventEmitterService;

  constructor({
    userDAO,
    clientDAO,
    profileDAO,
    queueFactory,
    tokenService,
    authCache,
    vendorService,
    subscriptionService,
    emitterService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.authCache = authCache;
    this.profileDAO = profileDAO;
    this.queueFactory = queueFactory;
    this.tokenService = tokenService;
    this.vendorService = vendorService;
    this.subscriptionService = subscriptionService;
    this.emitterService = emitterService;
    this.log = createLogger('AuthService');
    this.setupEventListeners();
  }

  async refreshToken(data: { refreshToken: string; userId: string }): Promise<
    ISuccessReturnData<{
      accessToken: string;
      refreshToken: string;
      rememberMe: boolean;
    }>
  > {
    const { refreshToken, userId } = data;

    if (!refreshToken || !userId) {
      this.log.error('RefreshToken or userId missing');
      throw new UnauthorizedError({ message: t('auth.errors.invalidRefreshToken') });
    }

    // Decode first to extract cuid for client-scoped Redis lookup
    const decoded = await this.tokenService.verifyJwtToken(
      JWT_KEY_NAMES.REFRESH_TOKEN as TokenType,
      refreshToken
    );

    if (!decoded.success || !decoded.data?.sub) {
      this.log.error('RefreshToken validation failed');
      throw new UnauthorizedError({ message: t('auth.errors.tokenExpired') });
    }

    const cuid = decoded.data.cuid;

    const storedRefreshToken = await this.authCache.getRefreshToken(userId, cuid);
    if (!storedRefreshToken.success) {
      this.log.error('RefreshToken does not match stored token or expired');
      throw new UnauthorizedError();
    }

    // Guard: reject if user has been disconnected from this client
    const user = await this.userDAO.getUserById(userId);
    if (!user) {
      throw new UnauthorizedError({ message: t('auth.errors.tokenExpired') });
    }
    const clientEntry = user.cuids?.find((c) => c.cuid === cuid);
    if (!clientEntry?.isConnected) {
      this.log.warn({ userId, cuid }, 'Refresh rejected — user disconnected from client');
      throw new UnauthorizedError({ message: t('auth.errors.tokenExpired') });
    }

    const tokens = this.tokenService.createJwtTokens({
      sub: userId,
      rememberMe: decoded.data.rememberMe,
      cuid,
    });

    const saved = await this.authCache.saveRefreshToken(
      userId,
      cuid,
      tokens.refreshToken,
      decoded.data.rememberMe
    );
    if (!saved.success) {
      throw new UnauthorizedError({ message: t('auth.errors.invalidRefreshToken') });
    }

    return {
      success: true,
      data: tokens,
      message: t('auth.success.tokenRefreshed'),
    };
  }

  async getTokenUser(token: string): Promise<ISuccessReturnData> {
    if (!token) {
      this.log.error('Token missing in validateToken');
      throw new UnauthorizedError({ message: t('auth.errors.authenticationRequired') });
    }

    const decoded = await this.tokenService.verifyJwtToken(
      JWT_KEY_NAMES.ACCESS_TOKEN as TokenType,
      token
    );

    if (!decoded.success || !decoded.data?.sub) {
      this.log.error('Token validation failed');
      throw new UnauthorizedError({ message: t('auth.errors.invalidAuthToken') });
    }

    const user = await this.userDAO.getUserById(decoded.data.sub);
    if (!user) {
      this.log.error('User not found for token');
      throw new UnauthorizedError();
    }

    if (!user.isActive) {
      this.log.error('User account inactive');
      throw new UnauthorizedError({ message: t('auth.errors.accountVerificationPending') });
    }

    const activeConnection = user.cuids.find((c) => c.cuid === decoded.data.cuid);
    if (!activeConnection || !activeConnection.isConnected) {
      this.log.error('User connection inactive');
      throw new UnauthorizedError({ message: t('auth.errors.connectionInactive') });
    }

    return {
      data: null,
      success: true,
      message: t('auth.success.tokenValidated'),
    };
  }

  async verifyClientAccess(userId: string, clientId: string): Promise<ISuccessReturnData> {
    const user = await this.userDAO.getUserById(userId);

    if (!user) {
      throw new ForbiddenError({ message: t('auth.errors.userNotFound') });
    }
    const client = await this.clientDAO.getClientByCuid(clientId);
    if (!client) {
      throw new ForbiddenError({ message: t('auth.errors.clientNotFound') });
    }

    const clientAccount = user.cuids.find((c) => c.cuid === clientId);
    if (!clientAccount) {
      throw new ForbiddenError({ message: t('auth.errors.noAccessToClient') });
    }

    return {
      success: true,
      data: null,
      message: t('auth.success.userHasAccess'),
    };
  }

  async signup(signupData: ISignupData): Promise<ISuccessReturnData> {
    const countryCode = getCountryCodeFromLocation(signupData.location);
    if (!countryCode || !STRIPE_SUPPORTED_COUNTRY_CODES.includes(countryCode)) {
      const normalizedLocation = getLocationDetails(signupData.location);
      const locationParts = normalizedLocation?.split(', ') ?? [];
      const countryName = locationParts[locationParts.length - 1] || signupData.location;
      throw new BadRequestError({
        message: t('auth.errors.unsupportedCountry', { country: countryName }),
      });
    }

    const session = await this.userDAO.startSession();
    const result = await this.userDAO.withTransaction(session, async (session) => {
      const _userId = new Types.ObjectId();
      const clientUid = generateShortUID();

      const alreadyExists = await this.userDAO.findFirst(
        { email: signupData.email },
        undefined,
        undefined,
        session
      );
      if (alreadyExists) {
        throw new ValidationRequestError({
          message: 'Validation failed',
          errorInfo: { email: ['An account with this email already exists.'] },
        });
      }

      const user = await this.userDAO.insert(
        {
          uid: generateShortUID(),
          _id: _userId,
          isActive: false,
          activecuid: clientUid,
          email: signupData.email,
          password: signupData.password,
          activationToken: hashGenerator({}),
          activationTokenExpiresAt: dayjs().add(2, 'hour').toDate(),
          cuids: [
            {
              cuid: clientUid,
              isConnected: true,
              roles: [IUserRole.SUPER_ADMIN],
              primaryRole: IUserRole.SUPER_ADMIN,
              clientDisplayName:
                signupData.displayName ||
                signupData.companyProfile?.tradingName ||
                `${signupData.firstName} ${signupData.lastName}`,
            },
          ],
        },
        session
      );

      if (!user) {
        throw new InvalidRequestError({ message: t('auth.errors.userNotCreated') });
      }

      const isEnterpriseAccount = signupData.accountType.category === 'business';
      signupData.accountType.isEnterpriseAccount = isEnterpriseAccount;

      if (isEnterpriseAccount) {
        signupData.companyProfile = {
          ...signupData.companyProfile,
          contactInfo: {
            email: signupData.email,
            contactPerson: `${signupData.firstName} ${signupData.lastName}`,
          },
        };
      }
      const client = await this.clientDAO.insert(
        {
          cuid: clientUid,
          accountAdmin: _userId,
          displayName: signupData.displayName,
          accountType: {
            category: signupData.accountType.category,
            isEnterpriseAccount: signupData.accountType.isEnterpriseAccount,
          },
          ...(isEnterpriseAccount && {
            companyProfile: signupData?.companyProfile,
          }),
        },
        session
      );

      const profile = await this.profileDAO.createUserProfile(
        _userId,
        {
          user: _userId,
          puid: generateShortUID(),
          personalInfo: {
            displayName: signupData.displayName,
            firstName: signupData.firstName,
            lastName: signupData.lastName,
            location: getLocationDetails(signupData.location) || 'Unknown',
            phoneNumber: signupData.phoneNumber,
          },
          settings: {
            lang: signupData.lang,
            loginType: 'password',
            timeZone: signupData.timeZone,
          },
        },
        session
      );
      const subscriptionResult = await this.subscriptionService.createSubscription(
        client._id.toString(),
        {
          planLookUpKey: signupData.accountType.planLookUpKey || '',
          planName: signupData.accountType.planName as PlanName,
          billingInterval: signupData.accountType.billingInterval as 'monthly' | 'annual',
          planId: signupData.accountType.planId,
          totalMonthlyPrice: signupData.accountType.totalMonthlyPrice,
        },
        session
      );

      if (!subscriptionResult.success) {
        throw new InvalidRequestError({
          message: subscriptionResult.message || 'Encountered an error while creating subscription',
        });
      }

      return {
        userId: _userId.toString(),
        clientId: client._id.toString(),
        cuid: clientUid,
        email: user.email,
        planName: signupData.accountType.planName,
        planId: signupData.accountType.planId,
        planLookUpKey: signupData.accountType.planLookUpKey,
        billingInterval: signupData.accountType.billingInterval,
        emailData: {
          to: user.email,
          subject: t('email.registration.subject'),
          emailType: MailType.ACCOUNT_ACTIVATION,
          data: {
            fullname: profile.fullname,
            activationUrl: `${process.env.FRONTEND_URL}/account_activation/${client.cuid}?t=${user.activationToken}`,
          },
        },
      };
    });

    const emailQueue = this.queueFactory.getQueue('emailQueue') as EmailQueue;
    emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, result.emailData);

    return {
      data: null,
      success: true,
      message: t('auth.success.activationEmailSent', { email: result.emailData.to }),
    };
  }

  async login(data: { email: string; password: string; rememberMe: boolean }): Promise<
    ISuccessReturnData<{
      accessToken: string;
      rememberMe: boolean;
      refreshToken: string;
      activeAccount: IActiveAccountInfo;
      accounts: IActiveAccountInfo[] | null;
    }>
  > {
    const { email, password, rememberMe } = data;
    if (!email || !password) {
      this.log.error('Email and password are required. | Login');
      throw new BadRequestError({ message: t('auth.errors.emailPasswordRequired') });
    }

    let user = await this.userDAO.getActiveUserByEmail(email);
    if (!user) {
      throw new NotFoundError({ message: t('auth.errors.invalidCredentials') });
    }

    if (!user.isActive) {
      throw new InvalidRequestError({ message: t('auth.errors.accountVerificationPending') });
    }

    user = await this.userDAO.verifyCredentials(email, password);
    if (!user) {
      throw new NotFoundError({ message: t('auth.errors.invalidCredentials') });
    }

    const connectedClients = user.cuids.filter((c) => c.isConnected);

    if (connectedClients.length === 0) {
      throw new UnauthorizedError({ message: t('auth.errors.allConnectionsDisabled') });
    }

    let activeAccount = connectedClients.find((c) => c.cuid === user.activecuid);

    if (!activeAccount) {
      activeAccount = connectedClients[0];
      await this.userDAO.updateById(user._id.toString(), {
        $set: { activecuid: activeAccount.cuid },
      });
    }

    const tokens = this.tokenService.createJwtTokens({
      sub: user._id.toString(),
      rememberMe,
      cuid: activeAccount.cuid,
    });
    await this.authCache.saveRefreshToken(
      user._id.toString(),
      activeAccount.cuid,
      tokens.refreshToken,
      rememberMe
    );
    const currentuser = await this.profileDAO.generateCurrentUserInfo(user._id.toString());
    currentuser && (await this.authCache.saveCurrentUser(currentuser));

    if (connectedClients.length === 1) {
      return {
        success: true,
        data: {
          rememberMe,
          refreshToken: tokens.refreshToken,
          accessToken: tokens.accessToken,
          activeAccount: {
            cuid: activeAccount.cuid,
            clientDisplayName: activeAccount.clientDisplayName,
          },
          accounts: [],
        },
        message: t('auth.success.loginSuccessful'),
      };
    }

    const otherAccounts = connectedClients
      .filter((c) => c.cuid !== activeAccount.cuid)
      .map((c) => ({ cuid: c.cuid, clientDisplayName: c.clientDisplayName }));
    return {
      success: true,
      data: {
        rememberMe,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        activeAccount: {
          cuid: activeAccount.cuid,
          clientDisplayName: activeAccount.clientDisplayName,
        },
        accounts: otherAccounts,
      },
      message: t('auth.success.loginSuccessful'),
    };
  }

  async getCurrentUser(userId: string): Promise<ISuccessReturnData> {
    if (!userId) {
      this.log.error('User ID is required. | GetCurrentUser');
      throw new BadRequestError({ message: t('auth.errors.userIdRequired') });
    }

    const currentuser = await this.profileDAO.generateCurrentUserInfo(userId);
    if (!currentuser) {
      this.log.error('User not found. | GetCurrentUser');
      throw new UnauthorizedError({ message: t('auth.errors.unauthorized') });
    }

    const cachedResp = await this.authCache.saveCurrentUser(currentuser);
    if (!cachedResp.success) {
      return {
        success: cachedResp.success,
        data: null,
      };
    }

    return {
      success: true,
      data: currentuser,
    };
  }

  async switchActiveAccount(
    userId: string,
    newcuid: string
  ): Promise<
    ISuccessReturnData<{
      accessToken: string;
      refreshToken: string;
      activeAccount: IActiveAccountInfo;
    }>
  > {
    if (!userId || !newcuid) {
      throw new BadRequestError({ message: t('auth.errors.userIdAndcuidRequired') });
    }

    const user = await this.userDAO.getUserById(userId);
    if (!user) {
      throw new NotFoundError({ message: t('auth.errors.userNotFound') });
    }

    const accountExists = user.cuids.find((c) => c.cuid === newcuid);
    if (!accountExists) {
      throw new NotFoundError({ message: t('auth.errors.unableToSelectAccount') });
    }

    // Validate that the new account is connected
    if (!accountExists.isConnected) {
      throw new UnauthorizedError({ message: t('auth.errors.connectionInactive') });
    }

    await this.userDAO.updateById(userId, { $set: { activecuid: newcuid } });
    const activeAccount = user.cuids.find((c) => c.cuid === newcuid)!;
    const tokens = this.tokenService.createJwtTokens({
      sub: user._id.toString(),
      rememberMe: false,
      cuid: activeAccount.cuid,
    });
    await this.authCache.saveRefreshToken(user._id.toString(), newcuid, tokens.refreshToken, false);

    const currentuser = await this.profileDAO.generateCurrentUserInfo(user._id.toString());
    currentuser && (await this.authCache.saveCurrentUser(currentuser));
    return {
      success: true,
      data: {
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        activeAccount: {
          cuid: activeAccount.cuid,
          clientDisplayName: activeAccount.clientDisplayName,
        },
      },
      message: t('auth.success.accountSelected'),
    };
  }

  async accountActivation(
    token: string,
    consentData: { firstName: string; lastName: string }
  ): Promise<ISuccessReturnData> {
    if (!token) {
      this.log.error(t('auth.errors.activationTokenMissing'));
      throw new BadRequestError({ message: t('auth.errors.activationTokenMissing') });
    }

    const pendingUser = await this.userDAO.findFirst(
      {
        activationToken: token.trim(),
        activationTokenExpiresAt: { $gt: new Date() },
        isActive: false,
      },
      { populate: 'profile' }
    );

    if (!pendingUser) {
      throw new NotFoundError({ message: t('auth.errors.invalidActivationToken') });
    }

    const storedFirst = pendingUser.profile?.personalInfo?.firstName?.trim().toLowerCase() ?? '';
    const storedLast = pendingUser.profile?.personalInfo?.lastName?.trim().toLowerCase() ?? '';
    const givenFirst = consentData.firstName.trim().toLowerCase();
    const givenLast = consentData.lastName.trim().toLowerCase();

    if (storedFirst && storedLast && (storedFirst !== givenFirst || storedLast !== givenLast)) {
      throw new ValidationRequestError({
        message: t('auth.errors.consentNameMismatch'),
      });
    }

    const acceptedBy = `${consentData.firstName} ${consentData.lastName}`.trim();
    const userId = await this.userDAO.activateAccount(token.trim(), { acceptedBy });
    if (!userId) {
      throw new NotFoundError({ message: t('auth.errors.invalidActivationToken') });
    }

    return { success: true, data: null, message: t('auth.success.accountActivated') };
  }

  async sendActivationLink(email: string): Promise<ISuccessReturnData> {
    if (!email) {
      throw new BadRequestError({ message: t('auth.errors.emailRequired') });
    }

    await this.userDAO.createActivationToken('', email)!;
    const user = await this.userDAO.findFirst({ email }, { populate: 'profile' });

    if (!user) {
      throw new NotFoundError({ message: t('auth.success.activationLinkSent', { email }) });
    }

    const emailData = {
      to: user.email,
      subject: t('email.registration.subject'),
      emailType: MailType.ACCOUNT_ACTIVATION,
      data: {
        fullname: user.profile?.fullname || '',
        activationUrl: `${envVariables.FRONTEND.URL}/account_activation/${user.activecuid}?t=${user.activationToken}`,
      },
    };
    const emailQueue = this.queueFactory.getQueue('emailQueue') as EmailQueue;
    emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, emailData);
    return {
      success: true,
      data: emailData,
      message: t('auth.success.activationEmailSent', { email: emailData.to }),
    };
  }

  async forgotPassword(email: string): Promise<ISuccessReturnData> {
    if (!email) {
      this.log.error('User email is required. | ForgotPassword');
      throw new BadRequestError({ message: t('auth.errors.userEmailRequired') });
    }

    await this.userDAO.createPasswordResetToken(email);
    const user = await this.userDAO.getActiveUserByEmail(email, { populate: 'profile' });
    if (!user) {
      throw new NotFoundError({ message: t('auth.errors.noRecordFound') });
    }

    const emailData = {
      subject: t('email.forgotPassword.subject'),
      to: user.email,
      data: {
        fullname: user.profile?.fullname || '',
        resetUrl: `${process.env.FRONTEND_URL}/reset_password/${user.passwordResetToken}`,
      },
      emailType: MailType.FORGOT_PASSWORD,
    };

    const emailQueue = this.queueFactory.getQueue('emailQueue') as EmailQueue;
    emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, emailData);
    return {
      data: null,
      success: true,
      message: t('auth.success.passwordResetEmailSent', { email: user.email }),
    };
  }

  async resetPassword(resetToken: string, password: string): Promise<ISuccessReturnData> {
    if (!resetToken && !password) {
      this.log.error('User email and token are required. | ResetPassword');
      throw new BadRequestError({ message: t('auth.errors.invalidEmailToken') });
    }

    const result = await this.userDAO.resetPassword(resetToken, password);
    if (!result) {
      throw new BadRequestError({ message: t('auth.errors.invalidEmailToken') });
    }
    const user = await this.userDAO.getActiveUserByEmail(result.email, { populate: 'profile' });
    if (!user) {
      throw new NotFoundError({ message: t('auth.errors.noRecordFound') });
    }

    const emailData = {
      subject: t('email.forgotPassword.subject'),
      to: user.email,
      data: {
        fullname: user.profile?.fullname || '',
      },
      emailType: MailType.PASSWORD_RESET,
    };

    const emailQueue = this.queueFactory.getQueue('emailQueue') as EmailQueue;
    emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, emailData);
    return {
      data: null,
      success: true,
      message: t('auth.success.passwordResetEmailSent', { email: user.email }),
    };
  }

  async logout(accessToken: string): Promise<ISuccessReturnData> {
    if (!accessToken) {
      this.log.error('Access token is required. | Logout');
    }
    const payload = await this.tokenService.verifyJwtToken(
      JWT_KEY_NAMES.ACCESS_TOKEN as TokenType,
      accessToken
    );
    if (!payload.success || !payload.data?.sub) {
      throw new ForbiddenError({ message: t('auth.errors.invalidAuthTokenLogout') });
    }

    await this.authCache.invalidateUserSession(payload.data.sub as string, payload.data.cuid);
    return { success: true, data: null, message: t('auth.success.logoutSuccessful') };
  }

  async loginAfterInvitationSignup(
    userId: string,
    cuid: string
  ): Promise<
    ISuccessReturnData<{
      accessToken: string;
      refreshToken: string;
      activeAccount: IActiveAccountInfo;
      accounts: IActiveAccountInfo[] | null;
    }>
  > {
    try {
      const user = await this.userDAO.getUserById(userId);
      if (!user) {
        throw new NotFoundError({ message: t('auth.errors.userNotFound') });
      }

      const activeConnection = user.cuids.find((c) => c.cuid === cuid);
      if (!activeConnection) {
        throw new UnauthorizedError({ message: t('auth.errors.noAccessToClient') });
      }

      const tokens = this.tokenService.createJwtTokens({
        sub: user._id.toString(),
        rememberMe: false,
        cuid: activeConnection.cuid,
      });

      // Cache tokens and user info
      await this.authCache.saveRefreshToken(user._id.toString(), cuid, tokens.refreshToken, false);

      const currentuser = await this.profileDAO.generateCurrentUserInfo(user._id.toString());
      currentuser && (await this.authCache.saveCurrentUser(currentuser));

      // Get all connected clients for account switching
      const connectedClients = user.cuids.filter((c) => c.isConnected);
      const otherAccounts = connectedClients
        .filter((c) => c.cuid !== activeConnection.cuid)
        .map((c) => ({ cuid: c.cuid, clientDisplayName: c.clientDisplayName }));

      return {
        success: true,
        data: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          activeAccount: {
            cuid: activeConnection.cuid,
            clientDisplayName: activeConnection.clientDisplayName,
          },
          accounts:
            otherAccounts.length > 0
              ? otherAccounts
              : [
                  {
                    cuid: activeConnection.cuid,
                    clientDisplayName: activeConnection.clientDisplayName,
                  },
                ],
        },
        message: t('auth.success.loginSuccessful'),
      };
    } catch (error) {
      this.log.error('Error in login after invitation signup:', error);
      throw error;
    }
  }

  async completeOnboarding(
    userId: string,
    cuid: string,
    body: {
      policies: {
        tos: { accepted: true };
        privacy: { accepted: true };
        marketing: { accepted: boolean };
      };
      newPassword?: string;
      lang?: string;
      timeZone?: string;
      location?: string;
    }
  ): Promise<ISuccessReturnData> {
    const profile = await this.profileDAO.getProfileByUserId(userId);
    if (!profile) {
      throw new NotFoundError({ message: t('profile.errors.notFound') });
    }

    const now = new Date();
    const updateFields: Record<string, any> = {
      'policies.tos.accepted': true,
      'policies.tos.acceptedOn': now,
      'policies.privacy.accepted': true,
      'policies.privacy.acceptedOn': now,
      'policies.marketing.accepted': body.policies.marketing.accepted,
      'policies.marketing.acceptedOn': body.policies.marketing.accepted ? now : null,
    };

    if (body.lang) updateFields['settings.lang'] = body.lang;
    if (body.timeZone) updateFields['settings.timeZone'] = body.timeZone;
    if (body.location) updateFields['personalInfo.location'] = body.location;

    await this.profileDAO.updateById(profile._id.toString(), { $set: updateFields });

    if (body.newPassword) {
      const user = await this.userDAO.getUserById(userId);
      if (user) {
        user.password = body.newPassword;
        await user.save();
      }
    }

    await this.userDAO.updateById(userId, {
      $set: {
        'consent.acceptedOn': now,
        'consent.acceptedBy':
          `${profile.personalInfo?.firstName ?? ''} ${profile.personalInfo?.lastName ?? ''}`.trim(),
      },
    });

    await this.userDAO.clearOnboardingFlag(userId, cuid);
    await this.authCache.invalidateCurrentUser(userId, cuid);

    return { success: true, message: t('auth.success.onboardingCompleted'), data: null };
  }

  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.USER_DISCONNECTED, this.handleUserDisconnected.bind(this));
  }

  private handleUserDisconnected = async (payload: UserDisconnectedPayload): Promise<void> => {
    try {
      const { userId, cuid } = payload;
      await this.authCache.invalidateUserSession(userId, cuid);
      this.log.info({ userId, cuid }, 'Session invalidated for disconnected user');
    } catch (error: any) {
      this.log.error(
        { error: error.message, payload },
        'Failed to invalidate session for disconnected user'
      );
    }
  };
}
