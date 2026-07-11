import { BaseIO } from '@sockets/index';
import { AssetDAO } from '@dao/assetDAO';
import { MailService } from '@mailer/index';
import { createLogger } from '@utils/index';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { envVariables } from '@shared/config';
import { QueueFactory } from '@services/queue';
import { LanguageService } from '@shared/languages';
import { GeoCoderService } from '@services/external';
import { ClamScannerService } from '@shared/config/index';
import { AssetService } from '@services/asset/asset.service';
import { DiskStorage, S3Service } from '@services/fileUpload';
import { DatabaseService, RedisService } from '@database/index';
import { AwilixContainer, asFunction, asValue, asClass } from 'awilix';
import { GuestPassController } from '@controllers/GuestPassController';
import { ServiceAreaService } from '@services/serviceArea/serviceArea.service';
import { EmailTemplateController } from '@controllers/EmailTemplateController';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';
import {
  EventsRegistryCache,
  SubscriptionCache,
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
  SmsWorker,
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
  SmsQueue,
  PdfQueue,
} from '@queues/index';
import {
  MaintenanceRequest,
  PaymentProcessor,
  MetricsSnapshot,
  Notification,
  PropertyUnit,
  Subscription,
  Invitation,
  GuestPass,
  Property,
  Payment,
  Expense,
  Invoice,
  Profile,
  SMSLog,
  Client,
  Vendor,
  Lease,
  Asset,
  User,
} from '@models/index';
import {
  MaintenanceRequestDAO,
  PaymentProcessorDAO,
  PropertyUnitDAO,
  NotificationDAO,
  SubscriptionDAO,
  InvitationDAO,
  GuestPassDAO,
  PropertyDAO,
  MetricsDAO,
  PaymentDAO,
  ProfileDAO,
  ExpenseDAO,
  SMSLogDAO,
  ClientDAO,
  VendorDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';
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
  GuestPassService,
  AnthropicService,
  AuthTokenService,
  InvoiceAIService,
  PropertyService,
  BoldSignService,
  LeasePdfService,
  InvoiceService,
  ExpenseService,
  MetricsService,
  PaymentService,
  ProfileService,
  TwilioService,
  StripeService,
  ClientService,
  VendorService,
  LeaseService,
  UserService,
  DSARService,
  AuthService,
  CronService,
  SSEService,
  SMSService,
  AIService,
} from '@services/index';

const ControllerResources = {
  authController: asClass(AuthController).scoped(),
  dsarController: asClass(DSARController).scoped(),
  userController: asClass(UserController).scoped(),
  adminController: asClass(AdminController).scoped(),
  leaseController: asClass(LeaseController).scoped(),
  clientController: asClass(ClientController).scoped(),
  vendorController: asClass(VendorController).scoped(),
  webhookController: asClass(WebhookController).scoped(),
  paymentController: asClass(PaymentController).scoped(),
  expenseController: asClass(ExpenseController).scoped(),
  metricsController: asClass(MetricsController).scoped(),
  propertyController: asClass(PropertyController).scoped(),
  guestPassController: asClass(GuestPassController).scoped(),
  invitationController: asClass(InvitationController).scoped(),
  maintenanceController: asClass(MaintenanceController).scoped(),
  propertyUnitController: asClass(PropertyUnitController).scoped(),
  notificationController: asClass(NotificationController).scoped(),
  subscriptionController: asClass(SubscriptionController).scoped(),
  emailTemplateController: asClass(EmailTemplateController).scoped(),
};

const ModelResources = {
  userModel: asValue(User),
  assetModel: asValue(Asset),
  leaseModel: asValue(Lease),
  smsLogModel: asValue(SMSLog),
  vendorModel: asValue(Vendor),
  clientModel: asValue(Client),
  invoiceModel: asValue(Invoice),
  profileModel: asValue(Profile),
  expenseModel: asValue(Expense),
  paymentModel: asValue(Payment),
  propertyModel: asValue(Property),
  guestPassModel: asValue(GuestPass),
  invitationModel: asValue(Invitation),
  propertyUnitModel: asValue(PropertyUnit),
  subscriptionModel: asValue(Subscription),
  notificationModel: asValue(Notification),
  metricsSnapshotModel: asValue(MetricsSnapshot),
  paymentProcessorModel: asValue(PaymentProcessor),
  maintenanceRequestModel: asValue(MaintenanceRequest),
};

