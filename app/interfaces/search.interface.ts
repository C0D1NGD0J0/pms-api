export interface IGlobalSearchResult {
  type: GlobalSearchResultType;
  subtitle?: string;
  status?: string;
  title: string;
  id: string;
}

export type GlobalSearchResultType = 'property' | 'tenant' | 'lease' | 'serviceRequest';

export interface IGlobalSearchResponse {
  results: IGlobalSearchResult[];
}
