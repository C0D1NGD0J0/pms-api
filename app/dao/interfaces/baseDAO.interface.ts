import {
  UpdateWriteOpResult,
  UpdateQuery,
  Types,
  PopulateOptions,
  PipelineStage,
  ModifyResult,
  FilterQuery,
  Document,
  ClientSession,
  AggregateOptions,
} from 'mongoose';

/**
 * The IBaseDAO interface defines common data access methods for interacting with a MongoDB collection.
 *
 * @param T - The type of the documents in the collection.
 */
export interface IBaseDAO<T extends Document> {
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
   * Upsert (update or insert) a document in the collection based on the provided filter.
   *
   * @param filter - Query used to find the document.
   * @param data - The data to update or insert.
   * @param opts - Optional settings for the upsert operation.
   * @returns A promise that resolves to the updated or inserted document.
   */
  upsert(filter: FilterQuery<T>, data: UpdateQuery<T>, opts?: any): Promise<ModifyResult<T> | null>;

  /**
   * Update a document in the collection based on its unique identifier.
   *
   * @param id - The unique identifier of the document to update.
   * @param data - The data to update in the document.
   * @returns A promise that resolves to the updated document or null if no document is found.
   */
  update(id: string | Types.ObjectId, data: UpdateQuery<T>): Promise<T | null>;

  /**
   * Perform an aggregation operation on the collection.
   *
   * @param pipeline - An array of aggregation stages to be executed.
   * @param opts - Optional settings for the aggregation operation.
   * @returns A promise that resolves to an array of documents produced by the aggregation.
   */
  aggregate(pipeline: PipelineStage[], opts?: AggregateOptions): Promise<T[]>;

  /**
   * List documents in the collection that match the filter.
   *
   * @param filter - Query used to filter the documents.
   * @param opts - Optional settings for the query.
   * @returns A promise that resolves to an array of found documents.
   */
  list(filter: FilterQuery<T>, opts?: IFindOptions): Promise<T[]>;

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
  select?: Record<string, any> | string;
  limit?: number;
  skip?: number;
}

export interface dynamic<T = unknown> {
  [key: string]: T | undefined;
}

export type dynamicProjection = dynamic<1 | 0>;
