import { AwilixContainer } from 'awilix';

declare global {
  namespace Express {
    export interface Request {
      container: AwilixContainer;
      currentuser?: unknown;
      rawBody: Buffer;
    }

    export interface Response {}
  }
}
