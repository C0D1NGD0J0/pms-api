import { Response, Request } from 'express';
import { AuthService } from '@services/index';
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

  getCurrentUser = async (req: Request, res: Response) => {
    const { currentuser } = req;
    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    return res.status(httpStatusCodes.OK).json({
      success: 200,
      data: currentuser,
    });
  };

  switchClientAccount = async (req: Request, res: Response) => {
    const { clientId } = req.body;
    const { currentuser } = req;
    if (!currentuser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Unauthorized',
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
    const token = req.cookies?.[JWT_KEY_NAMES.ACCESS_TOKEN];
    const result = await this.authService.logout(token);

    res.clearCookie(req.cookies?.[JWT_KEY_NAMES.ACCESS_TOKEN], { path: '/' });
    res.clearCookie(req.cookies?.[JWT_KEY_NAMES.REFRESH_TOKEN], { path: '/api/v1/auth/refresh' });
    res.status(httpStatusCodes.OK).json(result);
  };

  refreshToken = async (req: Request, res: Response) => {
    const token = req.cookies?.[JWT_KEY_NAMES.REFRESH_TOKEN];
    const result = await this.authService.refreshToken(token);
    console.log(result, '----result');
    // res = setAuthCookies(
    //   { accessToken: result.data.accessToken, refreshToken: result.data.refreshToken },
    //   res
    // );
    res.status(httpStatusCodes.OK).json(result);
  };
}
