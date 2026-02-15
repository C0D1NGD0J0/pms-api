import Logger from 'bunyan';
import { Model } from 'mongoose';
import { createLogger } from '@utils/index';
import { IPaymentProcessorDocument } from '@interfaces/paymentProcessor.interface';

import { BaseDAO } from './baseDAO';

export class PaymentProcessorDAO extends BaseDAO<IPaymentProcessorDocument> {
  protected logger: Logger;

  constructor({
    paymentProcessorModel,
  }: {
    paymentProcessorModel: Model<IPaymentProcessorDocument>;
  }) {
    super(paymentProcessorModel);
    this.logger = createLogger('PaymentProcessorDAO');
  }
}
