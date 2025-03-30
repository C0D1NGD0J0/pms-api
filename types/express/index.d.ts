import { ICurrentUser } from '@interfaces/user.interface';
import { AwilixContainer } from 'awilix';

declare global {
  namespace Express {
    export interface Request {
      container: AwilixContainer;
      currentuser: ICurrentUser | undefined;
      rawBody: Buffer;
    }

    export interface Response {}
  }
}
