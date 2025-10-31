import { Router } from 'express';
import { userController } from './userController';
import { createSecurityMiddleware, createAuthSecurityMiddleware, createDataProtectionMiddleware } from '../../security/securityMiddleware';
import { authenticationMiddleware } from '../../middleware/auth';
import { rateLimitMiddleware } from '../../middleware/rateLimit';
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

// Apply authentication security middleware
router.use(createAuthSecurityMiddleware());

// Rate limiting for user operations
const userRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many user requests from this IP'
});

const strictRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many administrative requests from this IP'
});

// Public routes (no authentication required)
router.get('/search', 
  userRateLimit,
  userController.searchUsers.bind(userController)
);

router.get('/:id',
  userRateLimit,
  userController.getUserById.bind(userController)
);

// Registration route
router.post('/',
  strictRateLimit,
  validationMiddleware('userCreate'),
  userController.createUser.bind(userController)
);

// Protected routes (authentication required)
router.use(authenticationMiddleware); // All routes below require authentication

// User profile routes
router.get('/profile/me',
  userRateLimit,
  createDataProtectionMiddleware('pii'),
  userController.getUserProfile.bind(userController)
);

router.put('/:id',
  userRateLimit,
  createDataProtectionMiddleware('pii'),
  validationMiddleware('userUpdate'),
  userController.updateUser.bind(userController)
);

router.delete('/:id',
  strictRateLimit,
  createDataProtectionMiddleware('pii'),
  userController.deleteUser.bind(userController)
);

// Administrative routes (admin permissions required)
router.put('/:id/roles',
  strictRateLimit,
  createDataProtectionMiddleware('restricted'),
  validationMiddleware('userRoleUpdate'),
  userController.updateUserRoles.bind(userController)
);

export { router as userRoutes };