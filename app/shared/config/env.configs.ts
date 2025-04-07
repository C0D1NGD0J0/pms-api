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
    PORT: number;
    HOST: string;
    URL: string;
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
  public APP_NAME: string;
  public PLATFORM_FEE_PERCENTAGE: number;

  constructor() {
    this.APP_NAME = process.env.APP_NAME || '';
    this.SERVER = {
      PORT: Number(process.env.PORT),
      ENV: process.env.NODE_ENV || 'dev',
      CLAMDSCAN_SOCKET: process.env.CLAMDSCAN_SOCKET || '/usr/local/var/run/clamav/clamd.sock',
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
      URL: process.env.REDIS_URL || '',
    };
    this.AWS = {
      REGION: process.env.AWS_REGION || '',
      ACCESS_KEY: process.env.AWS_ACCESS_KEY || '',
      SECRET_KEY: process.env.AWS_SECRET_KEY || '',
      BUCKET_NAME: process.env.AWS_BUCKET_NAME || '',
    };
    this.DATABASE = {
      PROD_URL: process.env.PROD_DB_URL || '',
      TEST_URL: process.env.TEST_DB_URL || '',
      DEV_URL: process.env.DEV_DB_URL || '',
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
    this.GEOCODER = {
      PROVIDER: process.env.GEOCODER_PROVIDER || '',
      PROVIDER_KEY: process.env.GEOCODER_PROVIDER_KEY || '',
    };
    this.PLATFORM_FEE_PERCENTAGE = Number(process.env.PLATFORM_FEE_PERCENTAGE);
    this.validateSecretValue();
  }

  private validateSecretValue(): void {
    const validateObject = (obj: any, parentKey: string = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = parentKey ? `${parentKey}.${key}` : key;
        if (typeof value === 'object' && value !== null) {
          validateObject(value, fullKey);
        } else if (value === undefined || value === '') {
          throw new Error(`Environment variable ${fullKey} not found!`);
        }
      }
    };

    validateObject(this);
  }
}

export const envVariables: EnvVariables = new EnvVariables();
