import { container } from '@di/index';
import { createLogger } from '@utils/helpers';

process.env.PROCESS_TYPE = 'worker';

class WorkerProcess {
  private log = createLogger('WorkerProcess');
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
      this.log.info('🚀 Starting worker process...');
      this.log.info(`Environment: ${process.env.NODE_ENV}`);
      this.log.info(`Process Type: ${process.env.PROCESS_TYPE}`);

      const { dbService } = container.cradle;
      await dbService.connect();
      this.log.info('📦 Database connected in worker-process');

      // Resolve queues - they'll auto-start processing in worker mode
      this.queueNames.forEach((queueName) => {
        try {
          container.resolve(queueName);
          this.log.info(`   ✓ ${queueName} ready`);
        } catch (error: any) {
          this.log.warn(`   ⚠ ${queueName} failed: ${error.message}`);
        }
      });

      this.registerShutdownHandlers();
    } catch (error) {
      this.log.error('❌ Worker startup failed:', error);
      process.exit(1);
    }
  }

  private registerShutdownHandlers(): void {
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
  }

  private async shutdown(signal: string): Promise<void> {
    this.log.info(`🛑 ${signal} received, shutting down worker gracefully...`);

    setTimeout(() => {
      this.log.info('Force shutdown after timeout');
      process.exit(0);
    }, 30000); // allows running jobs time to finish (max 30 seconds)

    process.exit(0);
  }
}

const worker = new WorkerProcess();
worker.start();
