import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { PaymentValidations } from '@shared/validations';
import { ROLES } from '@shared/constants/roles.constants';
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
  requireRole,
  idempotency,
  diskUpload,
  scanFile,
} from '@shared/middlewares';

export const router: Router = express.Router();

router.use(isAuthenticated);

router.get(
  '/:cuid/stats',
  basicLimiter(),
  requirePermission(PermissionResource.PAYMENT, PermissionAction.LIST),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getPaymentStats(req, res);
  })
);

router.get(
  '/:cuid/vendor-earnings',
  basicLimiter(),
  requirePermission(PermissionResource.PAYMENT, PermissionAction.LIST),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getVendorEarnings(req, res);
  })
);

router.post(
  '/:cuid/:pytuid/invoice',
  basicLimiter(),
  requirePermission(PermissionResource.PAYMENT, PermissionAction.READ),
  validateRequest({ params: UtilsValidations.cuid.merge(UtilsValidations.pytuid) }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.requestInvoice(req, res);
  })
);

router.get(
  '/:cuid/:pytuid',
  basicLimiter(),
  requirePermission(PermissionResource.PAYMENT, PermissionAction.READ),
  validateRequest({ params: UtilsValidations.cuid.merge(UtilsValidations.pytuid) }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getPayment(req, res);
  })
);

router.get(
  '/:cuid',
  basicLimiter(),
  requirePermission(PermissionResource.PAYMENT, PermissionAction.LIST),
  validateRequest({ params: UtilsValidations.cuid, query: PaymentValidations.listPaymentsQuery }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.listPayments(req, res);
  })
);

// PM-initiated: create a maintenance charge for a tenant on a specific maintenance request.
// Distinct from the tenant self-serve endpoint below.
router.post(
  '/:cuid/maintenance-charge',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  requireNotSuspended,
  requirePermission(PermissionResource.PAYMENT, PermissionAction.CREATE),
  requireVerifiedClient,
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid,
    body: PaymentValidations.chargeForMaintenance,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.chargeForMaintenance(req, res);
  })
);

// Tenant self-serve: idempotently ensure a maintenance charge exists for the calling tenant.
router.post(
  '/:cuid/maintenance-charge/ensure',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  requireNotSuspended,
  requirePermission(PermissionResource.PAYMENT, PermissionAction.CREATE),
  requireActiveTenant('onlinePayments'),
  requireVerifiedClient,
  idempotency,
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.ensureSelfMaintenanceCharge(req, res);
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
  '/:cuid/vendor-payout/:mruid',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  requireNotSuspended,
  requirePermission(PermissionResource.PAYMENT, PermissionAction.CREATE),
  requireVerifiedClient,
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(PaymentValidations.vendorPayoutParams),
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.payVendor(req, res);
  })
);

router.post(
  '/:cuid/manual_entry',
  basicLimiter(),
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
  basicLimiter(),
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
  '/:cuid/:pytuid/card-checkout',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.PAYMENT, PermissionAction.CREATE),
  requireActiveTenant('onlinePayments'),
  requireVerifiedClient,
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(PaymentValidations.cardCheckoutParams),
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.createCardPaymentSession(req, res);
  })
);

router.post(
  '/:cuid/:pytuid/pay',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.PAYMENT, PermissionAction.CREATE),
  requireActiveTenant('onlinePayments'),
  requireVerifiedClient,
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
  basicLimiter(),
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

router.get(
  '/:cuid/payout-account/schedule',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.getPayoutSchedule(req, res);
  })
);

router.patch(
  '/:cuid/payout-account/schedule',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  validateRequest({
    params: UtilsValidations.cuid,
    body: PaymentValidations.updatePayoutScheduleBody,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<PaymentController>('paymentController');
    return controller.updatePayoutSchedule(req, res);
  })
);

// ── Dev-only: manually trigger cron handlers ──────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  router.post(
    '/:cuid/dev/trigger-cron/:jobName',
    isAuthenticated,
    requireRole([ROLES.SUPER_ADMIN]),
    validateRequest({ params: UtilsValidations.cuid.passthrough() }),
    asyncWrapper((req, res) => {
      const controller = req.container.resolve<PaymentController>('paymentController');
      return controller.triggerCronJob(req, res);
    })
  );
}

export default router;
