import { UNIT_NUMBER_PATTERNS, UnitNumberPattern } from '@interfaces/unit-patterns.types';

export interface UnitUpdateValidationResult {
  suggestion?: string;
  conflict?: boolean;
  isValid: boolean;
  message: string;
  pattern: string;
}

export interface PatternValidationResult {
  suggestedFloor: number | null;
  detectedPattern: string;
  isValid: boolean;
  message: string;
}

export interface UnitNumberSuggestion {
  recommendation: string;
  isConsistent: boolean;
  nextNumber: string;
  pattern: string;
}

export interface ConflictDetectionResult {
  conflictingUnit?: string;
  hasConflict: boolean;
  suggestion?: string;
}

export interface UnitFormValues {
  unitNumber: string;
  unitType: string;
  floor: number;
}

export class UnitNumberingService {
  /**
   * Detect the numbering pattern of a unit number
   */
  detectNumberingPattern(unitNumber: string): string {
    if (!unitNumber) return 'numeric';

    // compare with predefined patterns
    for (const [patternId, pattern] of Object.entries(UNIT_NUMBER_PATTERNS)) {
      if (pattern.regex.test(unitNumber)) {
        return patternId;
      }
    }

    if (/^\d{4}$/.test(unitNumber)) return 'floor_based';
    if (/^Suite-\d+/i.test(unitNumber)) return 'suite';
    if (/^[A-Z]-\d+/.test(unitNumber)) return 'alpha_numeric';
    if (/^[A-Za-z]+-\d+/.test(unitNumber)) return 'custom';
    if (/^\d+$/.test(unitNumber)) return 'sequential';

    return 'custom';
  }

  /**
   * Extract expected floor from unit number based on pattern
   */
  extractExpectedFloorFromUnitNumber(unitNumber: string): number | null {
    if (!unitNumber) return null;

    const pattern = this.detectNumberingPattern(unitNumber);

    switch (pattern) {
      case 'alpha_numeric': {
        // A-1001 -> 1, B-2005 -> 2 (letter determines floor)
        const alphaMatch = unitNumber.match(/^([A-Z])-(\d+)$/);
        if (alphaMatch) {
          return alphaMatch[1].charCodeAt(0) - 64; // A=1, B=2, etc.
        }
        break;
      }

      case 'building_unit': {
        // B1U01 -> 1, B2U05 -> 2
        const buildingMatch = unitNumber.match(/^B(\d+)U\d+$/);
        if (buildingMatch) {
          return parseInt(buildingMatch[1]);
        }
        break;
      }

      case 'floor_based': {
        // 1001 -> 1, 2005 -> 2
        const fourDigitMatch = unitNumber.match(/^(\d{4})$/);
        if (fourDigitMatch) {
          return Math.floor(parseInt(fourDigitMatch[1]) / 1000);
        }
        // 101 -> 1, 205 -> 2
        const threeDigitMatch = unitNumber.match(/^(\d{3})$/);
        if (threeDigitMatch) {
          return Math.floor(parseInt(threeDigitMatch[1]) / 100);
        }
        break;
      }

      case 'wing_unit': {
        // A101 -> 1, B205 -> 2
        const wingMatch = unitNumber.match(/^[A-Z](\d{3})$/);
        if (wingMatch) {
          return Math.floor(parseInt(wingMatch[1]) / 100);
        }
        break;
      }

      case 'suite': {
        // Suite-105 -> 1, Suite-205 -> 2
        const suiteMatch = unitNumber.match(/^Suite-(\d+)$/i);
        if (suiteMatch) {
          const number = parseInt(suiteMatch[1]);
          return number >= 100 ? Math.floor(number / 100) : null;
        }
        break;
      }
    }

    return null;
  }

  /**
   * Validate unit number against floor correlation
   */
  validateUnitNumberFloorCorrelation(unitNumber: string, floor: number): PatternValidationResult {
    const expectedFloor = this.extractExpectedFloorFromUnitNumber(unitNumber);
    const detectedPattern = this.detectNumberingPattern(unitNumber);

    if (expectedFloor === null || expectedFloor === Number(floor)) {
      return {
        detectedPattern,
        isValid: true,
        message: '',
        suggestedFloor: null,
      };
    }

    const patternNames: Record<string, string> = {
      alpha_numeric: 'alphabetic pattern',
      building_unit: 'building-unit format',
      custom: 'custom pattern',
      floor_based: 'floor-based pattern',
      sequential: 'sequential pattern',
      suite: 'suite format',
      wing_unit: 'wing-unit format',
    };

    const message = `Unit number "${unitNumber}" suggests Floor ${expectedFloor} (${
      patternNames[detectedPattern] || 'numbering pattern'
    }), but Floor ${floor} is selected.`;

    return {
      detectedPattern,
      isValid: false,
      message,
      suggestedFloor: expectedFloor,
    };
  }

