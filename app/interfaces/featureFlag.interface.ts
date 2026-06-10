export enum FeatureFlag {
  AI_COMMUNICATION_DRAFT = 'AI_COMMUNICATION_DRAFT',
  AI_MAINTENANCE_TRIAGE = 'AI_MAINTENANCE_TRIAGE',
  AI_INVOICE_SCANNING = 'AI_INVOICE_SCANNING',
  // Disabled by default until HMAC webhook signature verification is implemented (Phase 2).
  // Set FEATURE_INVOICE_WEBHOOK_ENABLED=true only in environments with network-level protection.
  INVOICE_WEBHOOK = 'INVOICE_WEBHOOK',
  ESIGNATURE = 'ESIGNATURE',
  MCP = 'MCP',
  SMS = 'SMS',
}
