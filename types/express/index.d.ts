import { AwilixContainer } from 'awilix';
import { ICurrentUser } from '@interfaces/user.interface';

declare global {
  namespace Express {
    export interface Request {
      currentuser: ICurrentUser | undefined;
      container: AwilixContainer;
      rawBody: Buffer;
    }

    export interface Response {}
  }
}
