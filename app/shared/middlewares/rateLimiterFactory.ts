import crypto from 'crypto';
import slowDown from 'express-slow-down';
import rateLimit from 'express-rate-limit';
import { httpStatusCodes } from '@utils/index';
import { RateLimitOptions } from '@interfaces/utils.interface';

/**
 * Factory class to manage rate limiter instances
 * Creates instances once and caches them to avoid express-rate-limit validation errors
 */
export class RateLimiterFactory {
  private static instance: RateLimiterFactory;
  private rateLimiterCache = new Map<string, any>();
  private speedLimiterCache = new Map<string, any>();

  private constructor() {}

  public static getInstance(): RateLimiterFactory {
    if (!RateLimiterFactory.instance) {
      RateLimiterFactory.instance = new RateLimiterFactory();
    }
    return RateLimiterFactory.instance;
  }

  /**
   * Generate a unique key for caching based on options
   */
  private generateCacheKey(options: Partial<RateLimitOptions>): string {
    const normalizedOptions = {
      windowMs: options.windowMs || 5 * 60 * 1000,
      max: options.max || 30,
      delayAfter: options.delayAfter || 20,
      delayMs: typeof options.delayMs === 'function' ? 'function' : options.delayMs || 50000,
      message: options.message || 'Too many requests, please try again later.',
    };

    return crypto.createHash('md5').update(JSON.stringify(normalizedOptions)).digest('hex');
  }

  /**
   * Get or create a rate limiter instance
   */
  public getRateLimiter(options: Partial<RateLimitOptions> = {}): any {
    const cacheKey = this.generateCacheKey(options);

    if (this.rateLimiterCache.has(cacheKey)) {
      return this.rateLimiterCache.get(cacheKey);
    }

    const windowMs = options.windowMs || 5 * 60 * 1000; // 5 minutes default
    const rateLimiter = rateLimit({
      windowMs,
      max: options.max || 30, // 30 requests per window default
      standardHeaders: true,
      keyGenerator: options.keyGenerator,
      skip: options.skip,
      handler: (_req, res, _next) => {
        const message = options.message || 'Too many requests, please try again later.';
        // Send Retry-After header in seconds
        res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
        return res.status(httpStatusCodes.RATE_LIMITER).json({
          success: false,
          message,
          retryAfter: Math.ceil(windowMs / 1000),
        });
      },
    });

    this.rateLimiterCache.set(cacheKey, rateLimiter);
    return rateLimiter;
  }

  /**
   * Get or create a speed limiter instance
   */
  public getSpeedLimiter(options: Partial<RateLimitOptions> = {}): any {
    const cacheKey = this.generateCacheKey(options);

    if (this.speedLimiterCache.has(cacheKey)) {
      return this.speedLimiterCache.get(cacheKey);
    }

    const speedLimiter = slowDown({
      windowMs: options.windowMs || 2 * 60 * 1000, // 2 minutes default
      delayAfter: options.delayAfter || 20, // Start slowing down after 20 requests
      delayMs: options.delayMs || (() => 50000), // 50000ms delay default
    });

    this.speedLimiterCache.set(cacheKey, speedLimiter);
    return speedLimiter;
  }

  /**
   * Create a combined rate and speed limiter
   */
  public getBasicLimiter(options: Partial<RateLimitOptions> = {}): any {
    const cacheKey = `basic_${this.generateCacheKey(options)}`;

    if (this.rateLimiterCache.has(cacheKey)) {
      return this.rateLimiterCache.get(cacheKey);
    }

    const rateLimiter = this.getRateLimiter(options);
    const speedLimiter = this.getSpeedLimiter(options);

    const basicLimiter = (req: any, res: any, next: any) => {
      rateLimiter(req, res, (err?: any) => {
        if (err) return next(err);
        speedLimiter(req, res, next);
      });
    };

    this.rateLimiterCache.set(cacheKey, basicLimiter);
    return basicLimiter;
  }

  /**
   * Clear all cached instances (useful for testing)
   */
  public clearCache(): void {
    this.rateLimiterCache.clear();
    this.speedLimiterCache.clear();
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { rateLimiters: number; speedLimiters: number } {
    return {
      rateLimiters: this.rateLimiterCache.size,
      speedLimiters: this.speedLimiterCache.size,
    };
  }
}

// Export singleton instance
export const rateLimiterFactory = RateLimiterFactory.getInstance();
