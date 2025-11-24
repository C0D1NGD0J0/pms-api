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
  LeaseCache,
  AuthCache,
  UserCache,
} from '@caching/index';
import {
  NotificationModel,
  PropertyUnit,
  Invitation,
  Property,
  Profile,
  Client,
  Vendor,
  Lease,
  Asset,
  User,
} from '@models/index';
import {
  PropertyUnitDAO,
  NotificationDAO,
  InvitationDAO,
  PropertyDAO,
  ProfileDAO,
  ClientDAO,
  VendorDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';
import {
  DocumentProcessingWorker,
  PropertyUnitWorker,
  InvitationWorker,
  PropertyWorker,
  UploadWorker,
  EmailWorker,
  PdfWorker,
} from '@workers/index';
import {
  DocumentProcessingQueue,
  PropertyUnitQueue,
  InvitationQueue,
  EventBusQueue,
  PropertyQueue,
  UploadQueue,
  EmailQueue,
  PdfQueue,
} from '@queues/index';
import {
  NotificationController,
  PropertyUnitController,
  InvitationController,
  PropertyController,
  ClientController,
  VendorController,
  LeaseController,
  UserController,
  AuthController,
} from '@controllers/index';
import {
  InvitationCsvProcessor,
  PropertyCsvProcessor,
  PdfGeneratorService,
  NotificationService,
  EventEmitterService,
  PropertyUnitService,
  PermissionService,
  InvitationService,
  AuthTokenService,
  PropertyService,
  BoldSignService,
  ProfileService,
  ClientService,
  VendorService,
  LeaseService,
  UserService,
  AuthService,
  SSEService,
} from '@services/index';

const ControllerResources = {
  authController: asClass(AuthController).scoped(),
  userController: asClass(UserController).scoped(),
  leaseController: asClass(LeaseController).scoped(),
  clientController: asClass(ClientController).scoped(),
  vendorController: asClass(VendorController).scoped(),
  propertyController: asClass(PropertyController).scoped(),
  invitationController: asClass(InvitationController).scoped(),
  propertyUnitController: asClass(PropertyUnitController).scoped(),
  notificationController: asClass(NotificationController).scoped(),
  emailTemplateController: asClass(EmailTemplateController).scoped(),
};

const ModelResources = {
  userModel: asValue(User),
  assetModel: asValue(Asset),
  leaseModel: asValue(Lease),
  vendorModel: asValue(Vendor),
  clientModel: asValue(Client),
  profileModel: asValue(Profile),
  propertyModel: asValue(Property),
  invitationModel: asValue(Invitation),
  propertyUnitModel: asValue(PropertyUnit),
  notificationModel: asValue(NotificationModel),
};

const ServiceResources = {
  sseService: asClass(SSEService).singleton(),
  authService: asClass(AuthService).singleton(),
  userService: asClass(UserService).singleton(),
  assetService: asClass(AssetService).singleton(),
  mailerService: asClass(MailService).singleton(),
  leaseService: asClass(LeaseService).singleton(),
  clientService: asClass(ClientService).singleton(),
  vendorService: asClass(VendorService).singleton(),
  profileService: asClass(ProfileService).singleton(),
  tokenService: asClass(AuthTokenService).singleton(),
  languageService: asClass(LanguageService).singleton(),
  propertyService: asClass(PropertyService).singleton(),
  boldSignService: asClass(BoldSignService).singleton(),
  emitterService: asClass(EventEmitterService).singleton(),
  permissionService: asClass(PermissionService).singleton(),
  invitationService: asClass(InvitationService).singleton(),
  mediaUploadService: asClass(MediaUploadService).singleton(),
  propertyUnitService: asClass(PropertyUnitService).singleton(),
  notificationService: asClass(NotificationService).singleton(),
  pdfGeneratorService: asClass(PdfGeneratorService).singleton(),
  propertyCsvProcessor: asClass(PropertyCsvProcessor).singleton(),
  unitNumberingService: asClass(UnitNumberingService).singleton(),
  invitationCsvProcessor: asClass(InvitationCsvProcessor).singleton(),
};

const DAOResources = {
  userDAO: asClass(UserDAO).singleton(),
  assetDAO: asClass(AssetDAO).singleton(),
  leaseDAO: asClass(LeaseDAO).singleton(),
  clientDAO: asClass(ClientDAO).singleton(),
  vendorDAO: asClass(VendorDAO).singleton(),
  profileDAO: asClass(ProfileDAO).singleton(),
  propertyDAO: asClass(PropertyDAO).singleton(),
  invitationDAO: asClass(InvitationDAO).singleton(),
  propertyUnitDAO: asClass(PropertyUnitDAO).singleton(),
  notificationDAO: asClass(NotificationDAO).singleton(),
};

const CacheResources = {
  // Lazy-loaded cache services to reduce Redis connections and memory usage
  authCache: asFunction(() => {
    // Only initialize when authentication is actually used
    return new AuthCache();
  }).singleton(),

  propertyCache: asFunction(() => {
    return new PropertyCache();
  }).singleton(),

  leaseCache: asFunction(() => {
    return new LeaseCache();
  }).singleton(),

  eventsRegistry: asFunction(() => {
    return new EventsRegistryCache();
  }).singleton(),

  userCache: asFunction(() => {
    return new UserCache();
  }).singleton(),

  vendorCache: asFunction(() => {
    return new VendorCache();
  }).singleton(),
};

const WorkerResources = {
  emailWorker: asClass(EmailWorker).singleton(),
  uploadWorker: asClass(UploadWorker).singleton(),
  pdfGeneratorWorker: asClass(PdfWorker).singleton(),
  propertyWorker: asClass(PropertyWorker).singleton(),
  invitationWorker: asClass(InvitationWorker).singleton(),
  propertyUnitWorker: asClass(PropertyUnitWorker).singleton(),
  documentProcessingWorker: asClass(DocumentProcessingWorker).singleton(),
};

const QueuesResources = {
  emailQueue: asClass(EmailQueue).singleton(),
  uploadQueue: asClass(UploadQueue).singleton(),
  pdfGeneratorQueue: asClass(PdfQueue).singleton(),
  propertyQueue: asClass(PropertyQueue).singleton(),
  eventBusQueue: asClass(EventBusQueue).singleton(),
  invitationQueue: asClass(InvitationQueue).singleton(),
  propertyUnitQueue: asClass(PropertyUnitQueue).singleton(),
  documentProcessingQueue: asClass(DocumentProcessingQueue).singleton(),
};

const UtilsResources = {
  // Lazy-loaded services to reduce memory footprint
  geoCoderService: asFunction(() => {
    return new GeoCoderService();
  }).singleton(),
  redisService: asFunction(() => {
    return new RedisService('Redis Service');
  }).singleton(),
  dbService: asClass(DatabaseService).singleton(),
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
