import { EventTypes } from '@interfaces/events.interface';
import { EventsRegistryCache } from '@caching/events.cache';
import { EventEmitterService } from '@services/eventEmitter';

// Mock createLogger so the BaseCache and EventEmitterService constructors do not blow up
jest.mock('@utils/helpers', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    trace: jest.fn(),
  })),
}));

const REGISTRY_KEY = 'events:registry:events';

const buildRegistry = (isReady = true) => {
  const client = {
    isReady,
    sAdd: jest.fn().mockResolvedValue(1),
    sRem: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(true),
  };
  const registry = new EventsRegistryCache({ redisService: { client, log: {} } as any });
  return { registry, client };
};

describe('EventsRegistryCache', () => {
  it('writes many event types in one sAdd plus one expire', async () => {
    const { registry, client } = buildRegistry();

    await registry.registerEvents([EventTypes.UPLOAD_COMPLETED, EventTypes.UPLOAD_FAILED]);

    expect(client.sAdd).toHaveBeenCalledTimes(1);
    expect(client.sAdd).toHaveBeenCalledWith(REGISTRY_KEY, ['upload:completed', 'upload:failed']);
    expect(client.expire).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for an empty batch', async () => {
    const { registry, client } = buildRegistry();

    await expect(registry.registerEvents([])).resolves.toEqual({ success: true, data: null });
    expect(client.sAdd).not.toHaveBeenCalled();
  });

  it('removes many event types in one sRem', async () => {
    const { registry, client } = buildRegistry();

    await registry.unregisterEvents([EventTypes.UPLOAD_COMPLETED, EventTypes.UPLOAD_FAILED]);

    expect(client.sRem).toHaveBeenCalledTimes(1);
    expect(client.sRem).toHaveBeenCalledWith(REGISTRY_KEY, ['upload:completed', 'upload:failed']);
  });

  it('skips Redis when the client is not ready', async () => {
    const { registry, client } = buildRegistry(false);

    const result = await registry.registerEvents([EventTypes.UPLOAD_COMPLETED]);

    expect(result.success).toBe(false);
    expect(client.sAdd).not.toHaveBeenCalled();
  });
});

describe('EventEmitterService — registry writes at start-up', () => {
  const buildEmitter = () => {
    const eventsRegistry = {
      registerEvents: jest.fn().mockResolvedValue({ success: true }),
      unregisterEvents: jest.fn().mockResolvedValue({ success: true }),
      unregisteEvent: jest.fn().mockResolvedValue({ success: true }),
      getRegisteredEvents: jest.fn().mockResolvedValue({ success: true, data: [] }),
    };
    const emitter = new EventEmitterService({ eventsRegistry: eventsRegistry as any });
    return { emitter, eventsRegistry };
  };
  const nextTick = () => new Promise((resolve) => setImmediate(resolve));

  it('writes every newly subscribed event type to Redis in one batch, once per type', async () => {
    const { emitter, eventsRegistry } = buildEmitter();

    // Many listeners in one tick, several on the same event — like start-up registration
    for (let i = 0; i < 8; i++) emitter.on(EventTypes.LEASE_ESIGNATURE_COMPLETED, jest.fn());
    emitter.on(EventTypes.UPLOAD_COMPLETED, jest.fn());
    emitter.on(EventTypes.UPLOAD_FAILED, jest.fn());
    expect(eventsRegistry.registerEvents).not.toHaveBeenCalled();

    await nextTick();

    expect(eventsRegistry.registerEvents).toHaveBeenCalledTimes(1);
    expect(eventsRegistry.registerEvents).toHaveBeenCalledWith([
      EventTypes.LEASE_ESIGNATURE_COMPLETED,
      EventTypes.UPLOAD_COMPLETED,
      EventTypes.UPLOAD_FAILED,
    ]);
    emitter.destroy();
  });

  it('does not re-register an event type that already has listeners', async () => {
    const { emitter, eventsRegistry } = buildEmitter();
    emitter.on(EventTypes.UPLOAD_COMPLETED, jest.fn());
    await nextTick();

    emitter.on(EventTypes.UPLOAD_COMPLETED, jest.fn());
    await nextTick();

    expect(eventsRegistry.registerEvents).toHaveBeenCalledTimes(1);
    emitter.destroy();
  });

  it('unregisters all event types in one call when every listener is removed', async () => {
    const { emitter, eventsRegistry } = buildEmitter();
    eventsRegistry.getRegisteredEvents.mockResolvedValue({
      success: true,
      data: ['upload:completed', 'upload:failed'],
    });

    emitter.removeAllListeners();
    await nextTick();

    expect(eventsRegistry.unregisterEvents).toHaveBeenCalledTimes(1);
    expect(eventsRegistry.unregisterEvents).toHaveBeenCalledWith([
      'upload:completed',
      'upload:failed',
    ]);
    expect(eventsRegistry.unregisteEvent).not.toHaveBeenCalled();
    emitter.destroy();
  });
});
