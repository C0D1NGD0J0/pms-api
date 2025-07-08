import {
  getInvitationsQuerySchema,
  acceptInvitationSchema,
  revokeInvitationSchema,
  resendInvitationSchema,
  invitationTokenSchema,
  sendInvitationSchema,
  iuidSchema,
} from './schemas';

export class InvitationValidations {
  static sendInvitation = sendInvitationSchema;
  static acceptInvitation = acceptInvitationSchema;
  static revokeInvitation = revokeInvitationSchema;
  static resendInvitation = resendInvitationSchema;
  static getInvitations = getInvitationsQuerySchema;
  static invitationToken = invitationTokenSchema;
  static iuid = iuidSchema;
}
