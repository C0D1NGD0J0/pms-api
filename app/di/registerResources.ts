import { BaseIO } from '@sockets/index';
import { AuthCache } from '@caching/index';
import { EmailQueue } from '@queues/index';
import { MailService } from '@mailer/index';
import { EmailWorker } from '@workers/index';
import { AuthController } from '@controllers/index';
import { GeoCoderService } from '@services/external';
import { asFunction, asValue, asClass } from 'awilix';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { AuthTokenService, AuthService } from '@services/auth';
import { Property, Profile, Client, User } from '@models/index';
import { DatabaseService, RedisService } from '@database/index';

import { container } from './setup';

const ControllerResources = {
  authController: asClass(AuthController).scoped(),
};

const ModelResources = {
  userModel: asValue(User),
  clientModel: asValue(Client),
  profileModel: asValue(Profile),
  propertyModel: asValue(Property),
};

const ServiceResources = {
  authService: asClass(AuthService).singleton(),
  mailerService: asClass(MailService).singleton(),

  tokenService: asClass(AuthTokenService).singleton(),
};

const DAOResources = {
  userDAO: asClass(UserDAO).singleton(),
  clientDAO: asClass(ClientDAO).singleton(),
  profileDAO: asClass(ProfileDAO).singleton(),
};

const CacheResources = {
  authCache: asClass(AuthCache).singleton(),
};

const WorkerResources = {
  emailWorker: asClass(EmailWorker).singleton(),
};

const QueuesResources = {
  emailQueue: asClass(EmailQueue).singleton(),
};

const UtilsResources = {
  redisService: asFunction(() => {
    return new RedisService('Redis Service');
  }).singleton(),
  dbService: asClass(DatabaseService).singleton(),
  geoCoderService: asClass(GeoCoderService).singleton(),
};

const SocketIOResources = {
  baseIO: asFunction(() => {
    return new BaseIO('BaseIO', { ioServer: container.resolve('ioServer') });
  }).singleton(),
};

export const registerResources = {
  ...ControllerResources,
  ...ModelResources,
  ...DAOResources,
  ...CacheResources,
  ...QueuesResources,
  ...ServiceResources,
  ...WorkerResources,
  ...UtilsResources,
  ...SocketIOResources,
};
