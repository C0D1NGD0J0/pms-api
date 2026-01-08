import { Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { Subscription } from '@models/index';
import { ISubscriptionDocument } from '@interfaces/subscription.interface';

import { BaseDAO } from './baseDAO';
import { IFindOptions } from './interfaces/baseDAO.interface';
import { ISubscriptionDAO } from './interfaces/subscriptionDAO.interface';

export class SubscriptionDAO extends BaseDAO<ISubscriptionDocument> implements ISubscriptionDAO {
  constructor() {
    super(Subscription);
    this.logger = createLogger('SubscriptionDAO');
  }

  /**
   * Find subscription by payment gateway ID (Stripe subscription ID, etc.)
   */
  async findByPaymentGatewayId(
    paymentGatewayId: string,
    opts?: IFindOptions
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.findFirst({ paymentGatewayId }, opts);
    } catch (error) {
      this.logger.error({ error, paymentGatewayId }, 'Error finding subscription by gateway ID');
      this.throwErrorHandler(error);
    }
  }

  /**
   * Update subscription status
   */
  async updateStatus(
    subscriptionId: string | Types.ObjectId,
    status: 'active' | 'inactive'
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.update(
        { _id: new Types.ObjectId(subscriptionId) },
        {
          $set: { status },
        }
      );
    } catch (error) {
      this.logger.error({ error, subscriptionId, status }, 'Error updating subscription status');
      this.throwErrorHandler(error);
    }
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(
    subscriptionId: string | Types.ObjectId,
    canceledAt: Date = new Date()
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.update(
        { _id: new Types.ObjectId(subscriptionId) },
        {
          $set: {
            status: 'inactive',
            canceledAt,
          },
        }
      );
    } catch (error) {
      this.logger.error({ error, subscriptionId }, 'Error canceling subscription');
      this.throwErrorHandler(error);
    }
  }

  /**
   * Update payment gateway information
   */
  async updatePaymentGateway(
    subscriptionId: string | Types.ObjectId,
    paymentGateway: 'stripe' | 'paypal' | 'none' | 'paystack',
    paymentGatewayId?: string
  ): Promise<ISubscriptionDocument | null> {
    try {
      const updateData: any = { paymentGateway };
      if (paymentGatewayId) {
        updateData.paymentGatewayId = paymentGatewayId;
      }
      return await this.update(
        { _id: new Types.ObjectId(subscriptionId) },
        {
          $set: updateData,
        }
      );
    } catch (error) {
      this.logger.error({ error, subscriptionId }, 'Error updating payment gateway');
      this.throwErrorHandler(error);
    }
  }

  /**
   * Update subscription tier
   */
  async updateTier(
    subscriptionId: string | Types.ObjectId,
    planName: 'free' | 'business' | 'enterprise' | 'individual'
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.update(
        { _id: new Types.ObjectId(subscriptionId) },
        {
          $set: { planName },
        }
      );
    } catch (error) {
      this.logger.error({ error, subscriptionId, planName }, 'Error updating subscription tier');
      this.throwErrorHandler(error);
    }
  }

  /**
   * Update subscription end date
   */
  async updateEndDate(
    subscriptionId: string | Types.ObjectId,
    endDate: Date
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.update(
        { _id: new Types.ObjectId(subscriptionId) },
        {
          $set: { endDate },
        }
      );
    } catch (error) {
      this.logger.error({ error, subscriptionId, endDate }, 'Error updating end date');
      this.throwErrorHandler(error);
    }
  }

  /**
   * Update both property and unit counts
   */
  async updateUsage(
    subscriptionId: string | Types.ObjectId,
    properties: number,
    units: number
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.update(
        { _id: new Types.ObjectId(subscriptionId) },
        {
          $set: {
            currentProperties: properties,
            currentUnits: units,
          },
        }
      );
    } catch (error) {
      this.logger.error({ error, subscriptionId, properties, units }, 'Error updating usage');
      this.throwErrorHandler(error);
    }
  }

  /**
   * Bulk expire subscriptions past their end date
   */
  async bulkExpireSubscriptions(expiredDate: Date = new Date()): Promise<number> {
    try {
      const result = await this.updateMany(
        {
          endDate: { $lt: expiredDate },
          status: 'active',
        },
        {
          $set: {
            status: 'inactive',
          },
        }
      );

      this.logger.info({ modifiedCount: result.modifiedCount }, 'Bulk expired subscriptions');
      return result.modifiedCount;
    } catch (error) {
      this.logger.error({ error, expiredDate }, 'Error bulk expiring subscriptions');
      this.throwErrorHandler(error);
    }
  }
}
