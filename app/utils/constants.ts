export const httpStatusCodes = {
  OK: 200,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  UNPROCESSABLE: 422,
  UNAUTHORIZED: 401,
  INTERNAL_SERVER: 500,
  RATE_LIMITER: 429,
  SERVICE_UNAVAILABLE: 503,
  EXPIRED_AUTH_TOKEN: 419,
};

export const JWT_KEY_NAMES = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
};

export const SLUGIFY_CONFIG = { lower: true, strict: true, replacement: '_', trim: true };
