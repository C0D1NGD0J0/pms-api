import express from 'express';
import { asValue } from 'awilix';
import { container } from '@di/index';
import { routes } from '@routes/index';
import cookieParser from 'cookie-parser';
import { db } from '@tests/configs/db.config';
import { contextBuilder } from '@shared/middlewares';

// Initialize test app with routes
const initializeTestApp = () => {
  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(cookieParser());

  // Context middleware
  app.use(contextBuilder);

  // Register routes
  const BASE_PATH = '/api/v1';
  app.use(`${BASE_PATH}/auth`, routes.authRoutes);
  app.use(`${BASE_PATH}/properties`, routes.propertyRoutes);

  // Register app in container
  container.register({
    testApp: asValue(app),
  });

  return app;
};

const setup = async () => {
  console.log('Start!');
  db.connectTestDB();
  initializeTestApp();
};

export default setup;
