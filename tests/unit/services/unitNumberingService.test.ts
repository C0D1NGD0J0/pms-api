/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';
import { UNIT_NUMBER_PATTERNS } from '@interfaces/unit-patterns.types';

describe('UnitNumberingService - Unit Tests', () => {
  let unitNumberingService: UnitNumberingService;

  beforeAll(() => {
    unitNumberingService = new UnitNumberingService();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('detectNumberingPattern', () => {
    it('should detect basic patterns', () => {
      expect(unitNumberingService.detectNumberingPattern('1')).toBe('sequential');
      expect(unitNumberingService.detectNumberingPattern('A-1001')).toBe('alpha_numeric');
      expect(unitNumberingService.detectNumberingPattern('A101')).toBe('wing_unit');
      expect(unitNumberingService.detectNumberingPattern('Suite-101')).toBe('suite');
    });

    it('should handle edge cases', () => {
      expect(unitNumberingService.detectNumberingPattern('')).toBe('numeric');
      expect(unitNumberingService.detectNumberingPattern('XYZ123ABC')).toBe('custom');
    });
  });

  describe('extractExpectedFloorFromUnitNumber', () => {
    it('should extract floor from structured patterns', () => {
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('A-1001')).toBe(1);
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('Suite-205')).toBe(2);
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('A101')).toBe(1);
    });

    it('should return null for non-floor patterns', () => {
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('1001')).toBeNull();
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('')).toBeNull();
    });
  });

  describe('validateUnitNumberFloorCorrelation', () => {
    it('should validate correct floor correlation', () => {
      const result = unitNumberingService.validateUnitNumberFloorCorrelation('A-1001', 1);
      expect(result.isValid).toBe(true);
      expect(result.message).toBe('');
    });

    it('should detect floor mismatch', () => {
      const result = unitNumberingService.validateUnitNumberFloorCorrelation('A-1001', 2);
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('suggests Floor 1');
      expect(result.suggestedFloor).toBe(1);
    });
  });

  describe('generateNextUnitNumber', () => {
    it('should generate default first units', () => {
      const sequential = unitNumberingService.generateNextUnitNumber([], 'sequential');
      const alphaNumeric = unitNumberingService.generateNextUnitNumber([], 'alpha_numeric');

      expect(sequential.nextNumber).toBe('1');
      expect(alphaNumeric.nextNumber).toBe('A-1001');
    });

    it('should generate next sequential numbers', () => {
      const existingUnits = [
        { unitNumber: '1', unitType: 'apartment', floor: 1 },
        { unitNumber: '2', unitType: 'apartment', floor: 1 },
      ];

      const result = unitNumberingService.generateNextUnitNumber(existingUnits, 'sequential');
      expect(result.nextNumber).toBe('3');
    });

    it('should generate pattern-specific next numbers', () => {
      const alphaUnits = [{ unitNumber: 'A-1001', unitType: 'office', floor: 1 }];
      const wingUnits = [{ unitNumber: 'A101', unitType: 'apartment', floor: 1 }];

      const alphaResult = unitNumberingService.generateNextUnitNumber(
        alphaUnits,
        'alpha_numeric',
        1
      );
      const wingResult = unitNumberingService.generateNextUnitNumber(wingUnits, 'wing_unit', 1);

      expect(alphaResult.nextNumber).toBe('A-1002');
      expect(wingResult.nextNumber).toBe('A102');
    });
  });

  describe('validatePatternConsistency', () => {
    it('should validate consistent patterns', () => {
      const units = [
        { unitNumber: '1', unitType: 'apartment', floor: 1 },
        { unitNumber: '2', unitType: 'apartment', floor: 1 },
      ];

      const result = unitNumberingService.validatePatternConsistency(units);
      expect(result.isConsistent).toBe(true);
      expect(result.detectedPatterns).toEqual(['sequential']);
    });

    it('should detect mixed patterns', () => {
      const units = [
        { unitNumber: '1', unitType: 'apartment', floor: 1 },
        { unitNumber: 'A-1001', unitType: 'apartment', floor: 1 },
      ];

      const result = unitNumberingService.validatePatternConsistency(units);
      expect(result.isConsistent).toBe(false);
      expect(result.recommendation).toContain('Mixed patterns detected');
    });
  });

  describe('detectConflicts', () => {
    const existingUnits = [
      { unitNumber: '1', unitType: 'apartment', floor: 1 },
      { unitNumber: '2', unitType: 'apartment', floor: 1 },
    ];

    it('should detect conflicts with existing units', () => {
      const result = unitNumberingService.detectConflicts('1', existingUnits);
      expect(result.hasConflict).toBe(true);
      expect(result.conflictingUnit).toBe('1');
    });

    it('should not detect conflicts for unique numbers', () => {
      const result = unitNumberingService.detectConflicts('3', existingUnits);
      expect(result.hasConflict).toBe(false);
    });

    it('should provide suggestions for conflicts', () => {
      const result = unitNumberingService.detectConflicts('2', existingUnits);
      expect(result.hasConflict).toBe(true);
      expect(result.suggestion).toBe('3');
    });
  });

  describe('validateUnitNumberUpdate', () => {
    const existingUnits = [
      { unitNumber: '1', unitType: 'apartment', floor: 1 },
      { unitNumber: '2', unitType: 'apartment', floor: 1 },
    ];

    it('should validate acceptable updates', () => {
      const result = unitNumberingService.validateUnitNumberUpdate('3', 1, existingUnits);
      expect(result.isValid).toBe(true);
      expect(result.conflict).toBe(false);
    });

    it('should reject conflicting numbers', () => {
      const result = unitNumberingService.validateUnitNumberUpdate('1', 1, existingUnits);
      expect(result.isValid).toBe(false);
      expect(result.conflict).toBe(true);
    });
  });

  describe('suggestUnitNumberForFloor', () => {
    it('should suggest for existing floor', () => {
      const units = [{ unitNumber: '1001', unitType: 'apartment', floor: 1 }];
      const result = unitNumberingService.suggestUnitNumberForFloor(1, units, 'floor_based');
      expect(result.nextNumber).toBe('1002');
    });

    it('should suggest for new floor', () => {
      const units = [{ unitNumber: '1001', unitType: 'apartment', floor: 1 }];
      const result = unitNumberingService.suggestUnitNumberForFloor(3, units, 'floor_based');
      expect(result.nextNumber).toBe('101');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle empty inputs and special cases', () => {
      expect(unitNumberingService.detectNumberingPattern('')).toBe('numeric');
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('')).toBeNull();

      const emptyResult = unitNumberingService.validatePatternConsistency([]);
      expect(emptyResult.isConsistent).toBe(true);
      expect(emptyResult.recommendation).toBe('No units to validate');
    });
  });
});
