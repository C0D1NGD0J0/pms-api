import express, { Application, Express } from 'express';
import http from 'http';

(global as any).rootDir = __dirname;

class Server {
  private log;
  private expApp: Application;
  private PORT = process.env.PORT;

  constructor() {
    this.expApp = express();
  }

  start = (): void => {};

  getAppInstance = () => {
    return { server: this.expApp };
  };
}

const server = new Server();
server.start();
export const app = server.getAppInstance().server;
