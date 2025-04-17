import { AwilixContainer } from 'awilix';
import { createLogger } from '@utils/helpers';
import { EventBusQueue } from '@queues/index';
import { EventTypes } from '@interfaces/index';
import { DiskStorage } from '@services/fileUpload';
import { EventEmitterService } from '@services/eventEmitter';

interface DIServices {
  emitterService: EventEmitterService;
  eventBusQueue: EventBusQueue;
  diskStorage: DiskStorage;
}

export class EventListenerSetup {
  private static readonly log = createLogger('EventListenerSetup');
  static registerQueueListeners(container: AwilixContainer): void {
    try {
      const { emitterService, diskStorage }: DIServices = container.cradle;
      emitterService.once(EventTypes.DELETE_LOCAL_ASSET, diskStorage.deleteFiles);
      this.log.info('Registered EventBusQueue listeners.');
    } catch (error) {
      this.log.error({ err: error }, 'Failed to register EventBusQueue listeners');
      throw new Error(
        `Event listener registration failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
