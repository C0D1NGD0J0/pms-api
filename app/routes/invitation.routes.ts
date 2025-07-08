import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { InvitationController } from '@controllers/index';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import { requirePermission, isAuthenticated, diskUpload, scanFile } from '@shared/middlewares';
import {
  InvitationValidations,
  UtilsValidations,
  validateRequest,
} from '@shared/validations/index';

const router = Router();

/**
 * @route GET /api/v1/invites/:token/validate
 * @desc Validate an invitation token (public endpoint)
 * @access Public
 */
router.get(
  '/:token/validate',
  validateRequest({ params: InvitationValidations.invitationToken }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.validateInvitation(req, res);
  })
);

/**
 * @route POST /api/v1/invites/:token/accept
 * @desc Accept an invitation and complete user registration (public endpoint)
 * @access Public
 */
router.post(
  '/:token/accept',
  validateRequest({
    params: InvitationValidations.invitationToken,
    body: InvitationValidations.acceptInvitation,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.acceptInvitation(req, res);
  })
);

// Protected routes (authentication required)
// Note: Authentication middleware will be applied at the app level or route group level

/**
 * @route POST /api/v1/invites/:cid/send
 * @desc Send an invitation to join a client
 * @access Private (Admin/Manager only)
 */
router.post(
  '/:cid/send',
  isAuthenticated,
  validateRequest({
    params: UtilsValidations.cid,
    body: InvitationValidations.sendInvitation,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.sendInvitation(req, res);
  })
);

/**
 * @route GET /api/v1/invites/clients/:cid
 * @desc Get invitations for a client with filtering and pagination
 * @access Private (Admin/Manager only)
 */
router.get(
  '/clients/:cid',
  isAuthenticated,
  validateRequest({
    params: UtilsValidations.cid,
    query: InvitationValidations.getInvitations,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.getInvitations(req, res);
  })
);

/**
 * @route GET /api/v1/invites/clients/:cid/stats
 * @desc Get invitation statistics for a client
 * @access Private (Admin/Manager only)
 */
router.get(
  '/clients/:cid/stats',
  validateRequest({ params: UtilsValidations.cid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.getInvitationStats(req, res);
  })
);

/**
 * @route GET /api/v1/invites/:iuid
 * @desc Get invitation details by ID
 * @access Private (Admin/Manager only)
 */
router.get(
  '/:iuid',
  validateRequest({ params: InvitationValidations.iuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.getInvitationById(req, res);
  })
);

/**
 * @route DELETE /api/v1/invites/:iuid/revoke
 * @desc Revoke a pending invitation
 * @access Private (Admin/Manager only)
 */
router.delete(
  '/:iuid/revoke',
  validateRequest({
    params: InvitationValidations.iuid,
    body: InvitationValidations.revokeInvitation,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.revokeInvitation(req, res);
  })
);

/**
 * @route POST /api/v1/invites/:iuid/resend
 * @desc Resend an invitation reminder
 * @access Private (Admin/Manager only)
 */
router.post(
  '/:iuid/resend',
  validateRequest({
    params: InvitationValidations.iuid,
    body: InvitationValidations.resendInvitation,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.resendInvitation(req, res);
  })
);

/**
 * @route GET /api/v1/invites/by-email/:email
 * @desc Get invitations by email (for user's own invitations)
 * @access Private (Self or Admin only)
 */
router.get(
  '/by-email/:email',
  validateRequest({ params: UtilsValidations.isUniqueEmail }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.getInvitationsByEmail(req, res);
  })
);

/**
 * @route POST /api/v1/invites/:cid/validate_csv
 * @desc Validate a CSV file for bulk invitation import
 * @access Private (Admin/Manager only)
 */
router.post(
  '/:cid/validate_csv',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.INVITE),
  diskUpload(['csv_file']),
  scanFile,
  validateRequest({
    params: UtilsValidations.cid,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.validateInvitationCsv(req, res);
  })
);

/**
 * @route POST /api/v1/invites/:cid/import_invitations_csv
 * @desc Import invitations from a CSV file
 * @access Private (Admin/Manager only)
 */
router.post(
  '/:cid/import_invitations_csv',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.INVITE),
  diskUpload(['csv_file']),
  scanFile,
  validateRequest({
    params: UtilsValidations.cid,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.importInvitationsFromCsv(req, res);
  })
);

export default router;
