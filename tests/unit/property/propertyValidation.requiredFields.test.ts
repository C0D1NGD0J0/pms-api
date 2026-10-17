import { PropertyValidationService } from '@services/property/propertyValidation.service';

const fieldsWithErrors = (property: Record<string, any>) =>
  PropertyValidationService.validateProperty({
    name: 'Riverdale Family Home',
    fullAddress: '45 Withrow Avenue, Toronto, ON M4K 1C8',
    ...property,
  } as any).errors.map((error) => error.field);

// The same fields the property form requires, per type
describe('PropertyValidationService.validateProperty — required fields on create', () => {
  it('requires total area for every type', () => {
    expect(fieldsWithErrors({ propertyType: 'apartment', maxAllowedUnits: 12 })).toContain(
      'totalArea'
    );
    expect(fieldsWithErrors({ propertyType: 'industrial', maxAllowedUnits: 1 })).toContain(
      'totalArea'
    );
  });

  it('requires bedrooms and bathrooms on a single-unit house or townhouse', () => {
    for (const propertyType of ['house', 'townhouse']) {
      expect(
        fieldsWithErrors({ propertyType, maxAllowedUnits: 1, specifications: { totalArea: 1800 } })
      ).toEqual(['bedrooms', 'bathrooms']);
    }
  });

  it('accepts a single-unit house with its rooms', () => {
    expect(
      fieldsWithErrors({
        propertyType: 'house',
        maxAllowedUnits: 1,
        specifications: { totalArea: 1800, bedrooms: 3, bathrooms: 2 },
      })
    ).toEqual([]);
  });

  it('leaves rooms to the units once a house is split into several', () => {
    expect(
      fieldsWithErrors({
        propertyType: 'house',
        maxAllowedUnits: 3,
        specifications: { totalArea: 1800 },
      })
    ).toEqual([]);
  });

  it('does not ask for rooms on a multi-unit building', () => {
    expect(
      fieldsWithErrors({
        propertyType: 'apartment',
        maxAllowedUnits: 12,
        specifications: { totalArea: 14000 },
      })
    ).toEqual([]);
  });

  it('skips the required-field checks on update', () => {
    const result = PropertyValidationService.validateProperty(
      { propertyType: 'house', maxAllowedUnits: 1 } as any,
      true
    );
    expect(result.errors).toEqual([]);
  });
});
