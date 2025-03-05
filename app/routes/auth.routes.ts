import express, { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { AuthController } from '@controllers/index';
import { validateRequest } from '@shared/validations';
import { AuthValidations } from '@shared/validations/AuthValidation';

const router: Router = express.Router();

router.post(
  '/signup',
  validateRequest(AuthValidations.signup),
  asyncWrapper((req, res) => {
    const authController = req.container.resolve<AuthController>('authController');
    return authController.signup(req, res);
  })
);

export default router;
