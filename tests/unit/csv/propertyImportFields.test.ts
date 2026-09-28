import {
  SOURCE_PLATFORM_PRESETS,
  getImportFieldsResponse,
  isKnownImportField,
  IMPORTABLE_FIELDS,
} from '@services/csv/propertyImportFields';

describe('propertyImportFields', () => {
  const validKeys = new Set(IMPORTABLE_FIELDS.map((f) => f.key));

  describe('SOURCE_PLATFORM_PRESETS', () => {
    it('maps every preset header to a known field key', () => {
      for (const [platform, preset] of Object.entries(SOURCE_PLATFORM_PRESETS)) {
        for (const [header, fieldKey] of Object.entries(preset)) {
          expect(validKeys.has(fieldKey)).toBe(true);
          if (!validKeys.has(fieldKey)) {
            throw new Error(`${platform}: "${header}" maps to unknown field "${fieldKey}"`);
          }
        }
      }
    });
  });

  describe('isKnownImportField', () => {
    it('returns true for a real field key', () => {
      expect(isKnownImportField('name')).toBe(true);
      expect(isKnownImportField('fees_securityDeposit')).toBe(true);
    });

    it('returns false for an unknown field key', () => {
      expect(isKnownImportField('not_a_real_field')).toBe(false);
    });
  });

  describe('getImportFieldsResponse', () => {
    it('returns the full field list and no preset when no platform is given', () => {
      const result = getImportFieldsResponse();
      expect(result.fields).toEqual(IMPORTABLE_FIELDS);
      expect(result.presetMapping).toBeNull();
    });

    it('returns no preset for "other"', () => {
      const result = getImportFieldsResponse('other');
      expect(result.presetMapping).toBeNull();
    });

    it('returns no preset for an unrecognized platform id', () => {
      const result = getImportFieldsResponse('some-unknown-platform');
      expect(result.presetMapping).toBeNull();
    });

    it('returns the matching preset for a recognized platform', () => {
      const result = getImportFieldsResponse('buildium');
      expect(result.presetMapping).toEqual(SOURCE_PLATFORM_PRESETS.buildium);
    });
  });
});
