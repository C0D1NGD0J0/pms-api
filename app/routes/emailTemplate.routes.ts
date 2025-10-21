import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { validateRequest } from '@shared/validations';
import { EmailTemplateController } from '@controllers/EmailTemplateController';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import { requirePermission, isAuthenticated, basicLimiter } from '@shared/middlewares';
import { EmailTemplateValidations } from '@shared/validations/EmailTemplateValidation';

const router = Router();
router.use(basicLimiter());

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
 * @access  Private - Requires invitation read permission (for invitation templates)
 */
router.get(
  '/:cuid/:templateType',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.READ),
  validateRequest({ params: EmailTemplateValidations.templateType }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<EmailTemplateController>('emailTemplateController');
    return controller.getTemplateMetadata(req, res);
  })
);

/**
 * @route   POST /api/email-templates/:cuid/:templateType/render
 * @desc    Render template with provided data and return fully rendered HTML preview
 * @access  Private - Requires invitation send permission (preview before sending)
 */
router.post(
  '/:cuid/:templateType/render',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.SEND),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<EmailTemplateController>('emailTemplateController');
    return controller.renderTemplate(req, res);
  })
);

export default router;
