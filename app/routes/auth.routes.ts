import express, { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { AuthController } from '@controllers/index';
import { isAuthenticated } from '@shared/middlewares';
import { validateRequest, AuthValidations } from '@shared/validations';

const router: Router = express.Router();

router.post(
  '/signup',
  validateRequest({ body: AuthValidations.signup }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.signup(req, res);
  })
);

router.post(
  '/login',
  validateRequest({
    body: AuthValidations.login,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.login(req, res);
  })
);

router.get(
  '/:cid/me',
  isAuthenticated,
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.getCurrentUser(req, res);
  })
);

router.put(
  '/:cid/account_activation',
  validateRequest({
    query: AuthValidations.activationToken,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.accountActivation(req, res);
  })
);

router.put(
  '/resend_activation_link',
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
  validateRequest({
    body: AuthValidations.resendActivation,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.switchClientAccount(req, res);
  })
);

router.put(
  '/forgot_password',
  validateRequest({
    body: AuthValidations.emailValidation,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.forgotPassword(req, res);
  })
);

router.post(
  '/reset_password',
  validateRequest({
    body: AuthValidations.resetPassword,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.resetPassword(req, res);
  })
);

router.delete(
  '/:cid/logout',
  isAuthenticated,
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.logout(req, res);
  })
);

router.post(
  '/refresh_token',
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.refreshToken(req, res);
  })
);

export default router;
