import { createLogger } from '@utils/index';
import { createContainer, InjectionMode } from 'awilix';

import { registerResources } from './registerResources';

const initializeDI = () => {
  const logger = createLogger('DI');
  const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    ...registerResources,
  });

  logger.info('DI container initialized');
  return container;
};

const container = initializeDI();
// resolve singletons on intial load HERE...
container.resolve('emailQueue');
container.resolve('emailWorker');

export { container };
