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

/**
 * @route POST /api/v1/invites/:cuid/send
 * @desc Send an invitation to join a client
 * @access Private (Admin/Manager only)
 */
router.post(
  '/:cuid/send_invite',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.SEND),
  validateRequest({
    params: UtilsValidations.cuid,
    body: InvitationValidations.sendInvitation,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.sendInvitation(req, res);
  })
);

/**
 * @route GET /api/v1/invites/clients/:cuid
 * @desc Get invitations for a client with filtering and pagination
 * @access Private (Admin/Manager only)
 */
router.get(
  '/clients/:cuid',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.LIST),
  validateRequest({
    params: UtilsValidations.cuid,
    query: InvitationValidations.getInvitations,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.getInvitations(req, res);
  })
);

/**
 * @route GET /api/v1/invites/clients/:cuid/stats
 * @desc Get invitation statistics for a client
 * @access Private (Admin/Manager only)
 */
router.get(
  '/clients/:cuid/stats',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.STATS),
  validateRequest({ params: UtilsValidations.cuid }),
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
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.READ),
  validateRequest({ params: InvitationValidations.iuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.getInvitationById(req, res);
  })
);

/**
 * @route PATCH /api/v1/invites/:iuid/revoke
 * @desc Revoke a pending invitation
 * @access Private (Admin/Manager only)
 */
router.patch(
  '/:cuid/revoke/:iuid',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.REVOKE),
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
 * @route PATCH /api/v1/invites/:cuid/update/:iuid
 * @desc Update invitation details (only draft invitations)
 * @access Private (Admin/Manager only)
 */
router.patch(
  '/:cuid/update_invite/:iuid',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.UPDATE),
  validateRequest({
    params: InvitationValidations.iuid,
    body: InvitationValidations.updateInvitation,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.updateInvitation(req, res);
  })
);

/**
 * @route PATCH /api/v1/invites/:iuid/resend
 * @desc Resend an invitation reminder
 * @access Private (Admin/Manager only)
 */
router.patch(
  '/:cuid/resend/:iuid',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.RESEND),
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
  isAuthenticated,
  validateRequest({ params: UtilsValidations.isUniqueEmail }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.getInvitationsByEmail(req, res);
  })
);

/**
 * @route POST /api/v1/invites/:cuid/validate_csv
 * @desc Validate a CSV file for bulk invitation import
 * @access Private (Admin/Manager only)
 */
router.post(
  '/:cuid/validate_csv',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.SEND),
  diskUpload(['csv_file']),
  scanFile,
  validateRequest({
    params: UtilsValidations.cuid,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.validateInvitationCsv(req, res);
  })
);

/**
 * @route POST /api/v1/invites/:cuid/import_invitations_csv
 * @desc Import invitations from a CSV file
 * @access Private (Admin/Manager only)
 */
router.post(
  '/:cuid/import_invitations_csv',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.SEND),
  diskUpload(['csv_file']),
  scanFile,
  validateRequest({
    params: UtilsValidations.cuid,
  }),
  asyncWrapper((req, res) => {
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
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<InvitationController>('invitationController');
    return controller.processPendingInvitations(req, res);
  })
);

export default router;
