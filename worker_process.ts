import './instrument'; // must be first — initialises Sentry before any other module loads
process.env.PROCESS_TYPE = 'worker';
import { container } from '@di/index';
import * as Sentry from '@sentry/node';
import { createLogger } from '@utils/helpers';
import { PidManager } from '@utils/pid-manager';
import { initQueues } from '@di/registerResources';
import { EventListenerSetup } from '@di/eventListenerSetup';

class WorkerProcess {
  private log = createLogger('WorkerProcess');
  private pidManager = new PidManager('worker', this.log);

  async start(): Promise<void> {
    try {
      this.pidManager.check();

      this.log.info(`🚀 Starting worker process... ${process.env.NODE_ENV}`);

      const { dbService } = container.cradle;
      await dbService.connect();
      initQueues(container);
      EventListenerSetup.registerQueueListeners(container);
      const { queueFactory } = container.cradle;
      const result = await queueFactory.initializeAllQueues();
      this.log.info(
        {
          queues: result.queues.length,
          failed: result.failed.length > 0 ? result.failed : undefined,
        },
        '✅ Initialized all queues for job processing'
      );

      container.resolve('cronService');
      this.registerShutdownHandlers();
    } catch (error) {
      this.log.error({ err: error }, '❌ Worker startup failed');
      process.exit(1);
    }
  }

  private registerShutdownHandlers(): void {
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
  }

  private async shutdown(signal: string): Promise<void> {
    this.log.info(`🛑 ${signal} received, shutting down worker gracefully...`);

    // Force-exit after 10s if active jobs haven't finished.
    // unref() so this timer doesn't prevent the event loop from draining naturally.
    setTimeout(() => {
      this.log.warn('Force shutdown after timeout');
      process.exit(0);
    }, 10000).unref();

    try {
      const { queueFactory, emitterService } = container.cradle;
      await queueFactory.shutdownAll();
      emitterService.destroy();
    } catch (err) {
      this.log.error({ err }, '❌ Shutdown error — queue/emitter cleanup failed');
    }

    this.pidManager.cleanup();
    await Sentry.flush(2000);
    process.exit(0);
  }
}

const worker = new WorkerProcess();
worker.start();
