export type ICsvProcessorOptions<T, C = any> = {
  postProcess?: (validItems: T[], context: C) => Promise<{ validItems: T[]; invalidItems?: any[] }>;
  validateRow?: (row: any, context: C, rowNumber: number) => Promise<ICsvValidationResult>;
  transformRow?: (row: any, context: C, rowNumber: number) => Promise<T>;
  // Optional functions to customize CSV processing
  headerTransformer?: (header: { header: string }) => string;
  context: C; // context data needed for processing (e.g. clientId, etc..)
};

export type ICsvValidationResult = {
  errors: Array<{ field: string; error: string }>;
  isValid: boolean;
};

export type ICsvProcessingError = {
  errors: Array<{ field: string; error: string }>;
  rowNumber: number;
};

export interface IInvalidCsvProperty {
  errors: { field: string; error: string }[];
  rowNumber: number;
}
