import { AwilixContainer } from 'awilix';
import { IRequestContext } from '@interfaces/utils.interface';
declare global {
  namespace Express {
    export interface Request {
      container: AwilixContainer;
      context: IRequestContext;
      rawBody: Buffer;
    }

    export interface Response {}
  }
}
