import {
  RenewalRequestDecisionSchema,
  VacateRequestDecisionSchema,
  ExpiringLeasesQuerySchema,
  SignatureActionSchema,
  LeaseStatsQuerySchema,
  RenewalRequestSchema,
  TerminateLeaseSchema,
  VacateRequestSchema,
  ActivateLeaseSchema,
  FilterLeasesSchema,
  LeasePreviewSchema,
  LeaseIdParamSchema,
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
  static expiringQuery = ExpiringLeasesQuerySchema;
  static statsQuery = LeaseStatsQuerySchema;
  static previewLease = LeasePreviewSchema;
  static renewLease = RenewLeaseSchema;
  static leaseIdParam = LeaseIdParamSchema;
  static approveLease = ApproveLeaseSchema;
  static rejectLease = RejectLeaseSchema;
  static vacateRequest = VacateRequestSchema;
  static vacateRequestDecision = VacateRequestDecisionSchema;
  static renewalRequest = RenewalRequestSchema;
  static renewalRequestDecision = RenewalRequestDecisionSchema;
}
