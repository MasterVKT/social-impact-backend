/**
 * Système de logging structuré - Social Finance Impact Platform
 * Logging centralisé avec support pour différents niveaux et contextes
 */

/**
 * Interface pour le contexte de logging
 */
export interface LogContext {
  userId?: string;
  projectId?: string;
  contributionId?: string;
  auditId?: string;
  functionName?: string;
  traceId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  [key: string]: any;
}

/**
 * Niveaux de log
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

/**
 * Interface pour une entrée de log structurée
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  data?: any;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
    statusCode?: number;
  };
  performance?: {
    startTime: number;
    duration?: number;
    memoryUsage?: NodeJS.MemoryUsage;
  };
  security?: {
    sensitive: boolean;
    sanitized: boolean;
  };
}

/**
 * Classe principale du logger
 */
class Logger {
  private context: LogContext = {};
  private startTime: number = Date.now();
  private readonly environment: string;
  private readonly logLevel: LogLevel;

  constructor() {
    this.environment = process.env.NODE_ENV || 'development';
    this.logLevel = this.getLogLevel();
  }

  /**
   * Définit le niveau de log selon l'environnement
   */
  private getLogLevel(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    
    switch (envLevel) {
      case 'debug':
        return LogLevel.DEBUG;
      case 'info':
        return LogLevel.INFO;
      case 'warn':
        return LogLevel.WARN;
      case 'error':
        return LogLevel.ERROR;
      case 'fatal':
        return LogLevel.FATAL;
      default:
        return this.environment === 'production' ? LogLevel.INFO : LogLevel.DEBUG;
    }
  }

  /**
   * Vérifie si un niveau de log doit être affiché
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = Object.values(LogLevel);
    const currentIndex = levels.indexOf(this.logLevel);
    const messageIndex = levels.indexOf(level);
    
    return messageIndex >= currentIndex;
  }

  /**
   * Définit le contexte global du logger
   */
  public setContext(context: LogContext): Logger {
    this.context = { ...this.context, ...context };
    return this;
  }

  /**
   * Réinitialise le contexte
   */
  public clearContext(): Logger {
    this.context = {};
    return this;
  }

  /**
   * Crée une entrée de log formatée
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    data?: any,
    error?: Error,
    additionalContext?: LogContext
  ): LogEntry {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
    };

    // Contexte combiné
    if (Object.keys(this.context).length > 0 || additionalContext) {
      entry.context = { ...this.context, ...additionalContext };
    }

    // Données additionnelles
    if (data !== undefined) {
      entry.data = this.sanitizeData(data);
    }

    // Gestion des erreurs
    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
        statusCode: (error as any).statusCode,
      };
    }

    // Métriques de performance
    if (level === LogLevel.DEBUG || this.environment === 'development') {
      entry.performance = {
        startTime: this.startTime,
        duration: Date.now() - this.startTime,
        memoryUsage: process.memoryUsage(),
      };
    }

    return entry;
  }

  /**
   * Sanitise les données sensibles
   */
  private sanitizeData(data: any): any {
    if (!data) return data;

    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'authorization',
      'cookie',
      'ssn',
      'creditCard',
      'cardNumber',
      'cvv',
      'bankAccount',
      'iban',
    ];

    const sanitize = (obj: any, depth = 0): any => {
      if (depth > 10) return '[Max Depth Reached]';
      
      if (obj === null || typeof obj !== 'object') {
        return obj;
      }

      if (Array.isArray(obj)) {
        return obj.map(item => sanitize(item, depth + 1));
      }

      const sanitized: any = {};
      
      for (const [key, value] of Object.entries(obj)) {
        const keyLower = key.toLowerCase();
        
        if (sensitiveFields.some(field => keyLower.includes(field))) {
          sanitized[key] = '[REDACTED]';
        } else if (typeof value === 'object') {
          sanitized[key] = sanitize(value, depth + 1);
        } else {
          sanitized[key] = value;
        }
      }

      return sanitized;
    };

