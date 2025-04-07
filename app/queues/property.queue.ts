import { BaseQueue } from './base.queue';

interface IConstructor {
  // propertyWorker: PropertyWorker;
}

export class PropertyQueue extends BaseQueue {
  // private readonly propertyWorker: PropertyWorker;
  constructor() {
    super('propertyQueue');
  }
}
