import { UnitTypeRules } from '@interfaces/propertyUnit.interface';

export const unitTypeRules: UnitTypeRules = {
  residential: {
    visibleFields: {
      specifications: ['totalArea', 'bedrooms', 'bathrooms', 'maxOccupants'],
      amenities: [
        'airConditioning',
        'heating',
        'washerDryer',
        'dishwasher',
        'parking',
        'storage',
        'cableTV',
        'internet',
      ],
      utilities: ['water', 'centralAC', 'heating', 'gas', 'trash'],
      fees: ['rentAmount', 'securityDeposit'],
    },
    requiredFields: ['specifications.totalArea', 'fees.rentAmount'],
    helpText: {
      totalArea: 'Total living area of this residential unit',
      bedrooms: 'Number of bedrooms in the unit',
      bathrooms: 'Number of bathrooms in the unit',
      maxOccupants: 'Maximum number of people allowed to occupy this unit',
      rentAmount: 'Monthly rent amount for this unit',
    },
  },
  commercial: {
    visibleFields: {
      specifications: ['totalArea', 'maxOccupants'],
      amenities: ['airConditioning', 'heating', 'parking', 'storage'],
      utilities: ['water', 'centralAC', 'heating', 'gas', 'trash'],
      fees: ['rentAmount', 'securityDeposit'],
    },
    requiredFields: ['specifications.totalArea', 'fees.rentAmount'],
    helpText: {
      totalArea: 'Total floor area of this commercial space',
      maxOccupants: 'Maximum capacity for business operations',
      rentAmount: 'Monthly rent amount for this commercial unit',
    },
  },
  storage: {
    visibleFields: {
      specifications: ['totalArea'],
      amenities: ['storage'],
      utilities: [],
      fees: ['rentAmount'],
    },
    requiredFields: ['specifications.totalArea', 'fees.rentAmount'],
    helpText: {
      totalArea: 'Total storage area in square feet',
      rentAmount: 'Monthly rent amount for this storage unit',
    },
  },
  other: {
    visibleFields: {
      specifications: ['totalArea', 'maxOccupants'],
      amenities: ['airConditioning', 'heating', 'parking', 'storage'],
      utilities: ['water', 'centralAC', 'heating', 'gas', 'trash'],
      fees: ['rentAmount', 'securityDeposit'],
    },
    requiredFields: ['specifications.totalArea', 'fees.rentAmount'],
    helpText: {
      totalArea: 'Total area of this unit in square feet',
      rentAmount: 'Monthly rent amount for this unit',
    },
  },
};
