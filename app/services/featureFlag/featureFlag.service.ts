import { envVariables } from '@shared/config';
import { FeatureFlag } from '@interfaces/featureFlag.interface';

export class FeatureFlagService {
  isEnabled(flag: FeatureFlag): boolean {
    switch (flag) {
      case FeatureFlag.AI_COMMUNICATION_DRAFT:
        return (
          envVariables.FEATURES.AI_ENABLED && envVariables.FEATURES.AI_COMMUNICATION_DRAFT_ENABLED
        );
      case FeatureFlag.AI_MAINTENANCE_TRIAGE:
        return (
          envVariables.FEATURES.AI_ENABLED && envVariables.FEATURES.AI_MAINTENANCE_TRIAGE_ENABLED
        );
      case FeatureFlag.ESIGNATURE:
        return envVariables.FEATURES.ESIGNATURE_ENABLED;
      case FeatureFlag.SMS:
        return envVariables.FEATURES.SMS_ENABLED;
      case FeatureFlag.MCP:
        return envVariables.FEATURES.MCP_ENABLED;
      default:
        return false;
    }
  }
}
