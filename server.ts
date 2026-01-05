/* eslint-disable @typescript-eslint/no-namespace */
process.env.PROCESS_TYPE = 'api';
import http from 'http';
import { asValue } from 'awilix';
import { createClient } from 'redis';
import { container } from '@di/index';
import { IAppSetup, App } from '@root/app';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import express, { Application } from 'express';
import { PidManager } from '@utils/pid-manager';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { DatabaseService, Environments } from '@database/index';

(global as any).rootDir = __dirname;

interface IConstructor {
  dbService: DatabaseService;
}

class Server {
  private app: IAppSetup;
  private expApp: Application;
  private initialized = false;
  private shuttingDown = false;
  private pidManager: PidManager;
  private static instance: Server;
  private dbService: DatabaseService;
  private PORT = envVariables.SERVER.PORT;
  private httpServer: http.Server | null = null;
  private static processHandlersRegistered = false;
  private readonly log = createLogger('MainServer');
  private redisClients: { pub: any; sub: any } | null = null;
  private readonly SERVER_ENV = envVariables.SERVER.ENV as Environments;

  constructor({ dbService }: IConstructor) {
    this.expApp = express();
    this.dbService = dbService;
    this.app = new App(this.expApp, this.dbService);
    this.pidManager = new PidManager('api', this.log);
    this.setupProcessErrorHandlers();
  }

  start = async (): Promise<void> => {
    if (this.initialized) {
      this.log.info('Server already initialized, skipping startup');
      return;
    }

    // check for existing PID file to prevent duplicate processes
    this.pidManager.check();

    await this.dbService.connect();

    // Queues/workers run in separate worker_process.ts
    // Only load Bull Board UI (readonly) for monitoring via /admin/queues
    const isWorkerProcess = process.env.PROCESS_TYPE === 'worker';
    if (!isWorkerProcess) {
      this.log.info('API process: Skipping queue/worker initialization to save memory');
      this.log.info('Workers run in separate worker_process.ts (deploy pms-worker service)');
    } else {
      this.log.warn('⚠️  PROCESS_TYPE=worker detected in server.ts - this should not happen!');
      this.log.warn('⚠️  Worker initialization should only happen in worker_process.ts');
    }

    this.app.initConfig();
    await this.startServers(this.expApp);
    this.initialized = true;
  };

  public static getInstance(): Server {
    if (!Server.instance) {
      const { dbService } = container.cradle;
      Server.instance = new Server({ dbService });
      Server.instance.initialized = true;
    }
    return Server.instance;
  }

  getInstances = () => {
    return {
      expApp: this.expApp,
    };
  };

  private async startServers(app: Application): Promise<void> {
    try {
      this.httpServer = new http.Server(app);
      this.initHTTPServer(this.httpServer);
      const io = await this.setupSocketIO(this.httpServer);
      io && this.socketConnections(io);
    } catch (error: any) {
      this.log.error('Error: ', error.message);
    }
  }

  private initHTTPServer(httpServer: http.Server): void {
    if (this.SERVER_ENV === 'test') {
      return undefined;
    }

    httpServer.listen(this.PORT, '0.0.0.0', () => {
      this.log.info('Server initialized...');
    });

    httpServer.on('error', (error: any) => {
      this.log.error('HTTP Server Error:', error);
    });
  }

  private async setupSocketIO(httpServer: http.Server): Promise<SocketIOServer | undefined> {
    if (this.SERVER_ENV === 'test') {
      return undefined;
    }

    const io: SocketIOServer = new SocketIOServer(httpServer, {
      cors: {
        origin: [
          'localhost',
          envVariables.FRONTEND.URL,
          `http://localhost:${envVariables.SERVER.PORT}`,
        ],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      },
    });
    const pubClient = createClient({ url: envVariables.REDIS.URL });
    const subClient = pubClient.duplicate();

    await Promise.all([
      pubClient.connect().catch((err) => {
        this.log.error('Failed to connect Redis pub client:', err);
        throw err;
      }),
      subClient.connect().catch((err) => {
        this.log.error('Failed to connect Redis sub client:', err);
        throw err;
      }),
    ]);
    // save redis-clients for cleanup process ltr
    this.redisClients = { pub: pubClient, sub: subClient };
    io.adapter(createAdapter(pubClient, subClient));
    // register ioServer in the container
    container.register({ ioServer: asValue(io) });
    return io;
  }

  private async socketConnections(_io: SocketIOServer): Promise<void> {
    const scope = container.createScope();
    try {
      scope.resolve('baseIO');
    } catch (error) {
      this.log.error('Error resolving baseIO:', error);
    }
  }

