import { AwilixContainer } from 'awilix';

import { CurrentUser } from '../../app/interfaces/user.interface';
// import express from 'express';

declare global {
  namespace Express {
    export interface Request {
      container: AwilixContainer;
      currentuser?: CurrentUser;
      rawBody: Buffer;
    }

    export interface Response {}
  }
}
