import { containsPII, redactPII } from '@utils/pii.utils';

describe('redactPII', () => {
  it('should redact email addresses', () => {
    const result = redactPII('Contact john.doe@example.com for details');
    expect(result).toBe('Contact [EMAIL] for details');
    expect(result).not.toContain('john.doe@example.com');
  });

  it('should redact phone numbers', () => {
    const result = redactPII('Call me at +1-416-555-1234 or (416) 555-1234');
    expect(result).not.toContain('416');
    expect(result).toContain('[PHONE]');
  });

  it('should redact credit card numbers', () => {
    const result = redactPII('Card: 4111-1111-1111-1111');
    expect(result).toContain('[CARD]');
    expect(result).not.toContain('4111');
  });

  it('should redact SSN/SIN patterns', () => {
    const result = redactPII('SSN: 123-45-6789');
    expect(result).not.toContain('123-45-6789');
  });

  it('should redact MongoDB ObjectIds', () => {
    const result = redactPII('User 507f1f77bcf86cd799439011 reported the issue');
    expect(result).toContain('[ID]');
    expect(result).not.toContain('507f1f77bcf86cd799439011');
  });

  it('should redact resource UIDs', () => {
    const result = redactPII('Request MR-ABC12345 on property PR-XYZ789012');
    expect(result).toContain('[UID]');
    expect(result).not.toContain('MR-ABC12345');
    expect(result).not.toContain('PR-XYZ789012');
  });

  it('should redact known names from PIIContext', () => {
    const result = redactPII('Marcus Johnson reported a leak in unit 4A', {
      names: ['Marcus Johnson'],
    });
    expect(result).toContain('[NAME]');
    expect(result).not.toContain('Marcus Johnson');
  });

  it('should redact known emails from PIIContext', () => {
    const result = redactPII('Email me at marcus@test.com please', {
      emails: ['marcus@test.com'],
    });
    expect(result).toContain('[EMAIL]');
    expect(result).not.toContain('marcus@test.com');
  });

  it('should redact known addresses from PIIContext', () => {
    const result = redactPII('The property at 123 Main St has an issue', {
      addresses: ['123 Main St'],
    });
    expect(result).toContain('[ADDRESS]');
    expect(result).not.toContain('123 Main St');
  });

  it('should handle empty or null input gracefully', () => {
    expect(redactPII('')).toBe('');
    expect(redactPII(null as any)).toBe(null);
    expect(redactPII(undefined as any)).toBe(undefined);
  });

  it('should leave clean text unchanged', () => {
    const text = 'The kitchen sink is leaking badly and the floor is wet';
    expect(redactPII(text)).toBe(text);
  });

  it('should handle multiple PII types in one string', () => {
    const text = 'Contact john@test.com or call +1-555-123-4567 at 123 Main St';
    const result = redactPII(text, { addresses: ['123 Main St'] });
    expect(result).toContain('[EMAIL]');
    expect(result).toContain('[PHONE]');
    expect(result).toContain('[ADDRESS]');
  });
});

describe('containsPII', () => {
  it('should detect email addresses', () => {
    expect(containsPII('Contact user@example.com')).toBe(true);
  });

  it('should detect phone numbers', () => {
    expect(containsPII('Call 416-555-1234')).toBe(true);
  });

  it('should return false for clean text', () => {
    expect(containsPII('The kitchen sink is broken')).toBe(false);
  });

  it('should return false for empty input', () => {
    expect(containsPII('')).toBe(false);
    expect(containsPII(null as any)).toBe(false);
  });

  it('should return consistent results across multiple calls with the same input (no lastIndex bug)', () => {
    // If containsPII used global regex .test(), every other call would return
    // a false-negative because lastIndex would advance past the match.
    const text = 'Landlord: owner@property.com';
    for (let i = 0; i < 6; i++) {
      expect(containsPII(text)).toBe(true);
    }
  });

  it('should detect SSN patterns', () => {
    expect(containsPII('SSN: 123-45-6789')).toBe(true);
  });

  it('should detect credit card numbers', () => {
    expect(containsPII('Card 4111-1111-1111-1111')).toBe(true);
  });
});
