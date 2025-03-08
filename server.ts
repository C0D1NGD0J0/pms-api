import http from 'http';
import { container } from '@di/index';
import { IAppSetup, App } from '@root/app';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import express, { Application } from 'express';
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

  constructor({ dbService }: IConstructor) {
    this.expApp = express();
    this.dbService = dbService;
    this.app = new App(this.expApp);
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

    // unhandled promise rejection
    process.once('unhandledRejection', (err: any) => {
      this.log.error(`Error: ${err.message}`);
      httpServer.close(() => process.exit(1));
    });
  }
}

const dbService = container.resolve('dbService');
const server = new Server({ dbService });
server.start();

export const serverInstance = server.getInstance();
