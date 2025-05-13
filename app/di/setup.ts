import { createLogger } from '@utils/index';
import { createContainer, InjectionMode } from 'awilix';

import { EventListenerSetup } from './eventListenerSetup';
import { registerResources, initQueues } from './registerResources';

const initializeDI = () => {
  const logger = createLogger('DI');
  const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    ...registerResources,
  });

  initQueues(container);
  logger.info('DI container initialized...');
  EventListenerSetup.registerQueueListeners(container);
  return container;
};

const container = initializeDI();

export { container };
