import { normalizeStateToCode } from '@utils/jurisdiction.utils';

describe('normalizeStateToCode', () => {
  it('maps full province names to codes', () => {
    expect(normalizeStateToCode('Ontario')).toBe('ON');
    expect(normalizeStateToCode('British Columbia')).toBe('BC');
    expect(normalizeStateToCode('Quebec')).toBe('QC');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeStateToCode('  ontario ')).toBe('ON');
    expect(normalizeStateToCode('ON')).toBe('ON');
    expect(normalizeStateToCode('bc')).toBe('BC');
  });

  it('returns null for unknown, empty, or nullish input', () => {
    expect(normalizeStateToCode('Texas')).toBeNull();
    expect(normalizeStateToCode('')).toBeNull();
    expect(normalizeStateToCode('   ')).toBeNull();
    expect(normalizeStateToCode(undefined)).toBeNull();
    expect(normalizeStateToCode(null)).toBeNull();
  });
});
