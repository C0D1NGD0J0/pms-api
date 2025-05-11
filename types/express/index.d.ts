import { AwilixContainer } from 'awilix';

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
