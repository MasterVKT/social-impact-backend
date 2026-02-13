/**
 * Sync Platform Metrics Scheduled Firebase Function
 * Social Finance Impact Platform
 */

import { pubsub } from 'firebase-functions';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { UserDocument, ProjectDocument, ContributionDocument } from '../types/firestore';
import { STATUS, METRICS_CONFIG } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour les métriques globales de la plateforme
 */
interface PlatformMetrics {
  timestamp: Date;
  period: {
    startDate: Date;
    endDate: Date;
    type: 'hourly' | 'daily' | 'weekly' | 'monthly';
  };
  users: {
    total: number;
    active: number;
    new: number;
    byType: {
      creators: number;
      contributors: number;
      auditors: number;
    };
    kycApproved: number;
    averageActivity: number;
  };
  projects: {
    total: number;
    active: number;
    completed: number;
    cancelled: number;
    new: number;
    totalFunding: number;
    averageFunding: number;
    byCategory: Record<string, number>;
    byStatus: Record<string, number>;
  };
  contributions: {
    total: number;
    amount: number;
    average: number;
    uniqueContributors: number;
    byRange: Record<string, number>;
    velocity: number;
  };
  financial: {
    totalVolume: number;
    escrowHeld: number;
    interestAccrued: number;
    platformFees: number;
    refundsProcessed: number;
    cashFlow: number;
  };
  performance: {
    apiRequests: number;
    errorRate: number;
    averageResponseTime: number;
    peakConcurrency: number;
    dataStorageUsed: number;
    bandwidthUsed: number;
  };
  engagement: {
    projectViews: number;
    projectShares: number;
    emailsOpened: number;
    pushNotificationsDelivered: number;
    userSessions: number;
    averageSessionDuration: number;
  };
}

/**
 * Interface pour les résultats de synchronisation
 */
interface MetricsSyncResults {
  metricsCollected: number;
  periodsProcessed: number;
  errors: number;
  processingTime: number;
  batchId: string;
  dataPoints: {
    hourly: number;
    daily: number;
    weekly: number;
    monthly: number;
  };
  alertsTriggered: number;
}

/**
 * Collecte les métriques utilisateurs
 */
async function collectUserMetrics(
  startDate: Date, 
  endDate: Date, 
  periodType: 'hourly' | 'daily' | 'weekly' | 'monthly'
): Promise<PlatformMetrics['users']> {
  try {
    const [
      totalUsers,
      activeUsers,
      newUsers,
      kycApprovedUsers
    ] = await Promise.all([
      firestoreHelper.queryDocuments<UserDocument>('users', [
        ['status', '!=', 'deleted']
      ]),
      firestoreHelper.queryDocuments<UserDocument>('users', [
        ['stats.lastActivity', '>=', startDate],
        ['status', '==', 'active']
      ]),
      firestoreHelper.queryDocuments<UserDocument>('users', [
        ['createdAt', '>=', startDate],
        ['createdAt', '<', endDate]
      ]),
      firestoreHelper.queryDocuments<UserDocument>('users', [
        ['kycCompletedAt', '>=', startDate],
        ['kycCompletedAt', '<', endDate],
        ['kycStatus', '==', 'approved']
      ])
    ]);

    const byType = totalUsers.data.reduce((counts, user) => {
      counts[user.userType]++;
      return counts;
    }, { creators: 0, contributors: 0, auditors: 0 });

    const totalSessions = activeUsers.data.reduce((sum, user) => sum + (user.stats?.sessionsCount || 0), 0);
    const averageActivity = activeUsers.data.length > 0 ? totalSessions / activeUsers.data.length : 0;

    return {
      total: totalUsers.data.length,
      active: activeUsers.data.length,
      new: newUsers.data.length,
      byType,
      kycApproved: kycApprovedUsers.data.length,
      averageActivity
    };

  } catch (error) {
    logger.error('Failed to collect user metrics', error, { periodType });
    throw error;
  }
}

/**
 * Collecte les métriques de projets
 */
