import { BaseIO } from '@sockets/index';
import { AssetDAO } from '@dao/assetDAO';
import { MailService } from '@mailer/index';
import { QueueFactory } from '@services/queue';
import { GeoCoderService } from '@services/external';
import { ClamScannerService } from '@shared/config/index';
import { AssetService } from '@services/asset/asset.service';
import { DiskStorage, S3Service } from '@services/fileUpload';
import { DatabaseService, RedisService } from '@database/index';
import { LanguageService } from '@shared/languages/language.service';
import { AwilixContainer, asFunction, asValue, asClass } from 'awilix';
import { EmailTemplateController } from '@controllers/EmailTemplateController';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';
import {
  EventsRegistryCache,
  PropertyCache,
  VendorCache,
  AuthCache,
  UserCache,
} from '@caching/index';
import {
  PropertyUnit,
  Invitation,
  Property,
  Profile,
  Client,
  Vendor,
  Asset,
  User,
} from '@models/index';
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
  assetModel: asValue(Asset),
  clientModel: asValue(Client),
  invitationModel: asValue(Invitation),
  profileModel: asValue(Profile),
  propertyModel: asValue(Property),
  propertyUnitModel: asValue(PropertyUnit),
  userModel: asValue(User),
  vendorModel: asValue(Vendor),
};

const ServiceResources = {
  assetService: asClass(AssetService).singleton(),
  authService: asClass(AuthService).singleton(),
  clientService: asClass(ClientService).singleton(),
  emitterService: asClass(EventEmitterService).singleton(),
  invitationCsvProcessor: asClass(InvitationCsvProcessor).singleton(),
  invitationService: asClass(InvitationService).singleton(),
  languageService: asClass(LanguageService).singleton(),
  mailerService: asClass(MailService).singleton(),
  mediaUploadService: asClass(MediaUploadService).singleton(),
  permissionService: asClass(PermissionService).singleton(),
  profileService: asClass(ProfileService).singleton(),
  propertyCsvProcessor: asClass(PropertyCsvProcessor).singleton(),
  propertyService: asClass(PropertyService).singleton(),
  propertyUnitService: asClass(PropertyUnitService).singleton(),
  tokenService: asClass(AuthTokenService).singleton(),
  unitNumberingService: asClass(UnitNumberingService).singleton(),
  userService: asClass(UserService).singleton(),
  vendorService: asClass(VendorService).singleton(),
};

const DAOResources = {
  assetDAO: asClass(AssetDAO).singleton(),
  clientDAO: asClass(ClientDAO).singleton(),
  invitationDAO: asClass(InvitationDAO).singleton(),
  profileDAO: asClass(ProfileDAO).singleton(),
  propertyDAO: asClass(PropertyDAO).singleton(),
  propertyUnitDAO: asClass(PropertyUnitDAO).singleton(),
  userDAO: asClass(UserDAO).singleton(),
  vendorDAO: asClass(VendorDAO).singleton(),
};

const CacheResources = {
  // Lazy-loaded cache services to reduce Redis connections and memory usage
  authCache: asFunction(() => {
    // Only initialize when authentication is actually used
    return new AuthCache();
  }).singleton(),

  propertyCache: asFunction(() => {
    // Only initialize when property operations are used
    return new PropertyCache();
  }).singleton(),

  eventsRegistry: asFunction(() => {
    // Only initialize when event system is used
    return new EventsRegistryCache();
  }).singleton(),

  userCache: asFunction(() => {
    // Only initialize when user operations are used
    return new UserCache();
  }).singleton(),

  vendorCache: asFunction(() => {
    // Only initialize when vendor operations are used
    return new VendorCache();
  }).singleton(),
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
  // Lazy-loaded services to reduce memory footprint
  geoCoderService: asFunction(() => {
    // Only create when actually needed to reduce memory usage
    return new GeoCoderService();
  }).singleton(),

  redisService: asFunction(() => {
    return new RedisService('Redis Service');
  }).singleton(),

  dbService: asClass(DatabaseService).singleton(),

  // S3Service lazy loading for reduced memory footprint
  s3Service: asFunction(() => {
    // Only initialize S3Service when actually needed
    return new S3Service();
  }).singleton(),

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
  // Always initialize ClamScanner as it's essential for file security
  container.resolve('clamScanner');

  // Only initialize queues in development or when explicitly forced
  if (process.env.NODE_ENV === 'development' || process.env.FORCE_INIT_QUEUES === 'true') {
    console.log('🔧 Initializing all queues and workers for development/forced environment...');

    // Initialize all queues
    const queueNames = [
      'documentProcessingQueue',
      'emailQueue',
      'eventBusQueue',
      'propertyQueue',
      'propertyUnitQueue',
      'uploadQueue',
      'invitationQueue',
    ];

    // Initialize all workers
    const workerNames = [
      'documentProcessingWorker',
      'emailWorker',
      'propertyWorker',
      'propertyUnitWorker',
      'uploadWorker',
      'invitationWorker',
    ];

    // Resolve queues
    queueNames.forEach((queueName) => {
      try {
        container.resolve(queueName);
      } catch (error) {
        console.error(`Failed to initialize queue ${queueName}:`, error);
      }
    });

    // Resolve workers
    workerNames.forEach((workerName) => {
      try {
        container.resolve(workerName);
      } catch (error) {
        console.error(`Failed to initialize worker ${workerName}:`, error);
      }
    });

    console.log('✅ All queues and workers initialized successfully');
  } else {
    console.log(
      '⏸️  Queue initialization skipped (production environment - using lazy initialization)'
    );
    console.log('💡 Queues will be initialized on-demand when first accessed');
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
