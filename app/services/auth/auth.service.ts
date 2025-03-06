import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { v4 as uuid } from 'uuid';
import { User } from '@models/index';
import { UserDAO } from '@dao/index';
import { envVariables } from '@shared/config';
import { httpStatusCodes } from '@utils/constants';
import { hashGenerator, createLogger } from '@utils/index';
import { ISuccessReturnData, IEmailOptions } from '@interfaces/utils.interface';
import {
  IUserRole,
  IUserDocument,
  IUser,
  ISignupData,
  IInviteUserSignup,
  IAccountType,
} from '@interfaces/user.interface';

interface IConstructor {
  userDAO: UserDAO;
}

class AuthService {
  private log: Logger;
  private userDAO: UserDAO;

  constructor({ userDAO }: IConstructor) {
    this.userDAO = userDAO;
    this.log = createLogger('AuthService');
  }
}

export default AuthService;
