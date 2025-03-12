import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { v4 as uuid } from 'uuid';
import { EmailQueue } from '@queues/index';
import { InvalidRequestError } from '@shared/customErrors';
import { UserDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { IUserRole, ISignupData } from '@interfaces/user.interface';
import { MailType, ISuccessReturnData } from '@interfaces/utils.interface';
import { JOB_NAME, hashGenerator, getLocationDetails, createLogger } from '@utils/index';

interface IConstructor {
  profileDAO: ProfileDAO;
  emailQueue: EmailQueue;
  clientDAO: ClientDAO;
  userDAO: UserDAO;
}

export class AuthService {
  private log: Logger;
  private userDAO: UserDAO;
  private clientDAO: ClientDAO;
  private profileDAO: ProfileDAO;
  private emailQueue: EmailQueue;

  constructor({ userDAO, clientDAO, profileDAO, emailQueue }: IConstructor) {
    this.userDAO = userDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.emailQueue = emailQueue;
    this.log = createLogger('AuthService');
  }

  signup = async (signupData: ISignupData): Promise<ISuccessReturnData> => {
    const session = await this.userDAO.startSession();
    const result = await this.userDAO.withTransaction(session, async (session) => {
      const _userId = new Types.ObjectId();
      const clientId = uuid();
      const { accountType, companyInfo, ...userData } = signupData;

      const locationInfo = getLocationDetails(userData.location);

      const user = await this.userDAO.insert(
        {
          ...userData,
          uid: uuid(),
          _id: _userId,
          cid: clientId,
          isActive: false,
          location: locationInfo || userData.location,
          activationToken: hashGenerator({ usenano: true }),
          activationTokenExpiresAt: dayjs().add(2, 'hour').toDate(),
          cids: [{ cid: clientId, roles: [IUserRole.ADMIN], isConnected: false }],
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
          emailType: MailType.ACCOUNT_ACTIVATION,
          data: {
            fullname: user.fullname,
            activationUrl: `${process.env.FRONTEND_URL}/account_activation/${client.cid}?t=${user.activationToken}`,
          },
        },
      };
    });

    this.emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, result.emailData);
    return {
      success: true,
      data: result,
      msg: `Account activation email has been sent to ${result.emailData.to}`,
    };
  };
}
