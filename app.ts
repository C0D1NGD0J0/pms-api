/* eslint-disable @typescript-eslint/no-explicit-any */
import dotenv from 'dotenv';
dotenv.config();
import express, { Application, Express, urlencoded } from 'express';
import cors from 'cors';
import logger from 'morgan';
import cookieParser from 'cookie-parser';
import db from '@database/index';
import helmet from 'helmet';
import hpp from 'hpp';
import compression from 'compression';

import routes from '@routes/index';
import { createLogger } from '@utils/helperFN';
import { dbErrorHandler } from '@utils/middlewares';
import { serverAdapter } from '@root/app/queues/base.queue';
import { spawn } from 'child_process';

export class App {
  private log;
  protected app: Application;

  constructor(app: Application) {
    this.app = app;
    this.log = createLogger('MainApp', true);
  }

  setupConfig = (): void => {
    this.databaseConnection();
    this.securityMiddleware(this.app);
    this.standardMiddleware(this.app);
    this.routes(this.app);
    this.appErroHandler(this.app);
  };

  private databaseConnection(): void {
    if (process.env.NODE_ENV !== 'test') {
      db.connect();
    }
  }

  private securityMiddleware(app: Application): void {
    app.use(hpp());
    app.use(helmet());
    app.use(
      cors({
        origin: [
          'localhost',
          'http://localhost:3000',
          'https://my-property-fe.vercel.app',
        ],
        optionsSuccessStatus: 200,
        credentials: true,
      })
    );
  }

  private standardMiddleware(app: Application): void {
    if (process.env.NODE_ENV !== 'production') {
      app.use(logger('dev'));
    }
    app.use(express.json({ limit: '50mb' }));
    app.use(urlencoded({ extended: true, limit: '50mb' }));
    app.use(cookieParser());
    app.use(compression());
  }

  private routes(app: Application) {
    const BASE_PATH = '/api/v1';

    app.use('/queues', serverAdapter.getRouter());
    app.use(`${BASE_PATH}/auth`, routes.authRoutes);
    app.use(`${BASE_PATH}/users`, routes.userRoutes);
    app.use(`${BASE_PATH}/invites`, routes.inviteRoutes);
    app.use(`${BASE_PATH}/leases`, routes.leaseRoutes);
    app.use(`${BASE_PATH}/properties`, routes.propertyRoutes);
    app.use(`${BASE_PATH}/reports`, routes.reportRoutes);
    app.use(`${BASE_PATH}/subscriptions`, routes.subscriptionsRoutes);
    app.use(`${BASE_PATH}/notifications`, routes.notificationRoutes);
  }

  private appErroHandler(app: Application): void {
    app.use(dbErrorHandler);

    process.on('uncaughtException', (err: any) => {
      console.log(err);
      this.log.error('There was an uncaught error exception: ', err.message);
      this.serverShutdown(1);
      // const PORT = process.env.PORT || 5000;
      // if (err.code === 'EADDRINUSE') {
      //   console.error(`Port ${PORT} is in use, attempting to free it...`);

      //   // For macOS or Linux, adjust for Windows if necessary
      //   const child = spawn('lsof', ['-ti', `:${PORT}`]);
      //   child.stdout.on('data', (data) => {
      //     const pid = data.toString().trim();
      //     console.log('------WWW', pid);
      //     if (pid) {
      //       spawn('kill', ['-9', pid]);
      //     }
      //   });
      // }
    });

    process.on('unhandledRejection', (err: Error) => {
      this.log.error('There was an unhandled rejection error: ', err);
      this.serverShutdown(2);
    });

    process.on('SIGTERM', (err: Error) => {
      this.log.error('There was a SIGTERM error: ', err.message);
    });
  }

  private serverShutdown(exitCode: number): void {
    Promise.resolve()
      .then(() => {
        this.log.info('Shutdown complete.');
        process.exit(exitCode);
      })
      .catch((error: Error) => {
        this.log.error('Error occured during shutdown: ', error.message);
        process.exit(1);
      });
  }
}
