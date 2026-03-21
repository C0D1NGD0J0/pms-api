import dotenv from 'dotenv';
dotenv.config();
import * as Sentry from '@sentry/node';

Sentry.init({
  sendDefaultPii: true,
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  integrations: [Sentry.expressIntegration()],
  environment: process.env.NODE_ENV || 'development',
  // Lower sample rate in production to reduce noise/cost
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
