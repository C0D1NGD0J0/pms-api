import dotenv from 'dotenv';
dotenv.config();
if (process.env.NODE_ENV !== 'test') {
  require('@di/index');
}
import hpp from 'hpp';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { routes } from '@routes/index';
import cookieParser from 'cookie-parser';
import { serverAdapter } from '@queues/index';
import sanitizer from 'perfect-express-sanitizer';
import { DatabaseService } from '@database/index';
import mongoSanitize from 'express-mongo-sanitize';
import { httpStatusCodes, createLogger } from '@utils/index';
import express, { Application, urlencoded, Response, Request } from 'express';
import {
  errorHandlerMiddleware,
  scopedMiddleware,
  contextBuilder,
  requestLogger,
  detectLanguage,
  setUserLanguage,
} from '@shared/middlewares';

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
        level: 3,
      })
    );
    app.use(
      cors({
        credentials: true,
        optionsSuccessStatus: 200,
        methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        origin: 'http://localhost:3000',
      })
    );
    app.use(mongoSanitize());
  }

  private standardMiddleware(app: Application): void {
    if (process.env.NODE_ENV !== 'production') {
      app.use(requestLogger(this.log));
    }
    app.use(express.json({ limit: '50mb' }));
    app.use(urlencoded({ extended: true, limit: '50mb' }));
    app.use(cookieParser());
    app.use(compression());
    app.use(scopedMiddleware);
  }

  private routes(app: Application) {
    const BASE_PATH = '/api/v1';
    app.use(contextBuilder);
    app.use(detectLanguage); // Language detection after context is built
    app.use(setUserLanguage); // User language detection after basic language setup
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
    app.use(`${BASE_PATH}/clients`, routes.clientRoutes);
    // app.use(`${BASE_PATH}/leases`, routes.leaseRoutes);
    // app.use(`${BASE_PATH}/vendors`, routes.vendorRoutes);
    // app.use(`${BASE_PATH}/invites`, routes.inviteRoutes);
    // app.use(`${BASE_PATH}/tenants`, routes.tenantsRoutes);
    // app.use(`${BASE_PATH}/employees`, routes.employeeRoutes);
    app.use(`${BASE_PATH}/properties`, routes.propertyRoutes);
    // app.use(`${BASE_PATH}/notifications`, routes.notificationRoutes);
    // app.use(`${BASE_PATH}/subscriptions`, routes.subscriptionsRoutes);
    // app.use(`${BASE_PATH}/service-requests`, routes.serviceRequestRoutes);
    app.all('*', (req: Request, res: Response) => {
      // catch-all for non-existing routes
      res.status(httpStatusCodes.NOT_FOUND).json({ message: 'Invalid endpoint.' });
    });
  }
}
