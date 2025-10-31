import { Request, Response, NextFunction } from 'express';
import { threatDetectionSystem } from './threatDetection';
import { accessControlSystem, AccessContext } from './accessControl';
import { securityMonitoringSystem, logAuthenticationEvent, logAuthorizationEvent } from './securityMonitoring';
import { logger } from '../utils/logger';

export interface SecurityMiddlewareOptions {
  enableThreatDetection?: boolean;
  enableAccessControl?: boolean;
  enableMonitoring?: boolean;
  requiredPermissions?: string[];
  riskThreshold?: number;
  blockOnHighRisk?: boolean;
}

export interface SecureRequest extends Request {
  security?: {
    threatAnalysis: any;
    accessDecision: any;
    riskScore: number;
    userId?: string;
    sessionId?: string;
  };
  user?: {
    uid: string;
    email?: string;
    roles?: string[];
    permissions?: string[];
    [key: string]: any;
  };
}

/**
 * Comprehensive security middleware that integrates all security components
 */
export function createSecurityMiddleware(options: SecurityMiddlewareOptions = {}) {
  const {
    enableThreatDetection = true,
    enableAccessControl = true,
    enableMonitoring = true,
    requiredPermissions = [],
    riskThreshold = 80,
    blockOnHighRisk = true
  } = options;

  return async (req: SecureRequest, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    try {
      // Initialize security context
      req.security = {
        threatAnalysis: null,
        accessDecision: null,
        riskScore: 0,
        userId: req.user?.uid,
        sessionId: generateSessionId(req)
      };

      // Step 1: Threat Detection
      if (enableThreatDetection) {
        const threatResult = await runThreatDetection(req);
        req.security.threatAnalysis = threatResult;
        req.security.riskScore = Math.max(req.security.riskScore, threatResult.riskScore);

        // Block if threat detected
        if (threatResult.isBlocked) {
          await logSecurityViolation(req, 'threat_detection', 'blocked', threatResult.threats);
          return sendSecurityResponse(res, 403, 'Request blocked due to security threat', {
            riskScore: threatResult.riskScore,
            threats: threatResult.threats.map(t => t.type)
          });
        }

        // Block on high risk if configured
        if (blockOnHighRisk && threatResult.riskScore >= riskThreshold) {
          await logSecurityViolation(req, 'high_risk', 'blocked', threatResult.threats);
          return sendSecurityResponse(res, 403, 'Request blocked due to high risk score', {
            riskScore: threatResult.riskScore
          });
        }
      }

      // Step 2: Access Control
      if (enableAccessControl && req.user?.uid) {
        const accessResult = await runAccessControl(req, requiredPermissions);
        req.security.accessDecision = accessResult;
        req.security.riskScore = Math.max(req.security.riskScore, accessResult.riskScore);

        // Block if access denied
        if (!accessResult.allowed) {
          await logSecurityViolation(req, 'access_denied', 'blocked', []);
          return sendSecurityResponse(res, 403, 'Access denied', {
            reason: accessResult.reason,
            requiredPermissions,
            missingPermissions: accessResult.missingPermissions
          });
        }
      }

      // Step 3: Security Monitoring
      if (enableMonitoring) {
        await logSecurityEvent(req, 'success');
      }

      // Add security headers
      addSecurityHeaders(res);

      // Log performance metrics
      const processingTime = Date.now() - startTime;
      logger.info('Security middleware completed', {
        path: req.path,
        method: req.method,
        userId: req.user?.uid,
        riskScore: req.security.riskScore,
        processingTime,
        blocked: false
      });

      next();

    } catch (error) {
      logger.error('Security middleware error', error as Error, {
        path: req.path,
        method: req.method,
        userId: req.user?.uid
      });

      // On security system error, log and allow request to proceed with warning
      await logSecurityEvent(req, 'error', { error: (error as Error).message });
      
      res.setHeader('X-Security-Status', 'degraded');
      next();
    }
  };
}

/**
 * Authentication-specific security middleware
 */
export function createAuthSecurityMiddleware() {
  return async (req: SecureRequest, res: Response, next: NextFunction) => {
    try {
      const authResult = extractAuthInfo(req);
      
      if (authResult.outcome === 'failure') {
        await logAuthenticationEvent(
          authResult.userId || 'anonymous',
          req.ip,
          'failure',
          {
            action: authResult.action,
            reason: authResult.reason,
            userAgent: req.get('user-agent')
          }
        );

        // Check for brute force patterns
        const recentFailures = await getRecentAuthFailures(req.ip);
        if (recentFailures >= 5) {
          return sendSecurityResponse(res, 429, 'Too many failed authentication attempts', {
            retryAfter: 900 // 15 minutes
          });
        }
      } else if (authResult.outcome === 'success') {
        await logAuthenticationEvent(
          authResult.userId!,
          req.ip,
          'success',
          {
            action: authResult.action,
            userAgent: req.get('user-agent')
          }
        );
      }

      next();

    } catch (error) {
      logger.error('Auth security middleware error', error as Error);
      next();
    }
  };
}

