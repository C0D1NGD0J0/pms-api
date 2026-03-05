import * as schemas from './schemas';

export const PaymentValidations = {
  createPayment: schemas.createPayment,
  recordManualPayment: schemas.recordManualPayment,
  createConnectAccount: schemas.createConnectAccount,
  refundPayment: schemas.refundPayment,
};
