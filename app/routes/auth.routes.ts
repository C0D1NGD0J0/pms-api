import express, { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { AuthController } from '@controllers/index';
import { validateRequest } from '@shared/validations';
import { AuthValidations } from '@shared/validations/AuthValidation';

const router: Router = express.Router();

router.post(
  '/signup',
  validateRequest({ body: AuthValidations.signup }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.signup(req, res);
  })
);

router.put(
  '/account_activation/:token',
  validateRequest({
    params: AuthValidations.activationToken,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.accountActivation(req, res);
  })
);

router.put(
  '/resend_activation_link',
  validateRequest({
    body: AuthValidations.emailValidation,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.sendActivationLink(req, res);
  })
);

router.post(
  '/forgot_password',
  validateRequest({
    body: AuthValidations.emailValidation,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.forgotPassword(req, res);
  })
);

router.put(
  '/reset_password',
  validateRequest({
    body: AuthValidations.resetPassword,
  }),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.resetPassword(req, res);
  })
);

export default router;