  /**
   * Get last number from existing units of same pattern
   */
  private getLastNumber(units: UnitFormValues[], pattern: string, customPrefix?: string): number {
    let filteredUnits: number[] = [];

    switch (pattern) {
      case 'alpha_numeric': {
        filteredUnits = units
          .filter((unit) => /^[A-Z]-\d+$/.test(unit.unitNumber))
          .map((unit) => parseInt(unit.unitNumber.split('-')[1]))
          .sort((a, b) => a - b);
        break;
      }

      case 'building_unit': {
        filteredUnits = units
          .filter((unit) => /^B\d{1,2}U\d{2}$/.test(unit.unitNumber))
          .map((unit) => {
            const match = unit.unitNumber.match(/^B\d{1,2}U(\d{2})$/);
            return match ? parseInt(match[1]) : 0;
          })
          .sort((a, b) => a - b);
        break;
      }

      case 'floor_based': {
        filteredUnits = units
          .filter((unit) => /^\d{3,4}$/.test(unit.unitNumber))
          .map((unit) => parseInt(unit.unitNumber))
          .sort((a, b) => a - b);
        break;
      }

      case 'sequential': {
        filteredUnits = units
          .filter((unit) => /^\d+$/.test(unit.unitNumber))
          .map((unit) => parseInt(unit.unitNumber))
          .sort((a, b) => a - b);
        break;
      }

      case 'wing_unit': {
        filteredUnits = units
          .filter((unit) => /^[A-Z]\d{3}$/.test(unit.unitNumber))
          .map((unit) => parseInt(unit.unitNumber.substring(1)))
          .sort((a, b) => a - b);
        break;
      }

      case 'custom': {
        const prefix = customPrefix || 'Unit';
        filteredUnits = units
          .filter((unit) => unit.unitNumber.startsWith(`${prefix}-`))
          .map((unit) => parseInt(unit.unitNumber.split('-')[1]) || 0)
          .sort((a, b) => a - b);
        break;
      }

      case 'suite': {
        filteredUnits = units
          .filter((unit) => /^Suite-\d+/i.test(unit.unitNumber))
          .map((unit) => parseInt(unit.unitNumber.split('-')[1]) || 0)
          .sort((a, b) => a - b);
        break;
      }

      default: {
        filteredUnits = units
          .filter((unit) => /^\d+$/.test(unit.unitNumber))
          .map((unit) => parseInt(unit.unitNumber))
          .sort((a, b) => a - b);
        break;
      }
    }

    return filteredUnits.length > 0 ? filteredUnits[filteredUnits.length - 1] : 0;
  }

  /**
   * Generate next unit number based on pattern and existing units
   */
  generateNextUnitNumber(
    existingUnits: UnitFormValues[],
    pattern: string,
    currentFloor: number = 1,
    customPrefix?: string,
    suggestedNumber?: string
  ): UnitNumberSuggestion {
    // Use suggested number for first unit
    if (existingUnits.length === 0 && suggestedNumber) {
      const detectedPattern = this.detectNumberingPattern(suggestedNumber);
      return {
        isConsistent: true,
        nextNumber: suggestedNumber,
        pattern: detectedPattern,
        recommendation: `Using suggested number with ${detectedPattern} pattern`,
      };
    }

    // Default first unit
    if (existingUnits.length === 0) {
      const defaultNumbers: Record<string, string> = {
        alpha_numeric: 'A-1001',
        building_unit: 'B1U01',
        custom: `${customPrefix || 'Unit'}-001`,
        floor_based: '101',
        sequential: '1',
        suite: 'Suite-101',
        wing_unit: 'A101',
      };
      return {
        isConsistent: true,
        nextNumber: defaultNumbers[pattern] || '101',
        pattern,
        recommendation: `Starting new ${pattern} pattern`,
      };
    }

    const lastNumber = this.getLastNumber(existingUnits, pattern, customPrefix);

    switch (pattern) {
      case 'alpha_numeric': {
        const letter = String.fromCharCode(64 + currentFloor); // A, B, C...
        const nextAlpha = lastNumber > 0 ? lastNumber + 1 : currentFloor * 1000 + 1;
        return {
          isConsistent: true,
          nextNumber: `${letter}-${nextAlpha}`,
          pattern,
          recommendation: `Following alphabetic pattern for floor ${currentFloor}`,
        };
      }

      case 'building_unit': {
        const building = Math.ceil(currentFloor / 10);
        const nextBuilding = lastNumber > 0 ? lastNumber + 1 : 1;
        return {
          isConsistent: true,
          nextNumber: `B${building}U${nextBuilding.toString().padStart(2, '0')}`,
          pattern,
          recommendation: `Following building-unit pattern for building ${building}`,
        };
      }

      case 'floor_based': {
        const nextFloor = lastNumber > 0 ? lastNumber + 1 : currentFloor * 100 + 1;
        return {
          isConsistent: true,
          nextNumber: nextFloor.toString(),
          pattern,
          recommendation: 'Following floor-based numbering pattern',
        };
      }

      case 'sequential': {
        return {
          isConsistent: true,
          nextNumber: (lastNumber + 1).toString(),
          pattern: 'sequential',
          recommendation: 'Following sequential numbering pattern',
        };
      }

      case 'wing_unit': {
        const wing = String.fromCharCode(64 + Math.ceil(currentFloor / 10)); // A, B, C...
        const nextWing = lastNumber > 0 ? lastNumber + 1 : currentFloor * 100 + 1;
        return {
          isConsistent: true,
          nextNumber: `${wing}${nextWing.toString().padStart(3, '0')}`,
          pattern,
          recommendation: `Following wing-unit pattern for wing ${wing}`,
        };
      }

      case 'custom': {
        const prefix = customPrefix || 'Unit';
        const nextCustom = lastNumber + 1;
        return {
          isConsistent: true,
          nextNumber: `${prefix}-${nextCustom.toString().padStart(3, '0')}`,
          pattern,
          recommendation: `Following custom pattern with prefix "${prefix}"`,
        };
      }

      case 'suite': {
        const nextSuite = lastNumber + 1;
        return {
          isConsistent: true,
          nextNumber: `Suite-${nextSuite.toString().padStart(3, '0')}`,
          pattern,
          recommendation: 'Following suite numbering pattern',
        };
      }

      default: {
        return {
          isConsistent: true,
          nextNumber: (lastNumber + 1).toString(),
          pattern: 'sequential',
          recommendation: 'Following sequential numbering pattern',
        };
      }
    }
  }