const ServiceResources = {
  aiService: asClass(AIService).singleton(),
  sseService: asClass(SSEService).singleton(),
  smsService: asClass(SMSService).singleton(),
  dsarService: asClass(DSARService).singleton(),
  authService: asClass(AuthService).singleton(),
  cronService: asClass(CronService).singleton(),
  userService: asClass(UserService).singleton(),
  assetService: asClass(AssetService).singleton(),
  mailerService: asClass(MailService).singleton(),
  leaseService: asClass(LeaseService).singleton(),
  stripeService: asClass(StripeService).singleton(),
  twilioService: asClass(TwilioService).singleton(),
  clientService: asClass(ClientService).singleton(),
  vendorService: asClass(VendorService).singleton(),
  metricsService: asClass(MetricsService).singleton(),
  expenseService: asClass(ExpenseService).singleton(),
  paymentService: asClass(PaymentService).singleton(),
  profileService: asClass(ProfileService).singleton(),
  tokenService: asClass(AuthTokenService).singleton(),
  invoiceService: asClass(InvoiceService).singleton(),
  languageService: asClass(LanguageService).singleton(),
  propertyService: asClass(PropertyService).singleton(),
  leasePdfService: asClass(LeasePdfService).singleton(),
  boldSignService: asClass(BoldSignService).singleton(),
  guestPassService: asClass(GuestPassService).singleton(),
  subscriptionPlanConfig: asValue(subscriptionPlanConfig),
  anthropicService: asClass(AnthropicService).singleton(),
  invoiceAIService: asClass(InvoiceAIService).singleton(),
  emitterService: asClass(EventEmitterService).singleton(),
  permissionService: asClass(PermissionService).singleton(),
  invitationService: asClass(InvitationService).singleton(),
  mediaUploadService: asClass(MediaUploadService).singleton(),
  paymentCronService: asClass(PaymentCronService).singleton(),
  rentPaymentService: asClass(RentPaymentService).singleton(),
  featureFlagService: asClass(FeatureFlagService).singleton(),
  propertyUnitService: asClass(PropertyUnitService).singleton(),
  notificationService: asClass(NotificationService).singleton(),
  pdfGeneratorService: asClass(PdfGeneratorService).singleton(),
  leaseRenewalService: asClass(LeaseRenewalService).singleton(),
  subscriptionService: asClass(SubscriptionService).singleton(),
  payoutAccountService: asClass(PayoutAccountService).singleton(),
  leaseTemplateService: asClass(LeaseTemplateService).singleton(),
  leaseDocumentService: asClass(LeaseDocumentService).singleton(),
  propertyStatsService: asClass(PropertyStatsService).singleton(),
  propertyMediaService: asClass(PropertyMediaService).singleton(),
  propertyCsvProcessor: asClass(PropertyCsvProcessor).singleton(),
  unitNumberingService: asClass(UnitNumberingService).singleton(),
  leaseSignatureService: asClass(LeaseSignatureService).singleton(),
  paymentGatewayService: asClass(PaymentGatewayService).singleton(),
  paymentWebhookService: asClass(PaymentWebhookService).singleton(),
  invitationCsvProcessor: asClass(InvitationCsvProcessor).singleton(),
  invoiceTemplateRenderer: asClass(InvoiceTemplateRenderer).singleton(),
  propertyApprovalService: asClass(PropertyApprovalService).singleton(),
  vendorSuggestionService: asClass(VendorSuggestionService).singleton(),
  maintenanceRequestService: asClass(MaintenanceRequestService).singleton(),
  maintenancePaymentService: asClass(MaintenancePaymentService).singleton(),
  maintenanceInvoiceService: asClass(MaintenanceInvoiceService).singleton(),
  subscriptionWebhookService: asClass(SubscriptionWebhookService).singleton(),
};

const DAOResources = {
  userDAO: asClass(UserDAO).singleton(),
  assetDAO: asClass(AssetDAO).singleton(),
  leaseDAO: asClass(LeaseDAO).singleton(),
  clientDAO: asClass(ClientDAO).singleton(),
  vendorDAO: asClass(VendorDAO).singleton(),
  smsLogDAO: asClass(SMSLogDAO).singleton(),
  profileDAO: asClass(ProfileDAO).singleton(),
  paymentDAO: asClass(PaymentDAO).singleton(),
  metricsDAO: asClass(MetricsDAO).singleton(),
  expenseDAO: asClass(ExpenseDAO).singleton(),
  invoiceDAO: asClass(InvoiceDAO).singleton(),
  propertyDAO: asClass(PropertyDAO).singleton(),
  guestPassDAO: asClass(GuestPassDAO).singleton(),
  invitationDAO: asClass(InvitationDAO).singleton(),
  propertyUnitDAO: asClass(PropertyUnitDAO).singleton(),
  subscriptionDAO: asClass(SubscriptionDAO).singleton(),
  notificationDAO: asClass(NotificationDAO).singleton(),
  paymentProcessorDAO: asClass(PaymentProcessorDAO).singleton(),
  maintenanceRequestDAO: asClass(MaintenanceRequestDAO).singleton(),
};

const CacheResources = {
  authCache: asClass(AuthCache).singleton(),
  propertyCache: asClass(PropertyCache).singleton(),
  leaseCache: asClass(LeaseCache).singleton(),
  eventsRegistry: asClass(EventsRegistryCache).singleton(),
  userCache: asClass(UserCache).singleton(),
  vendorCache: asClass(VendorCache).singleton(),
  idempotencyCache: asClass(IdempotencyCache).singleton(),
  subscriptionCache: asClass(SubscriptionCache).singleton(),
  notificationCache: asClass(NotificationCache).singleton(),
};

const WorkerResources = {
  cronWorker: asClass(CronWorker).singleton(),
  emailWorker: asClass(EmailWorker).singleton(),
  smsWorker: asClass(SmsWorker).singleton(),
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
  smsQueue: asClass(SmsQueue).singleton(),
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
