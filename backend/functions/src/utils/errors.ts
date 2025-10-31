import { https } from 'firebase-functions';
import { logger } from './logger';
import { auditLogger } from '../monitoring/auditLogger';
import { metricsCollector } from '../monitoring/metricsCollector';

export abstract class BaseError extends Error {
  abstract readonly statusCode: number;
  abstract readonly errorCode: string;
  abstract readonly isOperational: boolean;
  
  constructor(
    message: string,
    public readonly context?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      errorCode: this.errorCode,
      context: this.context,
      stack: this.stack
    };
  }
}

export class AppError extends BaseError {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly isOperational = true;

  constructor(code: string, message: string, statusCode: number = 500, context?: Record<string, any>) {
    super(message, context);
    this.code = code;
    this.statusCode = statusCode;
    this.errorCode = code;
  }
}

export class ValidationError extends AppError {
  public readonly field?: string;

  constructor(message: string, field?: string, value?: any, context?: Record<string, any>) {
    super('VALIDATION_ERROR', message, 400, { ...context, field, value });
    this.field = field;
  }
}

export class SchemaValidationError extends ValidationError {
  readonly errorCode = 'SCHEMA_VALIDATION_ERROR';

  constructor(
    message: string,
    public readonly violations: Array<{
      field: string;
      message: string;
      value?: any;
    }>,
    context?: Record<string, any>
  ) {
    super(message, undefined, undefined, { ...context, violations });
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required', context?: Record<string, any>) {
    super('AUTHENTICATION_ERROR', message, 401, context);
  }
}

export class AuthorizationError extends AppError {
  constructor(
    message: string = 'Insufficient permissions',
    requiredRoles?: string[],
    userRoles?: string[],
    context?: Record<string, any>
  ) {
    super('AUTHORIZATION_ERROR', message, 403, { ...context, requiredRoles, userRoles });
  }
}

export class TokenExpiredError extends AuthenticationError {
  constructor(message: string = 'Authentication token has expired', context?: Record<string, any>) {
    super(message, context);
  }
}

