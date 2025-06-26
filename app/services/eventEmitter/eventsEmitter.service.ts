import { EventEmitter } from 'events';
import { createLogger } from '@utils/helpers';
import { EventsRegistryCache } from '@caching/events.cache';
import { EventPayloadMap, EventTypes } from '@interfaces/events.interface';

export class EventEmitterService {
  private emitter: EventEmitter;
  private log: any;
  private eventsRegistry: EventsRegistryCache;
  private listenerCounts = new Map<EventTypes, number>();
  private readonly MAX_LISTENERS_PER_EVENT = 10;
  private memoryLeakDetectionInterval?: NodeJS.Timer;
  private handlerMappings = new Map<Function, Function>();

  constructor({ eventsRegistry }: { eventsRegistry: EventsRegistryCache }) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(this.MAX_LISTENERS_PER_EVENT);
    this.eventsRegistry = eventsRegistry;
    this.log = createLogger('EventEmitterService');
    this.setupMemoryLeakDetection();
  }

  private setupMemoryLeakDetection(): void {
    // monitor for potential memory leaks
    this.memoryLeakDetectionInterval = setInterval(() => {
      const eventNames = this.emitter.eventNames();
      eventNames.forEach((eventName) => {
        const listenerCount = this.emitter.listenerCount(eventName as string);
        if (listenerCount > this.MAX_LISTENERS_PER_EVENT) {
          this.log.warn(
            `Potential memory leak detected: Event '${String(eventName)}' has ${listenerCount} listeners`
          );
        }
      });
    }, 60000); // every minute
  }

  emit<T extends EventTypes>(eventType: T, payload: EventPayloadMap[T]): boolean {
    this.log.debug(`Emitting local event: ${eventType}`);

    try {
      return this.emitter.emit(eventType, payload);
    } catch (error) {
      this.log.error(`Error emitting event ${eventType}:`, error);
      return false;
    }
  }

  on<T extends EventTypes>(eventType: T, handler: (payload: EventPayloadMap[T]) => void): this {
    const currentCount = this.listenerCounts.get(eventType) || 0;

    if (currentCount >= this.MAX_LISTENERS_PER_EVENT) {
      this.log.error(
        `Cannot add listener for ${eventType}: Maximum listeners (${this.MAX_LISTENERS_PER_EVENT}) reached`
      );
      return this;
    }

    const safeHandler = (payload: EventPayloadMap[T]) => {
      try {
        handler(payload);
      } catch (error) {
        this.log.error(`Error in event handler for ${eventType}:`, error);
      }
    };

    // Store mapping for removal later
    this.handlerMappings.set(handler, safeHandler);

    this.emitter.on(eventType, safeHandler);
    this.listenerCounts.set(eventType, currentCount + 1);

    this.eventsRegistry.registerEvent(eventType).catch((error) => {
      this.log.error(error, `Failed to register event: ${eventType}`);
    });
    return this;
  }

  once<T extends EventTypes>(eventType: T, handler: (payload: EventPayloadMap[T]) => void): this {
    // Wrap handler to catch errors and clean up
    const safeHandler = (payload: EventPayloadMap[T]) => {
      try {
        handler(payload);
      } catch (error) {
        this.log.error(`Error in once handler for ${eventType}:`, error);
      } finally {
        const count = this.listenerCounts.get(eventType) || 0;
        if (count > 0) {
          this.listenerCounts.set(eventType, count - 1);
        }
      }
    };

    this.emitter.once(eventType, safeHandler);
    return this;
  }

  off<T extends EventTypes>(eventType: T, handler: (payload: EventPayloadMap[T]) => void): this {
    // Get the wrapped handler
    const wrappedHandler = this.handlerMappings.get(handler);
    if (wrappedHandler) {
      this.emitter.off(eventType, wrappedHandler);
      this.handlerMappings.delete(handler);
    } else {
      // Fallback to removing the original handler (in case it wasn't wrapped)
      this.emitter.off(eventType, handler);
    }

    // update listener count
    const count = this.listenerCounts.get(eventType) || 0;
    if (count > 0) {
      this.listenerCounts.set(eventType, count - 1);
    }

    // if no more listeners unregister the event
    if (this.emitter.listenerCount(eventType) === 0) {
      this.eventsRegistry.unregisteEvent(eventType).catch((error) => {
        this.log.error(error, `Failed to unregister event: ${eventType}`);
      });
    }

    return this;
  }

  removeAllListeners(eventType?: EventTypes): this {
    if (eventType) {
      this.emitter.removeAllListeners(eventType);
      this.listenerCounts.delete(eventType);
    } else {
      this.emitter.removeAllListeners();
      this.listenerCounts.clear();
    }

    // clean up registry
    if (!eventType) {
      this.eventsRegistry.getRegisteredEvents().then((events) => {
        if (events.success && events.data) {
          Promise.all(
            events.data.map((event) =>
              this.eventsRegistry.unregisteEvent(event).catch((error) => {
                this.log.error(error, `Failed to unregister event: ${event}`);
              })
            )
          );
        }
      });
    } else {
      this.eventsRegistry.unregisteEvent(eventType).catch((error) => {
        this.log.error(error, `Failed to unregister event: ${eventType}`);
      });
    }

    this.log.debug(`Removed all listeners for event: ${eventType || 'all events'}`);
    return this;
  }

  listenerCount(eventType: EventTypes): number {
    return this.emitter.listenerCount(eventType);
  }

  destroy(): void {
    this.removeAllListeners();
    this.listenerCounts.clear();
    this.handlerMappings.clear();
    
    // Clear the memory leak detection interval
    if (this.memoryLeakDetectionInterval) {
      clearInterval(this.memoryLeakDetectionInterval);
      this.memoryLeakDetectionInterval = undefined;
    }
  }
}
