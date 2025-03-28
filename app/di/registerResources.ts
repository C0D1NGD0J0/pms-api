import { BaseIO } from '@sockets/index';
import { AuthCache } from '@caching/index';
import { EmailQueue } from '@queues/index';
import { MailService } from '@mailer/index';
// import { AuthMiddleware } from '@shared/middleware';
// import { MailService } from '@services/MailService/config.mailer';
// import { CloudinaryService, DiskStorage, S3FileUpload } from '@services/FileUploadService';
import { EmailWorker } from '@workers/index';
import { AuthController } from '@controllers/index';
import { asFunction, asValue, asClass } from 'awilix';
import { Profile, Client, User } from '@models/index';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { AuthTokenService, AuthService } from '@services/auth';
import { DatabaseService, RedisService } from '@database/index';

import { container } from './setup';

const ControllerResources = {
  authController: asClass(AuthController).scoped(),
  // userController: asClass(UserController).scoped(),
  // notificationController: asClass(NotificationController).scoped(),
};

const ModelResources = {
  userModel: asValue(User),
  clientModel: asValue(Client),
  profileModel: asValue(Profile),
  // categoryModel: asValue(Category),
  // notificationModel: asValue(Notification),
  // subscriptionModel: asValue(Subscription),
};

const ServiceResources = {
  // s3Service: asClass(S3FileUpload).singleton(),
  // userService: asClass(UserService).singleton(),
  authService: asClass(AuthService).singleton(),
  mailerService: asClass(MailService).singleton(),
  // stripeService: asClass(StripeService).singleton(),
  // uploadService: asClass(CloudinaryService).singleton(),
  tokenService: asClass(AuthTokenService).singleton(),
  // notificationService: asClass(NotificationService).singleton(),
};

const DAOResources = {
  userDAO: asClass(UserDAO).singleton(),
  clientDAO: asClass(ClientDAO).singleton(),
  profileDAO: asClass(ProfileDAO).singleton(),
  // notificationDAO: asClass(NotificationDAO).singleton(),
};

const CacheResources = {
  authCache: asClass(AuthCache).singleton(),
};

const WorkerResources = {
  emailWorker: asClass(EmailWorker).singleton(),
  // uploadWorker: asClass(FileUploadWorker).singleton(),
  // notificationWorker: asClass(NotificationWorker).singleton(),
};

const QueuesResources = {
  emailQueue: asClass(EmailQueue).singleton(),
};

const UtilsResources = {
  redisService: asFunction(() => {
    return new RedisService('Redis Service');
  }).singleton(),
  dbService: asClass(DatabaseService).singleton(),
  // authMiddleware: asClass(AuthMiddleware).scoped(),
  // diskStorage: asClass(DiskStorage).singleton(),
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
