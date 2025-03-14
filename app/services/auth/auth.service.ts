import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { v4 as uuid } from 'uuid';
import { EmailQueue } from '@queues/index';
import { envVariables } from '@shared/config';
import { UserDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { IUserRole, ISignupData } from '@interfaces/user.interface';
import { MailType, ISuccessReturnData } from '@interfaces/utils.interface';
import { JOB_NAME, hashGenerator, getLocationDetails, createLogger } from '@utils/index';
import { NotFoundError, InvalidRequestError, BadRequestError } from '@shared/customErrors';

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

  async signup(signupData: ISignupData): Promise<ISuccessReturnData> {
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
      data: null,
      success: true,
      msg: `Account activation email has been sent to ${result.emailData.to}`,
    };
  }

  async accountActivation(token: string): Promise<ISuccessReturnData> {
    if (!token) {
      this.log.error('Activation token missing.');
      throw new BadRequestError({ message: 'Activation token missing.' });
    }

    const activated = await this.userDAO.activateAccount(token.trim());
    if (!activated) {
      const msg = 'Invalid or expired activation token.';
      throw new NotFoundError({ message: msg });
    }

    return { success: true, data: null, msg: 'Account activated successfully.' };
  }

  async sendActivationLink(email: string): Promise<ISuccessReturnData> {
    if (!email) {
      throw new BadRequestError({ message: 'Email is required to resend activation link.' });
    }

    const user = await this.userDAO.createActivationToken('', email);
    if (!user) {
      throw new NotFoundError({ message: 'No record found with email provided.' });
    }

    const emailData = {
      to: user.email,
      subject: 'Activate your account',
      emailType: MailType.ACCOUNT_ACTIVATION,
      data: {
        fullname: user.fullname,
        activationUrl: `${envVariables.FRONTEND.URL}/account_activation/${user.cid}?t=${user.activationToken}`,
      },
    };
    this.emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, emailData);
    return {
      success: true,
      data: emailData,
      msg: `Account activation link has been sent to ${emailData.to}`,
    };
  }

  async forgotPassword(email: string): Promise<ISuccessReturnData> {
    if (!email) {
      this.log.error('User email is required. | ForgotPassword');
      throw new BadRequestError({ message: 'User email is required.' });
    }

    const user = await this.userDAO.createPasswordResetToken(email);
    if (!user) {
      throw new NotFoundError({ message: 'No record found with email provided.' });
    }

    const emailData = {
      subject: 'Account Password Reset',
      to: user.email,
      data: {
        fullname: user.fullname || user.firstName,
        resetUrl: `${process.env.FRONTEND_URL}/reset_password/${user.passwordResetToken}`,
      },
      emailType: MailType.FORGOT_PASSWORD,
    };

    this.emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, emailData);
    return {
      data: null,
      success: true,
      msg: `Password reset email has been sent to ${user.email}`,
    };
  }

  async resetPassword(email: string, token: string): Promise<ISuccessReturnData> {
    if (!email && !token) {
      this.log.error('User email and token are required. | ResetPassword');
      throw new BadRequestError({ message: 'Invalid email/token is provided.' });
    }

    const user = await this.userDAO.resetPassword(email, token);
    if (!user) {
      throw new NotFoundError({ message: 'No record found with email provided.' });
    }

    const emailData = {
      subject: 'Account Password Reset',
      to: user.email,
      data: {
        fullname: user.fullname || user.firstName,
      },
      emailType: MailType.PASSWORD_RESET,
    };

    this.emailQueue.addToEmailQueue(JOB_NAME.ACCOUNT_ACTIVATION_JOB, emailData);
    return {
      data: null,
      success: true,
      msg: `Password reset email has been sent to ${user.email}`,
    };
  }
}
