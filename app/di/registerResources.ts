import { BaseIO } from '@sockets/index';
import { MailService } from '@mailer/index';
import { QueueFactory } from '@services/queue';
import { GeoCoderService } from '@services/external';
import { ClamScannerService } from '@shared/config/index';
import { DiskStorage, S3Service } from '@services/fileUpload';
import { DatabaseService, RedisService } from '@database/index';
import { LanguageService } from '@shared/languages/language.service';
import { AwilixContainer, asFunction, asValue, asClass } from 'awilix';
import { EmailTemplateController } from '@controllers/EmailTemplateController';
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';
import { EventsRegistryCache, PropertyCache, AuthCache, UserCache } from '@caching/index';
import { PropertyUnit, Invitation, Property, Profile, Client, Vendor, User } from '@models/index';
import {
  PropertyUnitDAO,
  InvitationDAO,
  PropertyDAO,
  ProfileDAO,
  ClientDAO,
  VendorDAO,
  UserDAO,
} from '@dao/index';
import {
  DocumentProcessingWorker,
  PropertyUnitWorker,
  InvitationWorker,
  PropertyWorker,
  UploadWorker,
  EmailWorker,
} from '@workers/index';
import {
  DocumentProcessingQueue,
  PropertyUnitQueue,
  InvitationQueue,
  EventBusQueue,
  PropertyQueue,
  UploadQueue,
  EmailQueue,
} from '@queues/index';
import {
  PropertyUnitController,
  InvitationController,
  PropertyController,
  ClientController,
  VendorController,
  UserController,
  AuthController,
} from '@controllers/index';
import {
  InvitationCsvProcessor,
  PropertyCsvProcessor,
  EventEmitterService,
  PropertyUnitService,
  PermissionService,
  InvitationService,
  AuthTokenService,
  PropertyService,
  ProfileService,
  ClientService,
  VendorService,
  UserService,
  AuthService,
} from '@services/index';

const ControllerResources = {
  authController: asClass(AuthController).scoped(),
  clientController: asClass(ClientController).scoped(),
  userController: asClass(UserController).scoped(),
  emailTemplateController: asClass(EmailTemplateController).scoped(),
  propertyController: asClass(PropertyController).scoped(),
  propertyUnitController: asClass(PropertyUnitController).scoped(),
  invitationController: asClass(InvitationController).scoped(),
  vendorController: asClass(VendorController).scoped(),
};

const ModelResources = {
  userModel: asValue(User),
  clientModel: asValue(Client),
  profileModel: asValue(Profile),
  propertyModel: asValue(Property),
  propertyUnitModel: asValue(PropertyUnit),
  invitationModel: asValue(Invitation),
  vendorModel: asValue(Vendor),
};

const ServiceResources = {
  authService: asClass(AuthService).singleton(),
  clientService: asClass(ClientService).singleton(),
  userService: asClass(UserService).singleton(),
  mailerService: asClass(MailService).singleton(),
  tokenService: asClass(AuthTokenService).singleton(),
  languageService: asClass(LanguageService).singleton(),
  propertyService: asClass(PropertyService).singleton(),
  profileService: asClass(ProfileService).singleton(),
  emitterService: asClass(EventEmitterService).singleton(),
  propertyUnitService: asClass(PropertyUnitService).singleton(),
  propertyCsvProcessor: asClass(PropertyCsvProcessor).singleton(),
  invitationCsvProcessor: asClass(InvitationCsvProcessor).singleton(),
  unitNumberingService: asClass(UnitNumberingService).singleton(),
  permissionService: asClass(PermissionService).singleton(),
  invitationService: asClass(InvitationService).singleton(),
  vendorService: asClass(VendorService).singleton(),
};

const DAOResources = {
  userDAO: asClass(UserDAO).singleton(),
  clientDAO: asClass(ClientDAO).singleton(),
  profileDAO: asClass(ProfileDAO).singleton(),
  propertyDAO: asClass(PropertyDAO).singleton(),
  propertyUnitDAO: asClass(PropertyUnitDAO).singleton(),
  invitationDAO: asClass(InvitationDAO).singleton(),
  vendorDAO: asClass(VendorDAO).singleton(),
};

const CacheResources = {
  authCache: asClass(AuthCache).singleton(),
  propertyCache: asClass(PropertyCache).singleton(),
  eventsRegistry: asClass(EventsRegistryCache).singleton(),
  userCache: asClass(UserCache).singleton(),
};

const WorkerResources = {
  documentProcessingWorker: asClass(DocumentProcessingWorker).singleton(),
  emailWorker: asClass(EmailWorker).singleton(),
  propertyWorker: asClass(PropertyWorker).singleton(),
  propertyUnitWorker: asClass(PropertyUnitWorker).singleton(),
  uploadWorker: asClass(UploadWorker).singleton(),
  invitationWorker: asClass(InvitationWorker).singleton(),
};

const QueuesResources = {
  documentProcessingQueue: asClass(DocumentProcessingQueue).singleton(),
  emailQueue: asClass(EmailQueue).singleton(),
  eventBusQueue: asClass(EventBusQueue).singleton(),
  propertyQueue: asClass(PropertyQueue).singleton(),
  propertyUnitQueue: asClass(PropertyUnitQueue).singleton(),
  uploadQueue: asClass(UploadQueue).singleton(),
  invitationQueue: asClass(InvitationQueue).singleton(),
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
  queueFactory: asFunction(() => {
    return QueueFactory.getInstance();
  }).singleton(),
};

const SocketIOResources = {
  baseIO: asClass(BaseIO).singleton(),
};

export const initQueues = (container: AwilixContainer) => {
  container.resolve('clamScanner');

  if (process.env.NODE_ENV === 'development' || process.env.FORCE_INIT_QUEUES === 'true') {
    container.resolve('documentProcessingQueue');
    container.resolve('emailQueue');
    container.resolve('eventBusQueue');
    container.resolve('propertyQueue');
    container.resolve('propertyUnitQueue');
    container.resolve('uploadQueue');
    container.resolve('invitationQueue');
    container.resolve('documentProcessingWorker');
    container.resolve('emailWorker');
    container.resolve('propertyWorker');
    container.resolve('propertyUnitWorker');
    container.resolve('uploadWorker');
    container.resolve('invitationWorker');
    console.log('✅ All queues and workers initialized successfully');
  } else {
    console.log('⏸️  Queue initialization skipped (test environment)');
  }
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
