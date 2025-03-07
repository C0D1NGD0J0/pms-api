// import { RedisConfig } from '@db/redisConfig';
// import { AuthMiddleware } from '@shared/middleware';
// import { AuthCache, UtilityCache } from '@caching/index';
// import { MailService } from '@services/MailService/config.mailer';
// import { EmailQueue, NotificationQueue, UploadQueue } from '@queues/index';
// import { CloudinaryService, DiskStorage, S3FileUpload } from '@services/FileUploadService';
// import { EmailWorker, FileUploadWorker, NotificationWorker } from '@workers/index';
import { UserDAO } from '@dao/index';
import { asValue, asClass } from 'awilix';
import { Client, User } from '@models/index';
import { DatabaseService } from '@database/index';
import { AuthController } from '@controllers/index';
import { AuthService } from '@services/index';

const ControllerResources = {
  authController: asClass(AuthController).scoped(),
  // userController: asClass(UserController).scoped(),
  // notificationController: asClass(NotificationController).scoped(),
};

const ModelResources = {
  userModel: asValue(User),
  clientModel: asValue(Client),
  // profileModel: asValue(Profile),
  // categoryModel: asValue(Category),
  // notificationModel: asValue(Notification),
  // subscriptionModel: asValue(Subscription),
};

const ServiceResources = {
  // s3Service: asClass(S3FileUpload).singleton(),
  // userService: asClass(UserService).singleton(),
  authService: asClass(AuthService).singleton(),
  // mailerService: asClass(MailService).singleton(),
  // stripeService: asClass(StripeService).singleton(),
  // uploadService: asClass(CloudinaryService).singleton(),
  // authTokenService: asClass(AuthTokenService).singleton(),
  // notificationService: asClass(NotificationService).singleton(),
};

const DAOResources = {
  userDAO: asClass(UserDAO).singleton(),
  // profileDAO: asClass(ProfileDAO).singleton(),
  // notificationDAO: asClass(NotificationDAO).singleton(),
};

const CacheResources = {
  // authCache: asClass(AuthCache).singleton(),
};

const WorkerResources = {
  // emailWorker: asClass(EmailWorker).singleton(),
  // uploadWorker: asClass(FileUploadWorker).singleton(),
  // notificationWorker: asClass(NotificationWorker).singleton(),
};

const QueuesResources = {
  // emailQueue: asClass(EmailQueue).singleton(),
  // uploadQueue: asClass(UploadQueue).singleton(),
  // notificationQueue: asClass(NotificationQueue).singleton(),
};

const UtilsResources = {
  // redisConfig: asClass(RedisConfig).singleton(),
  dbService: asClass(DatabaseService).singleton(),
  // authMiddleware: asClass(AuthMiddleware).scoped(),
  // diskStorage: asClass(DiskStorage).singleton(),
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
};
