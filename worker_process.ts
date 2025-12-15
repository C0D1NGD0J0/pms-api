import { container } from '@di/index';
import { createLogger } from '@utils/helpers';
import { PidManager } from '@utils/pid-manager';

process.env.PROCESS_TYPE = 'worker';

class WorkerProcess {
  private log = createLogger('WorkerProcess');
  private pidManager = new PidManager('worker', this.log);
  private queueNames = [
    'emailQueue',
    'uploadQueue',
    'pdfGeneratorQueue',
    'eSignatureQueue',
    'propertyQueue',
    'propertyUnitQueue',
    'invitationQueue',
    'documentProcessingQueue',
    'eventBusQueue',
    'cronQueue',
  ];

  async start(): Promise<void> {
    try {
      this.pidManager.check();

      this.log.info('🚀 Starting worker process...');
      this.log.info(`Environment: ${process.env.NODE_ENV}`);
      this.log.info(`Process Type: ${process.env.PROCESS_TYPE}`);

      const { dbService } = container.cradle;
      await dbService.connect();
      container.resolve('cronService');

      // Resolve queues - they'll auto-start processing in worker mode
      this.queueNames.forEach((queueName) => {
        try {
          container.resolve(queueName);
        } catch (error: any) {
          this.log.warn(`⚠ ${queueName} failed: ${error.message}`);
        }
      });
      this.logRedisConnectionCount();
      this.registerShutdownHandlers();
    } catch (error) {
      this.log.error('❌ Worker startup failed:', error);
      process.exit(1);
    }
  }

  private logRedisConnectionCount(): void {
    // Log Redis connection info after startup
    setTimeout(() => {
      this.log.info({
        message: 'Redis connection monitoring',
        tip: 'Check active connections with: lsof -i :6379 | grep ESTABLISHED | wc -l',
        expectedConnections: `~${this.queueNames.length * 2}-${this.queueNames.length * 3} per worker (${this.queueNames.length} queues)`,
        alert: 'If connections > 100, check for duplicate processes or connection leaks',
      });
    }, 2000); // Wait 2s for all queues to initialize
  }

  private registerShutdownHandlers(): void {
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
  }

  private async shutdown(signal: string): Promise<void> {
    this.log.info(`🛑 ${signal} received, shutting down worker gracefully...`);

    this.pidManager.killProcess();
    setTimeout(() => {
      this.log.info('Force shutdown after timeout');
      process.exit(0);
    }, 30000); // allows running jobs time to finish (max 30 seconds)

    process.exit(0);
  }
}

const worker = new WorkerProcess();
worker.start();
