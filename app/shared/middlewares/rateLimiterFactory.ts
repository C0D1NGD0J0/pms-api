import crypto from 'crypto';
import slowDown from 'express-slow-down';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { httpStatusCodes } from '@utils/index';
import { RedisService } from '@database/redis-setup';
import { RateLimitOptions } from '@interfaces/utils.interface';

// Env-configurable defaults so limits can be tuned from Railway dashboard
// without redeploying.
const DEFAULT_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10);
const DEFAULT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '300000', 10); // 5 min

/**
 * Factory class to manage rate limiter instances.
 *
 * Uses Redis-backed storage (via the shared RedisService) to prevent the
 * in-memory buildup that caused OOM on long-running processes.
 * Call `setRedisService()` once during app init to wire up the Redis client;
 * until then the factory falls back to the default in-memory store.
 */
export class RateLimiterFactory {
  private static instance: RateLimiterFactory;
  private rateLimiterCache = new Map<string, any>();
  private speedLimiterCache = new Map<string, any>();
  private redisService: RedisService | null = null;

  private constructor() {}

  public static getInstance(): RateLimiterFactory {
    if (!RateLimiterFactory.instance) {
      RateLimiterFactory.instance = new RateLimiterFactory();
    }
    return RateLimiterFactory.instance;
  }

  /**
   * Inject the shared RedisService instance. Called once from app init
   * (after DI container is ready) so the factory can create Redis-backed stores
   * without importing the DI container directly.
   */
  public setRedisService(redisService: RedisService): void {
    this.redisService = redisService;
  }

  /**
   * Generate a unique key for caching based on options
   */
  private generateCacheKey(options: Partial<RateLimitOptions>): string {
    const normalizedOptions = {
      windowMs: options.windowMs || DEFAULT_WINDOW_MS,
      max: options.max || DEFAULT_MAX,
      delayAfter: options.delayAfter || 20,
      delayMs: typeof options.delayMs === 'function' ? 'function' : options.delayMs || 50000,
      message: options.message || 'Too many requests, please try again later.',
    };

    return crypto.createHash('md5').update(JSON.stringify(normalizedOptions)).digest('hex');
  }

  /**
   * Build a Redis-backed store for rate limiting.
   * Falls back to the default in-memory store if Redis is unavailable (e.g. tests).
   */
  private buildStore(prefix: string): RedisStore | undefined {
    try {
      if (process.env.NODE_ENV === 'test') return undefined;
      if (!this.redisService?.client?.isReady) return undefined;

      return new RedisStore({
        sendCommand: (...args: string[]) => this.redisService!.client.sendCommand(args),
        prefix: `rl:${prefix}:`,
      });
    } catch {
      // Redis not connected — fall back to in-memory store
      return undefined;
    }
  }

  /**
   * Get or create a rate limiter instance
   */
  public getRateLimiter(options: Partial<RateLimitOptions> = {}): any {
    const cacheKey = this.generateCacheKey(options);

    if (this.rateLimiterCache.has(cacheKey)) {
      return this.rateLimiterCache.get(cacheKey);
    }

    const windowMs = options.windowMs || DEFAULT_WINDOW_MS;
    const store = this.buildStore(cacheKey);

    const rateLimiter = rateLimit({
      windowMs,
      max: options.max || DEFAULT_MAX,
      standardHeaders: true,
      keyGenerator: options.keyGenerator,
      skip: options.skip ?? (() => process.env.NODE_ENV !== 'production'),
      ...(store ? { store } : {}),
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
      skip: options.skip ?? (() => process.env.NODE_ENV !== 'production'),
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
