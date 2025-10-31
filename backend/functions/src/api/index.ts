import { Router } from 'express';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { logger } from '../utils/logger';
import { auditLogger } from '../monitoring/auditLogger';
import { performanceMonitor } from '../monitoring/performanceMonitor';
import { metricsCollector } from '../monitoring/metricsCollector';
import { createSecurityMiddleware } from '../security/securityMiddleware';
import { apiRateLimit } from '../middleware/rateLimit';

// Import route handlers
import { userRoutes } from './users/userRoutes';
import { projectRoutes } from './projects/projectRoutes';
import { donationRoutes } from './donations/donationRoutes';

const router = Router();

// Global security headers and middleware
router.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration for production
router.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://socialfinanceimpact.org',
      'https://www.socialfinanceimpact.org',
      'https://admin.socialfinanceimpact.org',
      'https://api.socialfinanceimpact.org'
    ];
    
    // In development, allow localhost
    if (process.env.NODE_ENV === 'development') {
      allowedOrigins.push(
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:8080'
      );
    }
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS origin blocked', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-Source',
    'X-Request-ID'
  ],
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-Request-ID'
  ],
  maxAge: 86400 // 24 hours
}));

// Compression for response payloads
router.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// Request parsing with size limits
router.use(express.json({ 
  limit: '10mb',
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

router.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Global API security middleware
router.use(createSecurityMiddleware({
  enableThreatDetection: true,
  enableAccessControl: true,
  enableMonitoring: true,
  riskThreshold: 75,
  blockOnHighRisk: true
}));

// Global rate limiting
router.use(apiRateLimit);

// Request ID and logging middleware
router.use((req: any, res, next) => {
  // Generate unique request ID
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Request-ID', req.requestId);
  
  // Start performance trace
  req.startTime = Date.now();
  
  // Log incoming request
  logger.info('API Request', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    userId: req.user?.uid
  });
  
  next();
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Check database connectivity
    const dbHealth = await checkDatabaseHealth();
    
    // Check external services
    const servicesHealth = await checkExternalServices();
    
    const responseTime = Date.now() - startTime;
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      responseTime,
      services: {
        database: dbHealth,
        ...servicesHealth
      },
      system: {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      }
    };
    
    // Record health check metrics
    await metricsCollector.recordHistogram('api.health_check.response_time', responseTime);
    await metricsCollector.recordCounter('api.health_check.requests', 1, {
      status: 'success'
    });
    
    res.json(health);
    
  } catch (error) {
    logger.error('Health check failed', error as Error);
    
    await metricsCollector.recordCounter('api.health_check.requests', 1, {
      status: 'error'
    });
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
});

// API status and metrics endpoint
router.get('/status', async (req, res) => {
  try {
    const metrics = await metricsCollector.getMetrics();
    
    res.json({
      status: 'operational',
      timestamp: new Date().toISOString(),
      api: {
        version: '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        region: process.env.FUNCTION_REGION || 'unknown'
      },
      metrics: {
        requests: metrics.requests || 0,
        errors: metrics.errors || 0,
        averageResponseTime: metrics.averageResponseTime || 0
      }
    });
    
  } catch (error) {
    logger.error('Status endpoint error', error as Error);
    res.status(500).json({
      status: 'error',
      message: 'Unable to retrieve status'
    });
  }
});

// Route registration with versioning
const API_VERSION = 'v2';

router.use(`/${API_VERSION}/users`, userRoutes);
router.use(`/${API_VERSION}/projects`, projectRoutes);
router.use(`/${API_VERSION}/donations`, donationRoutes);

// API documentation endpoint
router.get(`/${API_VERSION}/docs`, (req, res) => {
  res.json({
    name: 'Social Finance Impact Platform API',
    version: API_VERSION,
    description: 'Secure API for social finance and impact investment platform',
    endpoints: {
      users: {
        base: `/api/${API_VERSION}/users`,
        operations: ['GET /', 'POST /', 'GET /:id', 'PUT /:id', 'DELETE /:id', 'GET /profile', 'PUT /profile', 'PUT /:id/roles']
      },
      projects: {
        base: `/api/${API_VERSION}/projects`,
        operations: ['GET /search', 'GET /:id', 'POST /', 'PUT /:id', 'POST /:id/publish']
      },
      donations: {
        base: `/api/${API_VERSION}/donations`,
        operations: ['POST /', 'POST /:id/process', 'GET /:id', 'GET /', 'POST /:id/refund']
      }
    },
    authentication: 'Firebase ID Token required for most endpoints',
    rateLimit: 'Rate limiting applied per endpoint and user',
    security: 'Enterprise-grade security with threat detection and monitoring'
  });
});

// 404 handler for unknown API routes
router.use(`/${API_VERSION}/*`, (req, res) => {
  logger.warn('API route not found', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  
  res.status(404).json({
    error: 'Endpoint not found',
    message: `The requested endpoint ${req.method} ${req.path} does not exist`,
    availableEndpoints: [
      `/api/${API_VERSION}/users`,
      `/api/${API_VERSION}/projects`, 
      `/api/${API_VERSION}/donations`
    ]
  });
});

// Global error handler
router.use((error: any, req: any, res: any, next: any) => {
  const requestId = req.requestId;
  const responseTime = Date.now() - req.startTime;
  
  // Log error with context
  logger.error('API Error', error, {
    requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userId: req.user?.uid,
    responseTime
  });
  
  // Record error metrics
  metricsCollector.recordCounter('api.errors', 1, {
    endpoint: req.path,
    method: req.method,
    statusCode: error.status || 500
  });
  
  // Audit log for security-related errors
  if (error.status === 401 || error.status === 403 || error.status === 429) {
    auditLogger.logUserAction(
      req.user?.uid || 'anonymous',
      'access',
      'endpoint',
      req.path,
      'failure',
      {
        service: 'api-router',
        error: error.message,
        statusCode: error.status
      }
    );
  }
  
  // Determine error response
  const statusCode = error.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';
  
  const errorResponse: any = {
    error: error.name || 'Internal Server Error',
    message: error.message || 'An unexpected error occurred',
    requestId,
    timestamp: new Date().toISOString()
  };
  
  // Include stack trace in development
  if (!isProduction && error.stack) {
    errorResponse.stack = error.stack;
  }
  
  // Include validation details if available
  if (error.details) {
    errorResponse.details = error.details;
  }
  
  res.status(statusCode).json(errorResponse);
});

// Response time logging middleware
router.use((req: any, res, next) => {
  res.on('finish', () => {
    const responseTime = Date.now() - req.startTime;
    
    // Log response
    logger.info('API Response', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      responseTime,
      userId: req.user?.uid
    });
    
    // Record response time metrics
    metricsCollector.recordHistogram('api.response_time', responseTime, {
      endpoint: req.path,
      method: req.method,
      statusCode: res.statusCode.toString()
    });
    
    // Record request counter
    metricsCollector.recordCounter('api.requests', 1, {
      endpoint: req.path,
      method: req.method,
      statusCode: res.statusCode.toString()
    });
  });
  
  next();
});

// Helper functions
async function checkDatabaseHealth(): Promise<{ status: string; responseTime: number }> {
  try {
    const startTime = Date.now();
    // Simple database connectivity test
    await require('../config/database').firestoreDb.collection('health').limit(1).get();
    return {
      status: 'healthy',
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      responseTime: -1
    };
  }
}

async function checkExternalServices(): Promise<Record<string, { status: string; responseTime: number }>> {
  const services: Record<string, { status: string; responseTime: number }> = {};
  
  // Check Firebase Auth
  try {
    const startTime = Date.now();
    await require('firebase-admin').auth().listUsers(1);
    services.firebase_auth = {
      status: 'healthy',
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    services.firebase_auth = {
      status: 'unhealthy',
      responseTime: -1
    };
  }
  
  return services;
}

export { router as apiRouter };