import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { v4 as uuid } from 'uuid';
import { EMAIL_TEMPLATES } from '@utils/constants';
import { hashGenerator, createLogger } from '@utils/index';
import { UserDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { IUserRole, ISignupData } from '@interfaces/user.interface';
import { InvalidRequestError, BadRequestError } from '@shared/customErrors';

interface IConstructor {
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class AuthService {
  private log: Logger;
  private userDAO: UserDAO;
  private clientDAO: ClientDAO;
  private profileDAO: ProfileDAO;

  constructor({ userDAO, clientDAO, profileDAO }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.log = createLogger('AuthService');
  }

  signup = async (signupData: ISignupData): Promise<ISuccessReturnData> => {
    try {
      const session = await this.userDAO.startSession();
      const result = await this.userDAO.withTransaction(session, async (session) => {
        const _userId = new Types.ObjectId();
        const clientId = uuid();
        const { accountType, companyInfo, ...userData } = signupData;

        const user = await this.userDAO.insert(
          {
            ...userData,
            _id: _userId,
            uid: uuid(),
            isActive: false,
            activationToken: hashGenerator({ usenano: true }),
            cids: [{ cid: clientId, roles: [IUserRole.ADMIN], isConnected: false }],
            cid: clientId,
            activationTokenExpiresAt: dayjs().add(2, 'hour').toDate(),
          },
          session
        );

        if (!user) {
          throw new InvalidRequestError({ message: 'User not created' });
        }

        const client = await this.clientDAO.insert(
          {
            cid: clientId,
            accountAdmin: _userId,
            accountType,
            ...(accountType.isEnterpriseAccount ? { companyInfo } : {}),
          },
          session
        );

        await this.profileDAO.createUserProfile(
          _userId,
          {
            user: _userId,
            puid: uuid(),
            lang: client.settings.lang,
            timeZone: client.settings.timeZone,
          },
          session
        );

        return {
          emailData: {
            to: user.email,
            subject: 'Activate your account',
            template: EMAIL_TEMPLATES.ACCOUNT_ACTIVATION,
            data: {
              fullname: user.fullname,
              activationUrl: `${process.env.FRONTEND_URL}/account_activation/${client.cid}?t=${user.activationToken}`,
            },
          },
        };
      });

      return {
        success: true,
        data: result,
        msg: `Account activation email has been sent to ${result.emailData.to}`,
      };
    } catch (error) {
      this.log.error({ error }, 'Error in signup process');
      throw new BadRequestError({ message: 'Error in signup process' });
    }
  };
}
