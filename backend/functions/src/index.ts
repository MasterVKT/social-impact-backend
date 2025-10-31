/**
 * Firebase Functions Entry Point
 * Social Finance Impact Platform
 * 
 * This file exports all Firebase Functions for deployment
 */

import { onRequest } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import express from 'express';
import { logger } from './utils/logger';
import { apiRouter } from './api';

// ============================================================================
// GLOBAL CONFIGURATION
// ============================================================================

// Set global options for all functions
setGlobalOptions({
  region: 'europe-west1',
  memory: '1GiB',
  timeoutSeconds: 540,
  maxInstances: 100,
  minInstances: 1, // Keep warm instances for production
  concurrency: 1000,
  invoker: 'public'
});

// ============================================================================
// API FUNCTION - MAIN REST API
// ============================================================================

const app = express();

// Add global error handling
app.use((req, res, next) => {
  res.on('error', (error) => {
    logger.error('Response error', error);
  });
  next();
});

// Mount API router
app.use('/api', apiRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Social Finance Impact Platform API',
    version: '2.0.0',
    status: 'operational',
    timestamp: new Date().toISOString(),
    endpoints: {
      api: '/api/v2',
      health: '/api/health',
      status: '/api/status',
      docs: '/api/v2/docs'
    }
  });
});

// Export the main API function
export const api = onRequest({
  region: 'europe-west1',
  memory: '2GiB',
  timeoutSeconds: 300,
  maxInstances: 200,
  minInstances: 2,
  concurrency: 1000
}, app);

// ============================================================================
// AUTH MODULE FUNCTIONS
// ============================================================================

export { completeProfile } from './auth/completeProfile';
export { initKYC } from './auth/initKYC';
export { handleKYCWebhook } from './auth/handleKYCWebhook';
export { updateProfile } from './auth/updateProfile';

// ============================================================================
// PROJECTS MODULE FUNCTIONS
// ============================================================================

export { createProject } from './projects/createProject';
export { updateProject } from './projects/updateProject';
export { submitProject } from './projects/submitProject';
export { approveProject } from './projects/approveProject';
export { getProjectDetails } from './projects/getProjectDetails';
export { searchProjects } from './projects/searchProjects';
export { getProjectAnalytics } from './projects/getProjectAnalytics';

// ============================================================================
// PAYMENTS MODULE FUNCTIONS
// ============================================================================

export { createContribution } from './payments/createContribution';
export { confirmPayment } from './payments/confirmPayment';
export { handleStripeWebhook } from './payments/handleStripeWebhook';
export { processRefunds } from './payments/processRefunds';
export { releaseEscrow } from './payments/releaseEscrow';

// ============================================================================
// AUDITS MODULE FUNCTIONS
// ============================================================================

export { assignAuditor } from './audits/assignAuditor';
export { acceptAudit } from './audits/acceptAudit';
export { submitAuditReport } from './audits/submitAuditReport';
export { getAuditorDashboard } from './audits/getAuditorDashboard';

// ============================================================================
// NOTIFICATIONS MODULE FUNCTIONS
// ============================================================================

export { sendNotification } from './notifications/sendNotification';
export { getNotifications } from './notifications/getNotifications';
export { markAsRead } from './notifications/markAsRead';

// ============================================================================
// SYSTEM TRIGGERS
// ============================================================================

export { onUserCreate } from './triggers/onUserCreate';
export { onProjectUpdate } from './triggers/onProjectUpdate';
export { onPaymentSuccess } from './triggers/onPaymentSuccess';
export { onAuditComplete } from './triggers/onAuditComplete';

// ============================================================================
// SCHEDULED FUNCTIONS
// ============================================================================

export { calculateInterest } from './scheduled/calculateInterest';
export { cleanupExpiredData } from './scheduled/cleanupExpiredData';
export { sendDigestEmails } from './scheduled/sendDigestEmails';
export { updateRecommendations } from './scheduled/updateRecommendations';
export { processScheduledRefunds } from './scheduled/processScheduledRefunds';
export { updateTrendingProjects } from './scheduled/updateTrendingProjects';
export { generateMonthlyReports } from './scheduled/generateMonthlyReports';
export { syncPlatformMetrics } from './scheduled/syncPlatformMetrics';
export { processAuditQueue } from './scheduled/processAuditQueue';

// ============================================================================
// FIREBASE FUNCTIONS CONFIGURATION
// ============================================================================

/**
 * Firebase Functions Runtime Configuration
 * 
 * Default memory allocation: 1GB
 * Default timeout: 540 seconds (9 minutes)
 * Default region: Europe-West1 (Belgium)
 * 
 * Individual functions may override these settings as needed.
 */