  async shutdown(exitCode = 0): Promise<void> {
    if (this.shuttingDown) {
      this.log.info('Shutdown already in progress, skipping...');
      return;
    }

    this.shuttingDown = true;
    this.log.info('Server shutting down...');
    this.pidManager.killProcess();

    // Set a timeout to force exit if graceful shutdown takes too long
    const shutdownTimeout = setTimeout(() => {
      this.log.warn('Shutdown timeout reached, forcing exit...');
      process.exit(exitCode);
    }, 10000); // 10 seconds timeout

    try {
      // close socket connections
      if (container.hasRegistration('ioServer')) {
        const io = container.resolve<SocketIOServer>('ioServer');
        await new Promise<void>((resolve) => {
          io.close(() => {
            this.log.info('Socket.IO server closed');
            resolve();
          });
        });
      }

      // close Redis clients if they exist
      if (this.redisClients) {
        const { pub, sub } = this.redisClients;
        await Promise.all([
          pub
            .quit()
            .catch((err: unknown) => this.log.error('Error closing Redis pub client:', err)),
          sub
            .quit()
            .catch((err: unknown) => this.log.error('Error closing Redis sub client:', err)),
        ]);
        this.log.info('Redis clients closed');
      }

      // close HTTP server
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer?.close(() => {
            this.log.info('HTTP server closed');
            resolve();
          });
        });
      }

      // cleanup queues and services first
      await this.cleanupDIContainer();

      // close database connection last
      await this.dbService.disconnect();

      clearTimeout(shutdownTimeout);
      this.log.info('Graceful shutdown completed');

      if (exitCode !== 0) {
        this.log.info(`Exiting with code ${exitCode}`);
        process.exit(exitCode);
      }
    } catch (error) {
      clearTimeout(shutdownTimeout);
      this.log.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  private async cleanupDIContainer(): Promise<void> {
    this.log.info('Cleaning up DI container and services...');

    try {
      const servicesWithCleanup = [
        'emitterService',
        'propertyService',
        'redisService',
        'propertyUnitService',
        'authService',
        'leaseService',
        'clientService',
      ];

      // clean up services that have destroy/cleanup methods
      for (const serviceName of servicesWithCleanup) {
        try {
          if (container.hasRegistration(serviceName)) {
            const service = container.resolve(serviceName);
            if (service && typeof service.destroy === 'function') {
              await service.destroy();
              this.log.info(`Cleaned up ${serviceName}`);
            } else if (service && typeof service.cleanupEventListeners === 'function') {
              service.cleanupEventListeners();
              this.log.info(`Cleaned up event listeners for ${serviceName}`);
            }
          }
        } catch (error) {
          this.log.warn(`Failed to cleanup ${serviceName}:`, error);
        }
      }

      // Clean up queues - dynamically discover all registered queues
      const queueNames = Object.keys(container.registrations).filter((name) =>
        name.endsWith('Queue')
      );
      let queueCount = 0;
      for (const queueName of queueNames) {
        try {
          if (container.hasRegistration(queueName)) {
            const queue = container.resolve(queueName);
            if (queue && typeof queue.shutdown === 'function') {
              await queue.shutdown();
              queueCount += 1;
            }
          }
        } catch (error) {
          this.log.warn(`Failed to shutdown ${queueName}:`, error);
        }
      }

      container.dispose();
      this.log.info(`Shutdown ${queueCount} queues`);
      this.log.info('DI container disposed');
    } catch (error) {
      this.log.error('Error during DI container cleanup:', error);
    }
  }

  private setupProcessErrorHandlers(): void {
    if (Server.processHandlersRegistered) {
      return;
    }

    Server.processHandlersRegistered = true;

    process.on('unhandledRejection', (reason, promise) => {
      this.log.error('Unhandled Rejection at:', promise, 'reason:', reason);
      // Don't shut down for unhandled rejections in production
      if (this.SERVER_ENV === 'development') {
        this.shutdown(1);
      }
    });

    process.on('uncaughtException', (err: Error) => {
      this.log.error(`Uncaught Exception: ${err.message}`);
      this.shutdown(1);
    });

    process.on('warning', (warning) => {
      if (warning.name === 'HeapSizeLimit' || warning.name === 'MemoryLimitError') {
        console.warn('----WARNIGN----', warning);
      }
    });

    // handle termination signals
    process.on('SIGTERM', () => {
      this.log.info('SIGTERM received');
      this.shutdown(0);
    });

    process.on('SIGINT', () => {
      this.log.info('SIGINT received');
      this.shutdown(0);
    });
  }
}

export const getServerInstance = () => {
  const server = Server.getInstance();
  return {
    appInstance: server.getInstances().expApp,
  };
};

// Only start the server if this file is run directly (not imported in tests)
if (require.main === module) {
  const start = function () {
    if (envVariables.SERVER.ENV === 'test') {
      console.log('Skipping server startup in test environment');
      return;
    }

    const { dbService } = container.cradle;
    const server = new Server({ dbService });
    server.start().catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
  };
  start();
}
