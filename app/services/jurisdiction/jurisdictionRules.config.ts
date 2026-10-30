import * as fs from 'fs';
import * as path from 'path';

import {
  IRentIncreaseGuidelineEntry,
  IJurisdictionFormWithCode,
  IJurisdictionRulesConfig,
  IJurisdictionConfig,
  INoticePeriodEntry,
} from './jurisdiction.types';

const CONFIG_PATH = path.join(__dirname, 'jurisdiction-rules.config.json');

/**
 * Singleton accessor for the static jurisdiction rules config. Follows the same
 * load-once pattern as `subscription_plans.config.ts`. Adding a province is a
 * data-only change to `jurisdiction-rules.config.json`.
 */
class JurisdictionRulesConfig {
  private static instance: JurisdictionRulesConfig;
  private readonly config: IJurisdictionRulesConfig;

  private constructor() {
    try {
      this.config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch (error) {
      console.error('Failed to load jurisdiction-rules.config.json:', error);
      throw new Error('Jurisdiction rules configuration file not found or invalid');
    }
  }

  static getInstance(): JurisdictionRulesConfig {
    if (!JurisdictionRulesConfig.instance) {
      JurisdictionRulesConfig.instance = new JurisdictionRulesConfig();
    }
    return JurisdictionRulesConfig.instance;
  }

  getJurisdiction(code: string): IJurisdictionConfig | null {
    if (!code) return null;
    return this.config.jurisdictions[code.toUpperCase()] ?? null;
  }

  getRentGuideline(code: string, year: number): IRentIncreaseGuidelineEntry | null {
    const jurisdiction = this.getJurisdiction(code);
    if (!jurisdiction) return null;
    return jurisdiction.rentIncreaseGuidelines.find((g) => g.year === year) ?? null;
  }

  getNoticePeriod(code: string, noticeType: string): INoticePeriodEntry | null {
    const jurisdiction = this.getJurisdiction(code);
    if (!jurisdiction) return null;
    return jurisdiction.noticePeriods[noticeType] ?? null;
  }

  getForms(code: string): IJurisdictionFormWithCode[] {
    const jurisdiction = this.getJurisdiction(code);
    if (!jurisdiction) return [];
    return Object.entries(jurisdiction.forms).map(([formCode, form]) => ({
      code: formCode,
      ...form,
    }));
  }

  getFormsByContext(code: string, context: string): IJurisdictionFormWithCode[] {
    return this.getForms(code).filter((form) => form.context === context);
  }

  getSupportedJurisdictions(): string[] {
    return Object.keys(this.config.jurisdictions);
  }
}

export const jurisdictionRulesConfig = JurisdictionRulesConfig.getInstance();
export { JurisdictionRulesConfig };
