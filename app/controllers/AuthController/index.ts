import { Response, Request } from 'express';
import { httpStatusCodes } from '@utils/index';

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
}
