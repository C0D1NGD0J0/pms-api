import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { InvitationController } from '@controllers/index';
import { PermissionResource, PermissionAction, AppRequest } from '@interfaces/utils.interface';
import {
  InvitationValidations,
  UtilsValidations,
  validateRequest,
} from '@shared/validations/index';
import {
  requirePermission,
  isAuthenticated,
  basicLimiter,
  diskUpload,
  scanFile,
} from '@shared/middlewares';

const router = Router();

router.get(
  '/:cuid/validate_token',
  basicLimiter,
  validateRequest({ params: UtilsValidations.cuid, query: InvitationValidations.invitationToken }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.validateInvitation(req, res);
  })
);

router.post(
  '/:cuid/accept_invite/:token',
  basicLimiter,
  validateRequest({
    params: InvitationValidations.validateTokenAndCuid,
    body: InvitationValidations.acceptInvitation,
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.acceptInvitation(req, res);
  })
);

router.patch(
  '/:cuid/decline_invite/:token',
  basicLimiter,
  validateRequest({
    params: InvitationValidations.validateTokenAndCuid,
    body: InvitationValidations.revokeInvitation,
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.declineInvitation(req, res);
  })
);

router.post(
  '/:cuid/send_invite',
  isAuthenticated,
  basicLimiter,
  requirePermission(PermissionResource.INVITATION, PermissionAction.SEND),
  validateRequest({
    params: UtilsValidations.cuid,
    body: InvitationValidations.sendInvitation,
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.sendInvitation(req, res);
  })
);

router.get(
  '/clients/:cuid',
  isAuthenticated,
  basicLimiter,
  requirePermission(PermissionResource.INVITATION, PermissionAction.LIST),
  validateRequest({
    params: UtilsValidations.cuid,
    query: InvitationValidations.getInvitations,
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.getInvitations(req, res);
  })
);

router.get(
  '/clients/:cuid/stats',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.STATS),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.getInvitationStats(req, res);
  })
);

router.get(
  '/:iuid',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.READ),
  validateRequest({ params: InvitationValidations.iuid }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.getInvitationById(req, res);
  })
);

router.patch(
  '/:cuid/revoke/:iuid',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.REVOKE),
  validateRequest({
    params: InvitationValidations.iuid,
    body: InvitationValidations.revokeInvitation,
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.revokeInvitation(req, res);
  })
);

router.patch(
  '/:cuid/update_invite/:iuid',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.UPDATE),
  validateRequest({
    params: InvitationValidations.iuid,
    body: InvitationValidations.updateInvitation,
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.updateInvitation(req, res);
  })
);

router.patch(
  '/:cuid/resend/:iuid',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.RESEND),
  validateRequest({
    params: InvitationValidations.iuid,
    body: InvitationValidations.resendInvitation,
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.resendInvitation(req, res);
  })
);

router.get(
  '/by-email/:email',
  isAuthenticated,
  validateRequest({ params: UtilsValidations.isUniqueEmail }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.getInvitationsByEmail(req, res);
  })
);

router.post(
  '/:cuid/validate_csv',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.SEND),
  diskUpload(['csv_file']),
  scanFile,
  validateRequest({
    params: UtilsValidations.cuid,
    query: InvitationValidations.bulkCreationQuery,
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.validateInvitationCsv(req, res);
  })
);

router.post(
  '/:cuid/import_invitations_csv',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.SEND),
  diskUpload(['csv_file']),
  scanFile,
  validateRequest({
    params: UtilsValidations.cuid,
    query: InvitationValidations.bulkCreationQuery,
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.importInvitationsFromCsv(req, res);
  })
);

/**
 * @route POST /api/v1/invites/:cuid/process-pending
 * @desc Process pending invitations for a client with optional filters
 * @access Private (Admin/Manager only)
 */
router.patch(
  '/:cuid/process-pending',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.SEND),
  validateRequest({
    params: UtilsValidations.cuid,
    query: InvitationValidations.processPending,
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.processPendingInvitations(req, res);
  })
);

export default router;
