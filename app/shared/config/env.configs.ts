import dotenv from 'dotenv';
dotenv.config();

import type {
  AuthCookieConfig,
  AnthropicConfig,
  BullBoardConfig,
  BoldsignConfig,
  DatabaseConfig,
  FeaturesConfig,
  FrontendConfig,
  GeocoderConfig,
  ClamavConfig,
  ServerConfig,
  StripeConfig,
  TwilioConfig,
  EmailConfig,
  RedisConfig,
  VapidConfig,
  AwsConfig,
  JwtConfig,
} from './env.types';

class EnvVariables {
  public EMAIL: EmailConfig;
  public VAPID: VapidConfig;
  public JWT: JwtConfig;
  public BULL_BOARD: BullBoardConfig;
  public AWS: AwsConfig;
  public REDIS: RedisConfig;
  public DATABASE: DatabaseConfig;
  public SERVER: ServerConfig;
  public CLAMAV: ClamavConfig;
  public AUTH_COOKIE: AuthCookieConfig;
  public FRONTEND: FrontendConfig;
  public GEOCODER: GeocoderConfig;
  public STRIPE: StripeConfig;
  public BOLDSIGN: BoldsignConfig;
  public ANTHROPIC: AnthropicConfig;
  public TWILIO: TwilioConfig;
  public FEATURES: FeaturesConfig;
  public APP_NAME: string;

  constructor() {
    this.APP_NAME = process.env.APP_NAME || '';
    this.SERVER = {
      PORT: Number(process.env.PORT),
      ENV: process.env.NODE_ENV || 'dev',
      PROCESS_TYPE: (process.env.PROCESS_TYPE as 'api' | 'worker') || 'api',
      CLAMDSCAN_SOCKET: process.env.CLAMDSCAN_SOCKET || '/tmp/clamd.sock',
    };
    this.AUTH_COOKIE = {
      NAME: process.env.AUTH_COOKIE_NAME || '',
    };
    this.BULL_BOARD = {
      BASE_PATH: process.env.BULL_BOARD_BASE_PATH || '',
    };
    this.REDIS = {
      PORT: Number(process.env.REDIS_PORT) || 6379,
      HOST: process.env.REDIS_HOST || '',
      URL:
        process.env.REDIS_URL ||
        process.env.REDIS_PRIVATE_URL ||
        process.env.REDIS_PUBLIC_URL ||
        '',
      PASSWORD: process.env.REDIS_PASSWORD || '',
      USERNAME: process.env.REDIS_USERNAME || '',
    };
    this.AWS = {
      REGION: process.env.AWS_REGION || '',
      ACCESS_KEY: process.env.AWS_ACCESS_KEY || '',
      SECRET_KEY: process.env.AWS_SECRET_KEY || '',
      BUCKET_NAME: process.env.AWS_BUCKET_NAME || '',
    };
    this.DATABASE = {
      PROD_URL:
        process.env.PROD_DB_URL ||
        process.env.DATABASE_URL ||
        process.env.DATABASE_PRIVATE_URL ||
        '',
      TEST_URL: process.env.TEST_DB_URL || '',
      DEV_URL: process.env.DEV_DB_URL || process.env.DATABASE_URL || '',
    };
    if (!process.env.JWT_SECRET) {
      throw new Error('FATAL: JWT_SECRET environment variable is required but not set.');
    }
    if (!process.env.JWT_REFRESH_SECRET) {
      throw new Error('FATAL: JWT_REFRESH_SECRET environment variable is required but not set.');
    }
    this.JWT = {
      EXPIREIN: process.env.JWT_EXPIREIN || '15m',
      SECRET: process.env.JWT_SECRET,
      REFRESH: {
        EXPIRESIN: process.env.JWT_REFRESH_EXPIRESIN || '7d',
        SECRET: process.env.JWT_REFRESH_SECRET,
      },
      EXTENDED_ACCESS_TOKEN_EXPIRY: process.env.JWT_EXTENDED_EXPIRY || '',
      EXTENDED_REFRESH_TOKEN_EXPIRY: process.env.JWT_EXTENDED_REFRESH_TOKEN_EXPIRY || '',
    };
    this.EMAIL = {
      DEV: {
        PROVIDER: process.env.EMAIL_PROVIDER_DEV || '',
        PROVIDER_PORT: Number(process.env.EMAIL_PROVIDER_PORT_DEV),
        PROVIDER_HOST: process.env.EMAIL_PROVIDER_HOST_DEV || '',
        PROVIDER_USERNAME: process.env.EMAIL_PROVIDER_USERNAME_DEV || '',
        PROVIDER_PASSWORD: process.env.EMAIL_PROVIDER_PASSWORD_DEV || '',
      },
      PROD: {
        PROVIDER: process.env.EMAIL_PROVIDER_PROD || '',
        PROVIDER_HOST: process.env.EMAIL_PROVIDER_HOST_PROD || '',
        PROVIDER_PORT: Number(process.env.EMAIL_PROVIDER_PORT_PROD),
        PROVIDER_USERNAME: process.env.EMAIL_PROVIDER_USERNAME_PROD || '',
        PROVIDER_PASSWORD: process.env.EMAIL_PROVIDER_PASSWORD_PROD || '',
      },
      APP_EMAIL_ADDRESS: process.env.APP_EMAIL_ADDRESS || '',
    };
    this.FRONTEND = {
      URL: process.env.FRONTEND_URL || '',
    };
    this.STRIPE = {
      SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
      PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY || '',
      REDIRECT_URL: process.env.STRIPE_REDIRECT_URL || '',
      WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
      CONNECT_WEBHOOK_SECRET: process.env.STRIPE_CONNECT_WEBHOOK_SECRET || '',
      // Default: $3,000 USD (in cents). Conservative limit that covers both USD and CAD.
      // Override via STRIPE_ACSS_PER_TXN_LIMIT if your Stripe account has a higher limit.
      ACSS_PER_TXN_LIMIT: Number(process.env.STRIPE_ACSS_PER_TXN_LIMIT) || 300_000,
    };
    this.BOLDSIGN = {
      API_KEY: process.env.BOLDSIGN_API_KEY || '',
      API_URL: process.env.BOLDSIGN_API_URL || 'https://api.boldsign.com/v1',
      WEBHOOK_SECRET: process.env.BOLDSIGN_WEBHOOK_SECRET || '',
      DEFAULT_SENDER_NAME:
        process.env.BOLDSIGN_DEFAULT_SENDER_NAME || this.APP_NAME || 'PropertyDesk',
      DEFAULT_SENDER_EMAIL:
        process.env.BOLDSIGN_DEFAULT_SENDER_EMAIL ||
        process.env.APP_EMAIL_ADDRESS ||
        'noreply@propertydesk.com',
    };
    this.GEOCODER = {
      PROVIDER: process.env.GEOCODER_PROVIDER || '',
      PROVIDER_KEY: process.env.GEOCODER_PROVIDER_KEY || '',
    };
    this.CLAMAV = {
      ENABLED: process.env.ENABLE_CLAMAV === 'true',
      HOST: process.env.CLAMAV_HOST || 'localhost',
      PORT: Number(process.env.CLAMAV_PORT) || 3310,
      SOCKET: process.env.CLAMDSCAN_SOCKET || '/tmp/clamd.sock',
    };
    this.ANTHROPIC = {
      API_KEY: process.env.ANTHROPIC_API_KEY || '',
      MODEL: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      MAX_TOKENS: Number(process.env.ANTHROPIC_MAX_TOKENS) || 256,
    };
    this.TWILIO = {
      ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
      AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
      VERIFY_SERVICE_SID: process.env.TWILIO_VERIFY_SERVICE_SID || '',
      MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
    };
    this.VAPID = {
      PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
      PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
      SUBJECT: process.env.VAPID_SUBJECT || 'mailto:support@propertydesk.com',
    };
    this.FEATURES = {
      AI_ENABLED: process.env.FEATURE_AI_ENABLED !== 'false',
      AI_COMMUNICATION_DRAFT_ENABLED:
        process.env.FEATURE_AI_COMMUNICATION_DRAFT_ENABLED !== 'false',
      AI_MAINTENANCE_TRIAGE_ENABLED: process.env.FEATURE_AI_MAINTENANCE_TRIAGE_ENABLED !== 'false',
      // Vision AI sends raw binary (PDF/image) content to Anthropic — opt-in only.
      // Set FEATURE_AI_INVOICE_SCANNING_ENABLED=true to enable after reviewing data-handling obligations.
      AI_INVOICE_SCANNING_ENABLED: process.env.FEATURE_AI_INVOICE_SCANNING_ENABLED === 'true',
      ESIGNATURE_ENABLED: process.env.FEATURE_ESIGNATURE_ENABLED !== 'false',
      SMS_ENABLED: process.env.FEATURE_SMS_ENABLED !== 'false',
      MCP_ENABLED: process.env.FEATURE_MCP_ENABLED !== 'false',
      PUSH_NOTIFICATIONS_ENABLED: process.env.FEATURE_PUSH_NOTIFICATIONS_ENABLED !== 'false',
      INVOICE_WEBHOOK_ENABLED: process.env.FEATURE_INVOICE_WEBHOOK_ENABLED === 'true',
    };
    try {
      this.validateSecretValue();
    } catch (error) {
      console.error('❌ Environment validation failed:', error.message);
      throw error;
    }
  }

