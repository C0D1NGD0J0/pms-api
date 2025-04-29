import { BaseIO } from '@sockets/index';
import { MailService } from '@mailer/index';
import { GeoCoderService } from '@services/external';
import { ClamScannerService } from '@shared/config/index';
import { DiskStorage, S3Service } from '@services/fileUpload';
import { Property, Profile, Client, User } from '@models/index';
import { DatabaseService, RedisService } from '@database/index';
import { AwilixContainer, asFunction, asValue, asClass } from 'awilix';
import { PropertyController, AuthController } from '@controllers/index';
import { PropertyDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { PropertyCsvProcessor } from '@services/csv/propertyCsvProcessor';
import { PropertyWorker, UploadWorker, EmailWorker } from '@workers/index';
import { EventsRegistryCache, PropertyCache, AuthCache } from '@caching/index';
import { PropertyQueue, EventBusQueue, UploadQueue, EmailQueue } from '@queues/index';
import {
  EventEmitterService,
  AuthTokenService,
  PropertyService,
  AuthService,
} from '@services/index';

const ControllerResources = {
  authController: asClass(AuthController).scoped(),
  propertyController: asClass(PropertyController).scoped(),
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
  propertyService: asClass(PropertyService).singleton(),
  emitterService: asClass(EventEmitterService).singleton(),
  propertyCsvProcessor: asClass(PropertyCsvProcessor).singleton(),
};

const DAOResources = {
  userDAO: asClass(UserDAO).singleton(),
  clientDAO: asClass(ClientDAO).singleton(),
  profileDAO: asClass(ProfileDAO).singleton(),
  propertyDAO: asClass(PropertyDAO).singleton(),
};

const CacheResources = {
  authCache: asClass(AuthCache).singleton(),
  propertyCache: asClass(PropertyCache).singleton(),
  eventsRegistry: asClass(EventsRegistryCache).singleton(),
};

const WorkerResources = {
  emailWorker: asClass(EmailWorker).singleton(),
  uploadWorker: asClass(UploadWorker).singleton(),
  propertyWorker: asClass(PropertyWorker).singleton(),
};

const QueuesResources = {
  emailQueue: asClass(EmailQueue).singleton(),
  uploadQueue: asClass(UploadQueue).singleton(),
  eventBusQueue: asClass(EventBusQueue).singleton(),
  propertyQueue: asClass(PropertyQueue).singleton(),
};

const UtilsResources = {
  geoCoderService: asClass(GeoCoderService).singleton(),
  redisService: asFunction(() => {
    return new RedisService('Redis Service');
  }).singleton(),
  dbService: asClass(DatabaseService).singleton(),
  s3Service: asClass(S3Service).singleton(),
  clamScanner: asClass(ClamScannerService).singleton(),
  diskStorage: asClass(DiskStorage).singleton(),
  propertyCsvService: asClass(PropertyCsvProcessor).singleton(),
};

const SocketIOResources = {
  baseIO: asClass(BaseIO).singleton(),
};
export const initQueues = (container: AwilixContainer) => {
  container.resolve('emailQueue');
  container.resolve('uploadQueue');
  container.resolve('eventBusQueue');
  container.resolve('propertyQueue');
  container.resolve('clamScanner');
  container.resolve('emailWorker');
  container.resolve('uploadWorker');
  container.resolve('propertyWorker');
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
