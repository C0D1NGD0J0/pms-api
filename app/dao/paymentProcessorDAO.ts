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

  /**
   * Find a vendor's payout processor by vuid only.
   * A vendor has one Stripe account regardless of how many clients they're connected to.
   */
  async findByVuid(vuid: string): Promise<IPaymentProcessorDocument | null> {
    return this.findFirst({ vuid, ownerType: 'vendor' });
  }

  /**
   * Create or update a vendor-owned PaymentProcessor record.
   * Uses $setOnInsert for immutable fields (cuid, client) so that a vendor
   * invited by a second client does not overwrite the origin client reference,
   * and does not trigger a Mongoose immutability error.
   */
  async upsertForVendor(
    data: Partial<IPaymentProcessorFormData>
  ): Promise<ModifyResult<IPaymentProcessorDocument> | null> {
    const { vuid, cuid, client, ownerType, accountId, ...statusFields } = data;
    return this.upsert(
      {
        $set: { accountId, ...statusFields },
        $setOnInsert: { cuid, client, vuid, ownerType: 'vendor' },
      } as any,
      { vuid, ownerType: 'vendor' }
    );
  }
}
