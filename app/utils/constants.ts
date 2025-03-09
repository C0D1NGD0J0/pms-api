export const httpStatusCodes = {
  OK: 200,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  UNPROCESSABLE: 422,
  UNAUTHORIZED: 401,
  RATE_LIMITER: 429,
  EXPIRED_AUTH_TOKEN: 419,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_SERVER_ERROR: 500,
};

export const JWT_KEY_NAMES = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
};

export const SLUGIFY_CONFIG = { lower: true, strict: true, replacement: '_', trim: true };

export const EMAIL_TEMPLATES = {
  PASSWORD_RESET: 'password-reset',
  FORGOT_PASSWORD: 'forgot-password',
  ACCOUNT_ACTIVATION: 'account-activation',
};
