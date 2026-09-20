import express, { Router } from 'express';
import { EmailQueue } from '@queues/index';
import { asyncWrapper } from '@utils/index';
import { QueueFactory } from '@services/queue';
import { httpStatusCodes } from '@utils/constants';
import { AuthController } from '@controllers/index';
import { validateRequest, AuthValidations } from '@shared/validations';
import { requirePermission, isAuthenticated, basicLimiter } from '@shared/middlewares';
import { PermissionResource, PermissionAction, MailType } from '@interfaces/utils.interface';

const router: Router = express.Router();

router.post(
  '/signup',
  basicLimiter({ max: 5, windowMs: 60 * 60 * 1000 }),
  validateRequest({ body: AuthValidations.signup }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.signup(req, res);
  })
);

router.post(
  '/login',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  validateRequest({
    body: AuthValidations.login,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.login(req, res);
  })
);

router.get(
  '/:cuid/me',
  isAuthenticated,
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.getCurrentUser(req, res);
  })
);

router.patch(
  '/:cuid/account_activation',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  validateRequest({
    query: AuthValidations.activationToken,
    body: AuthValidations.consentBody,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.accountActivation(req, res);
  })
);

router.patch(
  '/resend_activation_link',
  basicLimiter({ max: 3, windowMs: 15 * 60 * 1000 }),
  validateRequest({
    body: AuthValidations.resendActivation,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.sendActivationLink(req, res);
  })
);

router.patch(
  '/switch_client_account',
  isAuthenticated,
  basicLimiter(),
  validateRequest({
    body: AuthValidations.switchClientAccount,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.switchClientAccount(req, res);
  })
);

router.patch(
  '/forgot_password',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  validateRequest({
    body: AuthValidations.emailValidation,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.forgotPassword(req, res);
  })
);

router.patch(
  '/reset_password',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  validateRequest({
    body: AuthValidations.resetPassword,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.resetPassword(req, res);
  })
);

router.patch(
  '/change_password',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  isAuthenticated,
  validateRequest({
    body: AuthValidations.changePassword,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.changePassword(req, res);
  })
);

router.delete(
  '/:cuid/logout',
  basicLimiter(),
  isAuthenticated,
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.logout(req, res);
  })
);

router.post(
  '/:cuid/feedback',
  basicLimiter({ max: 5, windowMs: 60 * 60 * 1000 }),
  isAuthenticated,
  requirePermission(PermissionResource.CLIENT, PermissionAction.READ),
  validateRequest({ body: AuthValidations.feedback }),
  asyncWrapper(async (req, res) => {
    const { category, message, rating } = req.body;
    const currentuser = req.context?.currentuser;
    const { cuid } = req.params;

    const queueFactory = req.container.resolve<QueueFactory>('queueFactory');
    const emailQueue = queueFactory.getQueue('emailQueue') as EmailQueue;

    emailQueue.addToEmailQueue(MailType.USER_FEEDBACK, {
      to: 'support@propertydesk.live',
      requestId: req.context.requestId,
      subject: `[Feedback] ${category} — ${currentuser?.fullname || 'Unknown User'}`,
      emailType: MailType.USER_FEEDBACK,
      data: {
        category,
        message,
        rating: rating || null,
        userName: currentuser?.fullname || 'Unknown',
        userEmail: currentuser?.email || 'N/A',
        userRole: currentuser?.client?.role || 'N/A',
        clientName: currentuser?.client?.displayname || cuid,
      },
    });

    res.status(httpStatusCodes.OK).json({ success: true, message: 'Feedback submitted' });
  })
);

router.post(
  '/refresh_token',
  basicLimiter({ max: 10, windowMs: 5 * 60 * 1000 }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.refreshToken(req, res);
  })
);

router.post(
  '/:cuid/complete_onboarding',
  isAuthenticated,
  basicLimiter(),
  validateRequest({ body: AuthValidations.completeOnboarding }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.completeOnboarding(req, res);
  })
);

router.post(
  '/:cuid/charge_first_payment',
  isAuthenticated,
  basicLimiter({ max: 3, windowMs: 60 * 60 * 1000 }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.chargeFirstPayment(req, res);
  })
);

router.post(
  '/:cuid/setup_payment_intent',
  isAuthenticated,
  basicLimiter(),
  validateRequest({
    body: AuthValidations.setupPaymentIntent,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.setupPaymentIntent(req, res);
  })
);

router.get(
  '/:cuid/payment_method',
  isAuthenticated,
  basicLimiter(),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.getPaymentMethod(req, res);
  })
);

router.delete(
  '/:cuid/payment_method',
  isAuthenticated,
  basicLimiter(),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.removePaymentMethod(req, res);
  })
);

// ── Passkey Discoverable Login (no email required) ─────────────

router.get(
  '/passkeys/auth_options',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.getDiscoverablePasskeyOptions(req, res);
  })
);

router.post(
  '/passkeys/auth_verify',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  validateRequest({ body: AuthValidations.passkeyDiscoverableVerify }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.verifyDiscoverablePasskey(req, res);
  })
);

router.get(
  '/:cuid/passkeys',
  basicLimiter(),
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.listPasskeys(req, res);
  })
);

router.get(
  '/:cuid/passkeys/registration_options',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.getPasskeyRegistrationOptions(req, res);
  })
);

router.post(
  '/:cuid/passkeys/registration_verify',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
  validateRequest({ body: AuthValidations.passkeyRegVerify }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.verifyPasskeyRegistration(req, res);
  })
);

router.delete(
  '/:cuid/passkeys',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.DELETE),
  validateRequest({ body: AuthValidations.passkeyDelete }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.deletePasskey(req, res);
  })
);

export default router;
