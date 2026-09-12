import { UserDAO } from '@dao/index';
import { t } from '@shared/languages';
import { Response, Request } from 'express';
import { AuthService } from '@services/index';
import { AppRequest } from '@interfaces/utils.interface';
import { WebAuthnService } from '@services/auth/webauthn.service';
import { httpStatusCodes, setAuthCookies, JWT_KEY_NAMES } from '@utils/index';

interface IConstructor {
  webAuthnService: WebAuthnService;
  authService: AuthService;
  userDAO: UserDAO;
}

export class AuthController {
  private readonly webAuthnService: WebAuthnService;
  private readonly authService: AuthService;
  private readonly userDAO: UserDAO;

  constructor({ authService, webAuthnService, userDAO }: IConstructor) {
    this.authService = authService;
    this.webAuthnService = webAuthnService;
    this.userDAO = userDAO;
  }

  signup = async (req: Request, res: Response) => {
    const signupData = req.body;
    const { data: emailData, ...rest } = await this.authService.signup(signupData);
    res.status(httpStatusCodes.OK).json(rest);
  };

  login = async (req: Request, res: Response) => {
    const result = await this.authService.login(req.body);

    // step 1 responses (password_required / otp_sent / passkey_available) have no tokens
    if (result.data.step !== 'authenticated') {
      return res.status(httpStatusCodes.OK).json({
        success: true,
        msg: result.message,
        step: result.data.step,
        loginType: result.data.loginType,
        maskedPhone: result.data.maskedPhone,
        fallbackLoginType: result.data.fallbackLoginType,
        passkeyOptions: result.data.passkeyOptions,
      });
    }

    // step 2: authenticated — set cookies and return tokens
    res = setAuthCookies(
      {
        accessToken: result.data.accessToken,
        refreshToken: result.data.refreshToken,
        rememberMe: result.data.rememberMe,
      },
      res
    );
    res.status(httpStatusCodes.OK).json({
      success: true,
      msg: result.message,
      step: result.data.step,
      accounts: result.data.accounts,
      activeAccount: result.data.activeAccount,
    });
  };