    return sanitize(data);
  }

  /**
   * Émet un log vers la sortie appropriée
   */
  private emit(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    if (this.environment === 'development') {
      // Console colorée en développement
      this.consoleLog(entry);
    } else {
      // JSON structuré en production (compatible Cloud Logging)
      console.log(JSON.stringify(entry));
    }
  }

  /**
   * Affichage console formaté pour le développement
   */
  private consoleLog(entry: LogEntry): void {
    const colors = {
      [LogLevel.DEBUG]: '\x1b[36m', // Cyan
      [LogLevel.INFO]: '\x1b[32m',  // Green
      [LogLevel.WARN]: '\x1b[33m',  // Yellow
      [LogLevel.ERROR]: '\x1b[31m', // Red
      [LogLevel.FATAL]: '\x1b[35m', // Magenta
    };

    const reset = '\x1b[0m';
    const color = colors[entry.level];
    
    const timestamp = entry.timestamp.substring(11, 23); // HH:MM:SS.mmm
    const level = entry.level.toUpperCase().padEnd(5);
    const context = entry.context ? ` [${JSON.stringify(entry.context)}]` : '';
    
    console.log(`${color}${timestamp} ${level}${reset} ${entry.message}${context}`);
    
    if (entry.data) {
      console.log('  Data:', entry.data);
    }
    
    if (entry.error) {
      console.log('  Error:', entry.error);
    }
  }

  /**
   * Log de niveau DEBUG
   */
  public debug(message: string, data?: any, context?: LogContext): void {
    this.emit(this.createLogEntry(LogLevel.DEBUG, message, data, undefined, context));
  }

  /**
   * Log de niveau INFO
   */
  public info(message: string, data?: any, context?: LogContext): void {
    this.emit(this.createLogEntry(LogLevel.INFO, message, data, undefined, context));
  }

  /**
   * Log de niveau WARN
   */
  public warn(message: string, data?: any, context?: LogContext): void {
    this.emit(this.createLogEntry(LogLevel.WARN, message, data, undefined, context));
  }

  /**
   * Log de niveau ERROR
   */
  public error(message: string, error?: Error | any, context?: LogContext): void {
    // Si le second paramètre n'est pas une erreur, on le traite comme des données
    if (error && !(error instanceof Error) && !error.message) {
      this.emit(this.createLogEntry(LogLevel.ERROR, message, error, undefined, context));
    } else {
      this.emit(this.createLogEntry(LogLevel.ERROR, message, undefined, error, context));
    }
  }

  /**
   * Log de niveau FATAL
   */
  public fatal(message: string, error?: Error, context?: LogContext): void {
    this.emit(this.createLogEntry(LogLevel.FATAL, message, undefined, error, context));
  }

  /**
   * Log spécifique pour les transactions financières
   */
  public financial(message: string, data?: any, context?: LogContext): void {
    const financialContext = {
      ...context,
      category: 'financial',
      sensitive: true
    };
    this.emit(this.createLogEntry(LogLevel.INFO, `[FINANCIAL] ${message}`, data, undefined, financialContext));
  }

  /**
   * Log avec mesure de performance automatique
   */
  public withPerformance<T>(
    operation: string,
    fn: () => T | Promise<T>,
    context?: LogContext
  ): Promise<T> {
    const startTime = Date.now();
    const operationId = `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.debug(`Starting ${operation}`, { operationId }, context);

    const measure = async (result: T): Promise<T> => {
      const duration = Date.now() - startTime;
      
      this.info(`Completed ${operation}`, {
        operationId,
        duration,
        success: true,
      }, context);
      
      return result;
    };

    const measureError = async (error: any): Promise<never> => {
      const duration = Date.now() - startTime;
      
      this.error(`Failed ${operation}`, {
        operationId,
        duration,
        success: false,
        error: error.message,
      }, context);
      
      throw error;
    };

    try {
      const result = fn();
      
      if (result instanceof Promise) {
        return result.then(measure).catch(measureError);
      } else {
        return Promise.resolve(measure(result));
      }
    } catch (error) {
      return measureError(error);
    }
  }

  /**
   * Log d'événements de sécurité
   */
  public security(
    event: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    data?: any,
    context?: LogContext
  ): void {
    const logLevel = severity === 'critical' ? LogLevel.FATAL :
                    severity === 'high' ? LogLevel.ERROR :
                    severity === 'medium' ? LogLevel.WARN : LogLevel.INFO;

    this.emit(this.createLogEntry(
      logLevel,
      `SECURITY: ${event}`,
      data,
      undefined,
      { ...context, securityEvent: event, severity }
    ));
  }

  /**
   * Log d'événements d'audit
   */
  public audit(
    action: string,
    resource: string,
    result: 'success' | 'failure',
    data?: any,
    context?: LogContext
  ): void {
    this.info(`AUDIT: ${action} on ${resource}`, {
      ...data,
      auditAction: action,
      auditResource: resource,
      auditResult: result,
    }, context);
  }

  /**
   * Log d'événements métier
   */
  public business(
    event: string,
    entity: string,
    data?: any,
    context?: LogContext
  ): void {
    this.info(`BUSINESS: ${event}`, {
      ...data,
      businessEvent: event,
      businessEntity: entity,
    }, context);
  }

  /**
   * Crée un logger enfant avec un contexte spécifique
   */
  public child(context: LogContext): Logger {
    const childLogger = new Logger();
    childLogger.context = { ...this.context, ...context };
    childLogger.startTime = this.startTime;
    return childLogger;
  }

  /**
   * Middleware pour Express/Firebase Functions
   */
  public middleware() {
    return (req: any, res: any, next: any): void => {
      const traceId = req.headers['x-cloud-trace-context']?.split('/')[0] || 
                     `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const requestContext: LogContext = {
        traceId,
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip || req.connection.remoteAddress,
      };

      // Ajouter l'ID utilisateur si disponible
      if (req.user) {
        requestContext.userId = req.user.uid;
      }

      this.setContext(requestContext);
      
      this.info('Request started', {
        method: req.method,
        url: req.url,
        headers: this.sanitizeData(req.headers),
      });

      const startTime = Date.now();
      
      // Intercepter la réponse
      const originalSend = res.send;
      res.send = function(data: any) {
        const duration = Date.now() - startTime;
        
        logger.info('Request completed', {
          statusCode: res.statusCode,
          duration,
          responseSize: data ? Buffer.byteLength(data, 'utf8') : 0,
        });
        
        return originalSend.call(this, data);
      };

      next();
    };
  }
}

