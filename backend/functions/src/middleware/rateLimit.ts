import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { auditLogger } from '../monitoring/auditLogger';
import { metricsCollector } from '../monitoring/metricsCollector';

export interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  max: number; // Maximum number of requests per window
  message?: string; // Custom message for rate limit exceeded
  skipSuccessfulRequests?: boolean; // Don't count successful requests
  skipFailedRequests?: boolean; // Don't count failed requests
  keyGenerator?: (req: Request) => string; // Custom key generator
  skip?: (req: Request) => boolean; // Skip rate limiting for certain requests
  onLimitReached?: (req: Request, res: Response) => void; // Callback when limit is reached
}

interface RateLimitData {
  count: number;
  resetTime: number;
  blocked: boolean;
}

class RateLimitStore {
  private store: Map<string, RateLimitData> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  get(key: string): RateLimitData | undefined {
    const data = this.store.get(key);
    if (data && Date.now() >= data.resetTime) {
      this.store.delete(key);
      return undefined;
    }
    return data;
  }

  set(key: string, data: RateLimitData): void {
    this.store.set(key, data);
  }

  increment(key: string, windowMs: number): RateLimitData {
    const now = Date.now();
    const existing = this.get(key);

    if (existing) {
      existing.count++;
      return existing;
    } else {
      const newData: RateLimitData = {
        count: 1,
        resetTime: now + windowMs,
        blocked: false
      };
      this.set(key, newData);
      return newData;
    }
  }

  block(key: string): void {
    const data = this.get(key);
    if (data) {
      data.blocked = true;
    }
  }

  reset(key: string): void {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, data] of this.store.entries()) {
      if (now >= data.resetTime) {
        this.store.delete(key);
      }
    }
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

const defaultStore = new RateLimitStore();

export function rateLimitMiddleware(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    message = 'Too many requests from this IP, please try again later',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = (req: Request) => req.ip,
    skip = () => false,
    onLimitReached
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Skip rate limiting if specified
      if (skip(req)) {
        next();
        return;
      }

      const key = keyGenerator(req);
      const rateLimitData = defaultStore.increment(key, windowMs);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', max.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - rateLimitData.count).toString());
      res.setHeader('X-RateLimit-Reset', new Date(rateLimitData.resetTime).toISOString());

      // Check if limit exceeded
      if (rateLimitData.count > max || rateLimitData.blocked) {
        // Mark as blocked
        defaultStore.block(key);

        // Record rate limit violation
        await metricsCollector.recordCounter('rate_limit.violations', 1, {
          endpoint: req.path,
          method: req.method,
          ip: req.ip
        });

        // Log rate limit violation
        await auditLogger.logUserAction(
          (req as any).user?.uid || 'anonymous',
          'access',
          'endpoint',
          req.path,
          'failure',
          {
            service: 'rate-limit-middleware',
            endpoint: req.path,
            method: req.method,
            reason: 'rate_limit_exceeded'
          }
        );

        // Call custom callback if provided
        if (onLimitReached) {
          onLimitReached(req, res);
        }

        const retryAfter = Math.ceil((rateLimitData.resetTime - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter.toString());

        res.status(429).json({
          error: 'Rate limit exceeded',
          message,
          retryAfter,
          limit: max,
          windowMs
        });

        logger.warn('Rate limit exceeded', {
          ip: req.ip,
          endpoint: req.path,
          method: req.method,
          count: rateLimitData.count,
          limit: max,
          userId: (req as any).user?.uid
        });

        return;
      }

      // Record successful rate limit check
      await metricsCollector.recordCounter('rate_limit.checks', 1, {
        endpoint: req.path,
        method: req.method,
        status: 'allowed'
      });

      // Handle response counting
      if (!skipSuccessfulRequests || !skipFailedRequests) {
        const originalSend = res.send;
        res.send = function(body) {
          const statusCode = res.statusCode;
          const isSuccessful = statusCode >= 200 && statusCode < 400;
          const isFailure = statusCode >= 400;

          // Decrement count if we should skip this type of request
          if ((isSuccessful && skipSuccessfulRequests) || (isFailure && skipFailedRequests)) {
            const currentData = defaultStore.get(key);
            if (currentData && currentData.count > 0) {
              currentData.count--;
            }
          }

          return originalSend.call(this, body);
        };
      }

      next();

    } catch (error) {
      logger.error('Rate limit middleware error', error as Error, {
        ip: req.ip,
        endpoint: req.path,
        method: req.method
      });

      // On error, allow the request to proceed
      next();
    }
  };
}

