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
      case FeatureFlag.AI_INVOICE_SCANNING:
        return (
          envVariables.FEATURES.AI_ENABLED && envVariables.FEATURES.AI_INVOICE_SCANNING_ENABLED
        );
      case FeatureFlag.PUSH_NOTIFICATIONS:
        return envVariables.FEATURES.PUSH_NOTIFICATIONS_ENABLED;
      case FeatureFlag.INVOICE_WEBHOOK:
        return envVariables.FEATURES.INVOICE_WEBHOOK_ENABLED;
      case FeatureFlag.ESIGNATURE:
        return envVariables.FEATURES.ESIGNATURE_ENABLED;
      case FeatureFlag.SMS:
        return envVariables.FEATURES.SMS_ENABLED;
      case FeatureFlag.MCP:
        return envVariables.FEATURES.MCP_ENABLED;
      default: {
        // Exhaustiveness guard: a new FeatureFlag enum value was added without a case here.
        // Throwing makes this immediately visible in dev/test rather than silently disabling
        // the feature everywhere in production.
        const unhandled: never = flag;
        throw new Error(`Unhandled feature flag: ${String(unhandled)}`);
      }
    }
  }
}