/**
 * Instance globale du logger
 */
export const logger = new Logger();

/**
 * Factory pour créer des loggers spécialisés
 */
export const createLogger = (context: LogContext): Logger => {
  return logger.child(context);
};

/**
 * Utilitaires de logging pour Firebase Functions
 */
export const functionsLogger = {
  /**
   * Log de démarrage d'une fonction
   */
  start: (functionName: string, data?: any, context?: LogContext): void => {
    logger.info(`Function ${functionName} started`, data, {
      ...context,
      functionName,
    });
  },

  /**
   * Log de fin d'une fonction
   */
  end: (functionName: string, data?: any, context?: LogContext): void => {
    logger.info(`Function ${functionName} completed`, data, {
      ...context,
      functionName,
    });
  },

  /**
   * Log d'erreur d'une fonction
   */
  error: (functionName: string, error: Error, context?: LogContext): void => {
    logger.error(`Function ${functionName} failed`, error, {
      ...context,
      functionName,
    });
  },

  /**
   * Wrapper pour logger automatiquement une fonction
   */
  wrap: <T extends any[], R>(
    functionName: string,
    fn: (...args: T) => R | Promise<R>
  ) => {
    return async (...args: T): Promise<R> => {
      functionsLogger.start(functionName, { argsCount: args.length });
      
      try {
        const result = await fn(...args);
        functionsLogger.end(functionName, { success: true });
        return result;
      } catch (error) {
        functionsLogger.error(functionName, error as Error);
        throw error;
      }
    };
  },
};

// Types déjà exportés ci-dessus