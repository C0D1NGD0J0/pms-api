import { ListResultWithPagination, IPaginationQuery } from '@interfaces/index';
import {
  UpdateWriteOpResult,
  AggregateOptions,
  PopulateOptions,
  PipelineStage,
  ClientSession,
  ModifyResult,
  UpdateQuery,
  FilterQuery,
  Document,
  Types,
} from 'mongoose';

/**
 * The IBaseDAO interface defines common data access methods for interacting with a MongoDB collection.
 *
 * @param T - The type of the documents in the collection.
 */
export interface IBaseDAO<T extends Document> {
  /**
   * List documents in the collection that match the filter.
   *
   * @param filter - Query used to filter the documents.
   * @param opts - Optional settings for the query.
   * @returns A promise that resolves to an array of found documents.
   */
  list(
    filter: FilterQuery<T>,
    opts?: { projection?: string | Record<string, any>; populate?: string | Array<string | PopulateOptions> | PopulateOptions } & IPaginationQuery
  ): ListResultWithPagination<T[]>;

  updateMany(
    filter: FilterQuery<T>,
    data: UpdateQuery<T>,
    session?: ClientSession
  ): Promise<UpdateWriteOpResult>;

  /**
   * Find the first document that matches the filter.
   *
   * @param filter - Query used to find the document.
   * @param opts - Optional settings for the query.
   * @returns A promise that resolves to the found document or null if no document is found.
   */
  findFirst(
    filter: FilterQuery<T>,
    opts?: IFindOptions,
    select?: Record<string, number>
  ): Promise<T | null>;

  /**
   * Execute operations within a transaction using the provided session.
   *
   * @param session - The MongoDB session to use for the transaction.
   * @param operations - Async function containing operations to execute in the transaction.
   * @returns A promise that resolves to the result of the operations.
   */
  withTransaction<T>(
    session: ClientSession,
    operations: (session?: ClientSession) => Promise<T>
  ): Promise<T>;

  /**
   * Upsert (update or insert) a document in the collection based on the provided filter.
   *
   * @param data - The data to update or insert.
   * @param filter - Query used to find the document.
   * @param opts - Optional settings for the upsert operation.
   * @returns A promise that resolves to the updated or inserted document.
   */
  upsert(data: UpdateQuery<T>, filter: FilterQuery<T>, opts?: any): Promise<ModifyResult<T> | null>;

  /**
   * Update a document in the collection based on its unique identifier.
   *
   * @param filter - Query used to find the document.
   * @param data - The data to update in the document.
   * @returns A promise that resolves to the updated document or null if no document is found.
   */
  update(filter: FilterQuery<T> | Types.ObjectId, data: UpdateQuery<T>): Promise<T | null>;

  /**
   * Perform an aggregation operation on the collection.
   *
   * @param pipeline - An array of aggregation stages to be executed.
   * @param opts - Optional settings for the aggregation operation.
   * @returns A promise that resolves to an array of documents produced by the aggregation.
   */
  aggregate(pipeline: PipelineStage[], opts?: AggregateOptions): Promise<T[]>;

  /**
   * Update a document in the collection based on its unique identifier.
   *
   * @param id - Query used to find the document.
   * @param data - The data to update in the document.
   * @returns A promise that resolves to the updated document or null if no document is found.
   */
  updateById(id: string, data: UpdateQuery<T>): Promise<T | null>;

  /**
   * Delete a document from the collection by its unique identifier.
   *
   * @param id - The unique identifier of the document to delete.
   * @returns A promise that resolves to true if the document was successfully deleted, or false if not.
   */
  deleteAll(ids: (string | Types.ObjectId)[]): Promise<boolean>;

  /**
   * Delete a document from the collection by its unique identifier.
   *
   * @param id - The unique identifier of the document to delete.
   * @returns A promise that resolves to true if the document was successfully deleted, or false if not.
   */
  deleteById(id: string | Types.ObjectId): Promise<boolean>;

  /**
   * Find a document by its unique identifier.
   *
   * @param id - The unique identifier of the document.
   * @returns A promise that resolves to the found document or null if no document is found.
   */
  findById(id: string | Types.ObjectId): Promise<T | null>;

  /**
   * Count the number of documents in the collection that match the filter.
   *
   * @param filter - Query used to filter the documents.
   * @returns A promise that resolves to the count of documents that match the filter.
   */
  countDocuments(filter: FilterQuery<T>): Promise<number>;

  /**
   * Start a new MongoDB session for transaction operations.
   *
   * @returns A promise that resolves to a new MongoDB session.
   */
  startSession(): Promise<ClientSession>;
  /**
   * Insert a new document into the collection.
   *
   * @param data - The data for the new document.
   * @returns A promise that resolves to the inserted document.
   */
  insert(data: Partial<T>): Promise<T>;

  /**
   * Create a new instance of the document type with the provided data
   * without saving to the database.
   * @param data
   */
  createInstance(data: Partial<T>): T;
}

export interface IFindOptions {
  populate?: string | Array<string | PopulateOptions> | PopulateOptions;
  sort?: Record<string, 1 | -1 | { $meta: 'textScore' }> | string;
  projection?: Record<string, any> | string;
  select?: Record<string, number> | string;
  sortBy?: string;
  limit?: number;
  skip?: number;
}

export interface dynamic<T = unknown> {
  [key: string]: T | undefined;
}

export type dynamicProjection = dynamic<1 | 0>;
