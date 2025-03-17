import { Response, Request } from 'express';
import { AuthService } from '@services/index';
import { setAuthCookies, httpStatusCodes } from '@utils/index';

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
    const { email, password } = req.body;
    const result = await this.authService.login(email, password);
    res = setAuthCookies(
      { accessToken: result.data.accessToken, refreshToken: result.data.refreshToken },
      res
    );
    res.status(httpStatusCodes.OK).json({
      success: true,
      msg: result.msg,
      accounts: result.data.accounts,
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
}