// Specialized rate limiters for different use cases
export const strictRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: 'Too many requests for this sensitive operation'
});

export const authRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 login attempts per window
  message: 'Too many authentication attempts',
  keyGenerator: (req: Request) => {
    // Use email if provided, otherwise fall back to IP
    const email = req.body?.email;
    return email ? `auth:${email}` : `auth:${req.ip}`;
  }
});

export const apiRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 API requests per window
  message: 'API rate limit exceeded',
  keyGenerator: (req: Request) => {
    // Use user ID if authenticated, otherwise IP
    const userId = (req as any).user?.uid;
    return userId ? `api:${userId}` : `api:${req.ip}`;
  }
});

export const uploadRateLimit = rateLimitMiddleware({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 uploads per hour
  message: 'Upload rate limit exceeded',
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.uid;
    return userId ? `upload:${userId}` : `upload:${req.ip}`;
  }
});

export const searchRateLimit = rateLimitMiddleware({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 searches per 5 minutes
  message: 'Search rate limit exceeded',
  skipSuccessfulRequests: true // Don't count successful searches
});

// Advanced rate limiting with burst capacity
export function createBurstRateLimit(options: {
  burstLimit: number;
  sustainedLimit: number;
  burstWindowMs: number;
  sustainedWindowMs: number;
  message?: string;
}) {
  const burstLimiter = rateLimitMiddleware({
    windowMs: options.burstWindowMs,
    max: options.burstLimit,
    message: options.message || 'Burst rate limit exceeded'
  });

  const sustainedLimiter = rateLimitMiddleware({
    windowMs: options.sustainedWindowMs,
    max: options.sustainedLimit,
    message: options.message || 'Sustained rate limit exceeded'
  });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Check burst limit first
    burstLimiter(req, res, (err) => {
      if (err || res.headersSent) {
        return; // Burst limit exceeded
      }

      // Check sustained limit
      sustainedLimiter(req, res, next);
    });
  };
}

// IP-based rate limiting with whitelist support
export function createIPRateLimit(options: {
  windowMs: number;
  max: number;
  whitelist?: string[];
  message?: string;
}) {
  return rateLimitMiddleware({
    ...options,
    skip: (req: Request) => {
      if (options.whitelist && options.whitelist.includes(req.ip)) {
        return true;
      }
      return false;
    },
    keyGenerator: (req: Request) => `ip:${req.ip}`
  });
}

// User-based rate limiting
export function createUserRateLimit(options: {
  windowMs: number;
  max: number;
  guestMax?: number;
  message?: string;
}) {
  return rateLimitMiddleware({
    ...options,
    max: options.max,
    keyGenerator: (req: Request) => {
      const userId = (req as any).user?.uid;
      return userId ? `user:${userId}` : `guest:${req.ip}`;
    },
    skip: (req: Request) => {
      // Apply different limits for guests
      if (options.guestMax && !(req as any).user?.uid) {
        return false; // Let the guest rate limiter handle it
      }
      return false;
    }
  });
}

// Endpoint-specific rate limiting
export function createEndpointRateLimit(endpointLimits: Record<string, {
  windowMs: number;
  max: number;
  message?: string;
}>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const endpoint = req.path;
    const limits = endpointLimits[endpoint];

    if (!limits) {
      next();
      return;
    }

    const limiter = rateLimitMiddleware({
      ...limits,
      keyGenerator: (req: Request) => `endpoint:${endpoint}:${req.ip}`
    });

    limiter(req, res, next);
  };
}

// Cleanup function for graceful shutdown
export function shutdownRateLimitStore(): void {
  defaultStore.shutdown();
}