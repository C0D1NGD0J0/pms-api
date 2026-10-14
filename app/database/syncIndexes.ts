import mongoose from 'mongoose';
import { createLogger } from '@utils/helpers';

/**
 * Build and align the indexes for every registered model, once, after the database connection
 * is open. This replaces the per-model `Model.syncIndexes()` calls that used to run at import
 * time — those buffered against an unconnected Mongoose (stalling no-DB test runs) and duplicated
 * the same guard across every model file. Each model is synced independently so one failure
 * never blocks the rest.
 *
 * Model registration and the logger are resolved lazily here on purpose: importing this module
 * must stay side-effect-free so it never drags every model into a test's setup graph.
 */
export const syncAllIndexes = async (): Promise<void> => {
  // Registers every model on the default connection before we iterate it, so a model no request
  // path has touched yet still gets its indexes synced.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@models/index');

  const log = createLogger('SyncIndexes');
  const models = Object.values(mongoose.connection.models);
  await Promise.all(
    models.map((model) =>
      model.syncIndexes().catch((error) => {
        log.error(`Failed to sync indexes for ${model.modelName}:`, error);
      })
    )
  );
};
