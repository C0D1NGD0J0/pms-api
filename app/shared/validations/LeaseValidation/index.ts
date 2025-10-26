import {
  ExpiringLeasesQuerySchema,
  SignatureActionSchema,
  LeaseStatsQuerySchema,
  TerminateLeaseSchema,
  ActivateLeaseSchema,
  FilterLeasesSchema,
  CreateLeaseSchema,
  UpdateLeaseSchema,
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
}
