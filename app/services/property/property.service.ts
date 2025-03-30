import dayjs from 'dayjs';
import Logger from 'bunyan';
import { envVariables } from '@shared/config';
import { AuthTokenService } from '@services/auth';
import { ProfileDAO, ClientDAO, PropertyDAO } from '@dao/index';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import {
  getLocationDetails,
  hashGenerator,
  JWT_KEY_NAMES,
  createLogger,
  JOB_NAME,
} from '@utils/index';
import {
  InvalidRequestError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '@shared/customErrors';

interface IConstructor {
  // propertyCache: PropertyCache;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
}

export class PropertyService {
  private log: Logger;
  private clientDAO: ClientDAO;
  private profileDAO: ProfileDAO;
  private propertyDAO: PropertyDAO;
  // private propertyCache: PropertyCache;

  constructor({ clientDAO, profileDAO, propertyDAO }: IConstructor) {
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    // this.propertyCache = propertyCache;

    this.log = createLogger('PropertyService');
  }
}
