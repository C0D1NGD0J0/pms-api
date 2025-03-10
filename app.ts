import dotenv from 'dotenv';
dotenv.config();
import '@di/index';
import hpp from 'hpp';
import cors from 'cors';
import logger from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import { routes } from '@routes/index';
import cookieParser from 'cookie-parser';
import { envVariables } from '@shared/config';
import sanitizer from 'perfect-express-sanitizer';
import mongoSanitize from 'express-mongo-sanitize';
import { httpStatusCodes, createLogger } from '@utils/index';
import express, { urlencoded, Response, Request, Application } from 'express';
import { scopedMiddleware, errorHandlerMiddleware } from '@shared/middlewares';
import { serverAdapter } from '@queues/index';

export interface IAppSetup {
  initConfig(): void;
}

export class App implements IAppSetup {
  private readonly log = createLogger('App');
  protected expApp: Application;

  constructor(expressApp: Application) {
    this.expApp = expressApp;
  }

  initConfig = (): void => {
    this.securityMiddleware(this.expApp);
    this.standardMiddleware(this.expApp);
    this.routes(this.expApp);
  };

  private securityMiddleware(app: Application): void {
    app.use(hpp());
    app.use(helmet());
    app.use(
      sanitizer.clean({
        xss: true,
        noSql: true,
        sql: true,
        level: 5,
      })
    );
    app.use(
      cors({
        credentials: true,
        optionsSuccessStatus: 200,
        origin: envVariables.SERVER.ENV === 'production' ? envVariables.FRONTEND.URL : '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      })
    );
    app.use(mongoSanitize());
  }

  private standardMiddleware(app: Application): void {
    if (process.env.NODE_ENV !== 'production') {
      app.use(logger('dev'));
    }
    app.use(express.json({ limit: '50mb' }));
    app.use(urlencoded({ extended: true, limit: '50mb' }));
    app.use(cookieParser());
    app.use(compression());
    app.use(scopedMiddleware);
  }

  private routes(app: Application) {
    const BASE_PATH = '/api/v1';
    app.use(`${BASE_PATH}/healthcheck`, (req, res) => {
      res.status(200).json({ success: true });
    });
    app.use('/queues', serverAdapter.getRouter());
    app.use(`${BASE_PATH}/auth`, routes.authRoutes);
    // app.use(`${BASE_PATH}/users`, routes.userRoutes);
    // app.use(`${BASE_PATH}/leases`, routes.leaseRoutes);
    // app.use(`${BASE_PATH}/vendors`, routes.vendorRoutes);
    // app.use(`${BASE_PATH}/invites`, routes.inviteRoutes);
    // app.use(`${BASE_PATH}/tenants`, routes.tenantsRoutes);
    // app.use(`${BASE_PATH}/employees`, routes.employeeRoutes);
    // app.use(`${BASE_PATH}/properties`, routes.propertyRoutes);
    // app.use(`${BASE_PATH}/notifications`, routes.notificationRoutes);
    // app.use(`${BASE_PATH}/subscriptions`, routes.subscriptionsRoutes);
    // app.use(`${BASE_PATH}/service-requests`, routes.serviceRequestRoutes);
    app.all('*', (req: Request, res: Response) => {
      // catch-all for non-existing routes
      res.status(httpStatusCodes.NOT_FOUND).json({ message: 'Invalid endpoint.' });
    });
    this.expApp.use(errorHandlerMiddleware);
  }
}
