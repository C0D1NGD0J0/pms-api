/**
 * Normalize a free-text `address.state` value into a Canadian province/territory
 * code (ISO 3166-2 style, e.g. "ON"). Handles full names and 2-letter codes,
 * case-insensitively. Returns null for empty or unrecognized input.
 *
 * Used to look up jurisdiction rules from `jurisdictionRulesConfig`.
 */
const STATE_NAME_TO_CODE: Record<string, string> = {
  ontario: 'ON',
  on: 'ON',
  'british columbia': 'BC',
  bc: 'BC',
  alberta: 'AB',
  ab: 'AB',
  quebec: 'QC',
  québec: 'QC',
  qc: 'QC',
  manitoba: 'MB',
  mb: 'MB',
  saskatchewan: 'SK',
  sk: 'SK',
  'nova scotia': 'NS',
  ns: 'NS',
  'new brunswick': 'NB',
  nb: 'NB',
  'prince edward island': 'PE',
  pe: 'PE',
  'newfoundland and labrador': 'NL',
  newfoundland: 'NL',
  nl: 'NL',
  'northwest territories': 'NT',
  nt: 'NT',
  nunavut: 'NU',
  nu: 'NU',
  yukon: 'YT',
  yt: 'YT',
};

export function normalizeStateToCode(state?: string | null): string | null {
  if (!state || typeof state !== 'string') return null;
  const key = state.trim().toLowerCase();
  if (!key) return null;
  return STATE_NAME_TO_CODE[key] ?? null;
}
