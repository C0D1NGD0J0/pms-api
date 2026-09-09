import { AwilixContainer } from 'awilix';
import { createLogger } from '@utils/helpers';
import { EventBusQueue } from '@queues/index';
import { EventTypes } from '@interfaces/index';
import { DiskStorage } from '@services/fileUpload';
import { S3Service } from '@services/fileUpload/awsS3';
import { EventEmitterService } from '@services/eventEmitter';

interface DIServices {
  emitterService: EventEmitterService;
  eventBusQueue: EventBusQueue;
  diskStorage: DiskStorage;
  s3Service: S3Service;
}

export class EventListenerSetup {
  private static readonly log = createLogger('EventListenerSetup');
  static registerQueueListeners(container: AwilixContainer): void {
    try {
      const { emitterService, diskStorage, s3Service }: DIServices = container.cradle;
      // Register infrastructure event listeners only
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
}
