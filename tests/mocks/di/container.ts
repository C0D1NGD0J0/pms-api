import { createLogger } from '@utils/index';
import { InjectionMode, createContainer } from 'awilix';

import { mockResources } from './mocks';

const logger = createLogger('Test-DI');
const initializeTestDI = () => {
  const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    ...mockResources,
  });
  logger.info('Test DI container initialized');
  return container;
};

const container = initializeTestDI();
export { container };
