/**
 * Generic PII redaction utility for stripping personal data from free text.
 * Used by AIService before sending content to external LLMs, and available
 * project-wide for logging, exports, or any route that needs anonymized text.
 *
 * Complements the structured PII handling in DSARService
 * (app/services/dsar/dsar.service.ts) which operates on typed documents.
 */

export interface PIIContext {
  addresses?: string[];
  emails?: string[];
  phones?: string[];
  names?: string[];
}

// Patterns applied in order: most specific first to prevent partial matches
const MONGODB_OBJECTID_PATTERN = /\b[a-f0-9]{24}\b/gi;
const RESOURCE_UID_PATTERN = /\b(?:MR|PY|LS|PR|PU|CL|US|VN|IN|WO)[-_][A-Za-z0-9]{6,12}\b/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const CREDIT_CARD_PATTERN = /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g;
const SSN_SIN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g; // strict US SSN format: XXX-XX-XXXX
const PHONE_PATTERN = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;

/**
 * Redact PII from unstructured text.
 *
 * @param text    The raw text to sanitize
 * @param context Optional known PII values to explicitly scrub (e.g. tenant name from request context)
 * @returns       Text with PII replaced by generic tokens
 */
export function redactPII(text: string, context?: PIIContext): string {
  if (!text) return text;

  let result = text;

  // Phase 1: scrub any explicitly provided PII values first
  if (context) {
    for (const name of context.names ?? []) {
      if (name && name.length > 1) {
        result = result.replace(new RegExp(escapeRegex(name), 'gi'), '[NAME]');
      }
    }
    for (const email of context.emails ?? []) {
      if (email) {
        result = result.replace(new RegExp(escapeRegex(email), 'gi'), '[EMAIL]');
      }
    }
    for (const phone of context.phones ?? []) {
      if (phone) {
        result = result.replace(new RegExp(escapeRegex(phone), 'gi'), '[PHONE]');
      }
    }
    for (const address of context.addresses ?? []) {
      if (address) {
        result = result.replace(new RegExp(escapeRegex(address), 'gi'), '[ADDRESS]');
      }
    }
  }

  // Phase 2: regex-based pattern matching — order matters (most specific first)
  result = result.replace(MONGODB_OBJECTID_PATTERN, '[ID]');
  result = result.replace(RESOURCE_UID_PATTERN, '[UID]');
  result = result.replace(EMAIL_PATTERN, '[EMAIL]');
  result = result.replace(CREDIT_CARD_PATTERN, '[CARD]');
  result = result.replace(SSN_SIN_PATTERN, '[SSN]');
  result = result.replace(PHONE_PATTERN, '[PHONE]');

  return result;
}

/**
 * Check if text likely contains PII patterns.
 * Useful for logging warnings without exposing the actual content.
 *
 * NOTE: Uses non-global regex literals (no `g` flag) to avoid the `lastIndex`
 * statefulness bug that occurs when calling `.test()` on a shared global regex.
 */
export function containsPII(text: string): boolean {
  if (!text) return false;
  return (
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text) ||
    /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/.test(text) ||
    /\b\d{3}-\d{2}-\d{4}\b/.test(text) ||
    /\b(?:\d{4}[-.\s]?){3}\d{4}\b/.test(text)
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
