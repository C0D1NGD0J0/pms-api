import { EventEmitter } from 'events';
import { createLogger } from '@utils/helpers';
import { EventsRegistryCache } from '@caching/events.cache';
import { EventPayloadMap, EventTypes } from '@interfaces/events.interface';

export class EventEmitterService {
  private emitter: EventEmitter;
  private log = createLogger('EventEmitterService');
  private eventsRegistry: EventsRegistryCache;

  constructor({ eventsRegistry }: { eventsRegistry: EventsRegistryCache }) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(20);
    this.eventsRegistry = eventsRegistry;
  }

  emit<T extends EventTypes>(eventType: T, payload: EventPayloadMap[T]): boolean {
    this.log.debug(`Emitting local event: ${eventType}`);
    return this.emitter.emit(eventType, payload);
  }

  on<T extends EventTypes>(eventType: T, handler: (payload: EventPayloadMap[T]) => void): this {
    this.emitter.on(eventType, handler);
    this.eventsRegistry.registerEvent(eventType).catch((error) => {
      this.log.error(error, `Failed to register event: ${eventType}`);
    });
    return this;
  }

  once<T extends EventTypes>(eventType: T, handler: (payload: EventPayloadMap[T]) => void): this {
    this.emitter.once(eventType, handler);
    return this;
  }

  off<T extends EventTypes>(eventType: T, handler: (payload: EventPayloadMap[T]) => void): this {
    this.emitter.off(eventType, handler);
    this.eventsRegistry.unregisteEvent(eventType).catch((error) => {
      this.log.error(error, `Failed to unregister event: ${eventType}`);
    });
    return this;
  }

  removeAllListeners(eventType?: EventTypes): this {
    this.emitter.removeAllListeners(eventType);
    this.eventsRegistry.getRegisteredEvents().then((events) => {
      if (events.success && events.data) {
        events.data.forEach((event) => {
          this.eventsRegistry.unregisteEvent(event).catch((error) => {
            this.log.error(error, `Failed to unregister event: ${event}`);
          });
        });
      }
    });
    this.log.debug(`Removed all listeners for event: ${eventType}`);
    return this;
  }

  listenerCount(eventType: EventTypes): number {
    return this.emitter.listenerCount(eventType);
  }
}
