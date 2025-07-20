export default async (): Promise<void> => {
  console.log('🧹 Cleaning up test environment...');

  try {
    // Get the container from global if available
    const container = (global as any).__CONTAINER__;
    
    if (container) {
      // Follow the same cleanup pattern as the main server
      // Clean up services that have destroy/cleanup methods
      const servicesWithCleanup = [
        'emitterService',
        'propertyService', 
        'redisService',
        'propertyUnitService',
        'authService',
        'clientService',
      ];

      for (const serviceName of servicesWithCleanup) {
        try {
          if (container.hasRegistration(serviceName)) {
            const service = container.resolve(serviceName);
            if (service && typeof service.destroy === 'function') {
              await service.destroy();
              console.log(`✅ Cleaned up ${serviceName}`);
            }
          }
        } catch (error) {
          console.warn(`⚠️ Failed to cleanup ${serviceName}:`, error);
        }
      }

      // Clean up queues
      const queueNames = [
        'documentProcessingQueue',
        'emailQueue',
        'eventBusQueue', 
        'invitationQueue',
        'propertyQueue',
        'propertyUnitQueue',
        'uploadQueue',
      ];

      for (const queueName of queueNames) {
        try {
          if (container.hasRegistration(queueName)) {
            const queue = container.resolve(queueName);
            if (queue && typeof queue.shutdown === 'function') {
              await queue.shutdown();
            }
          }
        } catch (error) {
          console.warn(`⚠️ Failed to shutdown ${queueName}:`, error);
        }
      }

      // Close database connection
      try {
        if (container.hasRegistration('dbService')) {
          const dbService = container.resolve('dbService');
          await dbService.disconnect('test');
          console.log('✅ Database disconnected');
        }
      } catch (error) {
        console.warn('⚠️ Failed to disconnect database:', error);
      }

      // Dispose container
      container.dispose();
      console.log('✅ DI container disposed');
    }

    console.log('✅ Test environment cleanup completed');
  } catch (error) {
    console.error('❌ Test environment cleanup failed:', error);
    throw error;
  }
};