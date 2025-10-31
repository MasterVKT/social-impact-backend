import { Request, Response, NextFunction } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { logger } from '../utils/logger';
import { auditLogger } from '../monitoring/auditLogger';
import { accessControlSystem } from '../security/accessControl';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    roles?: string[];
    permissions?: string[];
    emailVerified?: boolean;
    customClaims?: Record<string, any>;
  };
}

export async function authenticationMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No valid authentication token provided'
      });
      
      await auditLogger.logUserAction(
        'anonymous',
        'access',
        'endpoint',
        req.path,
        'failure',
        { 
          service: 'auth-middleware',
          endpoint: req.path,
          method: req.method,
          reason: 'missing_token'
        }
      );
      
      return;
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    // Verify the Firebase ID token
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(idToken, true);
    
    // Get user roles and permissions
    const userRole = await accessControlSystem.getRoleDetails(decodedToken.uid);
    
    // Attach user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      roles: userRole?.roles || ['user'],
      permissions: userRole?.permissions || [],
      customClaims: decodedToken
    };

    // Log successful authentication
    await auditLogger.logUserAction(
      decodedToken.uid,
      'login',
      'session',
      decodedToken.uid,
      'success',
      {
        service: 'auth-middleware',
        endpoint: req.path,
        method: req.method,
        userAgent: req.get('user-agent')
      }
    );

    next();

  } catch (error) {
    logger.error('Authentication failed', error as Error, {
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });

    let errorMessage = 'Invalid or expired token';
    let statusCode = 401;

    if (error instanceof Error) {
      if (error.message.includes('expired')) {
        errorMessage = 'Token has expired';
      } else if (error.message.includes('invalid')) {
        errorMessage = 'Invalid token format';
      } else if (error.message.includes('revoked')) {
        errorMessage = 'Token has been revoked';
        statusCode = 403;
      }
    }

    res.status(statusCode).json({
      error: 'Authentication failed',
      message: errorMessage
    });

    await auditLogger.logUserAction(
      'anonymous',
      'login',
      'session',
      'unknown',
      'failure',
      {
        service: 'auth-middleware',
        endpoint: req.path,
        method: req.method,
        reason: error instanceof Error ? error.message : 'unknown_error'
      }
    );
  }
}

export function optionalAuthenticationMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No authentication provided, continue without user context
    next();
    return;
  }

  // Use the main authentication middleware if token is provided
  authenticationMiddleware(req, res, next);
}

export function requireRole(requiredRoles: string | string[]) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'This endpoint requires authentication'
      });
      return;
    }

    const userRoles = req.user.roles || [];
    const hasRequiredRole = roles.some(role => userRoles.includes(role));

    if (!hasRequiredRole) {
      res.status(403).json({
        error: 'Insufficient permissions',
        message: `This endpoint requires one of the following roles: ${roles.join(', ')}`,
        requiredRoles: roles,
        userRoles
      });

      await auditLogger.logUserAction(
        req.user.uid,
        'access',
        'endpoint',
        req.path,
        'failure',
        {
          service: 'auth-middleware',
          endpoint: req.path,
          method: req.method,
          reason: 'insufficient_role'
        }
      );

      return;
    }

    next();
  };
}

export function requirePermission(requiredPermissions: string | string[]) {
  const permissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'This endpoint requires authentication'
      });
      return;
    }

    const userPermissions = req.user.permissions || [];
    const hasRequiredPermission = permissions.some(permission => 
      userPermissions.includes(permission)
    );

    if (!hasRequiredPermission) {
      res.status(403).json({
        error: 'Insufficient permissions',
        message: `This endpoint requires one of the following permissions: ${permissions.join(', ')}`,
        requiredPermissions: permissions,
        userPermissions
      });

      await auditLogger.logUserAction(
        req.user.uid,
        'access',
        'endpoint',
        req.path,
        'failure',
        {
          service: 'auth-middleware',
          endpoint: req.path,
          method: req.method,
          reason: 'insufficient_permission'
        }
      );

      return;
    }

    next();
  };
}

export function requireEmailVerification() {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'This endpoint requires authentication'
      });
      return;
    }

    if (!req.user.emailVerified) {
      res.status(403).json({
        error: 'Email verification required',
        message: 'This endpoint requires a verified email address'
      });

      await auditLogger.logUserAction(
        req.user.uid,
        'access',
        'endpoint',
        req.path,
        'failure',
        {
          service: 'auth-middleware',
          endpoint: req.path,
          method: req.method,
          reason: 'email_not_verified'
        }
      );

      return;
    }

    next();
  };
}