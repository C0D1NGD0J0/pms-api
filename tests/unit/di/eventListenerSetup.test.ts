import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';
import { EventTypes } from '@interfaces/index';
import { SERVICE_EVENT_LISTENERS, EventListenerSetup } from '@di/eventListenerSetup';

const SERVICES_DIR = path.resolve(__dirname, '../../../app/services');

const listSourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return entry.name.endsWith('.ts') ? [fullPath] : [];
  });

const toRegistrationKey = (className: string) =>
  className.charAt(0).toLowerCase() + className.slice(1);

const makeContainer = () => {
  const emitterService = { on: jest.fn() };
  const diskStorage = { deleteFiles: jest.fn() };
  const s3Service = { deleteFiles: jest.fn() };
  const listenerOwners: Record<string, { registerEventListeners: jest.Mock }> = {};

  const container = {
    cradle: { emitterService, diskStorage, s3Service },
    resolve: jest.fn((name: string) => {
      listenerOwners[name] ??= { registerEventListeners: jest.fn() };
      return listenerOwners[name];
    }),
  };

  return { container, emitterService, listenerOwners };
};

describe('EventListenerSetup', () => {
  it('registers every listed service for its process, and skips the rest', () => {
    const { container, listenerOwners } = makeContainer();

    EventListenerSetup.registerServiceListeners(container as any, 'api');

    for (const { service, processes } of SERVICE_EVENT_LISTENERS) {
      if (processes.includes('api')) {
        expect(listenerOwners[service]?.registerEventListeners).toHaveBeenCalledTimes(1);
      } else {
        expect(listenerOwners[service]).toBeUndefined();
      }
    }
  });

  it('keeps PDF-rendering listeners off the API process', () => {
    const { container, listenerOwners } = makeContainer();

    EventListenerSetup.registerServiceListeners(container as any, 'api');

    expect(listenerOwners.leasePdfService).toBeUndefined();
    expect(listenerOwners.invoiceService).toBeUndefined();
  });

  it('registers the file clean-up listeners in both processes', () => {
    for (const processType of ['api', 'worker'] as const) {
      const { container, emitterService } = makeContainer();

      EventListenerSetup.registerAll(container as any, processType);

      const events = emitterService.on.mock.calls.map((call) => call[0]);
      expect(events).toEqual(
        expect.arrayContaining([EventTypes.DELETE_LOCAL_ASSET, EventTypes.DELETE_REMOTE_ASSET])
      );
    }
  });

  describe('registry stays in sync with the services', () => {
    const sourceFiles = listSourceFiles(SERVICES_DIR);
    const listedServices = new Set(SERVICE_EVENT_LISTENERS.map((entry) => entry.service));

    const listeningClasses = sourceFiles
      .map((file) => fs.readFileSync(file, 'utf8'))
      .filter((source) => /emitterService\.on\(/.test(source))
      .map((source) => source.match(/export class (\w+)/)?.[1])
      .filter((className): className is string => !!className);

    it('lists every service that subscribes to events', () => {
      const missing = listeningClasses
        .map(toRegistrationKey)
        .filter((registrationKey) => !listedServices.has(registrationKey));

      expect(missing).toEqual([]);
    });

    it('never subscribes from a constructor', () => {
      const constructorSubscriptions = sourceFiles.filter((file) =>
        /constructor\([\s\S]*?\{[\s\S]*?\n {2}\}/
          .exec(fs.readFileSync(file, 'utf8'))?.[0]
          .match(
            /(setupEventListeners|registerEventListeners|initializeEventListeners)\(\)|emitterService\.on\(/
          )
      );

      expect(constructorSubscriptions).toEqual([]);
    });
  });
});
