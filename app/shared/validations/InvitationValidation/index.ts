import {
  validateTokenAndCuidSchema,
  getInvitationsQuerySchema,
  processPendingQuerySchema,
  acceptInvitationSchema,
  resendInvitationSchema,
  revokeInvitationSchema,
  updateInvitationSchema,
  invitationTokenSchema,
  sendInvitationSchema,
  invitationCsvSchema,
  cuidAndIuidSchema,
  iuidSchema,
} from './schemas';

export class InvitationValidations {
  static acceptInvitation = acceptInvitationSchema;
  static getInvitations = getInvitationsQuerySchema;
  static invitationCsv = invitationCsvSchema;
  static invitationToken = invitationTokenSchema;
  static iuid = iuidSchema;
  static cuidAndIuid = cuidAndIuidSchema;
  static processPending = processPendingQuerySchema;
  static resendInvitation = resendInvitationSchema;
  static revokeInvitation = revokeInvitationSchema;
  static sendInvitation = sendInvitationSchema;
  static updateInvitation = updateInvitationSchema;
  static validateTokenAndCuid = validateTokenAndCuidSchema;
}
