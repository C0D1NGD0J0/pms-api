export interface AuthToken {
  activeAccount?: {
    csub: string;
    displayName: string;
  };
  refreshToken: string;
  rememberMe?: boolean;
  accessToken: string;
  accounts?: any[];
}

export interface ServiceResponse<T = any> {
  success: boolean;
  message: string;
  data: T | null;
}

// Type definitions for service responses to fix TypeScript errors
export interface ApiError {
  statusCode: number;
  errors?: string[];
  message: string;
}