  private validateSecretValue(): void {
    // Only validate critical variables in production
    if (this.SERVER.ENV === 'production') {
      const missingVars: string[] = [];

      if (!this.SERVER.PORT || isNaN(this.SERVER.PORT)) {
        missingVars.push('SERVER.PORT (PORT)');
      }

      if (!this.DATABASE.PROD_URL) {
        missingVars.push('DATABASE.PROD_URL (DATABASE_URL or PROD_DB_URL)');
      }

      if (!this.REDIS.URL) {
        missingVars.push('REDIS.URL (REDIS_URL, REDIS_PRIVATE_URL, or REDIS_PUBLIC_URL)');
      }

      if (missingVars.length > 0) {
        const errorMsg = `Critical environment variables missing: ${missingVars.join(', ')}`;
        console.error('❌ Environment validation failed:', errorMsg);
        throw new Error(errorMsg);
      }
    } else if (this.SERVER.ENV !== 'test') {
      // In development, warn about missing variables (skip in test to reduce noise)
      const validateObject = (obj: any, parentKey: string = '') => {
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = parentKey ? `${parentKey}.${key}` : key;
          if (typeof value === 'object' && value !== null) {
            validateObject(value, fullKey);
          } else if (
            value === undefined ||
            value === '' ||
            (typeof value === 'number' && isNaN(value))
          ) {
            console.warn(`⚠️ Environment variable ${fullKey} is not set or invalid!`);
          }
        }
      };

      validateObject(this);
    }
  }
}

export const envVariables: EnvVariables = new EnvVariables();
