/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace NodeJS {
    interface Global {
      gc(): void;
    }
  }
}
// import fs from 'fs';
import http from 'http';
// import path from 'path';
// import heapdump from 'heapdump';
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
if (envVariables.SERVER.ENV !== 'production') {
  if (typeof (global as any).gc === 'function') {
    (global as any).gc();
  } else {
    console.log('GC not available - make sure you run with --expose-gc flag');
  }
}
interface IConstructor {
  dbService: DatabaseService;
}
// let lastSnapshotTime = 0;
// const SNAPSHOT_COOLDOWN = 5 * 60 * 1000; // 5 minutes in milliseconds

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

  private scheduleMemoryCheck(): void {
    // Was getting memory leaks in the app, so added a memory check
    // to trigger garbage collection if memory usage exceeds a certain threshold
    const memoryCheckInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      // if memory exceeds threshold, trigger GC
      if (heapUsedMB > 1500 && typeof (global as any).gc === 'function') {
        this.log.info('High memory usage detected, running garbage collection');
        (global as any).gc();
      }
    }, 60000); // check every minute
    process.on('beforeExit', () => clearInterval(memoryCheckInterval));
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
    if (envVariables.SERVER.ENV !== 'production') {
      this.scheduleMemoryCheck();
    }
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

    httpServer.listen(this.PORT, () => {
      this.log.info('Server initialized...');
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

      if (exitCode !== 0) {
        this.log.info(`Exiting with code ${exitCode}`);
        process.exit(exitCode);
      }
    } catch (error) {
      this.log.error('Error during shutdown:', error);
      process.exit(1);
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

// function captureHeapSnapshot() {
//   const memoryUsage = process.memoryUsage();
//   const mbUsed = Math.round(memoryUsage.heapUsed / 1024 / 1024);

//   if (mbUsed > 1500) {
//     const heapdumpDir = path.join(process.cwd(), 'heapdump');

//     try {
//       if (!fs.existsSync(heapdumpDir)) {
//         fs.mkdirSync(heapdumpDir, { recursive: true });
//         console.log(`Created heapdump directory at ${heapdumpDir}`);
//       }

//       const snapshotPath = path.join(heapdumpDir, `heapdump-${Date.now()}.heapsnapshot`);

//       heapdump.writeSnapshot(snapshotPath, (err, filename) => {
//         if (err) {
//           console.error('Failed to create heap snapshot', err);
//         } else {
//           console.log(`Heap snapshot written to ${filename}`);
//         }
//       });
//     } catch (error) {
//       console.error('Error in heap snapshot capture:', error);
//     }
//   }
// }

// function monitorMemory() {
//   const memoryUsage = process.memoryUsage();
//   const mbUsed = Math.round(memoryUsage.heapUsed / 1024 / 1024);
//   const mbTotal = Math.round(memoryUsage.heapTotal / 1024 / 1024);
//   const now = Date.now();
//   if (mbUsed > 1500 && now - lastSnapshotTime > SNAPSHOT_COOLDOWN) {
//     captureHeapSnapshot();
//     lastSnapshotTime = now;
//     console.log(`Memory: ${mbUsed}MB / ${mbTotal}MB`);
//   }
// }

// const testfn = setInterval(monitorMemory, 30000); // every minute
// process.on('beforeExit', () => clearInterval(testfn));

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
