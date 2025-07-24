export type ICsvProcessorOptions<T, C = any> = {
  postProcess?: (validItems: T[], context: C) => Promise<{ validItems: T[]; invalidItems?: any[] }>;
  validateRow?: (row: any, context: C, rowNumber: number) => Promise<ICsvValidationResult>;
  transformRow?: (row: any, context: C, rowNumber: number) => Promise<T>;
  headerTransformer?: (header: { header: string }) => string | null;
  validateHeaders?: (headers: string[]) => ICsvHeaderValidationResult; // Returns validation result object
  processBatch?: (batch: T[], context: C) => Promise<void>; // Stream processing option
  context: C;
};

export type ICsvHeaderValidationResult = {
  isValid: boolean;
  missingHeaders: string[];
  foundHeaders: string[];
  errorMessage?: string;
};

export type ICsvValidationResult = {
  errors: Array<{ field: string; error: string }>;
  isValid: boolean;
};

export type ICsvProcessingError = {
  errors: Array<{ field: string; error: string }>;
  rowNumber: number;
};

export interface IInvalidCsvInvitation {
  errors: { field: string; error: string }[];
  rowNumber: number;
}

export interface IInvalidCsvProperty {
  errors: { field: string; error: string }[];
  rowNumber: number;
}
