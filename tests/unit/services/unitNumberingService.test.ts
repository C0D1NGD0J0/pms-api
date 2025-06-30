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
      expect(unitNumberingService.detectNumberingPattern('B1U01')).toBe('building_unit');
    });

    it('should detect complex patterns', () => {
      expect(unitNumberingService.detectNumberingPattern('A101')).toBe('wing_unit');
      expect(unitNumberingService.detectNumberingPattern('Suite-101')).toBe('suite');
      expect(unitNumberingService.detectNumberingPattern('Unit-001')).toBe('custom');
    });

    it('should handle edge cases', () => {
      expect(unitNumberingService.detectNumberingPattern('')).toBe('numeric');
      expect(unitNumberingService.detectNumberingPattern('XYZ123ABC')).toBe('custom');
    });
  });

  describe('extractExpectedFloorFromUnitNumber', () => {
    it('should extract floor from structured patterns', () => {
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('A-1001')).toBe(1);
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('B1U01')).toBe(1);
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('A101')).toBe(1);
    });

    it('should extract floor from suite pattern', () => {
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('Suite-105')).toBe(1);
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('Suite-205')).toBe(2);
    });

    it('should return null for non-floor patterns', () => {
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('1001')).toBeNull(); // Sequential
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('Unit-001')).toBeNull(); // Custom
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('')).toBeNull(); // Empty
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

    it('should validate when no floor info available', () => {
      const result = unitNumberingService.validateUnitNumberFloorCorrelation('1', 5);
      expect(result.isValid).toBe(true);
    });
  });

  describe('generateNextUnitNumber', () => {
    it('should generate default first units', () => {
      const sequential = unitNumberingService.generateNextUnitNumber([], 'sequential');
      const alphaNumeric = unitNumberingService.generateNextUnitNumber([], 'alpha_numeric');
      const custom = unitNumberingService.generateNextUnitNumber([], 'custom', 1, 'Unit');
      
      expect(sequential.nextNumber).toBe('1');
      expect(alphaNumeric.nextNumber).toBe('A-1001');
      expect(custom.nextNumber).toBe('Unit-001');
    });

    it('should generate next sequential numbers', () => {
      const existingUnits = [
        { unitNumber: '1', unitType: 'apartment', floor: 1 },
        { unitNumber: '2', unitType: 'apartment', floor: 1 }
      ];
      
      const result = unitNumberingService.generateNextUnitNumber(existingUnits, 'sequential');
      expect(result.nextNumber).toBe('3');
    });

    it('should generate pattern-specific next numbers', () => {
      const alphaUnits = [{ unitNumber: 'A-1001', unitType: 'office', floor: 1 }];
      const wingUnits = [{ unitNumber: 'A101', unitType: 'apartment', floor: 1 }];
      
      const alphaResult = unitNumberingService.generateNextUnitNumber(alphaUnits, 'alpha_numeric', 1);
      const wingResult = unitNumberingService.generateNextUnitNumber(wingUnits, 'wing_unit', 1);
      
      expect(alphaResult.nextNumber).toBe('A-1002');
      expect(wingResult.nextNumber).toBe('A102');
    });
  });

  describe('validatePatternConsistency', () => {
    it('should validate consistent patterns', () => {
      const units = [
        { unitNumber: '1', unitType: 'apartment', floor: 1 },
        { unitNumber: '2', unitType: 'apartment', floor: 1 }
      ];
      
      const result = unitNumberingService.validatePatternConsistency(units);
      expect(result.isConsistent).toBe(true);
      expect(result.detectedPatterns).toEqual(['sequential']);
    });

    it('should detect mixed patterns', () => {
      const units = [
        { unitNumber: '1', unitType: 'apartment', floor: 1 },
        { unitNumber: 'A-1001', unitType: 'apartment', floor: 1 }
      ];
      
      const result = unitNumberingService.validatePatternConsistency(units);
      expect(result.isConsistent).toBe(false);
      expect(result.recommendation).toContain('Mixed patterns detected');
    });

    it('should handle empty units array', () => {
      const result = unitNumberingService.validatePatternConsistency([]);
      expect(result.isConsistent).toBe(true);
      expect(result.recommendation).toBe('No units to validate');
    });
  });

  describe('getPatternInfo', () => {
    it('should return pattern info for valid IDs', () => {
      const info = unitNumberingService.getPatternInfo('sequential');
      expect(info).toBeDefined();
      expect(info.id).toBe('sequential');
    });

    it('should return null for invalid IDs', () => {
      const info = unitNumberingService.getPatternInfo('invalid_pattern');
      expect(info).toBeNull();
    });
  });

  describe('parseCustomUnit', () => {
    it('should parse valid custom unit numbers', () => {
      const result = unitNumberingService.parseCustomUnit('Unit-123');
      expect(result).toEqual({ prefix: 'Unit', number: 123 });
    });

    it('should return null for invalid formats', () => {
      expect(unitNumberingService.parseCustomUnit('123')).toBeNull();
      expect(unitNumberingService.parseCustomUnit('Unit-')).toBeNull();
    });
  });

  describe('detectConflicts', () => {
    const existingUnits = [
      { unitNumber: '1', unitType: 'apartment', floor: 1 },
      { unitNumber: '2', unitType: 'apartment', floor: 1 }
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
      { unitNumber: '2', unitType: 'apartment', floor: 1 }
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

    it('should reject floor mismatches', () => {
      const wingUnits = [{ unitNumber: 'A101', unitType: 'apartment', floor: 1 }];
      const result = unitNumberingService.validateUnitNumberUpdate('B201', 1, wingUnits);
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('suggests Floor 2');
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

    it('should work with different patterns', () => {
      const units = [{ unitNumber: 'A-1001', unitType: 'office', floor: 1 }];
      const result = unitNumberingService.suggestUnitNumberForFloor(1, units, 'alpha_numeric');
      expect(result.nextNumber).toBe('A-1002');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle empty inputs', () => {
      expect(unitNumberingService.detectNumberingPattern('')).toBe('numeric');
      expect(unitNumberingService.extractExpectedFloorFromUnitNumber('')).toBeNull();
    });

    it('should handle large numbers', () => {
      const result = unitNumberingService.detectNumberingPattern('9999');
      expect(result).toBe('sequential');
    });

    it('should handle special characters', () => {
      const result = unitNumberingService.detectNumberingPattern('Unit_123');
      expect(result).toBe('custom');
    });
  });
});