  getCurrentUser = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('common.errors.unauthorized'),
      });
    }

    // strip entitlements from /me response — now served via GET /subscriptions/:cuid/entitlements
    const { permissions, gdpr, ...userData } = currentuser as any;
    if (userData.subscription) {
      const { entitlements, paymentFlow, ...planData } = userData.subscription;
      userData.subscription = planData;
    }

    return res.status(httpStatusCodes.OK).json({
      success: true,
      data: userData,
    });
  };

  switchClientAccount = async (req: AppRequest, res: Response) => {
    const { clientId } = req.body;
    const { currentuser } = req.context;
    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('common.errors.unauthorized'),
      });
    }

    const result = await this.authService.switchActiveAccount(currentuser?.sub, clientId);
    res = setAuthCookies(
      { accessToken: result.data.accessToken, refreshToken: result.data.refreshToken },
      res
    );
    res.status(httpStatusCodes.OK).json({
      success: true,
      msg: result.message,
      activeAccount: result.data.activeAccount,
    });
  };

  accountActivation = async (req: Request, res: Response) => {
    const { t: token } = req.query;
    const { firstName, lastName } = req.body;
    const data = await this.authService.accountActivation(token as string, { firstName, lastName });
    res.status(httpStatusCodes.OK).json(data);
  };

  sendActivationLink = async (req: Request, res: Response) => {
    const { email } = req.body;
    const data = await this.authService.sendActivationLink(email);
    res.status(httpStatusCodes.OK).json(data);
  };

  forgotPassword = async (req: Request, res: Response) => {
    const { email } = req.body;
    const result = await this.authService.forgotPassword(email);
    res.status(httpStatusCodes.OK).json(result);
  };

  resetPassword = async (req: Request, res: Response) => {
    const { resetToken, password } = req.body;
    const result = await this.authService.resetPassword(resetToken, password);
    res.status(httpStatusCodes.OK).json(result);
  };

  changePassword = async (req: AppRequest, res: Response) => {
    const userId = req.context.currentuser!.sub;
    const { currentPassword, newPassword } = req.body;
    const result = await this.authService.changePassword(userId, currentPassword, newPassword);
    res.status(httpStatusCodes.OK).json(result);
  };

  logout = async (req: Request, res: Response) => {
    let token = req.cookies?.[JWT_KEY_NAMES.ACCESS_TOKEN];
    if (!token) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.accessTokenNotFound'),
      });
    }

    token = token.split(' ')[1];
    const result = await this.authService.logout(token);

    res.clearCookie(JWT_KEY_NAMES.ACCESS_TOKEN, { path: '/' });
    res.clearCookie(JWT_KEY_NAMES.REFRESH_TOKEN, { path: '/api/v1/auth/refresh_token' });
    res.status(httpStatusCodes.OK).json(result);
  };

  completeOnboarding = async (req: AppRequest, res: Response) => {
    const userId = req.context?.currentuser?.sub;
    const { cuid } = req.params;
    const result = await this.authService.completeOnboarding(userId!, cuid, req.body);
    res.status(httpStatusCodes.OK).json(result);
  };

  chargeFirstPayment = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const currentuser = req.context?.currentuser;
    const result = await this.authService.chargeFirstPayment(cuid, currentuser!);
    res.status(httpStatusCodes.CREATED).json(result);
  };

  setupPaymentIntent = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const currentuser = req.context?.currentuser;
    const { returnUrl, cancelUrl, paymentMethodType } = req.body;
    const result = await this.authService.setupPaymentIntent(
      cuid,
      currentuser!,
      returnUrl,
      cancelUrl,
      paymentMethodType
    );
    res.status(httpStatusCodes.OK).json(result);
  };

  getPaymentMethod = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const currentuser = req.context?.currentuser;
    const result = await this.authService.getPaymentMethod(cuid, currentuser!);
    res.status(httpStatusCodes.OK).json(result);
  };

  removePaymentMethod = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const currentuser = req.context?.currentuser;
    const result = await this.authService.removePaymentMethod(cuid, currentuser!);
    res.status(httpStatusCodes.OK).json(result);
  };

  refreshToken = async (req: Request, res: Response) => {
    let refreshToken = req.cookies?.[JWT_KEY_NAMES.REFRESH_TOKEN];

    if (!refreshToken) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.refreshTokenNotFound'),
      });
    }

    if (refreshToken.startsWith('Bearer ')) {
      refreshToken = refreshToken.split(' ')[1];
    }

    const result = await this.authService.refreshToken({ refreshToken });

    res = setAuthCookies(
      {
        accessToken: result.data.accessToken,
        refreshToken: result.data.refreshToken,
        rememberMe: result.data.rememberMe,
      },
      res
    );

    res.status(httpStatusCodes.OK).json({
      success: true,
      message: result.message,
    });
  };

  // ── Passkey (WebAuthn) Methods ──────────────────────────────────

  getPasskeyRegistrationOptions = async (req: AppRequest, res: Response) => {
    const userId = req.context?.currentuser?.sub;
    if (!userId) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('common.errors.unauthorized'),
      });
    }

    const options = await this.webAuthnService.generateRegistrationOptions(userId);
    res.status(httpStatusCodes.OK).json({ success: true, data: options });
  };

  verifyPasskeyRegistration = async (req: AppRequest, res: Response) => {
    const userId = req.context?.currentuser?.sub;
    if (!userId) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('common.errors.unauthorized'),
      });
    }

    const { friendlyName, registrationResponse } = req.body;
    const credential = await this.webAuthnService.verifyRegistration(
      userId,
      registrationResponse,
      friendlyName
    );
    res.status(httpStatusCodes.CREATED).json({ success: true, data: credential });
  };

  listPasskeys = async (req: AppRequest, res: Response) => {
    const userId = req.context?.currentuser?.sub;
    if (!userId) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('common.errors.unauthorized'),
      });
    }

    const passkeys = await this.userDAO.getUserPasskeys(userId);
    const safePasskeys = passkeys.map(({ publicKey: _pk, ...rest }) => rest);
    res.status(httpStatusCodes.OK).json({ success: true, data: safePasskeys });
  };

  deletePasskey = async (req: AppRequest, res: Response) => {
    const userId = req.context?.currentuser?.sub;
    const email = req.context?.currentuser?.email;
    if (!userId || !email) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('common.errors.unauthorized'),
      });
    }

    const { credentialId, password } = req.body;
    const user = await this.userDAO.verifyCredentials(email, password);
    if (!user) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.invalidCredentials'),
      });
    }

    await this.webAuthnService.deletePasskey(userId, credentialId);
    res.status(httpStatusCodes.OK).json({ success: true, data: null });
  };

  // Discoverable passkey login (no email required)
  getDiscoverablePasskeyOptions = async (req: Request, res: Response) => {
    const { options, sessionId } = await this.webAuthnService.generateDiscoverableAuthOptions();
    res.status(httpStatusCodes.OK).json({ success: true, data: { options, sessionId } });
  };

  verifyDiscoverablePasskey = async (req: Request, res: Response) => {
    const { sessionId, passkeyResponse, rememberMe } = req.body;
    const user = await this.webAuthnService.verifyDiscoverableAuthentication(
      sessionId,
      passkeyResponse
    );
    const result = await this.authService.completeLoginFromPasskey(user, rememberMe ?? false);

    res = setAuthCookies(
      {
        accessToken: result.data.accessToken,
        refreshToken: result.data.refreshToken,
        rememberMe: result.data.rememberMe,
      },
      res
    );
    res.status(httpStatusCodes.OK).json({
      success: true,
      msg: result.message,
      step: result.data.step,
      accounts: result.data.accounts,
      activeAccount: result.data.activeAccount,
    });
  };
}
