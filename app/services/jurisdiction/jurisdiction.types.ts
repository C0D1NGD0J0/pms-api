/**
 * Compliance payload attached to the property detail response. Scoped to
 * jurisdiction reference data only — no per-property rent math (a multi-unit
 * property has many rents, so a single "max allowed rent" would be misleading).
 * Per-lease rent-guideline math lives in the lease renewal flow instead.
 */
export interface IPropertyCompliance {
  rentIncreaseRules: {
    noticePeriodDays: number;
    noticeForm: string;
    minMonthsBetweenIncreases: number;
    exemptionNote?: string;
  } | null;
  rentGuideline: {
    year: number;
    guidelinePercentage: number;
    source?: string;
  } | null;
  jurisdiction: {
    code: string;
    name: string;
    legislation: string;
  } | null;
  forms: IJurisdictionFormWithCode[];
  isSupported: boolean;
}

export interface IJurisdictionConfig {
  rentIncreaseGuidelines: IRentIncreaseGuidelineEntry[];
  noticePeriods: Record<string, INoticePeriodEntry>;
  forms: Record<string, IJurisdictionFormEntry>;
  rentIncreaseRules: IRentIncreaseRules;
  legislation: string;
  country: string;
  code: string;
  name: string;
}

export interface IRentIncreaseRules {
  minMonthsBetweenIncreases: number; // 12
  maxGuidelineCapPercent?: number; // Ontario caps at 2.5% regardless of inflation
  noticePeriodDays: number; // 90
  noticeForm: string; // "N1", "RTB-7"
  notes?: string;
}

export interface IJurisdictionRulesConfig {
  jurisdictions: Record<string, IJurisdictionConfig>;
  description?: string;
  lastUpdated: string;
  version: string;
}

export interface IJurisdictionFormEntry {
  context: JurisdictionFormContext;
  description: string;
  name: string;
  url: string;
}

export interface IRentIncreaseGuidelineEntry {
  percentage: number;
  source?: string;
  year: number;
}

export type JurisdictionFormContext = 'rentIncrease' | 'arrears' | 'endTenancy' | 'landlordUse';

/** A form entry flattened with its code (e.g. "N1"). */
export type IJurisdictionFormWithCode = IJurisdictionFormEntry & { code: string };

export interface INoticePeriodEntry {
  description: string;
  days: number;
}
