import * as schemas from './schemas';

export const PaymentValidations = {
  createPayment: schemas.createPayment,
  recordManualPayment: schemas.recordManualPayment,
  createConnectAccount: schemas.createConnectAccount,
  paystackBankAccount: schemas.paystackBankAccount,
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
  cardCheckoutConfirmQuery: schemas.cardCheckoutConfirmQuery,
  listPaymentsQuery: schemas.listPaymentsQuery,
  paymentStatsQuery: schemas.paymentStatsQuery,
};
