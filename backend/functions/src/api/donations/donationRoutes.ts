import { Router } from 'express';
import { donationController } from './donationController';
import { createSecurityMiddleware, createDataProtectionMiddleware } from '../../security/securityMiddleware';
import { authenticationMiddleware, requireRole } from '../../middleware/auth';
import { rateLimitMiddleware, strictRateLimit, createUserRateLimit } from '../../middleware/rateLimit';
import { validationMiddleware } from '../../middleware/validation';

const router = Router();

// Apply global security middleware with enhanced financial protection
router.use(createSecurityMiddleware({
  enableThreatDetection: true,
  enableAccessControl: true,
  enableMonitoring: true,
  riskThreshold: 60, // Lower threshold for financial operations
  blockOnHighRisk: true,
  enableFinancialProtection: true
}));

// Financial-specific rate limiting
const donationRateLimit = rateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Strict limit for donation creation
  message: 'Too many donation attempts from this IP',
  keyGenerator: (req) => `donation:${req.ip}:${req.user?.uid || 'anonymous'}`
});

const donationProcessRateLimit = rateLimitMiddleware({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // Very strict for payment processing
  message: 'Too many payment processing attempts',
  keyGenerator: (req) => `payment:${req.ip}:${req.user?.uid || 'anonymous'}`
});

const donationRefundRateLimit = rateLimitMiddleware({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limited refund attempts
  message: 'Too many refund requests',
  keyGenerator: (req) => `refund:${req.ip}:${req.user?.uid || 'anonymous'}`
});

// User-based rate limiting for donations
const userDonationLimit = createUserRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Authenticated users get higher limits
  guestMax: 3, // Very limited for guests
  message: 'Donation rate limit exceeded for this user'
});

// All donation routes require authentication
router.use(authenticationMiddleware);

// Donation creation
router.post('/',
  donationRateLimit,
  userDonationLimit,
  createDataProtectionMiddleware('financial'),
  validationMiddleware('donationCreate'),
  donationController.createDonation.bind(donationController)
);

// Process donation payment
router.post('/:id/process',
  donationProcessRateLimit,
  createDataProtectionMiddleware('financial'),
  validationMiddleware('donationProcess'),
  donationController.processDonation.bind(donationController)
);

// Get donation by ID
router.get('/:id',
  rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many donation lookup requests'
  }),
  donationController.getDonationById.bind(donationController)
);

// Search donations
router.get('/',
  rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Too many donation search requests'
  }),
  donationController.searchDonations.bind(donationController)
);

// Refund donation (restricted to authorized users)
router.post('/:id/refund',
  donationRefundRateLimit,
  requireRole(['admin', 'support']), // Only admin and support can initiate refunds
  createDataProtectionMiddleware('financial'),
  validationMiddleware('donationRefund'),
  donationController.refundDonation.bind(donationController)
);

// Analytics endpoints (admin only)
router.get('/analytics/summary',
  strictRateLimit,
  requireRole(['admin', 'auditor']),
  async (req, res) => {
    // This would implement donation analytics
    res.status(501).json({
      error: 'Not implemented',
      message: 'Donation analytics endpoint not yet implemented'
    });
  }
);

router.get('/analytics/fraud-metrics',
  strictRateLimit,
  requireRole(['admin', 'auditor']),
  async (req, res) => {
    // This would implement fraud metrics
    res.status(501).json({
      error: 'Not implemented',
      message: 'Fraud metrics endpoint not yet implemented'
    });
  }
);

// Compliance endpoints (auditor access)
router.get('/compliance/audit-trail',
  strictRateLimit,
  requireRole(['admin', 'auditor']),
  async (req, res) => {
    // This would implement compliance audit trail
    res.status(501).json({
      error: 'Not implemented',
      message: 'Audit trail endpoint not yet implemented'
    });
  }
);

router.get('/compliance/aml-reports',
  strictRateLimit,
  requireRole(['admin', 'auditor']),
  async (req, res) => {
    // This would implement AML reporting
    res.status(501).json({
      error: 'Not implemented',
      message: 'AML reports endpoint not yet implemented'
    });
  }
);

// Webhook endpoints for payment processing
router.post('/webhooks/stripe',
  rateLimitMiddleware({
    windowMs: 60 * 1000, // 1 minute
    max: 1000, // High limit for webhooks
    message: 'Webhook rate limit exceeded',
    skip: (req) => {
      // Skip rate limiting if proper webhook signature
      return req.headers['stripe-signature'] !== undefined;
    }
  }),
  async (req, res) => {
    // This would handle Stripe webhooks
    res.status(501).json({
      error: 'Not implemented',
      message: 'Stripe webhook endpoint not yet implemented'
    });
  }
);

// Recurring donation management
router.get('/:id/recurring/status',
  rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: 'Too many recurring donation status requests'
  }),
  async (req, res) => {
    // This would get recurring donation status
    res.status(501).json({
      error: 'Not implemented',
      message: 'Recurring donation status endpoint not yet implemented'
    });
  }
);

router.post('/:id/recurring/cancel',
  strictRateLimit,
  createDataProtectionMiddleware('financial'),
  async (req, res) => {
    // This would cancel recurring donations
    res.status(501).json({
      error: 'Not implemented',
      message: 'Cancel recurring donation endpoint not yet implemented'
    });
  }
);

router.put('/:id/recurring/update',
  strictRateLimit,
  createDataProtectionMiddleware('financial'),
  async (req, res) => {
    // This would update recurring donation settings
    res.status(501).json({
      error: 'Not implemented',
      message: 'Update recurring donation endpoint not yet implemented'
    });
  }
);

export { router as donationRoutes };