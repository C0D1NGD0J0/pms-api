import * as schemas from './schemas';

export const PaymentValidations = {
  createPayment: schemas.createPayment,
  recordManualPayment: schemas.recordManualPayment,
  createConnectAccount: schemas.createConnectAccount,
  refundPayment: schemas.refundPayment,
  cancelPayment: schemas.cancelPayment,
  releaseDeposit: schemas.releaseDeposit,
  reviewPayment: schemas.reviewPayment,
  payoutHistoryQuery: schemas.payoutHistoryQuery,
  updatePayoutScheduleBody: schemas.updatePayoutScheduleBody,
  chargeForMaintenance: schemas.chargeForMaintenance,
  vendorPayoutParams: schemas.vendorPayoutParams,
  cardCheckoutParams: schemas.cardCheckoutParams,
  cardCheckoutBody: schemas.cardCheckoutBody,
  listPaymentsQuery: schemas.listPaymentsQuery,
};