/**
 * Data protection middleware for sensitive operations
 */
export function createDataProtectionMiddleware(protectionLevel: 'pii' | 'financial' | 'sensitive' = 'sensitive') {
  return async (req: SecureRequest, res: Response, next: NextFunction) => {
    try {
      // Validate data access permissions
      if (!req.user?.uid) {
        return sendSecurityResponse(res, 401, 'Authentication required for data access');
      }

      // Check data classification clearance
      const hasDataClearance = await checkDataClearance(req.user.uid, protectionLevel);
      if (!hasDataClearance) {
        await logAuthorizationEvent(
          req.user.uid,
          req.ip,
          req.path,
          req.method,
          'blocked',
          { reason: 'Insufficient data clearance', level: protectionLevel }
        );

        return sendSecurityResponse(res, 403, 'Insufficient clearance for data access', {
          requiredLevel: protectionLevel
        });
      }

      // Add data protection headers
      res.setHeader('X-Data-Classification', protectionLevel.toUpperCase());
      res.setHeader('X-Content-Security-Policy', 'default-src \'none\'');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      next();

    } catch (error) {
      logger.error('Data protection middleware error', error as Error);
      next();
    }
  };
}

/**
 * Rate limiting security middleware
 */
export function createRateLimitMiddleware(
  requestsPerWindow: number = 100,
  windowMinutes: number = 15
) {
  const requestCounts = new Map<string, { count: number; resetTime: number }>();

  return async (req: SecureRequest, res: Response, next: NextFunction) => {
    try {
      const identifier = req.user?.uid || req.ip;
      const now = Date.now();
      const windowMs = windowMinutes * 60 * 1000;

      // Get or initialize counter
      let counter = requestCounts.get(identifier);
      if (!counter || now >= counter.resetTime) {
        counter = { count: 0, resetTime: now + windowMs };
        requestCounts.set(identifier, counter);
      }

      counter.count++;

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', requestsPerWindow.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, requestsPerWindow - counter.count).toString());
      res.setHeader('X-RateLimit-Reset', new Date(counter.resetTime).toISOString());

      // Check rate limit
      if (counter.count > requestsPerWindow) {
        await logSecurityEvent(req, 'rate_limited');

        return sendSecurityResponse(res, 429, 'Rate limit exceeded', {
          retryAfter: Math.ceil((counter.resetTime - now) / 1000)
        });
      }

      next();

    } catch (error) {
      logger.error('Rate limit middleware error', error as Error);
      next();
    }
  };
}

// Helper functions
async function runThreatDetection(req: SecureRequest) {
  return await threatDetectionSystem.detectThreats({
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: req.user?.uid,
    endpoint: req.path,
    method: req.method,
    payload: req.body,
    headers: req.headers as Record<string, string>
  });
}

async function runAccessControl(req: SecureRequest, requiredPermissions: string[]) {
  const context: AccessContext = {
    userId: req.user!.uid,
    userRoles: req.user?.roles || [],
    userPermissions: req.user?.permissions || [],
    resource: req.path,
    action: req.method,
    resourceData: { ...req.params, ...req.query },
    requestData: req.body,
    ip: req.ip,
    timestamp: new Date()
  };

  return await accessControlSystem.checkAccess(context);
}

async function logSecurityEvent(req: SecureRequest, outcome: 'success' | 'blocked' | 'rate_limited' | 'error', details?: any) {
  const eventType = determineEventType(req.path, req.method);
  const severity = outcome === 'success' ? 'info' : outcome === 'error' ? 'medium' : 'high';

  await securityMonitoringSystem.logSecurityEvent({
    type: eventType,
    severity,
    source: {
      userId: req.user?.uid,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      service: 'api'
    },
    details: {
      action: `${req.method} ${req.path}`,
      outcome,
      ...details
    },
    risk: {
      score: req.security?.riskScore || 0,
      factors: extractRiskFactors(req, outcome),
      confidence: 0.8
    }
  });
}

