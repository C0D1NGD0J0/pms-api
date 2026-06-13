import { BaseIO } from '@sockets/index';
import { AssetDAO } from '@dao/assetDAO';
import { MailService } from '@mailer/index';
import { createLogger } from '@utils/index';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { envVariables } from '@shared/config';
import { QueueFactory } from '@services/queue';
import { LanguageService } from '@shared/languages';
import { GeoCoderService } from '@services/external';
import InvoiceModel from '@models/invoice/invoice.model';
import { ClamScannerService } from '@shared/config/index';
import { DSARService } from '@services/dsar/dsar.service';
import { AssetService } from '@services/asset/asset.service';
import { DiskStorage, S3Service } from '@services/fileUpload';
import { DatabaseService, RedisService } from '@database/index';
import { ExpenseService } from '@services/expense/expense.service';
import { AwilixContainer, asFunction, asValue, asClass } from 'awilix';
import { ServiceAreaService } from '@services/serviceArea/serviceArea.service';
import { EmailTemplateController } from '@controllers/EmailTemplateController';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';
import {
  EventsRegistryCache,
  NotificationCache,
  IdempotencyCache,
  PropertyCache,
  VendorCache,
  LeaseCache,
  AuthCache,
  UserCache,
} from '@caching/index';
import {
  PropertyMediaWorker,
  PropertyUnitWorker,
  InvitationWorker,
  ESignatureWorker,
  PropertyWorker,
  PaymentWorker,
  UploadWorker,
  EmailWorker,
  CronWorker,
  UserWorker,
  PdfWorker,
} from '@workers/index';
import {
  PropertyMediaQueue,
  PropertyUnitQueue,
  InvitationQueue,
  ESignatureQueue,
  EventBusQueue,
  PropertyQueue,
  PaymentQueue,
  UploadQueue,
  EmailQueue,
  CronQueue,
  UserQueue,
  PdfQueue,
} from '@queues/index';
import {
  MaintenanceRequestDAO,
  PaymentProcessorDAO,
  PropertyUnitDAO,
  NotificationDAO,
  SubscriptionDAO,
  InvitationDAO,
  PropertyDAO,
  MetricsDAO,
  PaymentDAO,
  ProfileDAO,
  ExpenseDAO,
  ClientDAO,
  VendorDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';
import {
  MaintenanceRequestModel,
  NotificationModel,
  PaymentProcessor,
  MetricsSnapshot,
  PaymentModel,
  PropertyUnit,
  Subscription,
  ExpenseModel,
  Invitation,
  Property,
  Profile,
  SMSLog,
  Client,
  Vendor,
  Lease,
  Asset,
  User,
} from '@models/index';
import {
  NotificationController,
  SubscriptionController,
  PropertyUnitController,
  MaintenanceController,
  InvitationController,
  PropertyController,
  MetricsController,
  WebhookController,
  PaymentController,
  ExpenseController,
  ClientController,
  VendorController,
  LeaseController,
  AdminController,
  UserController,
  AuthController,
  DSARController,
} from '@controllers/index';
import {
  SubscriptionWebhookService,
  MaintenanceRequestService,
  MaintenanceInvoiceService,
  MaintenancePaymentService,
  VendorSuggestionService,
  PropertyApprovalService,
  InvoiceTemplateRenderer,
  InvitationCsvProcessor,
  subscriptionPlanConfig,
  LeaseSignatureService,
  PaymentGatewayService,
  PaymentWebhookService,
  PropertyCsvProcessor,
  PropertyStatsService,
  PropertyMediaService,
  LeaseDocumentService,
  LeaseTemplateService,
  PayoutAccountService,
  PdfGeneratorService,
  NotificationService,
  EventEmitterService,
  PropertyUnitService,
  LeaseRenewalService,
  SubscriptionService,
  RentPaymentService,
  FeatureFlagService,
  PaymentCronService,
  PermissionService,
  InvitationService,
  AnthropicService,
  AuthTokenService,
  InvoiceAIService,
  PropertyService,
  BoldSignService,
  LeasePdfService,
  InvoiceService,
  MetricsService,
  PaymentService,
  ProfileService,
  StripeService,
  ClientService,
  VendorService,
  LeaseService,
  UserService,
  AuthService,
  CronService,
  SSEService,
  SMSService,
  AIService,
} from '@services/index';

const ControllerResources = {
  metricsController: asClass(MetricsController).scoped(),
  maintenanceController: asClass(MaintenanceController).scoped(),
  adminController: asClass(AdminController).scoped(),
  authController: asClass(AuthController).scoped(),
  userController: asClass(UserController).scoped(),
  leaseController: asClass(LeaseController).scoped(),
  clientController: asClass(ClientController).scoped(),
  vendorController: asClass(VendorController).scoped(),
  propertyController: asClass(PropertyController).scoped(),
  invitationController: asClass(InvitationController).scoped(),
  propertyUnitController: asClass(PropertyUnitController).scoped(),
  notificationController: asClass(NotificationController).scoped(),
  subscriptionController: asClass(SubscriptionController).scoped(),
  emailTemplateController: asClass(EmailTemplateController).scoped(),
  webhookController: asClass(WebhookController).scoped(),
  paymentController: asClass(PaymentController).scoped(),
  dsarController: asClass(DSARController).scoped(),
  expenseController: asClass(ExpenseController).scoped(),
};

const ModelResources = {
  userModel: asValue(User),
  assetModel: asValue(Asset),
  leaseModel: asValue(Lease),
  vendorModel: asValue(Vendor),
  clientModel: asValue(Client),
  profileModel: asValue(Profile),
  propertyModel: asValue(Property),
  smsLogModel: asValue(SMSLog),
  expenseModel: asValue(ExpenseModel),
  invoiceModel: asValue(InvoiceModel),
  paymentModel: asValue(PaymentModel),
  invitationModel: asValue(Invitation),
  propertyUnitModel: asValue(PropertyUnit),
  subscriptionModel: asValue(Subscription),
  notificationModel: asValue(NotificationModel),
  metricsSnapshotModel: asValue(MetricsSnapshot),
  paymentProcessorModel: asValue(PaymentProcessor),
  maintenanceRequestModel: asValue(MaintenanceRequestModel),
};

const ServiceResources = {
  sseService: asClass(SSEService).singleton(),
  smsService: asClass(SMSService).singleton(),
  authService: asClass(AuthService).singleton(),
  cronService: asClass(CronService).singleton(),
  userService: asClass(UserService).singleton(),
  assetService: asClass(AssetService).singleton(),
  mailerService: asClass(MailService).singleton(),
  leaseService: asClass(LeaseService).singleton(),
  clientService: asClass(ClientService).singleton(),
  vendorService: asClass(VendorService).singleton(),
  profileService: asClass(ProfileService).singleton(),
  tokenService: asClass(AuthTokenService).singleton(),
  invoiceService: asClass(InvoiceService).singleton(),
  languageService: asClass(LanguageService).singleton(),
  propertyService: asClass(PropertyService).singleton(),
  leasePdfService: asClass(LeasePdfService).singleton(),
  boldSignService: asClass(BoldSignService).singleton(),
  emitterService: asClass(EventEmitterService).singleton(),
  permissionService: asClass(PermissionService).singleton(),
  invitationService: asClass(InvitationService).singleton(),
  mediaUploadService: asClass(MediaUploadService).singleton(),
  propertyUnitService: asClass(PropertyUnitService).singleton(),
  notificationService: asClass(NotificationService).singleton(),
  pdfGeneratorService: asClass(PdfGeneratorService).singleton(),
  leaseRenewalService: asClass(LeaseRenewalService).singleton(),
  subscriptionService: asClass(SubscriptionService).singleton(),
  leaseDocumentService: asClass(LeaseDocumentService).singleton(),
  leaseSignatureService: asClass(LeaseSignatureService).singleton(),
  invoiceTemplateRenderer: asClass(InvoiceTemplateRenderer).singleton(),
  subscriptionWebhookService: asClass(SubscriptionWebhookService).singleton(),
  propertyApprovalService: asClass(PropertyApprovalService).singleton(),
  propertyStatsService: asClass(PropertyStatsService).singleton(),
  propertyMediaService: asClass(PropertyMediaService).singleton(),
  featureFlagService: asClass(FeatureFlagService).singleton(),
  propertyCsvProcessor: asClass(PropertyCsvProcessor).singleton(),
  unitNumberingService: asClass(UnitNumberingService).singleton(),
  subscriptionPlanConfig: asValue(subscriptionPlanConfig),
  anthropicService: asClass(AnthropicService).singleton(),
  aiService: asClass(AIService).singleton(),
  invoiceAIService: asClass(InvoiceAIService).singleton(),
  stripeService: asClass(StripeService).singleton(),
  paymentCronService: asClass(PaymentCronService).singleton(),
  payoutAccountService: asClass(PayoutAccountService).singleton(),
  paymentWebhookService: asClass(PaymentWebhookService).singleton(),
  maintenancePaymentService: asClass(MaintenancePaymentService).singleton(),
  rentPaymentService: asClass(RentPaymentService).singleton(),
  paymentService: asClass(PaymentService).singleton(),
  paymentGatewayService: asClass(PaymentGatewayService).singleton(),
  invitationCsvProcessor: asClass(InvitationCsvProcessor).singleton(),
  dsarService: asClass(DSARService).singleton(),
  maintenanceRequestService: asClass(MaintenanceRequestService).singleton(),
  vendorSuggestionService: asClass(VendorSuggestionService).singleton(),
  maintenanceInvoiceService: asClass(MaintenanceInvoiceService).singleton(),
  metricsService: asClass(MetricsService).singleton(),
  expenseService: asClass(ExpenseService).singleton(),
  leaseTemplateService: asClass(LeaseTemplateService).singleton(),
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
  subscriptionDAO: asClass(SubscriptionDAO).singleton(),
  notificationDAO: asClass(NotificationDAO).singleton(),
  paymentDAO: asClass(PaymentDAO).singleton(),
  paymentProcessorDAO: asClass(PaymentProcessorDAO).singleton(),
  maintenanceRequestDAO: asClass(MaintenanceRequestDAO).singleton(),
  metricsDAO: asClass(MetricsDAO).singleton(),
  expenseDAO: asClass(ExpenseDAO).singleton(),
  invoiceDAO: asClass(InvoiceDAO).singleton(),
};

const CacheResources = {
  authCache: asClass(AuthCache).singleton(),
  propertyCache: asClass(PropertyCache).singleton(),
  leaseCache: asClass(LeaseCache).singleton(),
  eventsRegistry: asClass(EventsRegistryCache).singleton(),
  userCache: asClass(UserCache).singleton(),
  vendorCache: asClass(VendorCache).singleton(),
  idempotencyCache: asClass(IdempotencyCache).singleton(),
  notificationCache: asClass(NotificationCache).singleton(),
};

const WorkerResources = {
  cronWorker: asClass(CronWorker).singleton(),
  emailWorker: asClass(EmailWorker).singleton(),
  uploadWorker: asClass(UploadWorker).singleton(),
  pdfGeneratorWorker: asClass(PdfWorker).singleton(),
  propertyWorker: asClass(PropertyWorker).singleton(),
  eSignatureWorker: asClass(ESignatureWorker).singleton(),
  invitationWorker: asClass(InvitationWorker).singleton(),
  propertyUnitWorker: asClass(PropertyUnitWorker).singleton(),
  propertyMediaWorker: asClass(PropertyMediaWorker).singleton(),
  paymentWorker: asClass(PaymentWorker).singleton(),
  userWorker: asClass(UserWorker).singleton(),
};

const QueuesResources = {
  cronQueue: asClass(CronQueue).singleton(),
  emailQueue: asClass(EmailQueue).singleton(),
  uploadQueue: asClass(UploadQueue).singleton(),
  pdfGeneratorQueue: asClass(PdfQueue).singleton(),
  propertyQueue: asClass(PropertyQueue).singleton(),
  eventBusQueue: asClass(EventBusQueue).singleton(),
  eSignatureQueue: asClass(ESignatureQueue).singleton(),
  invitationQueue: asClass(InvitationQueue).singleton(),
  propertyUnitQueue: asClass(PropertyUnitQueue).singleton(),
  propertyMediaQueue: asClass(PropertyMediaQueue).singleton(),
  paymentQueue: asClass(PaymentQueue).singleton(),
  userQueue: asClass(UserQueue).singleton(),
};

const UtilsResources = {
  serviceAreaService: asClass(ServiceAreaService).singleton(),
  geoCoderService: asFunction(() => {
    return new GeoCoderService();
  }).singleton(),
  redisService: asFunction(() => {
    return new RedisService('Redis Service');
  }).singleton(),
  dbService: asClass(DatabaseService).singleton(),
  s3Service: asFunction(() => {
    return new S3Service();
  }).singleton(),
  clamScanner: asClass(ClamScannerService).singleton(),
  diskStorage: asClass(DiskStorage).singleton(),
  propertyCsvService: asClass(PropertyCsvProcessor).singleton(),

  queueFactory: asClass(QueueFactory).singleton(),
};

const SocketIOResources = {
  baseIO: asClass(BaseIO).singleton(),
};

export const initQueues = (container: AwilixContainer) => {
  const logger = createLogger('DIContainer');

  // ClamAV initialization with error handling
  // Prevents crashes if ClamAV is not configured or fails to start
  const hasClamAVConfig =
    envVariables.CLAMAV && (envVariables.CLAMAV.HOST || envVariables.CLAMAV.SOCKET);

  if (!hasClamAVConfig) {
    logger.debug('ClamAV not configured - virus scanning disabled');
  } else {
    try {
      container.resolve('clamScanner');
      logger.debug('ClamAV scanner initialized');
    } catch (error) {
      logger.error(
        { error },
        'Failed to initialize ClamAV - file uploads will proceed without scanning'
      );
    }
  }

  // Ensure the metrics time-series collection exists (no-op if already present)
  try {
    const metricsDAO = container.resolve<MetricsDAO>('metricsDAO');
    metricsDAO.ensureCollection().catch((err) => {
      logger.error({ err }, 'Failed to ensure metrics_snapshots collection');
    });
  } catch (err) {
    logger.error({ err }, 'Failed to resolve metricsDAO for collection setup');
  }

  // Queues and workers are now lazily initialized via QueueFactory when first accessed
  // This reduces startup time and memory footprint
  const processType = envVariables.SERVER.PROCESS_TYPE;
  const environment = envVariables.SERVER.ENV;

  logger.debug(
    `💡 ${processType.toUpperCase()} process (${environment}): Queues will be initialized on-demand via QueueFactory`
  );
};

export const QUEUE_RESOURCE_NAMES = Object.keys(QueuesResources);
export const SERVICE_RESOURCE_NAMES = Object.keys(ServiceResources);

export const registerResources = {
  ...ControllerResources,
  ...ModelResources,
  ...DAOResources,
  ...CacheResources,
  ...WorkerResources,
  ...QueuesResources,
  ...ServiceResources,
  ...UtilsResources,
  ...SocketIOResources,
};
