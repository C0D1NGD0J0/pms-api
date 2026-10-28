import dotenv from 'dotenv';
dotenv.config();
import * as Sentry from '@sentry/node';

import { buildSentryOptions } from './app/shared/config/sentry.options';

Sentry.init({
  ...buildSentryOptions(process.env),
  integrations: [Sentry.expressIntegration()],
});
