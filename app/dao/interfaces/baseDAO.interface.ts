import { ListResultWithPagination, IPaginationQuery } from '@interfaces/index';
import {
  UpdateWriteOpResult,
  AggregateOptions,
  type QueryFilter,
  PopulateOptions,
  PipelineStage,
  ClientSession,
  ModifyResult,
  UpdateQuery,
  Document,
  Types,
} from 'mongoose';

export interface IBaseDAO<T extends Document> {
  list(
    filter: QueryFilter<T>,
    opts?: {
      projection?: string | Record<string, any>;
      populate?: string | Array<string | PopulateOptions> | PopulateOptions;
    } & IPaginationQuery,
    useLean?: boolean,
    session?: ClientSession
  ): ListResultWithPagination<T[]>;

  findFirst(
    filter: QueryFilter<T>,
    opts?: IFindOptions,
    select?: Record<string, number>,
    session?: ClientSession
  ): Promise<T | null>;

  updateMany(
    filter: QueryFilter<T>,
    data: UpdateQuery<T>,
    session?: ClientSession
  ): Promise<UpdateWriteOpResult>;

  withTransaction<T>(
    session: ClientSession,
    operations: (session?: ClientSession) => Promise<T>
  ): Promise<T>;

  upsert(data: UpdateQuery<T>, filter: QueryFilter<T>, opts?: any): Promise<ModifyResult<T> | null>;

  update(filter: QueryFilter<T> | Types.ObjectId, data: UpdateQuery<T>): Promise<T | null>;

  findById(id: string | Types.ObjectId, session?: ClientSession): Promise<T | null>;

  countDocuments(filter: QueryFilter<T>, session?: ClientSession): Promise<number>;

  aggregate(pipeline: PipelineStage[], opts?: AggregateOptions): Promise<T[]>;

  updateById(id: string, data: UpdateQuery<T>): Promise<T | null>;

  deleteAll(ids: (string | Types.ObjectId)[]): Promise<boolean>;

  deleteItem(query: Record<string, string>): Promise<boolean>;

  startSession(): Promise<ClientSession>;
  insert(data: Partial<T>): Promise<T>;

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
