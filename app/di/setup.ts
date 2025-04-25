import { createLogger } from '@utils/index';
import { createContainer, InjectionMode } from 'awilix';

import { EventListenerSetup } from './eventListenerSetup';
import { resolveQueuesOnInit, registerResources } from './registerResources';

const initializeDI = () => {
  const logger = createLogger('DI');
  const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    ...registerResources,
  });

  EventListenerSetup.registerQueueListeners(container);
  logger.info('DI container initialized...');
  return container;
};

const container = initializeDI();
resolveQueuesOnInit(container);
export { container };
