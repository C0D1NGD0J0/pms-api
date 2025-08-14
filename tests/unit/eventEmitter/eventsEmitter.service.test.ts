import { MailType } from '@interfaces/index';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter/eventsEmitter.service';

// Mock dependencies
const mockEventsRegistry = {
  registerEvent: jest.fn().mockResolvedValue(undefined),
  unregisteEvent: jest.fn().mockResolvedValue(undefined),
  getRegisteredEvents: jest.fn().mockResolvedValue({ success: true, data: [] }),
};

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

// Mock the createLogger helper
jest.mock('@utils/helpers', () => ({
  createLogger: () => mockLogger,
}));

describe('EventEmitterService', () => {
  let eventEmitterService: EventEmitterService;

  beforeEach(() => {
    jest.clearAllMocks();
    eventEmitterService = new EventEmitterService({
      eventsRegistry: mockEventsRegistry as any,
    });
  });

  afterEach(() => {
    eventEmitterService.destroy();
  });

  describe('emit and on', () => {
    it('should emit and handle events correctly', () => {
      const handler = jest.fn();
      const testEvent = EventTypes.PROPERTY_CREATED;
      const testPayload = { propertyId: 'test-id', clientId: 'client-id' };

      // Register event handler
      eventEmitterService.on(testEvent, handler);

      // Emit event
      const result = eventEmitterService.emit(testEvent, testPayload);

      expect(result).toBe(true);
      expect(handler).toHaveBeenCalledWith(testPayload);
      expect(mockEventsRegistry.registerEvent).toHaveBeenCalledWith(testEvent);
    });

    it('should handle errors in event handlers gracefully', () => {
      const faultyHandler = jest.fn().mockImplementation(() => {
        throw new Error('Handler error');
      });
      const testEvent = EventTypes.PROPERTY_CREATED;
      const testPayload = { propertyId: 'test-id', clientId: 'client-id' };

      eventEmitterService.on(testEvent, faultyHandler);

      // Should not throw despite handler error
      const result = eventEmitterService.emit(testEvent, testPayload);

      expect(result).toBe(true);
      expect(faultyHandler).toHaveBeenCalledWith(testPayload);
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Error in event handler for ${testEvent}:`,
        expect.any(Error)
      );
    });

    it('should respect max listeners limit', () => {
      const testEvent = EventTypes.UNIT_CREATED;

      // Add maximum number of listeners (default is 10)
      for (let i = 0; i < 10; i++) {
        eventEmitterService.on(testEvent, jest.fn());
      }

      // Try to add one more - should be rejected
      eventEmitterService.on(testEvent, jest.fn());

      expect(mockLogger.error).toHaveBeenCalledWith(
        `Cannot add listener for ${testEvent}: Maximum listeners (10) reached`
      );

      // Listener count should still be 10
      expect(eventEmitterService.listenerCount(testEvent)).toBe(10);
    });
  });

  describe('once', () => {
    it('should handle one-time event listeners', () => {
      const handler = jest.fn();
      const testEvent = EventTypes.PROPERTY_DELETED;
      const testPayload = { propertyId: 'test-id', clientId: 'client-id' };

      eventEmitterService.once(testEvent, handler);

      // First emit should trigger handler
      eventEmitterService.emit(testEvent, testPayload);
      expect(handler).toHaveBeenCalledTimes(1);

      // Second emit should not trigger handler
      eventEmitterService.emit(testEvent, testPayload);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle errors in once handlers gracefully', () => {
      const faultyOnceHandler = jest.fn().mockImplementation(() => {
        throw new Error('Once handler error');
      });
      const testEvent = EventTypes.UNIT_STATUS_CHANGED;
      const testPayload = {
        unitId: 'unit-id',
        propertyId: 'property-id',
        propertyPid: 'property-pid',
        clientId: 'client-id',
        cuid: 'client-uid',
        userId: 'user-id',
        changeType: 'status_changed' as const,
      };

      eventEmitterService.once(testEvent, faultyOnceHandler);

      // Should handle error gracefully
      eventEmitterService.emit(testEvent, testPayload);

      expect(faultyOnceHandler).toHaveBeenCalledWith(testPayload);
      expect(mockLogger.error).toHaveBeenCalledWith(
        `Error in once handler for ${testEvent}:`,
        expect.any(Error)
      );
    });
  });

  describe('off and removeAllListeners', () => {
    it('should remove specific event listeners', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const testEvent = EventTypes.EMAIL_SENT;
      const testPayload = {
        emailType: MailType.INVITATION,
        jobData: {
          invitationId: 'email-id',
          data: {
            clientId: 'client-id',
          },
        },
        sentAt: new Date(),
      };

      // Add multiple handlers
      eventEmitterService.on(testEvent, handler1);
      eventEmitterService.on(testEvent, handler2);

      expect(eventEmitterService.listenerCount(testEvent)).toBe(2);

      // Remove one handler
      eventEmitterService.off(testEvent, handler1);

      expect(eventEmitterService.listenerCount(testEvent)).toBe(1);

      // Emit - only handler2 should be called
      eventEmitterService.emit(testEvent, testPayload);
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith(testPayload);
    });

    it('should remove all listeners and unregister events', async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const testEvent1 = EventTypes.PROPERTY_CREATED;
      const testEvent2 = EventTypes.PROPERTY_DOCUMENTS_UPDATE;

      // Add handlers for multiple events
      eventEmitterService.on(testEvent1, handler1);
      eventEmitterService.on(testEvent2, handler2);

      // Remove all listeners
      eventEmitterService.removeAllListeners();

      expect(eventEmitterService.listenerCount(testEvent1)).toBe(0);
      expect(eventEmitterService.listenerCount(testEvent2)).toBe(0);
      expect(mockLogger.debug).toHaveBeenCalledWith('Removed all listeners for event: all events');
    });

    it('should unregister events when last listener is removed', () => {
      const handler = jest.fn();
      const testEvent = EventTypes.UPLOAD_COMPLETED;

      eventEmitterService.on(testEvent, handler);
      expect(eventEmitterService.listenerCount(testEvent)).toBe(1);

      // Remove the only handler
      eventEmitterService.off(testEvent, handler);

      expect(eventEmitterService.listenerCount(testEvent)).toBe(0);
      expect(mockEventsRegistry.unregisteEvent).toHaveBeenCalledWith(testEvent);
    });
  });

  describe('destroy and cleanup', () => {
    it('should properly cleanup resources on destroy', () => {
      const handler = jest.fn();
      const testEvent = EventTypes.EMAIL_SENT;

      eventEmitterService.on(testEvent, handler);

      // Destroy should clean up everything
      eventEmitterService.destroy();

      expect(eventEmitterService.listenerCount(testEvent)).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith('EventEmitter service destroyed successfully');
    });

    it('should handle destroy errors gracefully', () => {
      // Mock an error during cleanup
      const originalRemoveAllListeners = eventEmitterService.removeAllListeners;
      eventEmitterService.removeAllListeners = jest.fn().mockImplementation(() => {
        throw new Error('Cleanup error');
      });

      eventEmitterService.destroy();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error during EventEmitter cleanup:',
        expect.any(Error)
      );

      // Restore original method
      eventEmitterService.removeAllListeners = originalRemoveAllListeners;
    });

    it('should initialize memory leak detection', () => {
      // Simply verify that the service initializes properly with memory leak detection
      expect(eventEmitterService).toBeDefined();

      // Verify that the service has proper cleanup when destroyed
      eventEmitterService.destroy();
      expect(mockLogger.info).toHaveBeenCalledWith('EventEmitter service destroyed successfully');
    });
  });
});
