import { Types } from 'mongoose';
import {
  ISubscriptionDocument,
  ISubscriptionStatus,
  ISubscriptionTier,
  IPaymentGateway,
} from '@interfaces/subscription.interface';

import { IFindOptions } from './baseDAO.interface';

export interface ISubscriptionDAO {
  updatePaymentGateway(
    subscriptionId: string | Types.ObjectId,
    paymentGateway: IPaymentGateway,
    paymentGatewayId?: string
  ): Promise<ISubscriptionDocument | null>;
  updateTier(
    subscriptionId: string | Types.ObjectId,
    tier: ISubscriptionTier,
    planName: string
  ): Promise<ISubscriptionDocument | null>;
  updateUsage(
    subscriptionId: string | Types.ObjectId,
    properties: number,
    units: number
  ): Promise<ISubscriptionDocument | null>;
  updateStatus(
    subscriptionId: string | Types.ObjectId,
    status: ISubscriptionStatus
  ): Promise<ISubscriptionDocument | null>;
  cancelSubscription(
    subscriptionId: string | Types.ObjectId,
    canceledAt?: Date
  ): Promise<ISubscriptionDocument | null>;
  findByPaymentGatewayId(
    paymentGatewayId: string,
    opts?: IFindOptions
  ): Promise<ISubscriptionDocument | null>;
  updateEndDate(
    subscriptionId: string | Types.ObjectId,
    endDate: Date
  ): Promise<ISubscriptionDocument | null>;
  bulkExpireSubscriptions(expiredDate?: Date): Promise<number>;
}
