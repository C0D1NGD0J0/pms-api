export interface FeaturesConfig {
  AI_COMMUNICATION_DRAFT_ENABLED: boolean;
  AI_MAINTENANCE_TRIAGE_ENABLED: boolean;
  AI_INVOICE_SCANNING_ENABLED: boolean;
  PUSH_NOTIFICATIONS_ENABLED: boolean;
  INVOICE_WEBHOOK_ENABLED: boolean;
  ESIGNATURE_ENABLED: boolean;
  SMS_ENABLED: boolean;
  MCP_ENABLED: boolean;
  AI_ENABLED: boolean;
}

export interface JwtConfig {
  REFRESH: {
    EXPIRESIN: string;
    SECRET: string;
  };
  EXTENDED_REFRESH_TOKEN_EXPIRY: string;
  EXTENDED_ACCESS_TOKEN_EXPIRY: string;
  EXPIREIN: string;
  SECRET: string;
}

export interface StripeConfig {
  CONNECT_WEBHOOK_SECRET: string;
  ACSS_PER_TXN_LIMIT: number;
  WEBHOOK_SECRET: string;
  REDIRECT_URL: string;
  SECRET_KEY: string;
  PUBLIC_KEY: string;
}

export interface EmailProviderConfig {
  PROVIDER_USERNAME: string;
  PROVIDER_PASSWORD: string;
  PROVIDER_PORT: number;
  PROVIDER_HOST: string;
  PROVIDER: string;
}

export interface BoldsignConfig {
  DEFAULT_SENDER_EMAIL: string;
  DEFAULT_SENDER_NAME: string;
  WEBHOOK_SECRET: string;
  API_KEY: string;
  API_URL: string;
}

export interface TwilioConfig {
  MESSAGING_SERVICE_SID: string;
  VERIFY_SERVICE_SID: string;
  ACCOUNT_SID: string;
  AUTH_TOKEN: string;
}

export interface ServerConfig {
  PROCESS_TYPE: 'api' | 'worker';
  CLAMDSCAN_SOCKET: string;
  PORT: number;
  ENV: string;
}

export interface RedisConfig {
  USERNAME?: string;
  PASSWORD?: string;
  PORT: number;
  HOST: string;
  URL: string;
}

export interface EmailConfig {
  PROD: EmailProviderConfig;
  APP_EMAIL_ADDRESS: string;
  DEV: EmailProviderConfig;
}

export interface AwsConfig {
  BUCKET_NAME: string;
  ACCESS_KEY: string;
  SECRET_KEY: string;
  REGION: string;
}

export interface ClamavConfig {
  ENABLED: boolean;
  SOCKET: string;
  HOST: string;
  PORT: number;
}

export interface VapidConfig {
  PRIVATE_KEY: string;
  PUBLIC_KEY: string;
  SUBJECT: string;
}

export interface DatabaseConfig {
  PROD_URL: string;
  TEST_URL: string;
  DEV_URL: string;
}

export interface AnthropicConfig {
  MAX_TOKENS: number;
  API_KEY: string;
  MODEL: string;
}

export interface GeocoderConfig {
  PROVIDER_KEY: string;
  PROVIDER: string;
}

export interface BullBoardConfig {
  BASE_PATH: string;
}

export interface AuthCookieConfig {
  NAME: string;
}

export interface FrontendConfig {
  URL: string;
}
