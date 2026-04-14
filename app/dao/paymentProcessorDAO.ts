import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { ModifyResult, Model } from 'mongoose';
import {
  IPaymentProcessorDocument,
  IPaymentProcessorFormData,
} from '@interfaces/paymentProcessor.interface';

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

  /** Find a vendor's payout processor record by vendor uid + client cuid */
  async findByVuid(vuid: string, cuid: string): Promise<IPaymentProcessorDocument | null> {
    return this.findFirst({ vuid, cuid, ownerType: 'vendor' });
  }

  /** Create or update a vendor-owned PaymentProcessor record */
  async upsertForVendor(
    data: Partial<IPaymentProcessorFormData>
  ): Promise<ModifyResult<IPaymentProcessorDocument> | null> {
    const { vuid, cuid } = data;
    return this.upsert(data as any, { vuid, cuid, ownerType: 'vendor' });
  }
}
