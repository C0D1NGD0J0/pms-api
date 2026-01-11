import { Types } from 'mongoose';
import {
  ISubscriptionDocument,
  ISubscriptionStatus,
  IPaymentGateway,
} from '@interfaces/subscription.interface';

import { IFindOptions } from './baseDAO.interface';

export interface ISubscriptionDAO {
  updatePlanAndPrice(
    clientId: string | Types.ObjectId,
    planName: 'personal' | 'starter' | 'professional',
    totalMonthlyPrice: number
  ): Promise<ISubscriptionDocument | null>;
  updatePaymentGateway(
    subscriptionId: string | Types.ObjectId,
    paymentGateway: IPaymentGateway,
    paymentGatewayId?: string
  ): Promise<ISubscriptionDocument | null>;
  updateAdditionalSeats(
    clientId: string | Types.ObjectId,
    additionalSeatsCount: number,
    additionalSeatsCost: number
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
  updateTier(
    subscriptionId: string | Types.ObjectId,
    planName: string
  ): Promise<ISubscriptionDocument | null>;
  findByPaymentGatewayId(
    paymentGatewayId: string,
    opts?: IFindOptions
  ): Promise<ISubscriptionDocument | null>;
  updateEndDate(
    subscriptionId: string | Types.ObjectId,
    endDate: Date
  ): Promise<ISubscriptionDocument | null>;
  updatePropertyCount(
    clientId: string | Types.ObjectId,
    delta: number
  ): Promise<ISubscriptionDocument | null>;
  updateSeatCount(
    clientId: string | Types.ObjectId,
    delta: number
  ): Promise<ISubscriptionDocument | null>;
  updateUnitCount(
    clientId: string | Types.ObjectId,
    delta: number
  ): Promise<ISubscriptionDocument | null>;
  bulkExpireSubscriptions(expiredDate?: Date): Promise<number>;
}
