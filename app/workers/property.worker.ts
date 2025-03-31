import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';

export class PropertyWorker {
  log: Logger;

  constructor() {
    this.log = createLogger('propertyWorker');
  }
}
