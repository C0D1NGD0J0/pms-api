import Logger from 'bunyan';
import { envVariables } from '@shared/config';
import { handleMongoError } from '@shared/customErrors';
import { paginateResult, createLogger } from '@utils/index';
import { ListResultWithPagination, IPaginationQuery } from '@interfaces/utils.interface';
import {
  UpdateWriteOpResult,
  AggregateOptions,
  PopulateOptions,
  PipelineStage,
  MongooseError,
  ClientSession,
  ModifyResult,
  UpdateQuery,
  FilterQuery,
  Document,
  Types,
  Model,
} from 'mongoose';

import { IFindOptions, IBaseDAO } from './interfaces/baseDAO.interface';

export class BaseDAO<T extends Document> implements IBaseDAO<T> {
  protected logger: Logger;

  constructor(private model: Model<T>) {
    this.logger = createLogger('BaseDAO');
  }

  /**
   * Handle and log errors, then throw a formatted error.
   *
   * @param error - The error to handle.
   * @throws CustomError - Throws the properly formatted CustomError instance.
   */
  throwErrorHandler(error: Error | MongooseError | any): never {
    const result = handleMongoError(error);
    this.logger.error(result, 'uuu');
    throw result;
  }

  /**
   * Find the first document that matches the filter.
   *
   * @param filter - Query used to find the document.
   * @param opts - Optional settings for the query.
   * @param select - Optional field selection.
   * @returns A promise that resolves to the found document or null if no document is found.
   */
  async findFirst(
    filter: FilterQuery<T>,
    opts?: IFindOptions,
    select?: Record<string, number>
  ): Promise<T | null> {
    try {
      let query: any = this.model.findOne(filter);

      if (select) {
        query = query.select(select);
      } else if (opts?.select) {
        query = query.select(opts.select);
      } else if (opts?.projection) {
        query = query.select(opts.projection);
      }

      if (opts?.sort) query = query.sort(opts.sort);

      if (opts?.populate) {
        if (Array.isArray(opts.populate)) {
          opts.populate.forEach((option) => {
            query = query.populate(option);
          });
        } else {
          query = query.populate(opts.populate);
        }
      }

      return await query.exec();
    } catch (error: any) {
      this.logger.error(error.message);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * List documents in the collection that match the filter.
   *
   * @param filter - Query used to filter the documents.
   * @param options - Optional settings for the query.
   * @param useLean - Whether to return plain objects (true) or Mongoose documents (false). Defaults to false for backward compatibility.
   * @returns A promise that resolves to an array of found documents.
   */
  async list(
    filter: FilterQuery<T>,
    options?: {
      projection?: string | Record<string, any>;
      populate?: string | Array<string | PopulateOptions> | PopulateOptions;
    } & IPaginationQuery,
    useLean = false
  ): ListResultWithPagination<T[]> {
    try {
      let query: any = this.model.find(filter);

      // Add lean() for read-only operations unless populate is used
      if (useLean) {
        query = query.lean();
      }

      if (options?.sort) query = query.sort(options.sort);
      if (options?.skip) query = query.skip(options.skip);
      if (options?.limit) query = query.limit(options.limit);
      if (options?.projection) query = query.select(options.projection);

      if (options?.populate) {
        if (Array.isArray(options.populate)) {
          options.populate.forEach((option: any) => {
            query = query.populate(option);
          });
        } else {
          query = query.populate(options.populate);
        }
      }

      const count = await this.model.countDocuments(filter).exec();
      const result = await query.exec();
      const pagination = paginateResult(count, options?.skip, options?.limit);

      return {
        items: result,
        ...(pagination ? { pagination } : null),
      };
    } catch (error) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Upsert (update or insert) a document in the collection based on the provided filter.
   *
   * @param filter - Query used to find the document.
   * @param data - The data to update or insert.
   * @param options - Optional settings for the upsert operation.
   * @param session - Optional MongoDB session for transactions.
   * @returns A promise that resolves to the updated or inserted document.
   */
  async upsert(
    data: UpdateQuery<T>,
    filter: FilterQuery<T>,
    options?: any,
    session?: ClientSession
  ): Promise<ModifyResult<T> | null> {
    try {
      const queryOptions = {
        new: true,
        upsert: true,
        ...options,
      };

      if (session) {
        const result = await this.model
          .findOneAndUpdate(filter, data, queryOptions)
          .session(session);
        return result;
      }

      return await this.model.findOneAndUpdate(filter, data, queryOptions);
    } catch (error) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Delete multiple documents from the collection by their unique identifiers.
   *
   * @param ids - An array of unique identifiers (strings or ObjectId instances) of the documents to delete.
   * @returns A promise that resolves to true if all documents were successfully deleted, or false if not.
   */
  async deleteAll(ids: (string | Types.ObjectId)[]): Promise<boolean> {
    try {
      const objectIds = ids.map((id) => (typeof id === 'string' ? new Types.ObjectId(id) : id));

      const result = await this.model.deleteMany({ _id: { $in: objectIds } }).exec();
      return result.deletedCount === ids.length;
    } catch (error) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update a document in the collection based on its unique identifier.
   *
   * @param id - The unique identifier of the document to update.
   * @param data - The data to update in the document.
   * @param opts - Optional settings for the update operation.
   * @returns A promise that resolves to the updated document or null if no document is found.
   */
  async updateById(
    id: string,
    updateOperation: UpdateQuery<T>,
    opts?: Record<string, any>,
    session?: ClientSession
  ): Promise<T | null> {
    try {
      const options = { new: true, ...opts };
      let query = this.model.findOneAndUpdate(
        { _id: new Types.ObjectId(id) },
        updateOperation,
        options
      );

      if (session) {
        query = query.session(session);
      }

      return await query.exec();
    } catch (error) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update a document in the collection based on its unique identifier.
   *
   * @param filter - Query used to filter the documents.
   * @param data - The data to update in the document.
   * @param opts - Optional settings for the update operation.
   * @returns A promise that resolves to the updated document or null if no document is found.
   */
  async update(
    filter: FilterQuery<T>,
    updateOperation: UpdateQuery<T>,
    opts?: Record<string, any>,
    session?: ClientSession
  ): Promise<T | null> {
    try {
      const options = { new: true, ...opts, upsert: false };
      let query = this.model.findOneAndUpdate(filter, updateOperation, options);

      if (session) {
        query = query.session(session);
      }

      return await query.exec();
    } catch (error) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Delete a document from the collection.
   * @param query - An object containing key-value pairs to filter the document to delete.
   * @returns A promise that resolves to true if the document was successfully deleted, or false if not.
   */
  async deleteItem(query: Record<string, string | Types.ObjectId>): Promise<boolean> {
    try {
      if (Object.keys(query).length > 0) {
        if (query._id || query.id) {
          query._id = new Types.ObjectId(query._id ?? query.id);
          delete query.id;
        }
        const result = await this.model.deleteOne(query).exec();
        return result.deletedCount === 1;
      }
      return false;
    } catch (error) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Perform an aggregation operation on the collection.
   *
   * @param pipeline - An array of aggregation stages to be executed.
   * @param opts - Optional settings for the aggregation operation.
   * @returns A promise that resolves to an array of documents produced by the aggregation.
   */
  async aggregate(pipeline: PipelineStage[], opts?: AggregateOptions): Promise<T[]> {
    try {
      return await this.model.aggregate(pipeline, opts).exec();
    } catch (error: any) {
      this.logger.error(error.message);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Perform an aggregation operation with cursor support for large datasets.
   *
   * @param pipeline - An array of aggregation stages to be executed.
   * @param opts - Optional settings for the aggregation operation.
   * @returns A cursor for streaming results
   */
  aggregateCursor(pipeline: PipelineStage[], opts?: AggregateOptions) {
    try {
      return this.model.aggregate(pipeline, opts).cursor();
    } catch (error: any) {
      this.logger.error(error.message);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Process aggregation results in batches to prevent memory issues.
   *
   * @param pipeline - An array of aggregation stages to be executed.
   * @param batchSize - Number of documents to process at once (default: 1000)
   * @param processFunc - Function to process each batch of documents
   * @param opts - Optional settings for the aggregation operation.
   */
  async aggregateInBatches<R = T[]>(
    pipeline: PipelineStage[],
    processFunc: (batch: T[]) => Promise<R>,
    batchSize: number = 1000,
    opts?: AggregateOptions
  ): Promise<R[]> {
    const cursor = this.aggregateCursor(pipeline, opts);
    const results: R[] = [];
    let batch: T[] = [];

    try {
      for await (const doc of cursor) {
        batch.push(doc);

        if (batch.length >= batchSize) {
          const result = await processFunc(batch);
          results.push(result);
          batch = [];
        }
      }

      if (batch.length > 0) {
        const result = await processFunc(batch);
        results.push(result);
      }

      return results;
    } catch (error: any) {
      this.logger.error(error.message);
      throw this.throwErrorHandler(error);
    } finally {
      await cursor.close();
    }
  }

  /**
   * Insert a new document into the collection.
   *
   * @param data - The data for the new document.
   * @param session - Optional MongoDB session for transaction support.
   * @returns A promise that resolves to the inserted document.
   */
  async insert(data: Partial<T>, session?: ClientSession): Promise<T> {
    try {
      const result = await this.model.create([{ ...data }], { session: session ?? null });
      return result[0];
    } catch (error) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Create a new instance of the model without saving it to the database.
   *
   * @param data - The data to initialize the document with.
   * @returns A new document instance.
   */
  createInstance(data: Partial<T>): T {
    try {
      const newInstance = new this.model(data);
      return newInstance;
    } catch (error) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find a document by its unique identifier.
   *
   * @param id - The unique identifier of the document.
   * @returns A promise that resolves to the found document or null if no document is found.
   */
  async findById(id: string | Types.ObjectId): Promise<T | null> {
    try {
      const result = await this.model.findById(new Types.ObjectId(id)).exec();
      return result;
    } catch (error: unknown) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Count the number of documents in the collection that match the filter.
   *
   * @param filter - Query used to filter the documents.
   * @returns A promise that resolves to the count of documents that match the filter.
   */
  async countDocuments(filter: FilterQuery<T>): Promise<number> {
    try {
      return await this.model.countDocuments(filter).exec();
    } catch (error: unknown) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update multiple documents that match the filter.
   *
   * @param filter - Query to match documents to update.
   * @param updateOperation - The update operation to perform.
   * @returns A promise that resolves to the result of the update operation.
   */
  async updateMany(
    filter: FilterQuery<T>,
    updateOperation: UpdateQuery<T>,
    session?: ClientSession
  ): Promise<UpdateWriteOpResult> {
    try {
      const result: UpdateWriteOpResult = await this.model
        .updateMany(filter, updateOperation)
        .session(session ?? null)
        .exec();

      return result;
    } catch (error) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Inserts multiple documents in bulk.
   *
   * @param documents - Array of documents to be inserted.
   * @param session - Optional MongoDB session for transaction support.
   * @returns A promise that resolves to the inserted documents.
   */
  async insertMany(documents: Partial<T>[], session?: ClientSession) {
    try {
      return await this.model.insertMany(documents, {
        session: session ?? null,
        ordered: false,
      });
    } catch (error) {
      this.logger.error('Error in insertMany:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Archive a document by setting its deletedAt field to the current date.
   *
   * @param id - The unique identifier of the document to archive.
   * @returns A promise that resolves to true if the document was successfully archived, or false if not.
   */
  async archiveDocument(id: string): Promise<boolean> {
    try {
      const result = await this.model
        .updateOne({ _id: new Types.ObjectId(id) }, { $set: { deletedAt: new Date() } })
        .exec();
      return result.acknowledged && result.modifiedCount === 1;
    } catch (error) {
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Start a new MongoDB session for transaction operations.
   *
   * @returns A promise that resolves to a new MongoDB session.
   */
  async startSession(): Promise<ClientSession> {
    try {
      return await this.model.db.startSession();
    } catch (error) {
      this.logger.error('Error starting MongoDB session:', error);
      throw error;
    }
  }

  /**
   * Execute operations within a transaction using the provided session.
   *
   * @param session - The MongoDB session to use for the transaction.
   * @param operations - Async function containing operations to execute in the transaction.
   * @returns A promise that resolves to the result of the operations.
   */
  async withTransaction<T>(
    session: ClientSession | null,
    operations: (session?: ClientSession) => Promise<T>
  ): Promise<T> {
    try {
      if (!session || envVariables.SERVER.ENV === 'development') {
        return await operations();
      }

      return await session.withTransaction(async () => {
        return await operations(session);
      });
    } catch (error: any) {
      if (
        error.codeName === 'IllegalOperation' &&
        error.message?.includes('Transaction numbers are only allowed')
      ) {
        return await operations(); // Try again without transaction
      }

      // Handle specific MongoDB transaction errors
      if (error.hasErrorLabel && error.hasErrorLabel('TransientTransactionError')) {
        // this.logger.warn('Transient transaction error, operation may be retried');
      }

      if (error.hasErrorLabel && error.hasErrorLabel('UnknownTransactionCommitResult')) {
        // this.logger.warn('Unknown transaction commit result');
      }

      throw error;
    } finally {
      if (session && !session.hasEnded) {
        try {
          await session.endSession();
        } catch (sessionError) {
          this.logger.error('Error ending session:', sessionError);
        }
      }
    }
  }
}