export class InvalidTokenError extends AuthenticationError {
  constructor(message: string = 'Invalid authentication token', context?: Record<string, any>) {
    super(message, context);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super('NOT_FOUND', `${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists') {
    super('CONFLICT_ERROR', message, 409);
  }
}

export class PaymentError extends AppError {
  constructor(
    message: string,
    public readonly paymentCode?: string,
    public readonly amount?: number,
    public readonly currency?: string,
    context?: Record<string, any>
  ) {
    super('PAYMENT_ERROR', message, 402, { ...context, paymentCode, amount, currency });
  }
}

export class FraudDetectionError extends AppError {
  constructor(
    message: string = 'Transaction blocked by fraud detection',
    public readonly riskScore?: number,
    public readonly riskFactors?: string[],
    context?: Record<string, any>
  ) {
    super('FRAUD_DETECTION_BLOCKED', message, 403, { ...context, riskScore, riskFactors });
  }
}

export class ComplianceError extends AppError {
  constructor(
    message: string,
    public readonly complianceRule?: string,
    public readonly jurisdiction?: string,
    context?: Record<string, any>
  ) {
    super('COMPLIANCE_VIOLATION', message, 403, { ...context, complianceRule, jurisdiction });
  }
}

export class ExternalServiceError extends AppError {
  public readonly service: string;
  public readonly originalError: any;

  constructor(service: string, originalError: any, message?: string, context?: Record<string, any>) {
    super(
      'EXTERNAL_SERVICE_ERROR',
      message || `${service} service error: ${originalError.message}`,
      502,
      { ...context, service, originalError: originalError.message }
    );
    this.service = service;
    this.originalError = originalError;
  }
}

export class DatabaseError extends AppError {
  constructor(
    message: string,
    public readonly operation?: string,
    public readonly collection?: string,
    context?: Record<string, any>
  ) {
    super('DATABASE_ERROR', message, 503, { ...context, operation, collection });
  }
}

export class NetworkError extends ExternalServiceError {
  constructor(
    message: string,
    public readonly endpoint?: string,
    public readonly timeout?: boolean,
    context?: Record<string, any>
  ) {
    super('network', { message }, message, { ...context, endpoint, timeout });
  }
}

export class SystemError extends AppError {
  readonly isOperational = false;

  constructor(message: string = 'Internal system error', context?: Record<string, any>) {
    super('SYSTEM_ERROR', message, 500, context);
  }
}

export class BusinessRuleViolationError extends AppError {
  constructor(rule: string, message: string, context?: Record<string, any>) {
    super('BUSINESS_RULE_VIOLATION', `${rule}: ${message}`, 400, { rule, ...context });
  }
}

// ============================================================================
// ERROR HANDLING UTILITIES
// ============================================================================

export class ErrorHandler {
  static async handleError(error: Error, context?: {
    userId?: string;
    requestId?: string;
    endpoint?: string;
    method?: string;
    ip?: string;
  }): Promise<void> {
    try {
      // Log the error
      logger.error(error.message, error, context);

      // Record metrics
      await metricsCollector.recordCounter('errors.total', 1, {
        errorType: error.constructor.name,
        endpoint: context?.endpoint || 'unknown',
        method: context?.method || 'unknown'
      });

      // Audit log for security-related errors
      if (this.isSecurityError(error)) {
        await auditLogger.logUserAction(
          context?.userId || 'anonymous',
          'security',
          'error',
          context?.endpoint || 'unknown',
          'failure',
          {
            service: 'error-handler',
            errorType: error.constructor.name,
            errorMessage: error.message,
            ip: context?.ip
          }
        );
      }

      // Alert for critical errors
      if (this.isCriticalError(error)) {
        await this.sendCriticalAlert(error, context);
      }

    } catch (handlingError) {
      // If error handling fails, log with fallback logger
      console.error('Error handling failed:', handlingError);
      console.error('Original error:', error);
    }
  }

  static isOperationalError(error: Error): boolean {
    if (error instanceof BaseError) {
      return error.isOperational;
    }
    return false;
  }

  static isSecurityError(error: Error): boolean {
    return error instanceof AuthenticationError ||
           error instanceof AuthorizationError ||
           error instanceof FraudDetectionError ||
           error instanceof ComplianceError;
  }

  static isCriticalError(error: Error): boolean {
    return error instanceof SystemError ||
           error instanceof DatabaseError ||
           (error instanceof ExternalServiceError && error.service === 'payment');
  }

  static getErrorResponse(error: Error, includeStack = false): {
    error: string;
    message: string;
    statusCode: number;
    errorCode?: string;
    context?: any;
    stack?: string;
  } {
    if (error instanceof AppError) {
      return {
        error: error.name,
        message: error.message,
        statusCode: error.statusCode,
        errorCode: error.errorCode,
        context: error.context,
        ...(includeStack && { stack: error.stack })
      };
    }

    // Handle unknown errors
    return {
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      statusCode: 500,
      errorCode: 'UNKNOWN_ERROR',
      ...(includeStack && { stack: error.stack })
    };
  }

  private static async sendCriticalAlert(error: Error, context?: any): Promise<void> {
    try {
      // This would integrate with alerting service (e.g., PagerDuty, Slack)
      logger.error('CRITICAL ERROR ALERT', error, {
        ...context,
        severity: 'critical',
        timestamp: new Date().toISOString()
      });

      // Record critical error metric
      await metricsCollector.recordCounter('errors.critical', 1, {
        errorType: error.constructor.name,
        service: 'social-finance-platform'
      });

    } catch (alertError) {
      console.error('Failed to send critical alert:', alertError);
    }
  }
}

const httpsErrorCodeMapping: Record<string, any> = {
  'VALIDATION_ERROR': 'invalid-argument',
  'SCHEMA_VALIDATION_ERROR': 'invalid-argument',
  'AUTHENTICATION_ERROR': 'unauthenticated',
  'AUTHORIZATION_ERROR': 'permission-denied',
  'NOT_FOUND': 'not-found',
  'CONFLICT_ERROR': 'already-exists',
  'PAYMENT_ERROR': 'failed-precondition',
  'FRAUD_DETECTION_BLOCKED': 'permission-denied',
  'COMPLIANCE_VIOLATION': 'permission-denied',
  'EXTERNAL_SERVICE_ERROR': 'unavailable',
  'DATABASE_ERROR': 'unavailable',
  'SYSTEM_ERROR': 'internal',
  'BUSINESS_RULE_VIOLATION': 'failed-precondition'
};

export function convertToHttpsError(error: any): https.HttpsError {
  if (error instanceof https.HttpsError) {
    return error;
  }

  if (error instanceof AppError) {
    const code = httpsErrorCodeMapping[error.code] || 'internal';
    return new https.HttpsError(code, error.message, error.context);
  }

  // Log unexpected errors
  logger.error('Unhandled error type', error, { errorType: error.constructor.name });
  
  return new https.HttpsError(
    'internal',
    'An unexpected error occurred',
    { originalError: error.message }
  );
}

export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      throw convertToHttpsError(error);
    }
  };
}

export function withRetry<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  maxRetries: number = 3,
  backoffMs: number = 1000
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries) break;
        
        // Only retry on transient errors
        if (error instanceof ExternalServiceError || error instanceof NetworkError || error instanceof DatabaseError) {
          const delay = backoffMs * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        break; // Don't retry non-transient errors
      }
    }
    
    throw lastError;
  };
}

// ============================================================================
// ERROR FACTORY FUNCTIONS
// ============================================================================

export const createValidationError = (
  message: string,
  field?: string,
  value?: any
): ValidationError => new ValidationError(message, field, value);

export const createNotFoundError = (
  resourceType: string,
  resourceId: string
): NotFoundError => new NotFoundError(`${resourceType} with ID '${resourceId}' not found`);

export const createAuthError = (
  message?: string
): AuthenticationError => new AuthenticationError(message);

export const createAuthzError = (
  requiredRoles: string[],
  userRoles: string[] = []
): AuthorizationError => new AuthorizationError(
  `Access denied. Required roles: ${requiredRoles.join(', ')}`,
  requiredRoles,
  userRoles
);

export const createPaymentError = (
  message: string,
  code?: string,
  amount?: number,
  currency?: string
): PaymentError => new PaymentError(message, code, amount, currency);

export const createFraudError = (
  riskScore: number,
  riskFactors: string[]
): FraudDetectionError => new FraudDetectionError(
  `Transaction blocked due to fraud risk (score: ${riskScore})`,
  riskScore,
  riskFactors
);

// ============================================================================
// ERROR UTILITIES
// ============================================================================

export function isKnownError(error: any): error is AppError {
  return error instanceof AppError;
}

export function getHttpStatus(error: Error): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }
  return 500;
}

export function getErrorCode(error: Error): string {
  if (error instanceof AppError) {
    return error.errorCode;
  }
  return 'UNKNOWN_ERROR';
}

// ============================================================================
// ASYNC ERROR WRAPPER
// ============================================================================

export function asyncHandler<T extends any[], R>(
  fn: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      await ErrorHandler.handleError(error as Error);
      throw error;
    }
  };
}