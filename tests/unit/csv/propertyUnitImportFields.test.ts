import { PropertyUnitValidations } from '@shared/validations/PropertyUnitValidation';
import {
  getUnitImportFieldsResponse,
  UNIT_REQUIRED_FIELD_KEYS,
  UNIT_IMPORTABLE_FIELDS,
  isKnownUnitImportField,
} from '@services/csv/propertyUnitImportFields';

describe('propertyUnitImportFields', () => {
  it('requires the columns every unit needs to be leased', () => {
    expect(UNIT_REQUIRED_FIELD_KEYS).toEqual([
      'unitNumber',
      'unitType',
      'floor',
      'status',
      'specifications_totalArea',
      'fees_rentAmount',
      'fees_securityDeposit',
    ]);
  });

  it('only offers columns the CSV schema knows', () => {
    const schemaKeys = Object.keys(PropertyUnitValidations.csvSchema.shape);
    for (const field of UNIT_IMPORTABLE_FIELDS) {
      expect(schemaKeys).toContain(field.key);
    }
  });

  it('returns every field with no platform preset', () => {
    expect(getUnitImportFieldsResponse()).toEqual({
      fields: UNIT_IMPORTABLE_FIELDS,
      presetMapping: null,
    });
  });

  it('recognises known keys only', () => {
    expect(isKnownUnitImportField('fees_rentAmount')).toBe(true);
    expect(isKnownUnitImportField('fees_currency')).toBe(false);
  });
});
