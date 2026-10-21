import {
  RenewalRequestDecisionSchema,
  VacateRequestDecisionSchema,
  SignatureActionSchema,
  LeaseStatsQuerySchema,
  RenewalRequestSchema,
  TerminateLeaseSchema,
  VacateRequestSchema,
  ActivateLeaseSchema,
  FilterLeasesSchema,
  LeasePreviewSchema,
  ApproveLeaseSchema,
  CreateLeaseSchema,
  UpdateLeaseSchema,
  RejectLeaseSchema,
  RenewLeaseSchema,
} from './schemas';

export class LeaseValidations {
  static createLease = CreateLeaseSchema;
  static updateLease = UpdateLeaseSchema;
  static filterLeases = FilterLeasesSchema;
  static activateLease = ActivateLeaseSchema;
  static terminateLease = TerminateLeaseSchema;
  static signatureAction = SignatureActionSchema;
  static statsQuery = LeaseStatsQuerySchema;
  static previewLease = LeasePreviewSchema;
  static renewLease = RenewLeaseSchema;
  static approveLease = ApproveLeaseSchema;
  static rejectLease = RejectLeaseSchema;
  static vacateRequest = VacateRequestSchema;
  static vacateRequestDecision = VacateRequestDecisionSchema;
  static renewalRequest = RenewalRequestSchema;
  static renewalRequestDecision = RenewalRequestDecisionSchema;
}
