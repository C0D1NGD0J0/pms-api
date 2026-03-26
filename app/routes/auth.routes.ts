import express, { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { AuthController } from '@controllers/index';
import { isAuthenticated, basicLimiter } from '@shared/middlewares';
import { validateRequest, AuthValidations } from '@shared/validations';

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
    body: AuthValidations.resendActivation,
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

router.delete(
  '/:cuid/logout',
  isAuthenticated,
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.logout(req, res);
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

export default router;
