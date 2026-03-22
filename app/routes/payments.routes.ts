import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { PaymentValidations } from '@shared/validations';
import { PaymentController } from '@controllers/PaymentController';
import { UtilsValidations, validateRequest } from '@shared/validations';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  requireVerifiedClient,
  requirePermission,
  isAuthenticated,
  basicLimiter,
  idempotency,
  diskUpload,
  scanFile,
} from '@shared/middlewares';

export const router: Router = express.Router();

router.use(basicLimiter());

router.get(
  '/:cuid/stats',
  isAuthenticated,
  requirePermission(PermissionResource.PAYMENT, PermissionAction.LIST),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getPaymentStats(req, res);
  })
);

router.get(
  '/:cuid/:pytuid',
  isAuthenticated,
  requirePermission(PermissionResource.PAYMENT, PermissionAction.READ),
  validateRequest({ params: UtilsValidations.cuid.merge(UtilsValidations.pytuid) }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getPayment(req, res);
  })
);

router.get(
  '/:cuid',
  isAuthenticated,
  requirePermission(PermissionResource.PAYMENT, PermissionAction.LIST),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.listPayments(req, res);
  })
);

router.post(
  '/:cuid',
  isAuthenticated,
  requirePermission(PermissionResource.PAYMENT, PermissionAction.CREATE),
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
  isAuthenticated,
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
  isAuthenticated,
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
  isAuthenticated,
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.PAYMENT, PermissionAction.UPDATE),
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
  '/:cuid/payout-account',
  isAuthenticated,
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
  isAuthenticated,
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
  isAuthenticated,
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getAccountUpdateLink(req, res);
  })
);

router.get(
  '/:cuid/payout-account/dashboard',
  isAuthenticated,
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getLoginLink(req, res);
  })
);

export default router;
