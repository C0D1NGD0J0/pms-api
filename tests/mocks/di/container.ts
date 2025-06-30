import { createLogger } from '@utils/index';
import { createContainer, InjectionMode, AwilixContainer } from 'awilix';
import { mockResources } from './mocks';
import { clearMocks, resetMocks } from '@tests/utils/mockHelpers';

const logger = createLogger('Test-DI');

let testContainer: AwilixContainer | null = null;

const initializeTestDI = (): AwilixContainer => {
  if (testContainer) {
    testContainer.dispose();
  }

  testContainer = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  testContainer.register({
    ...mockResources,
  });
  
  logger.info('Test DI container initialized');
  return testContainer;
};

const resetTestContainer = (): void => {
  if (testContainer) {
    // Reset all mocks in the container
    resetMocks(mockResources);
    clearMocks(mockResources);
  }
};

const cleanupTestContainer = (): void => {
  if (testContainer) {
    testContainer.dispose();
    testContainer = null;
  }
};

// Initialize container on module load
const container = initializeTestDI();

export { 
  container, 
  initializeTestDI, 
  resetTestContainer, 
  cleanupTestContainer 
};
