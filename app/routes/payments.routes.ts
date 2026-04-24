import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { PaymentValidations } from '@shared/validations';
import { PaymentController } from '@controllers/PaymentController';
import { UtilsValidations, validateRequest } from '@shared/validations';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  requireVerifiedClient,
  requireNotSuspended,
  requireActiveTenant,
  requirePermission,
  isAuthenticated,
  basicLimiter,
  idempotency,
  diskUpload,
  scanFile,
} from '@shared/middlewares';

export const router: Router = express.Router();

router.use(isAuthenticated, basicLimiter());

router.get(
  '/:cuid/stats',
  requirePermission(PermissionResource.PAYMENT, PermissionAction.LIST),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getPaymentStats(req, res);
  })
);

router.get(
  '/:cuid/:pytuid',
  requirePermission(PermissionResource.PAYMENT, PermissionAction.READ),
  validateRequest({ params: UtilsValidations.cuid.merge(UtilsValidations.pytuid) }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getPayment(req, res);
  })
);

router.get(
  '/:cuid',
  requirePermission(PermissionResource.PAYMENT, PermissionAction.LIST),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.listPayments(req, res);
  })
);

router.post(
  '/:cuid',
  basicLimiter({ max: 50, windowMs: 60 * 60 * 1000 }),
  requireNotSuspended,
  requirePermission(PermissionResource.PAYMENT, PermissionAction.CREATE),
  requireActiveTenant('onlinePayments'),
  requireVerifiedClient,
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid,
    body: PaymentValidations.createPayment,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.createPayment(req, res);
  })
);

router.post(
  '/:cuid/manual_entry',
  requirePermission(PermissionResource.PAYMENT, PermissionAction.CREATE),
  requireVerifiedClient,
  idempotency,
  diskUpload(['receipt.file']),
  scanFile,
  validateRequest({
    params: UtilsValidations.cuid,
    body: PaymentValidations.recordManualPayment,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.recordManualPayment(req, res);
  })
);

router.patch(
  '/:cuid/:pytuid/cancel',
  requirePermission(PermissionResource.PAYMENT, PermissionAction.UPDATE),
  idempotency,
  validateRequest({ params: UtilsValidations.cuid.merge(UtilsValidations.pytuid) }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.cancelPayment(req, res);
  })
);

router.post(
  '/:cuid/:pytuid/refund',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.PAYMENT, PermissionAction.UPDATE),
  requireActiveTenant('onlinePayments'),
  requireVerifiedClient,
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.pytuid),
    body: PaymentValidations.refundPayment,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.refundPayment(req, res);
  })
);

router.post(
  '/:cuid/:pytuid/pay',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.PAYMENT, PermissionAction.CREATE),
  requireActiveTenant('onlinePayments'),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.pytuid),
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.payPendingCharge(req, res);
  })
);

router.post(
  '/:cuid/payout-account',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  requireVerifiedClient,
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid,
    body: PaymentValidations.createConnectAccount,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.createConnectAccount(req, res);
  })
);

router.get(
  '/:cuid/payout-account/onboard',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  requireVerifiedClient,
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getOnboardingLink(req, res);
  })
);

router.get(
  '/:cuid/payout-account/update',
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getAccountUpdateLink(req, res);
  })
);

router.get(
  '/:cuid/payout-account/dashboard',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getLoginLink(req, res);
  })
);

router.get(
  '/:cuid/payout-account/balance',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getPayoutBalance(req, res);
  })
);

router.get(
  '/:cuid/payout-account/history',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  validateRequest({ params: UtilsValidations.cuid, query: PaymentValidations.payoutHistoryQuery }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getPayoutHistory(req, res);
  })
);

export default router;
