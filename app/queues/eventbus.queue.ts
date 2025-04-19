import { v4 as uuidv4 } from 'uuid';
import { QUEUE_NAMES } from '@utils/constants';
import { EventPayloadMap, EventPayload, IEventBus } from '@interfaces/events.interface';

import { BaseQueue } from './base.queue';

export class EventBusQueue extends BaseQueue<EventPayload> implements IEventBus {
  constructor() {
    super(QUEUE_NAMES.EVENT_BUS_QUEUE);
    this.setupQueueEvents();
  }

  /**
   * Publish an event to the event bus
   * @param eventType The type of event to publish
   * @param payload The event payload
   * @param options Optional configuration for the event job
   */
  publishEvent<T extends keyof EventPayloadMap>(
    eventType: T,
    payload: EventPayloadMap[T],
    options: {
      delay?: number;
      priority?: number;
      userId?: string;
      source?: string;
      requestId?: string;
    } = {}
  ): Promise<any> {
    const event: EventPayload<EventPayloadMap[T]> = {
      eventType,
      payload,
      metadata: {
        timestamp: Date.now(),
        requestId: options.requestId || uuidv4(),
        source: options.source || 'event-bus',
        userId: options.userId,
      },
    };
    this.log.debug(`Publishing event: ${eventType}`);
    return this.addJobToQueue(eventType, event);
  }

  /**
   * Subscribe to events of a specific type
   * @param eventType The type of event to subscribe to
   * @param handler The handler function to process events
   * @param concurrency The number of events to process concurrently
   */
  subscribeToEvent<T extends keyof EventPayloadMap>(
    eventType: T,
    handler: (data: any) => Promise<void>
  ): void {
    this.log.info(`Subscribing to event: ${eventType} ...`);

    this.processQueueJobs(eventType, 5, async (job) => {
      try {
        const event = job.data as EventPayload<EventPayloadMap[T]>;
        this.log.debug(`Processing event ${eventType}, correlationId: ${event.metadata.requestId}`);

        await handler(event.payload);
        return Promise.resolve();
      } catch (error: any) {
        this.log.error(`Error processing event ${eventType}:`, error);
        return Promise.reject(error);
      }
    });
  }

  private setupQueueEvents(): void {
    this.queue.on('failed', (job, err) => {
      this.log.error(`Event processing failed for ${job.name}:`, err);
    });

    this.queue.on('completed', (job) => {
      const processingTime = Date.now() - new Date(job.timestamp).getTime();
      this.log.debug(`Event ${job.name} processed successfully in ${processingTime}ms`);
    });
  }
}
