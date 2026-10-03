import { AwilixContainer } from 'awilix';
import { createLogger } from '@utils/helpers';
import { EventTypes } from '@interfaces/index';
import { DiskStorage } from '@services/fileUpload';
import { S3Service } from '@services/fileUpload/awsS3';
import { EventEmitterService } from '@services/eventEmitter';

/** A service that subscribes to in-process events. Called once per process at start-up. */
export interface EventListenerOwner {
  registerEventListeners(): void;
}

export type ProcessType = 'api' | 'worker';

interface DIServices {
  emitterService: EventEmitterService;
  diskStorage: DiskStorage;
  s3Service: S3Service;
}

/**
 * Every service that listens to in-process events, and the processes it listens in.
 *
 * Events never cross processes, so a listener has to be registered in each process where
 * its event can be emitted. Registering here, instead of in constructors, means a listener
 * is active from start-up in exactly these processes — not only in a process that happened
 * to construct the service.
 *
 * Worker-only entries run heavy work (PDF rendering) that must stay off the API process.
 */
export const SERVICE_EVENT_LISTENERS: ReadonlyArray<{
  service: string;
  processes: ReadonlyArray<ProcessType>;
}> = [
  { service: 'assetService', processes: ['api', 'worker'] },
  { service: 'authService', processes: ['api', 'worker'] },
  { service: 'clientService', processes: ['api', 'worker'] },
  { service: 'inspectionAIService', processes: ['api', 'worker'] },
  { service: 'inspectionService', processes: ['api', 'worker'] },
  { service: 'invitationService', processes: ['api', 'worker'] },
  { service: 'invoiceService', processes: ['worker'] },
  { service: 'leasePdfService', processes: ['worker'] },
  { service: 'leaseService', processes: ['api', 'worker'] },
  { service: 'leaseSignatureService', processes: ['api', 'worker'] },
  { service: 'maintenancePaymentService', processes: ['api', 'worker'] },
  { service: 'maintenanceRequestService', processes: ['api', 'worker'] },
  { service: 'metricsService', processes: ['api', 'worker'] },
  { service: 'notificationService', processes: ['api', 'worker'] },
  { service: 'offboardingService', processes: ['api', 'worker'] },
  { service: 'profileService', processes: ['api', 'worker'] },
  { service: 'propertyMediaService', processes: ['api', 'worker'] },
  { service: 'propertyService', processes: ['api', 'worker'] },
  { service: 'propertyUnitService', processes: ['api', 'worker'] },
  { service: 'rentPaymentService', processes: ['api', 'worker'] },
  { service: 'reportService', processes: ['api', 'worker'] },
  { service: 'subscriptionService', processes: ['api', 'worker'] },
  { service: 'userService', processes: ['api', 'worker'] },
];

export class EventListenerSetup {
  private static readonly log = createLogger('EventListenerSetup');

  /**
   * Registers every in-process event listener for this process. Call once at start-up,
   * before HTTP traffic (API) or job processing (worker) begins.
   */
  static registerAll(container: AwilixContainer, processType: ProcessType): void {
    this.registerInfrastructureListeners(container);
    this.registerServiceListeners(container, processType);
  }

  /** Local temp-file and S3 clean-up. Both processes emit these events. */
  static registerInfrastructureListeners(container: AwilixContainer): void {
    try {
      const { emitterService, diskStorage, s3Service }: DIServices = container.cradle;
      emitterService.on(EventTypes.DELETE_LOCAL_ASSET, diskStorage.deleteFiles);
      emitterService.on(EventTypes.DELETE_REMOTE_ASSET, (keys: string[]) => {
        s3Service.deleteFiles(keys).catch((err) => {
          EventListenerSetup.log.error({ err, keys }, 'Failed to delete S3 assets');
        });
      });

      this.log.debug('Registered infrastructure event listeners.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.log.error(
        { err: message, stack },
        `Failed to register infrastructure event listeners: ${message}`
      );
      throw error;
    }
  }

  /** Resolves each listening service for this process and lets it subscribe. */
  static registerServiceListeners(container: AwilixContainer, processType: ProcessType): void {
    const registered: string[] = [];

    for (const { service, processes } of SERVICE_EVENT_LISTENERS) {
      if (!processes.includes(processType)) continue;

      const listenerOwner = container.resolve<EventListenerOwner>(service);
      listenerOwner.registerEventListeners();
      registered.push(service);
    }

    this.log.info(
      { processType, services: registered.length },
      'Registered service event listeners'
    );
  }
}
