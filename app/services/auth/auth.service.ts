import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { EmailQueue } from '@queues/index';
import { AuthCache } from '@caching/index';
import { envVariables } from '@shared/config';
import { AuthTokenService } from '@services/index';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { ISignupData, IUserRole } from '@interfaces/user.interface';
import { ISuccessReturnData, TokenType, MailType } from '@interfaces/utils.interface';
import {
  getLocationDetails,
  generateShortUID,
  hashGenerator,
  JWT_KEY_NAMES,
  createLogger,
  JOB_NAME,
} from '@utils/index';
import {
  InvalidRequestError,
  UnauthorizedError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '@shared/customErrors';

interface IConstructor {
  tokenService: AuthTokenService;
  profileDAO: ProfileDAO;
  emailQueue: EmailQueue;
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
  private readonly emailQueue: EmailQueue;
  private readonly tokenService: AuthTokenService;

  constructor({
    userDAO,
    clientDAO,
    profileDAO,
    emailQueue,
    tokenService,
    authCache,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.authCache = authCache;
    this.profileDAO = profileDAO;
    this.emailQueue = emailQueue;
    this.tokenService = tokenService;
    this.log = createLogger('AuthService');
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

    const storedRefreshToken = await this.authCache.getRefreshToken(userId);
    if (!storedRefreshToken.success) {
      this.log.error('RefreshToken does not match stored token or expired');
      throw new UnauthorizedError();
    }

    const decoded = await this.tokenService.verifyJwtToken(
      JWT_KEY_NAMES.REFRESH_TOKEN as TokenType,
      refreshToken
    );

    if (!decoded.success || !decoded.data?.sub) {
      this.log.error('RefreshToken validation failed');
      throw new UnauthorizedError({ message: t('auth.errors.tokenExpired') });
    }

    const tokens = this.tokenService.createJwtTokens({
      sub: userId,
      rememberMe: decoded.data.rememberMe,
      csub: decoded.data.csub,
    });

    const saved = await this.authCache.saveRefreshToken(
      userId,
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

    const activeConnection = user.cids.find((c) => c.cid === decoded.data.csub);
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
    const client = await this.clientDAO.getClientByCid(clientId);
    if (!client) {
      throw new ForbiddenError({ message: t('auth.errors.clientNotFound') });
    }

    const clientAccount = user.cids.find((c) => c.cid === clientId);
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
    const session = await this.userDAO.startSession();
    const result = await this.userDAO.withTransaction(session, async (session) => {
      const _userId = new Types.ObjectId();
      const clientId = generateShortUID();

      const user = await this.userDAO.insert(
        {
          uid: generateShortUID(),
          _id: _userId,
          activeCid: clientId,
          isActive: false,
          email: signupData.email,
          password: signupData.password,
          activationToken: hashGenerator({ _usenano: true }),
          activationTokenExpiresAt: dayjs().add(2, 'hour').toDate(),
          cids: [
            {
              cid: clientId,
              isConnected: true,
              roles: [IUserRole.ADMIN],
              displayName: signupData.displayName,
            },
          ],
        },
        session
      );

      if (!user) {
        throw new InvalidRequestError({ message: t('auth.errors.userNotCreated') });
      }

      if (signupData.accountType.isCorporate) {
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
          cid: clientId,
          accountAdmin: _userId,
          displayName: signupData.displayName,
          accountType: signupData.accountType,
          ...(signupData.accountType.isCorporate && { companyProfile: signupData?.companyProfile }),
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
          lang: signupData.lang,
          timeZone: signupData.timeZone,
        },
        session
      );

      return {
        emailData: {
          to: user.email,
          subject: t('email.registration.subject'),
          emailType: MailType.ACCOUNT_ACTIVATION,
          data: {
            fullname: profile.fullname,
            activationUrl: `${process.env.FRONTEND_URL}/${client.cid}/account_activation?t=${user.activationToken}`,
          },
        },
      };
    });

    this.emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, result.emailData);
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
      activeAccount: { csub: string; displayName: string };
      accounts: { csub: string; displayName: string }[] | null;
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

    const connectedClients = user.cids.filter((c) => c.isConnected);

    if (connectedClients.length === 0) {
      throw new UnauthorizedError({ message: t('auth.errors.allConnectionsDisabled') });
    }

    let activeAccount = connectedClients.find((c) => c.cid === user.activeCid);

    if (!activeAccount) {
      activeAccount = connectedClients[0];
      await this.userDAO.updateById(user._id.toString(), {
        $set: { activeCid: activeAccount.cid },
      });
    }

    const tokens = this.tokenService.createJwtTokens({
      sub: user._id.toString(),
      rememberMe,
      csub: activeAccount.cid,
    });
    await this.authCache.saveRefreshToken(user._id.toString(), tokens.refreshToken, rememberMe);
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
            csub: activeAccount.cid,
            displayName: activeAccount.displayName,
          },
          accounts: [],
        },
        message: t('auth.success.loginSuccessful'),
      };
    }

    const otherAccounts = connectedClients
      .filter((c) => c.cid !== activeAccount.cid)
      .map((c) => ({ csub: c.cid, displayName: c.displayName }));
    return {
      success: true,
      data: {
        rememberMe,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        activeAccount: {
          csub: activeAccount.cid,
          displayName: activeAccount.displayName,
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
    newCid: string
  ): Promise<
    ISuccessReturnData<{
      accessToken: string;
      refreshToken: string;
      activeAccount: { csub: string; displayName: string };
    }>
  > {
    if (!userId || !newCid) {
      throw new BadRequestError({ message: t('auth.errors.userIdAndCidRequired') });
    }

    const user = await this.userDAO.getUserById(userId);
    if (!user) {
      throw new NotFoundError({ message: t('auth.errors.userNotFound') });
    }

    const accountExists = user.cids.find((c) => c.cid === newCid);
    if (!accountExists) {
      throw new NotFoundError({ message: t('auth.errors.unableToSelectAccount') });
    }

    // Validate that the new account is connected
    if (!accountExists.isConnected) {
      throw new UnauthorizedError({ message: t('auth.errors.connectionInactive') });
    }

    await this.userDAO.updateById(userId, { $set: { activeCid: newCid } });
    const activeAccount = user.cids.find((c) => c.cid === newCid)!;
    const tokens = this.tokenService.createJwtTokens({
      sub: user._id.toString(),
      rememberMe: false,
      csub: activeAccount.cid,
    });
    await this.authCache.saveRefreshToken(user._id.toString(), tokens.refreshToken, false);

    const currentuser = await this.profileDAO.generateCurrentUserInfo(user._id.toString());
    currentuser && (await this.authCache.saveCurrentUser(currentuser));
    return {
      success: true,
      data: {
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        activeAccount: {
          csub: activeAccount.cid,
          displayName: activeAccount.displayName,
        },
      },
      message: t('auth.success.accountSelected'),
    };
  }

  async accountActivation(token: string): Promise<ISuccessReturnData> {
    if (!token) {
      this.log.error(t('auth.errors.activationTokenMissing'));
      throw new BadRequestError({ message: t('auth.errors.activationTokenMissing') });
    }

    const activated = await this.userDAO.activateAccount(token.trim());
    if (!activated) {
      const msg = t('auth.errors.invalidActivationToken');
      throw new NotFoundError({ message: msg });
    }

    return { success: true, data: null, message: t('auth.success.accountActivated') };
  }

  async sendActivationLink(email: string): Promise<ISuccessReturnData> {
    if (!email) {
      throw new BadRequestError({ message: t('auth.errors.emailRequired') });
    }

    await this.userDAO.createActivationToken('', email)!;
    const user = await this.userDAO.getActiveUserByEmail(email, { populate: 'profile' });

    if (!user) {
      throw new NotFoundError({ message: t('auth.success.activationLinkSent', { email }) });
    }

    const emailData = {
      to: user.email,
      subject: t('email.registration.subject'),
      emailType: MailType.ACCOUNT_ACTIVATION,
      data: {
        fullname: user.profile?.fullname,
        activationUrl: `${envVariables.FRONTEND.URL}/${user.activeCid}/account_activation/?t=${user.activationToken}`,
      },
    };
    this.emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, emailData);
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
        fullname: user.profile?.fullname,
        resetUrl: `${process.env.FRONTEND_URL}/reset_password/${user.passwordResetToken}`,
      },
      emailType: MailType.FORGOT_PASSWORD,
    };

    this.emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, emailData);
    return {
      data: null,
      success: true,
      message: t('auth.success.passwordResetEmailSent', { email: user.email }),
    };
  }

  async resetPassword(email: string, token: string): Promise<ISuccessReturnData> {
    if (!email && !token) {
      this.log.error('User email and token are required. | ResetPassword');
      throw new BadRequestError({ message: t('auth.errors.invalidEmailToken') });
    }

    await this.userDAO.resetPassword(email, token);
    const user = await this.userDAO.getActiveUserByEmail(email, { populate: 'profile' });
    if (!user) {
      throw new NotFoundError({ message: t('auth.errors.noRecordFound') });
    }

    const emailData = {
      subject: t('email.forgotPassword.subject'),
      to: user.email,
      data: {
        fullname: user.profile?.fullname,
      },
      emailType: MailType.PASSWORD_RESET,
    };

    this.emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, emailData);
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

    await this.authCache.invalidateUserSession(payload.data.sub as string);
    return { success: true, data: null, message: t('auth.success.logoutSuccessful') };
  }
}
