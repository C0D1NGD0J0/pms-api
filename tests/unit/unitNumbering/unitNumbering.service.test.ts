import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';

describe('UnitNumberingService', () => {
  let service: UnitNumberingService;

  beforeEach(() => {
    service = new UnitNumberingService();
  });

  describe('detectNumberingPattern', () => {
    it('should detect correct patterns for various unit numbers', () => {
      // Sequential patterns (UNIT_NUMBER_PATTERNS.sequential matches first with regex /^\d{1,4}$/)
      expect(service.detectNumberingPattern('1')).toBe('sequential');
      expect(service.detectNumberingPattern('25')).toBe('sequential');
      expect(service.detectNumberingPattern('101')).toBe('sequential');
      expect(service.detectNumberingPattern('1001')).toBe('sequential');
      
      // Alpha-numeric patterns
      expect(service.detectNumberingPattern('A-1001')).toBe('alpha_numeric');
      expect(service.detectNumberingPattern('B-205')).toBe('alpha_numeric');
      
      // Building-unit patterns
      expect(service.detectNumberingPattern('B1U01')).toBe('building_unit');
      expect(service.detectNumberingPattern('B10U05')).toBe('building_unit');
      
      // Wing-unit patterns
      expect(service.detectNumberingPattern('A101')).toBe('wing_unit');
      expect(service.detectNumberingPattern('C205')).toBe('wing_unit');
      
      // Non-matching patterns fall through to custom
      expect(service.detectNumberingPattern('XYZ-123')).toBe('custom'); // Doesn't match any specific pattern
      
      // Suite patterns (fallback detection)
      expect(service.detectNumberingPattern('Suite-101')).toBe('suite');
      expect(service.detectNumberingPattern('suite-205')).toBe('suite');
      
      // Custom patterns
      expect(service.detectNumberingPattern('Unit-001')).toBe('custom');
      expect(service.detectNumberingPattern('Apt-123')).toBe('custom');
      
      // Empty/null cases
      expect(service.detectNumberingPattern('')).toBe('numeric');
      expect(service.detectNumberingPattern(null as any)).toBe('numeric');
    });
  });

  describe('validateUnitNumberFloorCorrelation', () => {
    it('should validate floor correlation correctly for different patterns', () => {
      // Valid correlations
      const validAlpha = service.validateUnitNumberFloorCorrelation('A-1001', 1);
      expect(validAlpha.isValid).toBe(true);
      expect(validAlpha.message).toBe('');
      
      const validBuilding = service.validateUnitNumberFloorCorrelation('B2U01', 2);
      expect(validBuilding.isValid).toBe(true);
      
      const validFloorBased = service.validateUnitNumberFloorCorrelation('2105', 2);
      expect(validFloorBased.isValid).toBe(true);
      
      // Invalid correlations
      const invalidAlpha = service.validateUnitNumberFloorCorrelation('A-1001', 2);
      expect(invalidAlpha.isValid).toBe(false);
      expect(invalidAlpha.message).toContain('suggests Floor 1');
      expect(invalidAlpha.suggestedFloor).toBe(1);
      
      const invalidBuilding = service.validateUnitNumberFloorCorrelation('B2U01', 1);
      expect(invalidBuilding.isValid).toBe(false);
      expect(invalidBuilding.message).toContain('suggests Floor 2');
      expect(invalidBuilding.suggestedFloor).toBe(2);
      
      // Patterns with null extraction should be valid
      const sequentialPattern = service.validateUnitNumberFloorCorrelation('25', 3);
      expect(sequentialPattern.isValid).toBe(true);
    });
  });

  describe('generateNextUnitNumber', () => {
    it('should generate appropriate next unit numbers for different patterns', () => {
      const existingUnits = [
        { unitNumber: 'A-1001', unitType: 'residential', floor: 1 },
        { unitNumber: 'A-1002', unitType: 'residential', floor: 1 },
        { unitNumber: 'B-2001', unitType: 'residential', floor: 2 },
      ];

      // Alpha-numeric pattern
      const alphaResult = service.generateNextUnitNumber(existingUnits, 'alpha_numeric', 1);
      expect(alphaResult.nextNumber).toBe('A-2002');
      expect(alphaResult.isConsistent).toBe(true);
      expect(alphaResult.pattern).toBe('alpha_numeric');

      // Sequential pattern with empty units
      const emptyResult = service.generateNextUnitNumber([], 'sequential');
      expect(emptyResult.nextNumber).toBe('1');
      expect(emptyResult.isConsistent).toBe(true);
      expect(emptyResult.recommendation).toContain('Starting new sequential pattern');

      // Floor-based pattern
      const floorBasedUnits = [
        { unitNumber: '1001', unitType: 'residential', floor: 1 },
        { unitNumber: '1002', unitType: 'residential', floor: 1 },
      ];
      const floorResult = service.generateNextUnitNumber(floorBasedUnits, 'floor_based', 1);
      expect(floorResult.nextNumber).toBe('1003');
      expect(floorResult.isConsistent).toBe(true);

      // Custom pattern with prefix
      const customUnits = [
        { unitNumber: 'Unit-001', unitType: 'residential', floor: 1 },
        { unitNumber: 'Unit-002', unitType: 'residential', floor: 1 },
      ];
      const customResult = service.generateNextUnitNumber(customUnits, 'custom', 1, 'Unit');
      expect(customResult.nextNumber).toBe('Unit-003');
      expect(customResult.isConsistent).toBe(true);
    });

    it('should handle suggested numbers for first units', () => {
      const result = service.generateNextUnitNumber([], 'sequential', 1, undefined, '101');
      expect(result.nextNumber).toBe('101');
      expect(result.isConsistent).toBe(true);
      expect(result.pattern).toBe('sequential');
      expect(result.recommendation).toContain('Using suggested number');
    });
  });

  describe('detectConflicts', () => {
    it('should detect unit number conflicts and provide suggestions', () => {
      const existingUnits = [
        { unitNumber: '101', unitType: 'residential', floor: 1 },
        { unitNumber: '102', unitType: 'residential', floor: 1 },
        { unitNumber: '201', unitType: 'residential', floor: 2 },
      ];

      // Conflict detected
      const conflictResult = service.detectConflicts('101', existingUnits);
      expect(conflictResult.hasConflict).toBe(true);
      expect(conflictResult.conflictingUnit).toBe('101');
      expect(conflictResult.suggestion).toBe('202'); // Next sequential number

      // No conflict
      const noConflictResult = service.detectConflicts('103', existingUnits);
      expect(noConflictResult.hasConflict).toBe(false);
      expect(noConflictResult.conflictingUnit).toBeUndefined();

      // Empty units array
      const emptyResult = service.detectConflicts('101', []);
      expect(emptyResult.hasConflict).toBe(false);
    });
  });
});