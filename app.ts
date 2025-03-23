import dotenv from 'dotenv';
dotenv.config();
if (process.env.NODE_ENV !== 'test') {
  require('@di/index');
}
import hpp from 'hpp';
import cors from 'cors';
import logger from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import { routes } from '@routes/index';
import cookieParser from 'cookie-parser';
import { envVariables } from '@shared/config';
import { serverAdapter } from '@queues/index';
import sanitizer from 'perfect-express-sanitizer';
import { DatabaseService } from '@database/index';
import mongoSanitize from 'express-mongo-sanitize';
import { httpStatusCodes, createLogger } from '@utils/index';
import express, { urlencoded, Response, Request, Application } from 'express';
import { scopedMiddleware, errorHandlerMiddleware } from '@shared/middlewares';

export interface IAppSetup {
  initConfig(): void;
}

export class App implements IAppSetup {
  private readonly log = createLogger('App');
  private readonly db: DatabaseService;
  protected expApp: Application;

  constructor(expressApp: Application, dbService: DatabaseService) {
    this.expApp = expressApp;
    this.db = dbService;
  }

  initConfig = (): void => {
    this.securityMiddleware(this.expApp);
    this.standardMiddleware(this.expApp);
    this.routes(this.expApp);
    this.expApp.use(errorHandlerMiddleware);
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
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        origin: envVariables.SERVER.ENV !== 'production' ? envVariables.FRONTEND.URL : '*',
      })
    );
    app.use(mongoSanitize());
  }

  private standardMiddleware(app: Application): void {
    if (process.env.NODE_ENV !== 'production') {
      app.use(logger('dev'));
    }
    app.use((req, res, next) => {
      // Fix common content-type error
      const contentType = req.headers['content-type'];
      if (contentType === 'applicationjson') {
        req.headers['content-type'] = 'application/json';
        console.log('Fixed malformed Content-Type header');
      }
      next();
    });
    app.use(express.json({ limit: '50mb' }));
    app.use(urlencoded({ extended: true, limit: '50mb' }));
    app.use(cookieParser());
    app.use(compression());
    app.use(scopedMiddleware);
  }

  private routes(app: Application) {
    const BASE_PATH = '/api/v1';
    app.use((req, _res, next) => {
      console.log(req.body, '-----debug');
      next();
    });
    app.use(`${BASE_PATH}/healthcheck`, (req, res) => {
      const healthCheck = {
        uptime: process.uptime(),
        message: 'OK',
        timestamp: Date.now(),
        database: this.db.isConnected() ? 'Connected' : 'Disconnected',
      };
      res.status(200).json(healthCheck);
    });
    app.use(`${BASE_PATH}/queues`, serverAdapter.getRouter());
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
  }
}
