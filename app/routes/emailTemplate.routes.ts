import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { requirePermission, isAuthenticated } from '@shared/middlewares';
// import { validateRequest } from '@shared/validations/index';
import { EmailTemplateController } from '@controllers/EmailTemplateController';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
// import { EmailTemplateValidations } from '@shared/validations/EmailTemplateValidation';

const router = Router();

/**
 * @route   GET /api/email-templates
 * @desc    Get list of all available email templates
 * @access  Private
 */
router.get(
  '/',
  isAuthenticated,
  requirePermission(PermissionResource.CLIENT, PermissionAction.SETTINGS),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<EmailTemplateController>('emailTemplateController');
    return controller.getTemplateList(req, res);
  })
);

/**
 * @route   GET /api/email-templates/:templateType
 * @desc    Get detailed template metadata for a specific template type
 * @access  Private
 */
router.get(
  '/:cuid/:templateType',
  isAuthenticated,
  requirePermission(PermissionResource.CLIENT, PermissionAction.SETTINGS),
  // validateRequest({ params: EmailTemplateValidations.templateType }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<EmailTemplateController>('emailTemplateController');
    return controller.getTemplateMetadata(req, res);
  })
);

export default router;