async function logSecurityViolation(req: SecureRequest, violationType: string, outcome: string, threats: any[]) {
  await securityMonitoringSystem.logSecurityEvent({
    type: 'security_violation',
    severity: 'high',
    source: {
      userId: req.user?.uid,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      service: 'security_middleware'
    },
    details: {
      action: `${req.method} ${req.path}`,
      outcome,
      violationType,
      threats: threats.map(t => t.type)
    },
    risk: {
      score: req.security?.riskScore || 90,
      factors: ['security_violation', violationType, ...threats.map(t => t.type)],
      confidence: 0.95
    }
  });
}

function addSecurityHeaders(res: Response) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Security-Framework', 'active');
}

function sendSecurityResponse(res: Response, status: number, message: string, details?: any) {
  res.status(status).json({
    error: message,
    code: status,
    timestamp: new Date().toISOString(),
    security: true,
    ...details
  });
}

function generateSessionId(req: SecureRequest): string {
  const components = [
    req.ip,
    req.user?.uid,
    req.get('user-agent')
  ].filter(Boolean);

  const crypto = require('crypto');
  return crypto.createHash('sha256')
    .update(components.join('|'))
    .digest('hex')
    .substring(0, 16);
}

function extractAuthInfo(req: SecureRequest): {
  outcome: 'success' | 'failure';
  action: string;
  userId?: string;
  reason?: string;
} {
  // Extract authentication result from request
  // This would be populated by authentication middleware
  const authHeader = req.get('authorization');
  const isAuthenticated = !!req.user?.uid;

  if (req.path.includes('/auth/login')) {
    return {
      outcome: isAuthenticated ? 'success' : 'failure',
      action: 'login',
      userId: req.user?.uid,
      reason: !isAuthenticated ? 'invalid_credentials' : undefined
    };
  }

  if (req.path.includes('/auth/register')) {
    return {
      outcome: 'success', // Registration attempts are logged separately
      action: 'register',
      userId: req.user?.uid
    };
  }

  return {
    outcome: isAuthenticated ? 'success' : 'failure',
    action: 'token_validation',
    userId: req.user?.uid,
    reason: !isAuthenticated ? 'invalid_token' : undefined
  };
}

async function getRecentAuthFailures(ip: string): Promise<number> {
  try {
    const cutoffTime = new Date(Date.now() - 15 * 60 * 1000); // Last 15 minutes
    
    const searchResults = await securityMonitoringSystem.searchEvents({
      type: 'authentication',
      ip,
      timeRange: { start: cutoffTime, end: new Date() },
      limit: 100
    });

    return searchResults.filter(event => 
      event.details.outcome === 'failure'
    ).length;

  } catch (error) {
    logger.error('Failed to get recent auth failures', error as Error, { ip });
    return 0;
  }
}

async function checkDataClearance(userId: string, level: string): Promise<boolean> {
  try {
    const userRole = await accessControlSystem.getRoleDetails(userId);
    if (!userRole) return false;

    const dataClearanceMap: Record<string, string[]> = {
      'pii': ['admin', 'moderator'],
      'financial': ['admin', 'auditor'],
      'sensitive': ['admin', 'moderator', 'auditor', 'creator']
    };

    const requiredRoles = dataClearanceMap[level] || [];
    return userRole.roles.some(role => requiredRoles.includes(role));

  } catch (error) {
    logger.error('Failed to check data clearance', error as Error, { userId, level });
    return false;
  }
}

function determineEventType(path: string, method: string): 'authentication' | 'authorization' | 'data_access' | 'system_change' | 'threat_detected' | 'security_violation' {
  if (path.includes('/auth/')) return 'authentication';
  if (path.includes('/admin/')) return 'system_change';
  if (method === 'GET' && (path.includes('/api/users/') || path.includes('/api/projects/'))) return 'data_access';
  if (method !== 'GET') return 'authorization';
  return 'data_access';
}

function extractRiskFactors(req: SecureRequest, outcome: string): string[] {
  const factors: string[] = [];

  if (outcome !== 'success') factors.push('request_blocked');
  if (req.path.includes('/admin/')) factors.push('admin_access');
  if (req.method === 'DELETE') factors.push('destructive_operation');
  if (req.path.includes('/auth/')) factors.push('authentication_attempt');
  if (req.security?.riskScore && req.security.riskScore > 50) factors.push('high_risk_score');

  return factors;
}

// Cleanup function for rate limiting maps
setInterval(() => {
  // This would be implemented to clean up expired entries
  // In a production environment, this should use Redis or similar
}, 5 * 60 * 1000); // Clean up every 5 minutes

export {
  SecureRequest,
  SecurityMiddlewareOptions
};