  /**
   * Validate pattern consistency across multiple units
   */
  validatePatternConsistency(units: UnitFormValues[]): {
    detectedPatterns: string[];
    isConsistent: boolean;
    recommendation: string;
  } {
    if (units.length === 0) {
      return {
        detectedPatterns: [],
        isConsistent: true,
        recommendation: 'No units to validate',
      };
    }

    const patterns = units.map((unit) => this.detectNumberingPattern(unit.unitNumber));
    const uniquePatterns = [...new Set(patterns)];

    if (uniquePatterns.length === 1) {
      return {
        detectedPatterns: uniquePatterns,
        isConsistent: true,
        recommendation: `All units follow ${uniquePatterns[0]} pattern`,
      };
    }

    return {
      detectedPatterns: uniquePatterns,
      isConsistent: false,
      recommendation: `Mixed patterns detected: ${uniquePatterns.join(', ')}. Consider standardizing to one pattern.`,
    };
  }

  /**
   * Get pattern information
   */
  getPatternInfo(patternId: string): UnitNumberPattern | null {
    return UNIT_NUMBER_PATTERNS[patternId] || null;
  }

  /**
   * Parse custom unit number format
   */
  parseCustomUnit(unitNumber: string): { number: number; prefix: string } | null {
    const match = unitNumber.match(/^([A-Za-z]+)-(\d+)$/);
    return match ? { number: parseInt(match[2]), prefix: match[1] } : null;
  }

  /**
   * Check for unit number conflicts
   */
  detectConflicts(
    unitNumber: string,
    existingUnits: UnitFormValues[],
    _excludeUnitId?: string
  ): ConflictDetectionResult {
    const conflict = existingUnits.find((unit) => unit.unitNumber === unitNumber);

    if (conflict) {
      const pattern = this.detectNumberingPattern(unitNumber);
      const suggestion = this.generateNextUnitNumber(existingUnits, pattern, 1).nextNumber;

      return {
        hasConflict: true,
        conflictingUnit: conflict.unitNumber,
        suggestion,
      };
    }

    return {
      hasConflict: false,
    };
  }

  /**
   * Validate unit number update
   */
  validateUnitNumberUpdate(
    unitNumber: string,
    floor: number,
    existingUnits: UnitFormValues[],
    currentUnitId?: string
  ): UnitUpdateValidationResult {
    const pattern = this.detectNumberingPattern(unitNumber);

    // Check for conflicts
    const conflictCheck = this.detectConflicts(unitNumber, existingUnits, currentUnitId);
    if (conflictCheck.hasConflict) {
      return {
        isValid: false,
        conflict: true,
        message: `Unit number "${unitNumber}" already exists`,
        pattern,
        suggestion: conflictCheck.suggestion,
      };
    }

    // Check floor correlation
    const floorValidation = this.validateUnitNumberFloorCorrelation(unitNumber, floor);
    if (!floorValidation.isValid) {
      const suggestion = this.suggestUnitNumberForFloor(floor, existingUnits, pattern);
      return {
        isValid: false,
        conflict: false,
        message: floorValidation.message,
        pattern,
        suggestion: suggestion.nextNumber,
      };
    }

    return {
      isValid: true,
      conflict: false,
      message: 'Unit number is valid',
      pattern,
    };
  }

  /**
   * Suggest unit number for specific floor
   */
  suggestUnitNumberForFloor(
    floor: number,
    existingUnits: UnitFormValues[],
    pattern: string
  ): UnitNumberSuggestion {
    const floorUnits = existingUnits.filter((unit) => unit.floor === floor);
    return this.generateNextUnitNumber(floorUnits, pattern, floor);
  }
}
