import * as schemas from './schemas';

export const PaymentValidations = {
  createPayment: schemas.createPayment,
  recordManualPayment: schemas.recordManualPayment,
  createConnectAccount: schemas.createConnectAccount,
  refundPayment: schemas.refundPayment,
  payoutHistoryQuery: schemas.payoutHistoryQuery,
  updatePayoutScheduleBody: schemas.updatePayoutScheduleBody,
  chargeForMaintenance: schemas.chargeForMaintenance,
  vendorPayoutParams: schemas.vendorPayoutParams,
  cardCheckoutParams: schemas.cardCheckoutParams,
  listPaymentsQuery: schemas.listPaymentsQuery,
};