async function collectProjectMetrics(
  startDate: Date, 
  endDate: Date,
  periodType: 'hourly' | 'daily' | 'weekly' | 'monthly'
): Promise<PlatformMetrics['projects']> {
  try {
    const [
      allProjects,
      newProjects,
      completedProjects,
      cancelledProjects
    ] = await Promise.all([
      firestoreHelper.queryDocuments<ProjectDocument>('projects', []),
      firestoreHelper.queryDocuments<ProjectDocument>('projects', [
        ['createdAt', '>=', startDate],
        ['createdAt', '<', endDate]
      ]),
      firestoreHelper.queryDocuments<ProjectDocument>('projects', [
        ['completedAt', '>=', startDate],
        ['completedAt', '<', endDate],
        ['status', '==', STATUS.PROJECT.COMPLETED]
      ]),
      firestoreHelper.queryDocuments<ProjectDocument>('projects', [
        ['updatedAt', '>=', startDate],
        ['updatedAt', '<', endDate],
        ['status', '==', STATUS.PROJECT.CANCELLED]
      ])
    ]);

    const byStatus = allProjects.data.reduce((counts, project) => {
      counts[project.status] = (counts[project.status] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    const byCategory = allProjects.data.reduce((counts, project) => {
      counts[project.category] = (counts[project.category] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    const activeProjects = allProjects.data.filter(p => p.status === STATUS.PROJECT.ACTIVE);
    const totalFunding = activeProjects.reduce((sum, project) => sum + project.currentFunding, 0);
    const averageFunding = activeProjects.length > 0 ? totalFunding / activeProjects.length : 0;

    return {
      total: allProjects.data.length,
      active: activeProjects.length,
      completed: completedProjects.data.length,
      cancelled: cancelledProjects.data.length,
      new: newProjects.data.length,
      totalFunding,
      averageFunding,
      byCategory,
      byStatus
    };

  } catch (error) {
    logger.error('Failed to collect project metrics', error, { periodType });
    throw error;
  }
}

/**
 * Fonction principale de synchronisation des métriques
 */
async function executeMetricsSync(): Promise<MetricsSyncResults> {
  const batchId = helpers.string.generateId('metrics_sync');
  const startTime = Date.now();

  const results: MetricsSyncResults = {
    metricsCollected: 0,
    periodsProcessed: 0,
    errors: 0,
    processingTime: 0,
    batchId,
    dataPoints: {
      hourly: 0,
      daily: 0,
      weekly: 0,
      monthly: 0
    },
    alertsTriggered: 0
  };

  try {
    logger.info('Starting platform metrics sync', { batchId });

    const now = new Date();
    
    // Collecter métriques quotidiennes
    const dailyStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const dailyEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [userMetrics, projectMetrics] = await Promise.all([
      collectUserMetrics(dailyStartDate, dailyEndDate, 'daily'),
      collectProjectMetrics(dailyStartDate, dailyEndDate, 'daily')
    ]);

    // Sauvegarder les métriques globales
    await firestoreHelper.updateDocument('platform_stats', 'global', {
      'users.total': userMetrics.total,
      'users.active': userMetrics.active,
      'projects.total': projectMetrics.total,
      'projects.active': projectMetrics.active,
      'lastMetricsSync': now
    });

    results.metricsCollected = 2;
    results.periodsProcessed = 1;
    results.dataPoints.daily = 1;
    results.processingTime = Date.now() - startTime;

    logger.info('Platform metrics sync completed', results);

    return results;

  } catch (error) {
    logger.error('Failed to execute metrics sync', error, { batchId });
    results.errors++;
    return results;
  }
}

/**
 * Fonction Cloud Scheduler - Synchronisation des métriques
 */
export const syncPlatformMetrics = pubsub
  .schedule('0 */1 * * *') // Toutes les heures
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const executionId = helpers.string.generateId('metrics_exec');
    const startTime = Date.now();

    try {
      logger.info('Sync platform metrics scheduled function started', {
        executionId,
        scheduledTime: context.timestamp,
        timezone: 'Europe/Paris'
      });

      const results = await executeMetricsSync();

      logger.business('Platform metrics synchronized', 'analytics', {
        executionId,
        scheduledAt: context.timestamp,
        results,
        timestamp: new Date().toISOString()
      });

      await firestoreHelper.setDocument('scheduled_executions', executionId, {
        id: executionId,
        functionName: 'syncPlatformMetrics',
        executionTime: new Date(),
        duration: Date.now() - startTime,
        status: 'completed',
        results,
        nextScheduledRun: new Date(Date.now() + 60 * 60 * 1000),
        createdAt: new Date()
      });

      logger.info('Sync platform metrics scheduled function completed successfully', {
        executionId,
        duration: Date.now() - startTime,
        metricsCollected: results.metricsCollected
      });

    } catch (error) {
      logger.error('Sync platform metrics scheduled function failed', error, {
        executionId,
        scheduledTime: context.timestamp,
        duration: Date.now() - startTime
      });

      try {
        await firestoreHelper.setDocument('scheduled_executions', executionId, {
          id: executionId,
          functionName: 'syncPlatformMetrics',
          executionTime: new Date(),
          duration: Date.now() - startTime,
          status: 'failed',
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date()
          },
          retryScheduled: new Date(Date.now() + 15 * 60 * 1000),
          createdAt: new Date()
        });
      } catch (logError) {
        logger.error('Failed to log metrics sync execution failure', logError, { executionId });
      }

      throw error;
    }
  });