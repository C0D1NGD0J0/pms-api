import { Types } from 'mongoose';
import { createLogger } from '@utils/index';
import { Subscription } from '@models/index';
import {
  IPaymentGatewayProvider,
  ISubscriptionDocument,
  ISubscriptionStatus,
  IPaymentGateway,
} from '@interfaces/subscription.interface';

import { BaseDAO } from './baseDAO';
import { IFindOptions } from './interfaces/baseDAO.interface';
import { ISubscriptionDAO } from './interfaces/subscriptionDAO.interface';

export class SubscriptionDAO extends BaseDAO<ISubscriptionDocument> implements ISubscriptionDAO {
  constructor() {
    super(Subscription);
    this.logger = createLogger('SubscriptionDAO');
  }

  /**
   * Find subscription by payment gateway ID (Stripe customer ID, etc.)
   */
  async findByPaymentGatewayId(
    paymentGatewayId: string,
    opts?: IFindOptions
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.findFirst({ 'paymentGateway.id': paymentGatewayId }, opts);
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
    status: 'active' | 'inactive' | 'pending_payment'
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

  async downgradeToStarter(
    subscriptionId: string | Types.ObjectId
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.update(
        { _id: new Types.ObjectId(subscriptionId) },
        {
          $set: {
            planName: 'starter',
            status: 'active',
            totalMonthlyPrice: 0,
            pendingDowngradeAt: null,
            paymentGateway: {
              id: 'none',
              provider: 'none',
              planId: 'none',
            },
          },
        }
      );
    } catch (error) {
      this.logger.error({ error, subscriptionId }, 'Error downgrading subscription');
      this.throwErrorHandler(error);
    }
  }

  async activateEssentialPlan(
    subscriptionId: string | Types.ObjectId
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.update(
        { _id: new Types.ObjectId(subscriptionId) },
        {
          $set: {
            planName: 'essential',
            status: ISubscriptionStatus.ACTIVE,
            totalMonthlyPrice: 0,
            pendingDowngradeAt: null,
            'billing.subscriberId': null,
            'billing.customerId': null,
            'billing.provider': IPaymentGatewayProvider.NONE,
          },
        }
      );
    } catch (error) {
      this.logger.error({ error, subscriptionId }, 'Error activating essential plan');
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
    paymentGateway: IPaymentGateway
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.update(
        { _id: new Types.ObjectId(subscriptionId) },
        {
          $set: { paymentGateway },
        }
      );
    } catch (error) {
      this.logger.error({ error, subscriptionId }, 'Error updating payment gateway');
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

  /**
   * Update resource count (property, unit, or seat) with optional limit check
   * @param resourceName - The resource type ('property' | 'propertyUnit' | 'seat')
   * @param clientId - The client ID
   * @param delta - Amount to increment/decrement (positive or negative)
   * @param maxLimit - Optional maximum allowed count (for limit checks during increment)
   * @param session - Optional MongoDB session for transactions
   * @returns ISubscriptionDocument if updated, null if limit reached
   */
  async updateResourceCount(
    resourceName: 'property' | 'propertyUnit' | 'seat',
    clientId: string | Types.ObjectId,
    delta: number,
    maxLimit?: number,
    session?: any
  ): Promise<ISubscriptionDocument | null> {
    try {
      const fieldName = {
        property: 'currentProperties',
        propertyUnit: 'currentUnits',
        seat: 'currentSeats',
      }[resourceName];

      if (maxLimit !== undefined && delta > 0) {
        // Incrementing with max limit check
        const result = await this.update(
          {
            client: new Types.ObjectId(clientId),
            [fieldName]: { $lt: maxLimit },
          },
          { $inc: { [fieldName]: delta } },
          { new: true },
          session
        );
        return result;
      }

      if (delta < 0) {
        // Decrementing - prevent going below zero
        const result = await this.update(
          {
            client: new Types.ObjectId(clientId),
            [fieldName]: { $gte: Math.abs(delta) }, // Ensure current value >= amount to subtract
          },
          { $inc: { [fieldName]: delta } },
          { new: true },
          session
        );
        return result;
      }

      // Incrementing without limit check
      return await this.update(
        { client: new Types.ObjectId(clientId) },
        { $inc: { [fieldName]: delta } },
        { new: true },
        session
      );
    } catch (error) {
      this.logger.error(
        { error, resourceName, clientId, delta, maxLimit },
        'Error updating resource count'
      );
      this.throwErrorHandler(error);
    }
  }

  /**
   * Update plan and price
   */
  async updatePlanAndPrice(
    clientId: string | Types.ObjectId,
    planName: 'essential' | 'growth' | 'portfolio',
    totalMonthlyPrice: number
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.update(
        { client: new Types.ObjectId(clientId) },
        {
          $set: {
            planName,
            totalMonthlyPrice,
          },
        }
      );
    } catch (error) {
      this.logger.error(
        { error, clientId, planName, totalMonthlyPrice },
        'Error updating plan and price'
      );
      this.throwErrorHandler(error);
    }
  }

  /**
   * Update additional seats
   */
  async updateAdditionalSeats(
    clientId: string | Types.ObjectId,
    additionalSeatsCount: number,
    additionalSeatsCost: number
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.update(
        { client: new Types.ObjectId(clientId) },
        {
          $set: {
            additionalSeatsCount,
            additionalSeatsCost,
          },
        }
      );
    } catch (error) {
      this.logger.error(
        { error, clientId, additionalSeatsCount, additionalSeatsCost },
        'Error updating additional seats'
      );
      this.throwErrorHandler(error);
    }
  }

  async setPendingDowngrade(
    subscriptionId: string | Types.ObjectId,
    pendingDowngradeAt: Date
  ): Promise<ISubscriptionDocument | null> {
    try {
      return await this.update(
        { _id: new Types.ObjectId(subscriptionId) },
        {
          $set: { pendingDowngradeAt },
        }
      );
    } catch (error) {
      this.logger.error({ error, subscriptionId }, 'Error setting pending downgrade');
      this.throwErrorHandler(error);
    }
  }

  /**
   * Find all subscriptions pending downgrade past the threshold
   */
  async findPendingDowngrades(thresholdDate: Date): Promise<ISubscriptionDocument[]> {
    try {
      const result = await this.list({
        status: 'pending_payment',
        pendingDowngradeAt: { $lte: thresholdDate },
      });

      return result.items;
    } catch (error) {
      this.logger.error({ error, thresholdDate }, 'Error finding pending downgrades');
      this.throwErrorHandler(error);
    }
  }
}
