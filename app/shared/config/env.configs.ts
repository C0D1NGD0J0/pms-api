import dotenv from 'dotenv';
dotenv.config();

class EnvVariables {
  public EMAIL: {
    DEV: {
      PROVIDER: string;
      PROVIDER_PORT: number;
      PROVIDER_HOST: string;
      PROVIDER_USERNAME: string;
      PROVIDER_PASSWORD: string;
    };
    APP_EMAIL_ADDRESS: string;
    PROD: {
      PROVIDER: string;
      PROVIDER_HOST: string;
      PROVIDER_PORT: number;
      PROVIDER_USERNAME: string;
      PROVIDER_PASSWORD: string;
    };
  };
  public JWT: {
    EXPIREIN: string;
    SECRET: string;
    REFRESH: {
      EXPIRESIN: string;
      SECRET: string;
    };
    EXTENDED_ACCESS_TOKEN_EXPIRY: string;
    EXTENDED_REFRESH_TOKEN_EXPIRY: string;
  };
  public BULL_BOARD: {
    BASE_PATH: string;
  };
  public AWS: {
    REGION: string;
    ACCESS_KEY: string;
    SECRET_KEY: string;
    BUCKET_NAME: string;
  };
  public REDIS: {
    URL: string;
    PORT: number;
    HOST: string;
    USERNAME?: string;
    PASSWORD?: string;
  };
  public DATABASE: {
    PROD_URL: string;
    TEST_URL: string;
    DEV_URL: string;
  };
  public SERVER: {
    PORT: number;
    ENV: string;
    CLAMDSCAN_SOCKET: string;
  };
  public CLAMAV: {
    HOST: string;
    PORT: number;
    SOCKET: string;
  };
  public AUTH_COOKIE: {
    NAME: string;
  };
  public FRONTEND: {
    URL: string;
  };
  public GEOCODER: {
    PROVIDER: string;
    PROVIDER_KEY: string;
  };
  public STRIPE: {
    SECRET_KEY: string;
    PUBLIC_KEY: string;
    REDIRECT_URL: string;
    TEST_KEY: string;
    WEBHOOK_SECRET: string;
  };
  public BOLDSIGN: {
    API_KEY: string;
    API_URL: string;
    WEBHOOK_SECRET: string;
    DEFAULT_SENDER_NAME: string;
    DEFAULT_SENDER_EMAIL: string;
  };
  public APP_NAME: string;
  public PLATFORM_FEE_PERCENTAGE: number;

  constructor() {
    this.APP_NAME = process.env.APP_NAME || '';
    this.SERVER = {
      PORT: Number(process.env.PORT),
      ENV: process.env.NODE_ENV || 'dev',
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
    this.JWT = {
      EXPIREIN: process.env.JWT_EXPIREIN || '',
      SECRET: process.env.JWT_SECRET || '',
      REFRESH: {
        EXPIRESIN: process.env.JWT_REFRESH_EXPIRESIN || '',
        SECRET: process.env.JWT_REFRESH_SECRET || '',
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
        PROVIDER_PASSWORD: process.env.EMAIL_PROVIDER_USERNAME_PROD || '',
      },
      APP_EMAIL_ADDRESS: process.env.APP_EMAIL_ADDRESS || '',
    };
    this.FRONTEND = {
      URL: process.env.FRONTEND_URL || '',
    };
    this.STRIPE = {
      SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
      PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY || '',
      TEST_KEY: process.env.STRIPE_TEST_KEY || '',
      REDIRECT_URL: process.env.STRIPE_REDIRECT_URL || '',
      WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
    };
    this.BOLDSIGN = {
      API_KEY: process.env.BOLDSIGN_API_KEY || '',
      API_URL: process.env.BOLDSIGN_API_URL || 'https://api.boldsign.com/v1',
      WEBHOOK_SECRET: process.env.BOLDSIGN_WEBHOOK_SECRET || '',
      DEFAULT_SENDER_NAME:
        process.env.BOLDSIGN_DEFAULT_SENDER_NAME || this.APP_NAME || 'Property Management System',
      DEFAULT_SENDER_EMAIL:
        process.env.BOLDSIGN_DEFAULT_SENDER_EMAIL ||
        process.env.APP_EMAIL_ADDRESS ||
        'noreply@yourapp.com',
    };
    this.GEOCODER = {
      PROVIDER: process.env.GEOCODER_PROVIDER || '',
      PROVIDER_KEY: process.env.GEOCODER_PROVIDER_KEY || '',
    };
    this.CLAMAV = {
      HOST: process.env.CLAMAV_HOST || 'localhost',
      PORT: Number(process.env.CLAMAV_PORT) || 3310,
      SOCKET: process.env.CLAMDSCAN_SOCKET || '/tmp/clamd.sock',
    };
    this.PLATFORM_FEE_PERCENTAGE = Number(process.env.PLATFORM_FEE_PERCENTAGE);

    console.log('🔍 Starting environment validation...');
    try {
      this.validateSecretValue();
      console.log('✅ Environment validation passed');
    } catch (error) {
      console.error('❌ Environment validation failed:', error.message);
      throw error;
    }
  }

  private validateSecretValue(): void {
    // Critical environment variables that must be present
    // const criticalVars = ['SERVER.PORT', 'SERVER.ENV', 'DATABASE.PROD_URL', 'REDIS.URL'];

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
    } else {
      // In development/test, just warn about missing variables
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
