import { t } from '@shared/languages';
import { Response, Request } from 'express';
import { AuthService } from '@services/index';
import { AppRequest } from '@interfaces/utils.interface';
import { httpStatusCodes, setAuthCookies, JWT_KEY_NAMES } from '@utils/index';

interface IConstructor {
  authService: AuthService;
}

export class AuthController {
  private readonly authService: AuthService;

  constructor({ authService }: IConstructor) {
    this.authService = authService;
  }

  signup = async (req: Request, res: Response) => {
    const signupData = req.body;
    const { data: emailData, ...rest } = await this.authService.signup(signupData);
    res.status(httpStatusCodes.OK).json(rest);
  };

  login = async (req: Request, res: Response) => {
    const result = await this.authService.login(req.body);
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
      accounts: result.data.accounts,
      activeAccount: result.data.activeAccount,
    });
  };

  getCurrentUser = async (req: AppRequest, res: Response) => {
    const { currentuser } = req.context;
    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
      });
    }

    return res.status(httpStatusCodes.OK).json({
      success: 200,
      data: currentuser,
    });
  };

  switchClientAccount = async (req: AppRequest, res: Response) => {
    const { clientId } = req.body;
    const { currentuser } = req.context;
    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: t('auth.errors.unauthorized'),
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
    const data = await this.authService.accountActivation(token as string);
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
    const { token, password } = req.body;
    const result = await this.authService.resetPassword(token, password);
    res.status(httpStatusCodes.OK).json(result);
  };

  logout = async (req: Request, res: Response) => {
    let token = req.cookies?.[JWT_KEY_NAMES.ACCESS_TOKEN];
    if (!token) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Access token not found',
      });
    }

    token = token.split(' ')[1];
    const result = await this.authService.logout(token);

    res.clearCookie(JWT_KEY_NAMES.ACCESS_TOKEN, { path: '/' });
    res.clearCookie(JWT_KEY_NAMES.REFRESH_TOKEN, { path: '/api/v1/auth/refresh_token' });
    res.status(httpStatusCodes.OK).json(result);
  };

  refreshToken = async (req: Request, res: Response) => {
    let refreshToken = req.cookies?.[JWT_KEY_NAMES.REFRESH_TOKEN];

    if (!refreshToken) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Refresh token not found',
      });
    }

    // Remove Bearer prefix if present
    if (refreshToken.startsWith('Bearer ')) {
      refreshToken = refreshToken.split(' ')[1];
    }

    // Extract user ID from the refresh token
    const decoded = this.authService['tokenService'].decodeJwt(refreshToken);
    if (!decoded.success || !decoded.data?.data?.sub) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Invalid refresh token',
      });
    }

    const userId = decoded.data.data.sub;
    const result = await this.authService.refreshToken({ refreshToken, userId });

    // Set new tokens as cookies
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
}
