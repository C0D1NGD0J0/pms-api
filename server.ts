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
import { Environments, DatabaseService } from '@database/index';

(global as any).rootDir = __dirname;

interface IConstructor {
  dbService: DatabaseService;
}

class Server {
  private app: IAppSetup;
  private expApp: Application;
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
    this.dbService.connect();
    this.app.initConfig();
    await this.startServers(this.expApp);
  };

  getInstance = () => ({ server: this.expApp, dbInstance: this.dbService });

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
      this.log.info(`Server is currently running on port ${this.PORT}`);
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
    container.resolve('baseIO');
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

      // Close Redis clients if they exist
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

      // Close HTTP server
      if (this.httpServer) {
        await new Promise<void>((resolve) => {
          this.httpServer?.close(() => {
            this.log.info('HTTP server closed');
            resolve();
          });
        });
      }

      // Close database connection
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

    // Handle termination signals
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

const dbService = container.resolve('dbService');
const server = new Server({ dbService });
server.start();

export const serverInstance = server.getInstance();
