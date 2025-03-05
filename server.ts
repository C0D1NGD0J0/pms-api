import http from 'http';
import { DatabaseService, Environments } from '@database/index';
import { envVariables } from '@shared/config';
import express, { Application } from 'express';
import { App, IAppSetup } from '@root/app';
import { createLogger } from '@utils/index';

(global as any).rootDir = __dirname;

class Server {
  private app: IAppSetup;
  private expApp: Application;
  private dbService: DatabaseService;
  private PORT = envVariables.SERVER.PORT;
  private httpServer: http.Server | null = null;
  private readonly log = createLogger('MainServer');
  private readonly SERVER_ENV = envVariables.SERVER.ENV as Environments;

  constructor() {
    this.expApp = express();
    this.app = new App(this.expApp);
  }

  start = async (): Promise<void> => {
    // this.dbService.connect(this.SERVER_ENV);
    this.app.initConfig();
    await this.startServers(this.expApp);
  };

  getAppInstance = () => {
    return { server: this.expApp };
  };

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

const server = new Server();
server.start();
