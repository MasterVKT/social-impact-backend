import { Router } from 'express';
import { projectController } from './projectController';
import { createSecurityMiddleware, createDataProtectionMiddleware } from '../../security/securityMiddleware';
import { authenticationMiddleware, optionalAuthenticationMiddleware, requireRole } from '../../middleware/auth';
import { rateLimitMiddleware, apiRateLimit, strictRateLimit } from '../../middleware/rateLimit';
import { validationMiddleware } from '../../middleware/validation';

const router = Router();

// Apply global security middleware
router.use(createSecurityMiddleware({
  enableThreatDetection: true,
  enableAccessControl: true,
  enableMonitoring: true,
  riskThreshold: 70,
  blockOnHighRisk: true
}));

// Rate limiting for project operations
const projectRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 requests per windowMs
  message: 'Too many project requests from this IP'
});

// Public routes (no authentication required, but may use optional auth for enhanced features)
router.get('/search',
  projectRateLimit,
  optionalAuthenticationMiddleware,
  projectController.searchProjects.bind(projectController)
);

router.get('/:id',
  projectRateLimit,
  optionalAuthenticationMiddleware,
  projectController.getProjectById.bind(projectController)
);

// Protected routes (authentication required)
router.use(authenticationMiddleware);

// Project creation and management routes
router.post('/',
  strictRateLimit,
  requireRole(['creator', 'admin']),
  createDataProtectionMiddleware('sensitive'),
  validationMiddleware('projectCreate'),
  projectController.createProject.bind(projectController)
);

router.put('/:id',
  projectRateLimit,
  createDataProtectionMiddleware('sensitive'),
  validationMiddleware('projectUpdate'),
  projectController.updateProject.bind(projectController)
);

// Project publishing
router.post('/:id/publish',
  strictRateLimit,
  requireRole(['creator', 'admin']),
  createDataProtectionMiddleware('sensitive'),
  projectController.publishProject.bind(projectController)
);

export { router as projectRoutes };