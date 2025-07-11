/* eslint-disable @typescript-eslint/no-namespace */

import http from 'http';
import { asValue } from 'awilix';
import { createClient } from 'redis';
import { container } from '@di/index';
import { IAppSetup, App } from '@root/app';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import express, { Application } from 'express';
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
  private static instance: Server;
  private dbService: DatabaseService;
  private PORT = envVariables.SERVER.PORT;
  private httpServer: http.Server | null = null;
  private readonly log = createLogger('MainServer');
  private readonly SERVER_ENV = envVariables.SERVER.ENV as Environments;
  private redisClients: { pub: any; sub: any } | null = null;

  constructor({ dbService }: IConstructor) {
    this.expApp = express();
    this.dbService = dbService;
    this.app = new App(this.expApp, this.dbService);
    this.setupProcessErrorHandlers();
  }

  start = async (): Promise<void> => {
    if (this.initialized) {
      this.log.info('Server already initialized, skipping startup');
      return;
    }

    this.dbService.connect();
    this.app.initConfig();
    await this.startServers(this.expApp);
    this.initialized = true;
  };

  public static getInstance(): Server {
    if (!Server.instance) {
      const { dbService } = container.cradle;
      Server.instance = new Server({ dbService });
      this.instance.initialized = true;
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
      const httpServer: http.Server = new http.Server(app);
      this.initHTTPServer(httpServer);
      const io = await this.setupSocketIO(httpServer);
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
    this.log.info('Server shutting down...');

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

      // close database connection
      await this.dbService.disconnect();
      await this.cleanupDIContainer();

      if (exitCode !== 0) {
        this.log.info(`Exiting with code ${exitCode}`);
        process.exit(exitCode);
      }
    } catch (error) {
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
            }
          }
        } catch (error) {
          this.log.warn(`Failed to cleanup ${serviceName}:`, error);
        }
      }

      // Clean up queues
      const queueNames = [
        'documentProcessingQueue',
        'emailQueue',
        'eventBusQueue',
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
              this.log.info(`Shutdown ${queueName}`);
            }
          }
        } catch (error) {
          this.log.warn(`Failed to shutdown ${queueName}:`, error);
        }
      }

      // Cleanup shared Redis instance
      try {
        const { RedisService } = await import('@database/redis-setup');
        await RedisService.shutdownSharedInstance();
        this.log.info('Shared Redis instance shutdown');
      } catch (error) {
        this.log.warn('Failed to shutdown shared Redis instance:', error);
      }

      container.dispose();
      this.log.info('DI container disposed');
    } catch (error) {
      this.log.error('Error during DI container cleanup:', error);
    }
  }

  private setupProcessErrorHandlers(): void {
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
        // captureHeapSnapshot();
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
